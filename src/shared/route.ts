// Single parser for ALL ReadZen link types. Ported logic-for-logic from ReadZen
// lib/route.js, which mirrors Services/ZenUriParser.cs in the desktop app. Pure
// string logic — no DOM. Keep in sync with those two via tests/route.test.ts.

import {Corpus, inferCorpus, OPEN_WORK_ID_PATTERN} from './corpus.ts'

export type RouteKind =
  | 'passage'
  | 'compare'
  | 'dictionary'
  | 'dict-browse'
  | 'termbase'
  | 'master'
  | 'scholar'
  | 'scholar-graph'
  | 'tags'
  | 'masters'
  | 'lineage'
  | 'search'
  | 'shared-list'
  | 'unknown'

/**
 * The normalized shape of any parsed ReadZen route. All fields besides `kind`
 * and `rawRoute` are optional — which are present depends on the kind. Kept as a
 * single wide type (rather than a discriminated union) for ergonomic access; the
 * parser only sets the fields relevant to each kind. `linkOnly`/`source` are
 * added by the extractor (extract.ts).
 */
export type RzRoute = {
  kind: RouteKind
  rawRoute: string
  // passage
  workId?: string
  canon?: string
  volume?: string
  workSuffix?: string
  corpus?: Corpus
  startLine?: string
  endLine?: string
  hasExplicitRange?: boolean
  mode?: string
  translator?: string
  highlight?: string
  q?: string
  scroll?: string
  pos?: string
  leftContext?: string
  rightContext?: string
  block?: number | null
  // dictionary / termbase / master / masters / lineage
  term?: string
  entry?: string
  user?: string
  name?: string
  school?: string
  focus?: string
  // scholar
  collectionId?: string
  passageId?: string
  // tags / compare
  fileId?: string
  tagId?: string
  pane?: string
  sourceA?: string
  sourceB?: string
  from?: string
  to?: string
  // search
  orig?: string
  tran?: string
  zenOnly?: string
  statusIndex?: string
  translationSource?: string
  contextWidth?: string
  master?: string
  // shared-list / compare
  list?: unknown[]
  valid?: boolean
  incomplete?: boolean
  // added by extract.ts
  linkOnly?: boolean
  source?: string
}

export const WORK_ID_PATTERN =
  /^[A-Za-z]{1,3}\d{1,4}n[A-Za-z]?\d{1,5}[A-Za-z]?$/
export const RANGE_PATTERN = /^([0-9]{4}[abc]\d{2})-([0-9]{4}[abc]\d{2})$/
export const SINGLE_LB_PATTERN = /^[0-9]{4}[abc]\d{2}$/
const OPEN_LB_TOKEN = '[A-Za-z][A-Za-z0-9]*(?:\\.[A-Za-z0-9]+)+'
export const OPEN_SINGLE_LB_PATTERN = new RegExp(`^${OPEN_LB_TOKEN}$`)
export const OPEN_RANGE_PATTERN = new RegExp(
  `^(${OPEN_LB_TOKEN})-(${OPEN_LB_TOKEN})$`,
)

const SIDE_ALIASES = new Set(['en', 'tran', 'translated', 'translation'])

function splitRoute(rawRoute: string): {pathPart: string; queryPart: string} {
  const qIdx = rawRoute.indexOf('?')
  return {
    pathPart: qIdx >= 0 ? rawRoute.substring(0, qIdx) : rawRoute,
    queryPart: qIdx >= 0 ? rawRoute.substring(qIdx + 1) : '',
  }
}

function parseQuery(queryPart: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!queryPart) return out
  for (const pair of queryPart.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const key = eq >= 0 ? pair.substring(0, eq) : pair
    const value = eq >= 0 ? pair.substring(eq + 1) : ''
    try {
      out[decodeURIComponent(key)] = decodeURIComponent(
        value.replace(/\+/g, ' '),
      )
    } catch {
      out[key] = value
    }
  }
  return out
}

function isLbSegment(segment: string): boolean {
  if (!segment) return false
  return (
    SINGLE_LB_PATTERN.test(segment) ||
    RANGE_PATTERN.test(segment) ||
    OPEN_SINGLE_LB_PATTERN.test(segment) ||
    OPEN_RANGE_PATTERN.test(segment)
  )
}

function isSideSegment(segment: string): boolean {
  return !!segment && SIDE_ALIASES.has(segment.toLowerCase())
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// In the SPA this base64-decodes a reading list; here shared-list routes are
// LINK-ONLY (Phase 1), so we don't need the payload — return null.
function decodeListFromHash(_d: string): unknown[] | null {
  return null
}

function parsePassage(
  pathParts: string[],
  queryPart: string,
  rawRoute: string,
): RzRoute | null {
  const first = pathParts[0]
  if (first === undefined) return null
  const isOpenZen = OPEN_WORK_ID_PATTERN.test(first)
  const isCbeta = WORK_ID_PATTERN.test(first)
  if (!isOpenZen && !isCbeta) return null

  const inner = isCbeta
    ? /^([A-Za-z]{1,3})(\d{1,4})n([A-Za-z]?\d{1,5}[A-Za-z]?)$/.exec(first)
    : null
  const canon = inner ? inner[1] : ''
  const volume = inner ? inner[2] : ''
  const workSuffix = inner ? inner[3] : ''
  const corpus = isOpenZen ? Corpus.OpenZen : Corpus.Cbeta

  let startLine = ''
  let endLine = ''
  let hasExplicitRange = false
  let side = 'zh'
  let translator = ''

  for (let i = 1; i < pathParts.length; i += 1) {
    const seg = pathParts[i] ?? ''
    if (isLbSegment(seg)) {
      const cbetaRange = seg.match(RANGE_PATTERN)
      const openRange = cbetaRange ? null : seg.match(OPEN_RANGE_PATTERN)
      if (cbetaRange) {
        startLine = cbetaRange[1] ?? ''
        endLine = cbetaRange[2] ?? ''
      } else if (openRange) {
        startLine = openRange[1] ?? ''
        endLine = openRange[2] ?? ''
      } else {
        startLine = seg
        endLine = seg
      }
      hasExplicitRange = true
    } else if (isSideSegment(seg)) {
      side = 'en'
    } else if (i === pathParts.length - 1) {
      translator = safeDecode(seg)
    }
  }

  const query = parseQuery(queryPart)

  return {
    kind: 'passage',
    workId: first,
    canon,
    volume,
    workSuffix,
    corpus,
    startLine,
    endLine,
    hasExplicitRange,
    mode: side,
    translator,
    highlight: query.highlight || '',
    q: query.q || '',
    scroll: query.scroll || '',
    pos: query.pos || '',
    leftContext: query.lctx || '',
    rightContext: query.rctx || '',
    block: query.block ? Number.parseInt(query.block, 10) : null,
    rawRoute,
  }
}

/**
 * Parses any route string into a normalized object. Returns null for an empty
 * string, or `{kind: 'unknown', rawRoute}` if no kind could be identified.
 */
export function parseRoute(
  rawRoute: string | null | undefined,
): RzRoute | null {
  if (!rawRoute) return null

  const {pathPart, queryPart} = splitRoute(rawRoute)
  let parts = pathPart.split('/').filter(Boolean)
  if (parts.length === 0) return null

  if ((parts[0] ?? '').toLowerCase() === 'passage' && parts.length > 1) {
    parts = parts.slice(1)
  }

  let rawParts: string[] | null = null
  if (parts[0] && parts[0].toLowerCase() === 'scholar') {
    const trimmed = pathPart.replace(/^\/+/, '').replace(/\/+$/, '')
    rawParts = trimmed.split('/')
  }

  const first = parts[0]
  if (first === undefined) return null
  const query = parseQuery(queryPart)

  switch (first.toLowerCase()) {
    case 'dict':
      if (!parts[1]) return {kind: 'dict-browse', q: query.q || '', rawRoute}
      return {kind: 'dictionary', term: safeDecode(parts[1]), rawRoute}

    case 'term':
      return {
        kind: 'termbase',
        entry: parts[1] ? safeDecode(parts[1]) : '',
        user: parts[2] ? safeDecode(parts[2]) : '',
        rawRoute,
      }

    case 'master':
      return {
        kind: 'master',
        name: parts[1] ? safeDecode(parts[1]).replace(/_/g, ' ') : '',
        user: parts[2] ? safeDecode(parts[2]) : '',
        rawRoute,
      }

    case 'scholar': {
      const segs = rawParts || parts
      const seg1 = segs[1] ? safeDecode(segs[1]) : ''
      const seg2 = segs[2] ? safeDecode(segs[2]) : ''
      const seg3 = segs[3] ? safeDecode(segs[3]) : ''
      const isLegacy = !seg1
        ? false
        : (segs[2] === '' && !!seg3) ||
          (seg2.toLowerCase() === 'graph' && !!seg3) ||
          /^[0-9a-f]{24,}$/i.test(seg1) ||
          !!query.user

      if (isLegacy) {
        const isGraph = !!seg2 && seg2.toLowerCase() === 'graph'
        return {
          kind: isGraph ? 'scholar-graph' : 'scholar',
          collectionId: seg1,
          passageId: isGraph ? '' : seg2,
          user: seg3 || query.user || '',
          rawRoute,
        }
      }

      const isGraph = !!seg3 && seg3.toLowerCase() === 'graph'
      return {
        kind: isGraph ? 'scholar-graph' : 'scholar',
        user: seg1,
        collectionId: seg2,
        passageId: isGraph ? '' : seg3,
        rawRoute,
      }
    }

    case 'tags':
      return {
        kind: 'tags',
        fileId: parts[1] || '',
        corpus: inferCorpus(parts[1]),
        user: parts[2] ? safeDecode(parts[2]) : query.user || '',
        tagId: parts[3] ? safeDecode(parts[3]) : query.tagId || query.tag || '',
        rawRoute,
      }

    case 'search':
      return {
        kind: 'search',
        q: query.q || '',
        corpus: (query.corpus as Corpus) || undefined,
        orig: query.orig || '',
        tran: query.tran || '',
        zenOnly: query.zen || '',
        statusIndex: query.status || query.statusIndex || '',
        tagId: query.tag || query.tagId || '',
        translationSource: query.src || query.translationSource || '',
        contextWidth: query.ctxw || query.contextWidth || '',
        master: query.master || '',
        rawRoute,
      }

    case 'masters':
      return {
        kind: 'masters',
        school: query.school || '',
        q: query.q || '',
        rawRoute,
      }

    case 'lineage':
      return {
        kind: 'lineage',
        focus: query.focus ? safeDecode(query.focus).replace(/_/g, ' ') : '',
        rawRoute,
      }

    case 'list': {
      const list = query.d ? decodeListFromHash(query.d) : null
      return {
        kind: 'shared-list',
        list: list || [],
        valid: list !== null,
        rawRoute,
      }
    }

    case 'compare': {
      if (parts.length < 5) return {kind: 'compare', rawRoute, incomplete: true}
      return {
        kind: 'compare',
        fileId: parts[1],
        corpus: inferCorpus(parts[1]),
        pane: parts[2] ? parts[2].toLowerCase() : 'orig',
        sourceA: safeDecode(parts[3] ?? ''),
        sourceB: safeDecode(parts[4] ?? ''),
        from: query.from || '',
        to: query.to || '',
        highlight: query.highlight || '',
        rawRoute,
      }
    }
  }

  const passage = parsePassage(parts, queryPart, rawRoute)
  if (passage) return passage

  return {kind: 'unknown', rawRoute}
}

/** Builds the canonical `zen://` URI for a parsed route. */
export function buildZenUri(route: RzRoute | null): string | null {
  if (!route?.rawRoute) return null
  return `zen://${route.rawRoute.replace(/^\/+/, '')}`
}

/** Human-facing label for a parsed route (header chips, post titles). */
export function describeRoute(route: RzRoute | null): string {
  if (!route) return ''
  switch (route.kind) {
    case 'passage':
      return route.hasExplicitRange
        ? `${route.workId} · ${route.startLine}${route.endLine && route.endLine !== route.startLine ? `-${route.endLine}` : ''}`
        : (route.workId ?? '')
    case 'dictionary':
      return `Dictionary · ${route.term || ''}`
    case 'dict-browse':
      return 'Dictionary'
    case 'termbase':
      return `Termbase · ${route.entry || ''}`
    case 'master':
      return `Zen Master · ${route.name || ''}`
    case 'masters':
      return 'Zen Masters'
    case 'lineage':
      return `Lineage Web${route.focus ? ` · ${route.focus}` : ''}`
    case 'scholar':
      return `Scholar · ${route.collectionId || ''}`
    case 'scholar-graph':
      return 'Scholar Graph'
    case 'tags':
      return `Tags · ${route.fileId || ''}`
    case 'search':
      return `Search · ${route.q || ''}`
    case 'compare':
      return `Compare · ${route.fileId || ''}`
    default:
      return route.rawRoute || ''
  }
}
