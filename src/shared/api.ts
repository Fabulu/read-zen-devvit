/** Generic error detail for all responses. `detail` carries an optional raw
 *  cause (e.g. the underlying Reddit error message) for surfacing in-app. */
export type ErrorRsp = {error: string; status: number; detail?: string}

/** One bilingual line of a passage/koan. `en` absent → render the ZH row only. */
export type BilingualLine = {
  id: string
  zh: string
  en?: string
  role?: 'case' | 'comment' | 'verse' | 'plain'
}

/** Source / attribution shown under a passage. */
export type Attribution = {
  work: string
  workZh?: string
  cbetaId?: string
  master?: string
  translator?: string
  license?: string
}

/** A data-source-agnostic renderable unit. The client never knows its origin. */
export type RenderedContent = {
  kind: 'passage' | 'case' | 'master' | 'term'
  workId: string
  title: string
  titleZh?: string
  caseLabel?: string
  lines: BilingualLine[]
  attribution: Attribution
  rzLink: string
  zenUri?: string
}

/** Compact preview embedded in the post at submit; read synchronously by the
 *  reader to paint the in-feed card with ZERO fetch. MUST stay ≤ 2KB.
 *  v2 adds `cm`, a ≤240-char commentary teaser for instant first paint. Readers
 *  MUST accept both shapes (`pd.v === 1 || pd.v === 2`); v1 simply lacks `cm`. */
export type RzPostData = {
  v: 1 | 2
  route: string
  preview: {zh: string; en: string; attr: string}
  cm?: string
}

export type ResolveReq = {route: string}
export type ResolveRsp = {
  content: RenderedContent
  source: 'live' | 'cache' | 'sample'
  /** The resolved post's stored commentary, attached server-side from Redis
   *  postmeta when `context.postId` has one. Hub and old v1 posts omit it. */
  commentary?: string
}

/** One search result row. */
export type SearchHit = {
  workId: string
  title: string
  titleZh?: string
  route: string
  hitCount?: number
  side?: 'zh' | 'en' | 'community'
  translator?: string
  kind: 'title' | 'master' | 'fulltext'
}

/** Response to GET api/search?q= . P1 always sets fulltextAvailable:false. */
export type SearchRsp = {
  hits: SearchHit[]
  source: 'live' | 'cache'
  fulltextAvailable: boolean
}

/** Client asks the server to submit a passage as a post (server re-resolves). */
export type ComposeSubmitReq = {
  route: string
  title: string
  commentary: string
}
export type ComposeSubmitRsp = {
  postId: string
  url: string
  commentId?: string
  asUser: boolean
  /** When a USER-attributed submit threw and we fell back to an APP post
   *  (`asUser:false`), this carries the raw USER-submit error message so the
   *  client can surface WHY attribution failed instead of failing silently.
   *  Only set on the graceful-fallback path (STRICT_USER_ATTRIBUTION off). */
  fallbackReason?: string
}

export type Endpoint = (typeof Endpoint)[keyof typeof Endpoint]
export const Endpoint = {
  Search: 'api/search',
  Resolve: 'api/resolve',
  ComposeSubmit: 'api/compose/submit',
  OnAppInstall: 'internal/on/app/install',
  OnMenuOpenComposer: 'internal/on/menu/open-composer',
  OnMenuExpandLink: 'internal/on/menu/expand-link',
  OnFormExpandLink: 'internal/on/form/expand-link',
  OnFormExpandLinkPost: 'internal/on/form/expand-link-post',
  OnPostDelete: 'internal/on/post/delete',
  OnCommentDelete: 'internal/on/comment/delete',
} as const

export const EndpointMethod = {
  [Endpoint.Search]: 'GET',
  [Endpoint.Resolve]: 'POST',
  [Endpoint.ComposeSubmit]: 'POST',
  [Endpoint.OnAppInstall]: 'POST',
  [Endpoint.OnMenuOpenComposer]: 'POST',
  [Endpoint.OnMenuExpandLink]: 'POST',
  [Endpoint.OnFormExpandLink]: 'POST',
  [Endpoint.OnFormExpandLinkPost]: 'POST',
  [Endpoint.OnPostDelete]: 'POST',
  [Endpoint.OnCommentDelete]: 'POST',
} as const satisfies {[endpoint: string]: 'GET' | 'POST'}
