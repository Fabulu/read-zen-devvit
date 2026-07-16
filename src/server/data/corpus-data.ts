// Shared corpus data layer: fetches + caches the two small JSON corpora that the
// search engine (and the master content provider, PKT-3) read from. Both files
// live in the approved Fabulu/CbetaZenTranslations repo, served over the only
// permitted host (raw.githubusercontent.com). Two cache tiers sit in front of
// the network: a module-level memo (warm serverless instance) fronting a Redis
// key (cross-instance, 6h TTL via db.setJson). A Redis hit never touches the
// network. Ported logic-for-logic from ReadZen lib/titles.js + lib/corpus.js.

import {OPEN_ZEN_PUBLISHERS} from '../../shared/corpus.ts'
import {getJson, setJson} from '../db.ts'

/** One line of titles.jsonl. Keys are exhaustive (recon, measured on 4,992 rows). */
export type TitleRec = {
  path: string
  zh: string
  en: string
  enShort: string
  zhHash: string
}

/** One entry of masters.json `masters[]`. floruit/death/students/links/region are
 *  not present on every master (recon, measured on 301). NO birth/pinyin/bio. */
export type MasterRec = {
  names: string[]
  notes: string
  school: string
  teacher: string
  floruit?: string
  death?: string
  students?: string[]
  links?: string[]
  region?: string
}

const RAW_BASE =
  'https://raw.githubusercontent.com/Fabulu/CbetaZenTranslations/main'
const TITLES_URL = `${RAW_BASE}/titles.jsonl`
const MASTERS_URL = `${RAW_BASE}/masters.json`

const TITLES_KEY = 'srch:titles'
const MASTERS_KEY = 'srch:masters'
const CACHE_TTL_MS = 6 * 3600 * 1000 // 6 hours

let titlesMemo: TitleRec[] | undefined
let mastersMemo: MasterRec[] | undefined

/** Fetch text, or throw so the caller/handler can decide how to degrade. */
async function fetchTextOrThrow(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw Error(`fetch ${url} failed: ${res.status}`)
  return await res.text()
}

/** Parse NDJSON: one JSON object per non-empty line; malformed lines skipped. */
function parseTitlesNdjson(text: string): TitleRec[] {
  const out: TitleRec[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed) as TitleRec)
    } catch {
      // Skip a malformed line rather than fail the whole load.
    }
  }
  return out
}

/**
 * All title records. memo → Redis (`srch:titles`, 6h) → raw fetch. A Redis hit
 * never needs the network. Parsed arrays are stored (1.14MB ≪ Redis 4MB ceiling).
 */
export async function getTitles(): Promise<TitleRec[]> {
  if (titlesMemo) return titlesMemo
  const cached = await getJson<TitleRec[]>(TITLES_KEY)
  if (cached) {
    titlesMemo = cached
    return cached
  }
  const titles = parseTitlesNdjson(await fetchTextOrThrow(TITLES_URL))
  // A Redis write failure must not break returning freshly-fetched data.
  try {
    await setJson(TITLES_KEY, titles, CACHE_TTL_MS)
  } catch (err) {
    console.error(
      `corpus-data setJson ${TITLES_KEY} failed: ${err instanceof Error ? err.message : err}`,
    )
  }
  titlesMemo = titles
  return titles
}

/**
 * All master records (`masters.json` → `.masters`, 301 entries). memo → Redis
 * (`srch:masters`, 6h) → raw fetch. A Redis hit never needs the network.
 */
export async function getMasters(): Promise<MasterRec[]> {
  if (mastersMemo) return mastersMemo
  const cached = await getJson<MasterRec[]>(MASTERS_KEY)
  if (cached) {
    mastersMemo = cached
    return cached
  }
  const parsed = JSON.parse(await fetchTextOrThrow(MASTERS_URL)) as {
    masters?: MasterRec[]
  }
  const masters = parsed.masters ?? []
  // A Redis write failure must not break returning freshly-fetched data.
  try {
    await setJson(MASTERS_KEY, masters, CACHE_TTL_MS)
  } catch (err) {
    console.error(
      `corpus-data setJson ${MASTERS_KEY} failed: ${err instanceof Error ? err.message : err}`,
    )
  }
  mastersMemo = masters
  return masters
}

/** Title record for an exact source path, or undefined. (PKT-3 attribution.) */
export async function titleByPath(path: string): Promise<TitleRec | undefined> {
  const titles = await getTitles()
  return titles.find(t => t.path === path)
}

/** Master whose alias list contains `name` (case-insensitive), or undefined. */
export async function masterByName(
  name: string,
): Promise<MasterRec | undefined> {
  const lower = name.toLowerCase()
  const masters = await getMasters()
  return masters.find(m => m.names.some(n => n.toLowerCase() === lower))
}

/**
 * Faithful port of lib/titles.js `fileIdFromPath` (via `inferCorpusForRelPath`).
 * OpenZen path (first segment is a publisher and ≥2 segments) → `pub.slug`
 * (`ws/gateless-barrier/x.xml` → `ws.gateless-barrier`). Otherwise CBETA-shape:
 * last '/' segment minus its extension (`T/T48/T48n2005.xml` → `T48n2005`).
 */
export function workIdFromPath(path: string): string {
  if (!path) return ''
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length === 0) return ''
  const pub = parts[0]
  if (
    parts.length >= 2 &&
    pub !== undefined &&
    (OPEN_ZEN_PUBLISHERS as readonly string[]).includes(pub.toLowerCase())
  ) {
    return `${pub}.${parts[1] ?? ''}`
  }
  const filename = parts[parts.length - 1] ?? ''
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.substring(0, dot) : filename
}
