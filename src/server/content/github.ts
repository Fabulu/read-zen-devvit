import type {BilingualLine, RenderedContent} from '../../shared/api.ts'
import type {RzRoute} from '../../shared/route.ts'
import {getTitles, type TitleRec, workIdFromPath} from '../data/corpus-data.ts'
import type {ContentProvider} from './provider.ts'
import {getParsedLines} from './tei-cache.ts'

// Live provider: resolves the Chinese source + English translation via the parsed
// TEI cache (tei-cache.ts, which fetches from the approved raw.githubusercontent
// host, parses once, and caches). Bilingual truth lives only in this TEI pair (the
// segments files are ZH-only in practice); the cache also runs the Fabulu fallback
// when a bare route's authoritative translation is empty. A missing translation →
// ZH-only. Attribution prefers the curated titles.jsonl (enShort/zh) over the raw
// TEI header when the work is catalogued.

/** Short display title: drop the edition parenthetical / subtitle tail. */
function shortTitle(s: string): string {
  const head = s.split(/[（(—]/)[0]
  return (head ?? s).trim() || s.trim()
}

function caseLabelFromId(id: string): string | undefined {
  const m = id.match(/case0*(\d+)/i)
  return m ? `Case ${m[1]}` : undefined
}

function roleForId(id: string): BilingualLine['role'] {
  if (/verse/i.test(id)) return 'verse'
  if (/wumen|comment/i.test(id)) return 'comment'
  return 'case'
}

/** Real (non-synthetic) lb ids in [startLine, endLine]; capped when open-ended. */
function sliceIds(
  order: string[],
  startLine: string,
  endLine: string,
): string[] {
  const real = (id: string): boolean => !id.startsWith('__')
  if (!startLine) return order.filter(real).slice(0, 400)
  const s = order.indexOf(startLine)
  if (s < 0) return []
  const e = endLine ? order.indexOf(endLine) : s
  const lo = Math.min(s, e < 0 ? s : e)
  const hi = Math.max(s, e < 0 ? s : e)
  return order.slice(lo, hi + 1).filter(real)
}

// titleByPath (corpus-data) keys on the corpus `path`; here we have a `workId`.
// Build the reverse index once (getTitles is itself memoized) so attribution
// lookup is O(1) per request instead of a 4,992-row scan.
let titleByWorkId: Map<string, TitleRec> | undefined

async function titleForWorkId(workId: string): Promise<TitleRec | undefined> {
  try {
    if (!titleByWorkId) {
      const index = new Map<string, TitleRec>()
      for (const t of await getTitles()) {
        const id = workIdFromPath(t.path)
        if (id && !index.has(id)) index.set(id, t)
      }
      titleByWorkId = index
    }
    return titleByWorkId.get(workId)
  } catch {
    return undefined
  }
}

export const githubProvider: ContentProvider = {
  name: 'github',
  async resolve(route: RzRoute): Promise<RenderedContent | undefined> {
    if (route.kind !== 'passage' || !route.workId) return undefined

    let parsed: Awaited<ReturnType<typeof getParsedLines>>
    try {
      parsed = await getParsedLines(route.workId, route.translator || undefined)
    } catch {
      return undefined
    }
    const {src, tran, translatorUsed} = parsed

    const ids = sliceIds(
      src.lineOrder,
      route.startLine ?? '',
      route.endLine ?? '',
    )
    const lines: BilingualLine[] = ids
      .map(id => {
        const zh = src.linesById.get(id) ?? ''
        const en = tran?.linesById.get(id)
        return {id, zh, en: en || undefined, role: roleForId(id)}
      })
      .filter(l => l.zh)
    if (!lines.length) return undefined

    // Attribution polish: prefer the curated catalogue title, fall back to the
    // raw TEI header for works not in titles.jsonl (and the ZH-only paths).
    const rec = await titleForWorkId(route.workId)
    const workEn =
      rec?.enShort ||
      rec?.en ||
      shortTitle(src.titleEn || src.titleZh || route.workId)
    const workZh = rec?.zh || shortTitle(src.titleZh)

    const startId = route.startLine ?? ''
    return {
      kind: 'passage',
      workId: route.workId,
      title: workEn,
      titleZh: workZh || undefined,
      caseLabel: startId ? caseLabelFromId(startId) : undefined,
      lines,
      attribution: {
        work: workEn,
        workZh: workZh || undefined,
        translator: translatorUsed,
      },
      rzLink: `https://readzen.pages.dev/#/${route.rawRoute}`,
    }
  },
}
