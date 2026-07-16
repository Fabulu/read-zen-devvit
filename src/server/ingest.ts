// Link ingestion for the "Expand in ReadZen" menu action: take the markdown body
// of the comment/post the moderator/user acted on, pull every ReadZen link out of
// it (extract.ts does the forgiving parsing), and turn a chosen link into either a
// self-sufficient Reddit reply or a full custom reader post. Pure helpers here are
// unit-tested; the reddit/resolveContent-touching ones are exercised in playtest.
// PKT-1b (server.ts) wires these into the menu + form endpoints.

import type {PostData} from '@devvit/shared-types/PostData.js'
import type {T1, T3} from '@devvit/shared-types/tid.js'
import {reddit} from '@devvit/web/server'
import type {Form} from '@devvit/web/shared'
import {extractReadZenRoutes} from '../shared/extract.ts'
import type {RzRoute} from '../shared/route.ts'
import {resolveContent} from './content/resolve.ts'
import {dbSetPostMeta} from './db.ts'
import {buildPostData, buildTextFallback} from './render.ts'

/** Reader host for the link-only fallback replies. */
const RZ_HOST = 'https://readzen.pages.dev'

/** Comment replies must stay well under Reddit's ~10k limit. */
const MAX_COMMENT_CHARS = 9500

/** Post selftext (textFallback) must stay under Reddit's ~40k limit. */
export const MAX_POST_CHARS = 38000

/** Reddit post titles are capped at 300 characters. */
const MAX_TITLE_CHARS = 300

/**
 * Read the markdown body of the target the menu action fired on. `t1_…` is a
 * comment (markdown lives on `Comment.body`), `t3_…` is a post (`Post.body`, which
 * is `string | undefined` — old link posts have none). Defensive: any miss/error
 * returns '' so the caller degrades to a "no links found" toast.
 */
export async function readTargetBody(targetId: string): Promise<string> {
  try {
    if (targetId.startsWith('t1_')) {
      const comment = await reddit.getCommentById(targetId as T1)
      return comment.body ?? ''
    }
    if (targetId.startsWith('t3_')) {
      const post = await reddit.getPostById(targetId as T3)
      return post.body ?? ''
    }
    return ''
  } catch {
    return ''
  }
}

/**
 * Short human label for a route, for the "Which link?" form dropdown, e.g.
 * "Passage — T48n2005 (lines 0292a26-0292a29)", "Master — Huiyuan of Lushan",
 * "Search — dog". Covers the renderable kinds; link-only kinds get a sensible
 * generic label so they still read well as plain-link replies.
 */
export function describeRoute(route: RzRoute): string {
  switch (route.kind) {
    case 'passage': {
      const work = route.workId ?? ''
      if (route.hasExplicitRange && route.startLine) {
        const range =
          route.endLine && route.endLine !== route.startLine
            ? `lines ${route.startLine}-${route.endLine}`
            : `line ${route.startLine}`
        return `Passage — ${work} (${range})`
      }
      return `Passage — ${work}`
    }
    case 'master':
      return `Master — ${route.name ?? ''}`
    case 'dictionary':
      return `Dictionary — ${route.term ?? ''}`
    case 'dict-browse':
      return 'Dictionary'
    case 'termbase':
      return `Termbase — ${route.entry ?? ''}`
    case 'search':
      return `Search — ${route.q ?? ''}`
    case 'masters':
      return 'Zen Masters'
    case 'lineage':
      return `Lineage${route.focus ? ` — ${route.focus}` : ''}`
    case 'tags':
      return `Tags — ${route.fileId ?? ''}`
    case 'compare':
      return `Compare — ${route.fileId ?? ''}`
    case 'scholar':
    case 'scholar-graph':
      return 'Scholar'
    default:
      return route.rawRoute
  }
}

/**
 * Partition the ReadZen links in a block of text into `renderable` (kinds we can
 * inline as a passage/master/etc. reply or post) and `linkOnly` (browse/graph
 * surfaces we can only link to). Thin wrapper over extract.ts, renderable first.
 */
export function routesFromText(text: string): {
  renderable: RzRoute[]
  linkOnly: RzRoute[]
} {
  const renderable: RzRoute[] = []
  const linkOnly: RzRoute[] = []
  for (const route of extractReadZenRoutes(text)) {
    if (route.linkOnly) linkOnly.push(route)
    else renderable.push(route)
  }
  return {renderable, linkOnly}
}

/**
 * Build the "Expand in ReadZen" form: pick which link, and whether to reply with
 * the passage or spin up a reader post. `targetId` is not a form field — the caller
 * round-trips it through `showForm.data` — but it's in the signature so the wiring
 * packet can pass it in one place.
 */
export function buildExpandForm(routes: RzRoute[], targetId: string): Form {
  void targetId
  const first = routes[0]
  return {
    fields: [
      {
        type: 'select',
        name: 'route',
        label: 'Which link?',
        options: routes.map(r => ({
          label: describeRoute(r),
          value: r.rawRoute,
        })),
        ...(first ? {defaultValue: [first.rawRoute]} : {}),
      },
      {
        type: 'select',
        name: 'output',
        label: 'Output',
        options: [
          {label: 'Reply with the passage', value: 'reply'},
          {label: 'Create a post (title + 200-word commentary)', value: 'post'},
        ],
        defaultValue: ['reply'],
      },
    ],
    acceptLabel: 'Expand',
  }
}

/**
 * Second ingestion form: the title + 200-word commentary gate for
 * ingestion-as-post (the composer's Devvit-form twin). `suggestion` (a resolved
 * work·case label) lives ONLY in the title field's helpText — Devvit form fields
 * have no placeholder and the title MUST be user-typed, so `defaultValue` is
 * never the suggestion. `prior` re-seeds both fields on a reject-and-reshow, and
 * `errors` targets the reshow message at the FIELD that actually failed: a
 * title-specific message replaces the title helpText, a word-count message the
 * commentary helpText — so the user reads the fix next to the field it belongs to.
 */
export function buildExpandPostForm(
  route: string,
  suggestion: string,
  prior?: {title: string; commentary: string},
  errors?: {title?: string; commentary?: string},
): Form {
  void route
  return {
    fields: [
      {
        type: 'string',
        name: 'title',
        label: 'Your title',
        helpText:
          errors?.title ??
          `Suggestion: ${suggestion} — but use your own words.`,
        defaultValue: prior?.title ?? '',
      },
      {
        type: 'paragraph',
        name: 'commentary',
        label: 'Your commentary (at least 200 words)',
        helpText:
          errors?.commentary ??
          'Substantive posts only: at least 200 words of your own commentary.',
        defaultValue: prior?.commentary ?? '',
      },
    ],
    acceptLabel: 'Post',
  }
}

/** Absolute reader URL for a route (link-only fallback + read-more targets). */
function readZenUrl(route: RzRoute): string {
  return `${RZ_HOST}/#/${route.rawRoute.replace(/^\/+/, '')}`
}

/**
 * Truncate a built markdown fallback to `maxChars`, keeping whole `\n\n`-separated
 * blocks (the header + as many complete bilingual pairs as fit) and appending a
 * trailing read-more link. Because we only ever drop whole blocks, the result never
 * ends mid-token (no dangling `>` blockquote or half-written `[…](…)` link).
 */
export function truncateFallback(
  fallback: string,
  rzLink: string,
  maxChars: number = MAX_COMMENT_CHARS,
): string {
  const readMore = `\n\n[Read the full case ›](${rzLink})`
  if (fallback.length <= maxChars) return fallback

  const budget = Math.max(0, maxChars - readMore.length)
  const blocks = fallback.split('\n\n')
  const kept: string[] = []
  let len = 0
  for (const block of blocks) {
    const add = kept.length === 0 ? block.length : block.length + 2
    if (len + add > budget) break
    kept.push(block)
    len += add
  }

  // Header alone overflowed: hard-clip it at a whitespace boundary so we never cut
  // inside a markdown token, then drop any trailing incomplete `[` link opener.
  if (kept.length === 0) {
    const head = blocks[0] ?? ''
    let clipped = head.slice(0, budget)
    const sp = clipped.lastIndexOf(' ')
    if (sp > 0) clipped = clipped.slice(0, sp)
    const openBracket = clipped.lastIndexOf('[')
    if (openBracket > clipped.lastIndexOf(')')) {
      clipped = clipped.slice(0, openBracket).trimEnd()
    }
    kept.push(clipped)
  }

  return kept.join('\n\n') + readMore
}

/** Plain-link reply for a browse/graph surface we can't inline as content. */
function linkOnlyReply(route: RzRoute): string {
  const label = describeRoute(route)
  return `**${label}** opens as an interactive view in ReadZen.\n\n[Open in ReadZen ›](${readZenUrl(route)})`
}

/**
 * Expand a chosen link as a reply on the target comment/post (runAs APP — the menu
 * invoker didn't author the passage). Renderable routes resolve to a truncated
 * bilingual fallback; link-only routes get a descriptive markdown link instead.
 */
export async function expandAsReply(
  route: RzRoute,
  targetId: string,
): Promise<{commentId?: string; ok: boolean; reason?: string}> {
  try {
    let text: string
    if (route.linkOnly) {
      text = linkOnlyReply(route)
    } else {
      const resolved = await resolveContent(route)
      if (!resolved) return {ok: false, reason: 'content not found'}
      text = truncateFallback(
        buildTextFallback(resolved.content),
        resolved.content.rzLink,
      )
    }
    const comment = await reddit.submitComment({
      id: targetId as T1 | T3,
      text,
      runAs: 'APP',
    })
    return {commentId: comment.id, ok: true}
  } catch (err) {
    return {ok: false, reason: err instanceof Error ? err.message : String(err)}
  }
}

/**
 * Expand a chosen link as a full custom reader post, carrying the user's own
 * title + ≥200-word commentary (gated upstream in routeFormExpandLinkPost).
 * Runs as USER (decision R8: ingestion-as-post is user-attributed now that a
 * mandatory personal commentary rides with it) with `userGeneratedContent` for
 * moderation — SAME STRICT policy as compose: a USER throw returns {ok:false},
 * NO APP fallback. Commentary rides in postData (teaser), textFallback
 * (old-Reddit copy), and durable postmeta (the webview copy).
 */
export async function expandAsPost(
  route: RzRoute,
  opts: {title: string; commentary: string},
): Promise<{postId?: string; url?: string; ok: boolean; reason?: string}> {
  try {
    const resolved = await resolveContent(route)
    if (!resolved) return {ok: false, reason: 'content not found'}
    const content = resolved.content
    const post = await reddit.submitCustomPost({
      title: opts.title.slice(0, MAX_TITLE_CHARS),
      postData: buildPostData(content, opts.commentary) as unknown as PostData,
      // An open-ended passage (github sliceIds caps at 400 lines) can exceed
      // Reddit's ~40k selftext cap → submitCustomPost throws; clamp it.
      textFallback: {
        text: truncateFallback(
          buildTextFallback(content, opts.commentary),
          content.rzLink,
          MAX_POST_CHARS,
        ),
      },
      runAs: 'USER',
      userGeneratedContent: {
        text: buildTextFallback(content, opts.commentary),
      },
    })
    // Durable postmeta so the reader webview can attach the commentary. A write
    // failure must not discard the already-live post — log and continue.
    try {
      await dbSetPostMeta(post.id, {commentary: opts.commentary})
    } catch (metaErr) {
      console.error(
        `expandAsPost postmeta write failed: ${metaErr instanceof Error ? metaErr.stack : metaErr}`,
      )
    }
    return {postId: post.id, url: post.url, ok: true}
  } catch (err) {
    return {ok: false, reason: err instanceof Error ? err.message : String(err)}
  }
}
