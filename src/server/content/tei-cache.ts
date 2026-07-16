import {getJson, setJson} from '../db.ts'
import {sourceUrl, translationUrl} from './paths.ts'
import {parseTei, type TeiLines} from './tei.ts'

// Parse-once + Redis cache in front of the raw TEI fetch. The reader resolves the
// same work repeatedly (feed card, expand, comments), and parseTei on linkedom is
// the expensive step — so we parse each (work, translator) ONCE and cache the
// parsed line map. Two tiers: a module-level memo (warm serverless instance)
// fronts a Redis key (cross-instance, 24h). A Redis hit never touches the network
// and never re-parses. Only SUCCESSFUL parses are cached — a fetch miss or a parse
// failure caches nothing, so garbage never persists.

const TTL_MS = 24 * 3600 * 1000 // 24h
// Maps DON'T JSON-serialize, so TeiLines is stored as this flat shape and
// rehydrated on read. `order` mirrors lineOrder; `lines` mirrors linesById.
type SerializedTei = {
  titleZh: string
  titleEn: string
  order: string[]
  lines: [string, string][]
}
// Big lamp records serialize past Redis' comfort zone — skip caching (parse live)
// when the serialized JSON would exceed the byte budget below. Measured in UTF-8
// BYTES (not UTF-16 code units): CJK is ~3 bytes/char, so a char-count guard would
// wildly undercount and let ~6MB blow past Redis' ~4MB value cap.
const MAX_CACHE_BYTES = 3_500_000

const memo = new Map<string, TeiLines>()

/** Fetch raw text; undefined on non-2xx or network error (caller degrades). */
async function fetchText(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url)
    if (!res.ok) return undefined
    return await res.text()
  } catch {
    return undefined
  }
}

function serialize(t: TeiLines): SerializedTei {
  return {
    titleZh: t.titleZh,
    titleEn: t.titleEn,
    order: t.lineOrder,
    lines: [...t.linesById.entries()],
  }
}

function rehydrate(s: SerializedTei): TeiLines {
  return {
    titleZh: s.titleZh,
    titleEn: s.titleEn,
    lineOrder: s.order,
    linesById: new Map(s.lines),
  }
}

/**
 * Parsed TEI for `url`, keyed by `key` (memo → Redis → fetch+parse). Returns
 * undefined when the fetch misses or the parse throws (neither is cached). A
 * successful cold parse is memoized and written to Redis (24h) unless it
 * serializes past MAX_CACHE_BYTES, in which case it is served live but not stored.
 */
async function loadParsed(
  url: string,
  key: string,
): Promise<TeiLines | undefined> {
  const warm = memo.get(key)
  if (warm) return warm

  const cached = await getJson<SerializedTei>(key)
  if (cached) {
    const hydrated = rehydrate(cached)
    memo.set(key, hydrated)
    return hydrated
  }

  const xml = await fetchText(url)
  if (!xml) return undefined
  let parsed: TeiLines
  try {
    parsed = parseTei(xml)
  } catch {
    return undefined
  }

  memo.set(key, parsed)
  const serialized = serialize(parsed)
  const json = JSON.stringify(serialized)
  if (Buffer.byteLength(json, 'utf8') <= MAX_CACHE_BYTES) {
    // A Redis write failure must NEVER discard a successfully parsed passage;
    // log and serve the live parse instead of letting getParsedLines throw.
    try {
      await setJson(key, serialized, TTL_MS)
    } catch (err) {
      console.error(
        `tei-cache setJson failed for ${key}: ${err instanceof Error ? err.message : err}`,
      )
    }
  }
  return parsed
}

/**
 * Parsed source + (best-available) translation for a work.
 *
 * SOURCE is required (throws when it cannot be fetched/parsed — github.ts treats
 * that as "no content"). TRANSLATION carries the Fabulu fallback: try the
 * requested translator (authoritative when undefined); if that yields nothing AND
 * no translator was requested, retry the community `Fabulu` path. `translatorUsed`
 * names whoever actually produced text (undefined = authoritative), so the cache
 * key and attribution.translator both stay truthful. Both TEI 404s → ZH-only.
 */
export async function getParsedLines(
  workId: string,
  translator: string | undefined,
): Promise<{src: TeiLines; tran?: TeiLines; translatorUsed?: string}> {
  const sUrl = sourceUrl(workId)
  const src = sUrl ? await loadParsed(sUrl, `tei:${workId}:src`) : undefined
  if (!src) throw Error(`no source TEI for ${workId}`)

  let tran: TeiLines | undefined
  let translatorUsed: string | undefined

  const primaryUrl = translationUrl(workId, translator || undefined)
  if (primaryUrl) {
    tran = await loadParsed(primaryUrl, `tei:${workId}:${translator || 'auth'}`)
    if (tran) translatorUsed = translator || undefined
  }

  // Authoritative translations are frequently empty; fall back to the community
  // Fabulu path so a bare passage route still renders bilingually when possible.
  if (!tran && !translator) {
    const fbUrl = translationUrl(workId, 'Fabulu')
    if (fbUrl) {
      tran = await loadParsed(fbUrl, `tei:${workId}:Fabulu`)
      if (tran) translatorUsed = 'Fabulu'
    }
  }

  return {src, tran, translatorUsed}
}
