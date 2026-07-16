// Pure search engine (P1). No DOM, no fetch, no Redis in the leaf functions:
// searchMasters/searchTitles take plain arrays so they are unit-testable without
// a network. searchAll is the only async part — it pulls the cached corpora from
// corpus-data and joins the results (masters first, then titles, file order, no
// ranking). Ported from ReadZen views/search.js substring matchers; the bigram
// index / passesFilters / fulltext paths are intentionally NOT ported (P2).

import type {SearchHit} from '../../shared/api.ts'
import {
  getMasters,
  getTitles,
  type MasterRec,
  type TitleRec,
  workIdFromPath,
} from '../data/corpus-data.ts'

const MASTER_CAP = 5
const TITLE_CAP = 50

/**
 * Masters whose alias list contains `q` (case-insensitive substring over EVERY
 * `names[]` element; break on the first match so each master yields ≤ 1 hit).
 * Capped at 5. Route slug underscores spaces BEFORE encoding.
 */
export function searchMasters(q: string, masters: MasterRec[]): SearchHit[] {
  const lower = q.toLowerCase()
  const hits: SearchHit[] = []
  for (const m of masters) {
    for (const n of m.names) {
      if (n.toLowerCase().includes(lower)) {
        const canonical = m.names[0] ?? ''
        const slug = canonical.replace(/ /g, '_')
        hits.push({
          workId: slug,
          title: canonical,
          titleZh: m.names[1],
          route: `master/${encodeURIComponent(slug)}`,
          kind: 'master',
        })
        break
      }
    }
    if (hits.length >= MASTER_CAP) break
  }
  return hits
}

/**
 * Titles whose blob (`zh en enShort path`, lowercased) contains `q`. Capped at
 * 50. Route string is the bare workId (no `#/` prefix; the webview prepends it).
 */
export function searchTitles(q: string, titles: TitleRec[]): SearchHit[] {
  const lower = q.toLowerCase()
  const hits: SearchHit[] = []
  for (const t of titles) {
    const blob = `${t.zh} ${t.en} ${t.enShort} ${t.path}`.toLowerCase()
    if (blob.includes(lower)) {
      const workId = workIdFromPath(t.path)
      hits.push({
        workId,
        title: t.en || t.enShort || t.zh,
        titleZh: t.zh,
        route: workId,
        kind: 'title',
      })
      if (hits.length >= TITLE_CAP) break
    }
  }
  return hits
}

/**
 * Full P1 search. Blank / whitespace-only `q` → `[]` (never dumps the corpus).
 * Otherwise masters first, then titles, in file order (no ranking).
 */
export async function searchAll(q: string): Promise<SearchHit[]> {
  if (!q.trim()) return []
  const [masters, titles] = await Promise.all([getMasters(), getTitles()])
  return searchMasters(q, masters).concat(searchTitles(q, titles))
}
