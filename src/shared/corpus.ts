// Corpus / file-id identification. Ported from ReadZen lib/corpus.js, which
// mirrors Services/ZenUriParser.cs in the desktop app. Pure — no DOM, no deps.

export type Corpus = (typeof Corpus)[keyof typeof Corpus]
export const Corpus = {
  Cbeta: 'cbeta',
  OpenZen: 'openzen',
  Unknown: 'unknown',
} as const

export const OPEN_ZEN_PUBLISHERS = ['ws', 'pd', 'ce', 'mit'] as const
const OPEN_ZEN_PUBLISHER_GROUP = '(?:ws|pd|ce|mit)'

export const OPEN_WORK_ID_PATTERN = new RegExp(
  `^${OPEN_ZEN_PUBLISHER_GROUP}\\.[A-Za-z0-9][A-Za-z0-9-]*$`,
  'i',
)

const CBETA_WORK_ID_PATTERN = /^[A-Za-z]{1,3}\d{1,4}n[A-Za-z]?\d{1,5}[A-Za-z]?$/

/** True if the file ID is in OpenZen format (publisher.slug). */
export function isOpenZenFileId(fileId: string | undefined): boolean {
  if (!fileId) return false
  return OPEN_WORK_ID_PATTERN.test(fileId)
}

/** Infers the corpus from a compact file ID. */
export function inferCorpus(fileId: string | undefined): Corpus {
  if (!fileId) return Corpus.Unknown
  if (isOpenZenFileId(fileId)) return Corpus.OpenZen
  if (CBETA_WORK_ID_PATTERN.test(fileId)) return Corpus.Cbeta
  return Corpus.Unknown
}
