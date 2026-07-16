import {Corpus, inferCorpus} from '../../shared/corpus.ts'

// Corpus lives in public GitHub repos, fetchable server-side via the approved
// raw.githubusercontent.com domain. Ported from ReadZen lib/github.js.
const RAW = 'https://raw.githubusercontent.com/Fabulu'
const CBETA_TEXT = `${RAW}/CbetaZenTexts/main/xml-p5/`
const CBETA_TRAN = `${RAW}/CbetaZenTranslations/main/xml-p5t/`
const CBETA_COMMUNITY = `${RAW}/CbetaZenTranslations/main/community/translations/`
const OPEN_TEXT = `${RAW}/OpenZenTexts/main/xml-open/`
const OPEN_TRAN = `${RAW}/OpenZenTranslations/main/xml-open-t/`
const OPEN_COMMUNITY = `${RAW}/OpenZenTranslations/main/community/translations/`

/** fileId → relative TEI path. CBETA `T/T48/T48n2005.xml`; OpenZen `pub/slug/slug.xml`. */
export function relPathForFileId(
  fileId: string,
  corpus: Corpus,
): string | undefined {
  if (corpus === Corpus.OpenZen) {
    const dot = fileId.indexOf('.')
    if (dot < 1 || dot >= fileId.length - 1) return undefined
    const pub = fileId.slice(0, dot)
    const slug = fileId.slice(dot + 1)
    return `${pub}/${slug}/${slug}.xml`
  }
  if (corpus === Corpus.Cbeta) {
    const n = fileId.indexOf('n')
    if (n < 1) return undefined
    const volume = fileId.slice(0, n)
    const canon = volume.replace(/[0-9]/g, '')
    if (!canon) return undefined
    return `${canon}/${volume}/${fileId}.xml`
  }
  return undefined
}

/** URL of the Chinese source TEI for a work. */
export function sourceUrl(fileId: string): string | undefined {
  const corpus = inferCorpus(fileId)
  const rel = relPathForFileId(fileId, corpus)
  if (!rel) return undefined
  return (corpus === Corpus.OpenZen ? OPEN_TEXT : CBETA_TEXT) + rel
}

/**
 * URL of the English translation TEI. With a translator → the community path;
 * otherwise the authoritative path. (Returns a URL even if the file may 404 —
 * the caller treats a miss as "ZH-only".)
 */
export function translationUrl(
  fileId: string,
  translator?: string,
): string | undefined {
  const corpus = inferCorpus(fileId)
  const rel = relPathForFileId(fileId, corpus)
  if (!rel) return undefined
  const open = corpus === Corpus.OpenZen
  if (translator) {
    return `${open ? OPEN_COMMUNITY : CBETA_COMMUNITY}${translator}/${rel}`
  }
  return (open ? OPEN_TRAN : CBETA_TRAN) + rel
}

/** Whitespace normalization, ported verbatim from ReadZen lib/format.js. */
export function normalizeText(text: string | null | undefined): string {
  return String(text == null ? '' : text)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}
