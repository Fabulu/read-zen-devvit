// The forgiveness layer for link ingestion: pull ReadZen links out of arbitrary
// pasted text and parse them, tolerating the ways real users mangle URLs —
// markdown-wrapped, angle-bracketed, Reddit backslash-escaped, missing scheme,
// trailing punctuation, share-junk query params, lowercased CBETA file-ids, and
// partial/trailing-garbage routes. Built on the ported parseRoute (route.ts).

import {parseRoute, type RzRoute} from './route.ts'

// Hosts that carry ReadZen routes. Add the dedicated Reddit-facing site host
// here if/when it exists (e.g. a clean-URL /koan/… domain).
const HOSTS = ['readzen.pages.dev']
const HOST_ALT = HOSTS.map(h => h.replace(/[.]/g, '\\.')).join('|')

// Kinds we can render as self-sufficient content in a Reddit post/comment.
// Everything else (lineage, scholar-graph, masters/dict browse, tags, shared
// list, compare) is a visual/browse surface → LINK-ONLY fallback.
const RENDERABLE_KINDS = new Set([
  'passage',
  'master',
  'dictionary',
  'termbase',
  'search',
])

const CBETA_FILEID_RE = /^[A-Za-z]{1,3}\d{1,4}n[A-Za-z]?\d{1,5}[A-Za-z]?$/i

const BARE_RE = new RegExp(
  `(?:zen:\\/\\/[^\\s<>()\\[\\]]+)|(?:(?:https?:\\/\\/)?(?:www\\.)?(?:${HOST_ALT})[^\\s<>()\\[\\]]*)`,
  'gi',
)

/** Collect candidate URL strings from arbitrary text (markdown, angle brackets, bare). */
function findCandidates(text: string): string[] {
  // Un-escape Reddit's markdown backslash-escapes (e.g. Linji\_Yixuan → Linji_Yixuan).
  const t = text.replace(/\\([_*~`>[\]()#+\-.!])/g, '$1')
  const cands: string[] = []
  const md = /\[[^\]]*\]\(\s*([^)\s]+)\s*\)/g
  for (let m = md.exec(t); m !== null; m = md.exec(t)) {
    if (m[1]) cands.push(m[1])
  }
  const angle = /<([^>\s]+)>/g
  for (let m = angle.exec(t); m !== null; m = angle.exec(t)) {
    if (m[1]) cands.push(m[1])
  }
  BARE_RE.lastIndex = 0
  for (let m = BARE_RE.exec(t); m !== null; m = BARE_RE.exec(t)) {
    if (m[0]) cands.push(m[0])
  }
  return cands
}

/** Canonicalize a CBETA file-id in the first path segment (t48n2005 → T48n2005). */
function canonicalizeRawRoute(rawRoute: string): string {
  const qIdx = rawRoute.indexOf('?')
  const path = qIdx >= 0 ? rawRoute.substring(0, qIdx) : rawRoute
  const query = qIdx >= 0 ? rawRoute.substring(qIdx) : ''
  const segs = path.split('/')
  const seg0 = segs[0]
  if (seg0 && CBETA_FILEID_RE.test(seg0)) {
    segs[0] = seg0.toUpperCase().replace(/(\d)N(?=[A-Za-z]?\d)/, '$1n')
  }
  return segs.join('/') + query
}

/** Normalize one candidate string into a bare rawRoute, or null if not a ReadZen link. */
function candidateToRawRoute(cand: string): string | null {
  if (!cand) return null
  let s = cand.trim()
  s = s.replace(/^[<("']+/, '').replace(/[>).,;:!?"'”’…\]]+$/, '')

  let rest: string
  const zen = /^zen:\/\/(.*)$/i.exec(s)
  if (zen) {
    rest = zen[1] ?? ''
  } else {
    const noScheme = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
    const hostRe = new RegExp(`^(?:${HOST_ALT})`, 'i')
    if (!hostRe.test(noScheme)) return null
    rest = noScheme.replace(hostRe, '')
  }

  rest = rest.replace(/^\/+/, '')
  if (rest.startsWith('#')) rest = rest.replace(/^#\/?/, '')
  rest = rest.replace(/^\/+/, '')
  if (!rest) return null
  return canonicalizeRawRoute(rest)
}

function tryParse(raw: string): RzRoute | null {
  if (!raw) return null
  const route = parseRoute(raw)
  return route && route.kind !== 'unknown' ? route : null
}

/** Parse a rawRoute, retrying with progressive trimming if the full form fails. */
function parseRouteForgiving(rawRoute: string): RzRoute | null {
  let r = tryParse(rawRoute)
  if (r) return r
  const qIdx = rawRoute.indexOf('?')
  if (qIdx >= 0) {
    r = tryParse(rawRoute.substring(0, qIdx))
    if (r) return r
  }
  let base = qIdx >= 0 ? rawRoute.substring(0, qIdx) : rawRoute
  while (base.includes('/')) {
    base = base.substring(0, base.lastIndexOf('/'))
    if (!base) break
    r = tryParse(base)
    if (r) return r
  }
  return null
}

/**
 * Extract every ReadZen route referenced in a block of text. Returns parsed
 * routes deduped by rawRoute, each annotated with `linkOnly` (true → render as a
 * link, not inline content) and `source` (the matched candidate string).
 */
export function extractReadZenRoutes(
  text: string | null | undefined,
): RzRoute[] {
  if (!text || typeof text !== 'string') return []
  const out: RzRoute[] = []
  const seen = new Set<string>()
  for (const cand of findCandidates(text)) {
    const rawRoute = candidateToRawRoute(cand)
    if (!rawRoute) continue
    const route = parseRouteForgiving(rawRoute)
    if (!route) continue
    if (seen.has(route.rawRoute)) continue
    seen.add(route.rawRoute)
    route.linkOnly = !RENDERABLE_KINDS.has(route.kind)
    route.source = cand
    out.push(route)
  }
  return out
}

/** Convenience: parse a single pasted string into one route (or null). */
export function parseReadZenLink(str: string): RzRoute | null {
  const routes = extractReadZenRoutes(str)
  return routes[0] ?? null
}
