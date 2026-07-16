import {once} from 'node:events'
import type {IncomingMessage, ServerResponse} from 'node:http'
import type {PostData} from '@devvit/shared-types/PostData.js'
import {context, reddit} from '@devvit/web/server'
import type {
  PartialJsonValue,
  TriggerResponse,
  UiResponse,
} from '@devvit/web/shared'
import {
  type ComposeSubmitReq,
  type ComposeSubmitRsp,
  Endpoint,
  EndpointMethod,
  type ErrorRsp,
  type ResolveReq,
  type ResolveRsp,
  type SearchRsp,
} from '../shared/api.ts'
import {parseReadZenLink} from '../shared/extract.ts'
import {parseRoute, type RzRoute} from '../shared/route.ts'
import {countWords} from '../shared/words.ts'
import {resolveContent} from './content/resolve.ts'
import {
  dbGetPostMeta,
  dbPurgePost,
  dbSetPostMeta,
  getJson,
  setJson,
} from './db.ts'
import {
  buildExpandForm,
  buildExpandPostForm,
  expandAsPost,
  expandAsReply,
  MAX_POST_CHARS,
  readTargetBody,
  routesFromText,
  truncateFallback,
} from './ingest.ts'
import {attrLine, buildPostData, buildTextFallback} from './render.ts'
import {searchAll} from './search/engine.ts'

/** Hub post lives at the 30-day compliance ceiling (setJson allows exactly ≤30d). */
const HUB_TTL_MS = 30 * 24 * 3600 * 1000

/**
 * DEBUG SWITCH — USER-attribution diagnostics.
 *
 * When `true`, `routeComposeSubmit` does NOT silently fall back to an
 * APP-attributed post if the USER-attributed `submitCustomPost({runAs:'USER'})`
 * throws. Instead it returns the raw Reddit reason (502 + `detail`) so the real
 * failure surfaces in the client toast — and NO misattributed APP post is
 * created. This is what we want WHILE DEBUGGING, because the user requires posts
 * under real usernames: a graceful APP fallback hides the very error we need.
 *
 * When `false`, the graceful APP fallback is used (a post always lands, with an
 * attribution byline, and `fallbackReason` records why USER attribution failed).
 * Flip to `false` for production-safety once USER attribution is confirmed live.
 */
const STRICT_USER_ATTRIBUTION = true

/** Old-Reddit text for the hub post; the webview opens the composer inline when a post has no postData. */
const HUB_INVITE_MD =
  'Tap **“Share a passage”** to post a koan or teaching from the Zen canon — bilingual Chinese and English, with your own commentary.'

type AnyRsp =
  | SearchRsp
  | ResolveRsp
  | ComposeSubmitRsp
  | UiResponse
  | TriggerResponse
  | ErrorRsp

export async function onReq(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  try {
    await route(reqMsg, rspMsg)
  } catch (err) {
    const msg = `server error; ${err instanceof Error ? err.stack : err}`
    console.error(msg)
    writeJson<ErrorRsp>(500, {error: msg, status: 500}, rspMsg)
  }
}

async function route(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  // Split the path from the query string BEFORE endpoint lookup, so GET routes
  // like `api/search?q=dog` still match `Endpoint.Search`.
  const [path = '', qs = ''] = (reqMsg.url ?? '').slice(1).split('?')
  const endpoint = path as Endpoint
  const method = EndpointMethod[endpoint]

  let rsp: AnyRsp
  if (method !== reqMsg.method) {
    rsp = {error: 'not found', status: 404}
  } else {
    switch (endpoint) {
      case Endpoint.Search: {
        const q = new URLSearchParams(qs).get('q') ?? ''
        rsp = await routeSearch(q)
        break
      }
      case Endpoint.Resolve:
        rsp = await routeResolve(reqMsg)
        break
      case Endpoint.ComposeSubmit:
        rsp = await routeComposeSubmit(reqMsg)
        break
      case Endpoint.OnAppInstall:
        rsp = await routeAppInstall()
        break
      case Endpoint.OnMenuOpenComposer:
        rsp = await routeMenuOpenComposer()
        break
      case Endpoint.OnMenuExpandLink:
        rsp = await routeMenuExpandLink(reqMsg)
        break
      case Endpoint.OnFormExpandLink:
        rsp = await routeFormExpandLink(reqMsg)
        break
      case Endpoint.OnFormExpandLinkPost:
        rsp = await routeFormExpandLinkPost(reqMsg)
        break
      case Endpoint.OnPostDelete:
        rsp = await routePostDelete(reqMsg)
        break
      case Endpoint.OnCommentDelete:
        rsp = await routeCommentDelete(reqMsg)
        break
      default:
        endpoint satisfies never
        rsp = {error: 'not found', status: 404}
        break
    }
  }

  writeJson<PartialJsonValue>('status' in rsp ? rsp.status : 200, rsp, rspMsg)
}

/** Live corpus search; `q` is already parsed from ?q=. Blank q → searchAll []. */
async function routeSearch(q: string): Promise<SearchRsp> {
  const hits = await searchAll(q)
  return {hits, source: 'live', fulltextAvailable: false}
}

/**
 * Parse the resolve endpoint's `route` input, tolerating BOTH shapes it can
 * arrive in: a BARE client route (search hits, classic cases, range-picker
 * output — `parseRoute` handles these) and the reader's FULL-URL route
 * (`content.rzLink` = `https://readzen.pages.dev/#/…` — only the URL extractor
 * reads these). Bare parser first, URL extractor as fallback. Returns null when
 * neither yields a known kind.
 */
export function parseResolveRoute(input: string): RzRoute | null {
  const route = parseRoute(input)
  if (route && route.kind !== 'unknown') return route
  const fallback = parseReadZenLink(input)
  if (fallback && fallback.kind !== 'unknown') return fallback
  return null
}

async function routeResolve(
  reqMsg: IncomingMessage,
): Promise<ResolveRsp | ErrorRsp> {
  const req = await readJson<ResolveReq>(reqMsg)
  const route = parseResolveRoute(req.route)
  if (!route) return {error: 'unresolvable route', status: 400}
  const rsp = await resolveContent(route)
  if (!rsp) return {error: 'content not found', status: 404}
  // Attach the post's stored commentary when this webview request is bound to a
  // post that has one. Hub / old-v1 posts miss → commentary stays undefined.
  const meta = context.postId ? await dbGetPostMeta(context.postId) : undefined
  return {...rsp, commentary: meta?.commentary}
}

/**
 * Re-resolve the passage server-side (never trust the client's content) and
 * submit it as the invoking user's OWN custom post. The gate is enforced here
 * (never trusting the client): a real title (≥3 chars) and ≥200 words of
 * commentary via the shared `countWords`. The submitted title is the USER's own
 * (the server no longer rebuilds it); commentary rides in postData (teaser),
 * textFallback (old-Reddit copy), and durable postmeta (the webview copy). The
 * USER path carries `userGeneratedContent` for moderation; while
 * STRICT_USER_ATTRIBUTION is on, a USER-submit throw surfaces the raw reason
 * (no misattributed APP fallback). No auto top-level comment is created — the
 * commentary is now first-class in the post itself.
 */
async function routeComposeSubmit(
  reqMsg: IncomingMessage,
): Promise<ComposeSubmitRsp | ErrorRsp> {
  const req = await readJson<ComposeSubmitReq>(reqMsg)
  // Gate (server-side, never trust the client): a title of their own + ≥200
  // words of commentary. These 400s surface in the Step 2 error line.
  const title = (req.title ?? '').trim()
  if (title.length < 3)
    return {error: 'A title of your own is required.', status: 400}
  const words = countWords(req.commentary ?? '')
  if (words < 200)
    return {
      error: `Commentary must be at least 200 words (currently ${words}).`,
      status: 400,
    }

  // The composer always sends a BARE route (range-picker / master hit) → parse
  // it directly; an unknown kind is a client bug and surfaces as an error toast.
  const route = parseRoute(req.route)
  if (!route || route.kind === 'unknown')
    return {error: 'That passage could not be loaded.', status: 400}
  const resolved = await resolveContent(route)
  if (!resolved)
    return {error: 'That passage could not be loaded.', status: 400}

  const content = resolved.content
  const postData = buildPostData(content, req.commentary) as unknown as PostData
  // A 400-line open-ended passage can blow past Reddit's ~40k selftext cap and
  // make submitCustomPost throw; clamp the post fallback with a read-more link.
  const fallback = truncateFallback(
    buildTextFallback(content, req.commentary),
    content.rzLink,
    MAX_POST_CHARS,
  )
  // Moderation payload: the full case + the user's commentary, untruncated.
  const ugcText = buildTextFallback(content, req.commentary)
  // The APP-run fallback loses author attribution, so we prepend a byline the
  // reader can see is theirs (Markdown blockquote).
  const bylineFallback = `> Shared by u/${context.username ?? 'a reader'} via ReadZen\n\n${fallback}`

  type SubmittedPost = Awaited<ReturnType<typeof reddit.submitCustomPost>>
  let post: SubmittedPost
  let asUser: boolean
  // Populated only on the graceful-fallback path so the client can say WHY
  // USER attribution was lost instead of failing silently.
  let fallbackReason: string | undefined
  try {
    post = await reddit.submitCustomPost({
      title: title.slice(0, 300),
      postData,
      textFallback: {text: fallback},
      runAs: 'USER',
      userGeneratedContent: {text: ugcText},
    })
    asUser = true
  } catch (userErr) {
    console.error(
      `compose submit failed (USER): ${userErr instanceof Error ? userErr.stack : userErr}`,
    )
    const userReason =
      userErr instanceof Error ? userErr.message : String(userErr)
    // STRICT mode (debugging): surface the raw Reddit reason and refuse to
    // create a misattributed APP post. The user requires real-username posts,
    // so a silent APP fallback would hide the exact error we're hunting.
    if (STRICT_USER_ATTRIBUTION) {
      return {
        error: 'Could not post as you.',
        status: 502,
        detail: userReason,
      }
    }
    try {
      // APP default (no runAs, no userGeneratedContent) with the byline fallback.
      post = await reddit.submitCustomPost({
        title: title.slice(0, 300),
        postData,
        textFallback: {text: bylineFallback},
      })
      asUser = false
      fallbackReason = userReason
    } catch (appErr) {
      console.error(
        `compose submit failed (APP fallback): ${appErr instanceof Error ? appErr.stack : appErr}`,
      )
      return {
        error: 'We couldn’t post that just now. Please try again.',
        status: 502,
        detail: appErr instanceof Error ? appErr.message : String(appErr),
      }
    }
  }

  // Store the commentary durably so routeResolve can attach it to the webview.
  // A postmeta write failure must NOT discard the already-live post — the
  // textFallback still carries the commentary; log and continue.
  try {
    await dbSetPostMeta(post.id, {commentary: req.commentary})
  } catch (metaErr) {
    console.error(
      `compose postmeta write failed: ${metaErr instanceof Error ? metaErr.stack : metaErr}`,
    )
  }

  const rsp: ComposeSubmitRsp = {postId: post.id, url: post.url, asUser}
  if (fallbackReason) rsp.fallbackReason = fallbackReason
  return rsp
}

/** Submit the pinned hub post + cache it under `hub:v2:{subredditId}` (30d). */
async function createHubPost(): Promise<{id: string; url: string}> {
  const post = await reddit.submitCustomPost({
    title: 'Share a passage from the Zen canon',
    textFallback: {text: HUB_INVITE_MD},
  })
  await setJson(
    `hub:v2:${context.subredditId}`,
    {id: post.id, url: post.url},
    HUB_TTL_MS,
  )
  // Pinning needs mod rights; the hub works fine unpinned if this is denied.
  try {
    await post.sticky()
  } catch (err) {
    console.error(
      `hub sticky failed (needs mod): ${err instanceof Error ? err.message : err}`,
    )
  }
  return {id: post.id, url: post.url}
}

/** On install: create the hub post (no postData → the webview opens the composer inline). */
async function routeAppInstall(): Promise<TriggerResponse> {
  try {
    await createHubPost()
  } catch (err) {
    console.error(
      `app-install hub post failed: ${err instanceof Error ? err.stack : err}`,
    )
  }
  return {}
}

/** Subreddit menu → hub post; self-heal by minting a fresh hub on a cache miss. */
async function routeMenuOpenComposer(): Promise<UiResponse> {
  const hub = await getJson<{id: string; url: string}>(
    `hub:v2:${context.subredditId}`,
  )
  if (hub?.url) return {navigateTo: hub.url}
  try {
    const fresh = await createHubPost()
    return {navigateTo: fresh.url}
  } catch (err) {
    console.error(
      `open-composer self-heal failed: ${err instanceof Error ? err.stack : err}`,
    )
    return {showToast: 'Could not open the composer. Please try again.'}
  }
}

/** Post/comment menu → find ReadZen links in the target's body → expand form. */
async function routeMenuExpandLink(
  reqMsg: IncomingMessage,
): Promise<UiResponse> {
  const body = await readJson<{
    targetId?: string
    event?: {targetId?: string}
  }>(reqMsg).catch(
    () => ({}) as {targetId?: string; event?: {targetId?: string}},
  )
  // UNVERIFIED body shape — log once so the user can confirm in playtest.
  console.log(`[verify] expand-link body: ${JSON.stringify(body)}`)
  const targetId =
    body.targetId ?? body.event?.targetId ?? context.postId ?? context.commentId
  if (!targetId) return {showToast: 'No ReadZen links found in this text.'}

  const text = await readTargetBody(targetId)
  const {renderable, linkOnly} = routesFromText(text)
  const routes = renderable.length ? renderable : linkOnly
  if (routes.length === 0)
    return {showToast: 'No ReadZen links found in this text.'}

  return {
    showForm: {
      name: 'expandLink',
      form: buildExpandForm(routes, targetId),
      data: {targetId},
    },
  }
}

/** Expand-link form submit → reply on the target, or spin up a reader post. */
async function routeFormExpandLink(
  reqMsg: IncomingMessage,
): Promise<UiResponse> {
  const body = await readJson<{
    values?: Record<string, unknown>
    data?: {targetId?: string}
    targetId?: string
  }>(reqMsg).catch(
    () =>
      ({}) as {
        values?: Record<string, unknown>
        data?: {targetId?: string}
        targetId?: string
      },
  )
  // UNVERIFIED that showForm.data round-trips — log once for playtest.
  console.log(`[verify] expand-link form body: ${JSON.stringify(body)}`)

  const values = body.values ?? {}
  // Select field values may arrive as string[] — coalesce to the first element.
  const coalesce = (v: unknown): string =>
    Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '')
  const rawRoute = coalesce(values.route)
  const output = coalesce(values.output)
  const targetId = body.data?.targetId ?? body.targetId ?? ''

  // The form's `route` value is a BARE rawRoute (from buildExpandForm options)
  // → parse it directly; a full-URL never reaches here.
  const route = parseRoute(rawRoute)
  if (!route || route.kind === 'unknown')
    return {showToast: 'That link could not be expanded.'}

  if (output === 'post') {
    // Ingestion-as-post is now gated too: don't post directly. Resolve once for
    // a title SUGGESTION and hand off to the title + 200-word commentary form.
    const suggestion = await titleSuggestion(route)
    return {
      showForm: {
        name: 'expandLinkPost',
        form: buildExpandPostForm(rawRoute, suggestion),
        data: {route: rawRoute},
      },
    }
  }

  // Reply path (UNCHANGED, exempt from the gate): expandAsReply returns no
  // permalink, so there is no navigateTo.
  const r = await expandAsReply(route, targetId)
  return {showToast: r.ok ? 'Reply posted.' : r.reason || 'Could not expand.'}
}

/** Resolve a route to a human title suggestion for the ingestion form's helpText. */
async function titleSuggestion(route: RzRoute): Promise<string> {
  const resolved = await resolveContent(route)
  return resolved ? attrLine(resolved.content) : route.rawRoute
}

/**
 * Second ingestion form (`expandLinkPost`) submit → the title + 200-word gate,
 * server-enforced with the SAME shared `countWords` rule as the composer. On
 * failure, re-show the form with the user's text preserved (`defaultValue`) and
 * the live count in the commentary helpText — nothing is lost. On success,
 * expand the route as a USER-attributed post (§C4 / R8).
 */
async function routeFormExpandLinkPost(
  reqMsg: IncomingMessage,
): Promise<UiResponse> {
  const body = await readJson<{
    values?: Record<string, unknown>
    data?: {route?: string}
    route?: string
  }>(reqMsg).catch(
    () =>
      ({}) as {
        values?: Record<string, unknown>
        data?: {route?: string}
        route?: string
      },
  )
  // UNVERIFIED that showForm.data round-trips on this second form — log once.
  console.log(`[verify] expand-link-post form body: ${JSON.stringify(body)}`)

  const values = body.values ?? {}
  const coalesce = (v: unknown): string =>
    Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '')
  const title = coalesce(values.title)
  const commentary = coalesce(values.commentary)
  // Defensive: prefer the round-tripped data.route, fall back to a top-level one.
  const rawRoute = body.data?.route ?? body.route ?? ''

  const route = parseRoute(rawRoute)
  if (!route || route.kind === 'unknown')
    return {showToast: 'That link could not be expanded.'}

  const words = countWords(commentary)
  if (title.trim().length < 3 || words < 200) {
    // Route the message to the field that failed: a short commentary shows the
    // live count under the COMMENTARY field; an otherwise-valid submit with a bad
    // title shows the requirement under the TITLE field (word-count takes priority
    // when both are short — the commentary is the harder bar to clear).
    const errors =
      words < 200
        ? {
            commentary: `${words} words so far — ${Math.max(0, 200 - words)} more needed.`,
          }
        : {title: 'A title of your own is required.'}
    const suggestion = await titleSuggestion(route)
    return {
      showForm: {
        name: 'expandLinkPost',
        form: buildExpandPostForm(
          rawRoute,
          suggestion,
          {title, commentary},
          errors,
        ),
        data: {route: rawRoute},
      },
    }
  }

  const r = await expandAsPost(route, {title, commentary})
  if (r.ok && r.url) return {showToast: 'Posted.', navigateTo: r.url}
  return {showToast: r.ok ? 'Posted.' : r.reason || 'Could not expand.'}
}

/** Delete triggers MUST NOT 501: purge post-scoped keys and ack with {}. */
async function routePostDelete(
  reqMsg: IncomingMessage,
): Promise<TriggerResponse> {
  const body = await readJson<{postId?: string; event?: {postId?: string}}>(
    reqMsg,
  ).catch(() => ({}) as {postId?: string; event?: {postId?: string}})
  // UNVERIFIED trigger payload wrapper — log once for playtest.
  console.log(`[verify] post-delete body: ${JSON.stringify(body)}`)
  const postId = body.postId ?? body.event?.postId
  if (postId) await dbPurgePost(postId)
  return {}
}

async function routeCommentDelete(
  reqMsg: IncomingMessage,
): Promise<TriggerResponse> {
  const body = await readJson<{postId?: string; event?: {postId?: string}}>(
    reqMsg,
  ).catch(() => ({}) as {postId?: string; event?: {postId?: string}})
  // UNVERIFIED trigger payload wrapper — log once for playtest.
  console.log(`[verify] comment-delete body: ${JSON.stringify(body)}`)
  // A CommentDelete payload's `postId` is the PARENT POST id, not a comment key.
  // No comment-scoped Redis keys exist today; a comment delete must NOT purge the
  // parent post's postmeta (that would silently wipe the author's commentary while
  // the post is still live). Ack with {} and touch nothing.
  return {}
}

async function readJson<T>(reqMsg: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = []
  reqMsg.on('data', chunk => chunks.push(chunk))
  await once(reqMsg, 'end')
  return JSON.parse(`${Buffer.concat(chunks)}`)
}

function writeJson<T extends PartialJsonValue>(
  status: number,
  json: Readonly<T>,
  rsp: ServerResponse,
): void {
  const body = JSON.stringify(json)
  const len = Buffer.byteLength(body)
  rsp.writeHead(status, {
    'Content-Length': len,
    'Content-Type': 'application/json',
  })
  rsp.end(body)
}
