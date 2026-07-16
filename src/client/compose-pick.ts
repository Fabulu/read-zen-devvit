import type {BilingualLine, RenderedContent, SearchHit} from '../shared/api.ts'
import {CASES} from '../shared/cases.ts'
import {parseRoute} from '../shared/route.ts'
import {fetchResolve, fetchSearch} from './fetch.ts'
import {escapeHtml} from './post-card.ts'

// Composer Step 1 — pick the passage to quote. Search is the front half of
// composing (the default tab): "find a Zen passage" is the first thing the user
// sees. Once a title/master/case is chosen we resolve it and let the user tap a
// first line then a last line to narrow the quotation, then Continue advances to
// Step 2 with a line-ranged route.

type Tab = 'search' | 'cases'

/**
 * Sticky-head setter, threaded from reader.ts: `setHead(label, onBack?)` renders
 * the composer's Back button + step kicker into the pinned head so they stay put
 * while the (potentially very long) step body scrolls.
 */
type SetHead = (label: string, onBack?: () => void) => void

/** Mount the picker. `onPicked` receives a line-ranged route for Step 2. */
export function mountComposePick(
  container: HTMLElement,
  setHead: SetHead,
  onPicked: (route: string) => void,
): void {
  // Step 1 head = the kicker only. No Back — this IS the composer's entry step.
  setHead('Find a passage to share')
  container.innerHTML = `<section class="rz-compose">
      <div class="rz-seg" role="tablist">
        <button class="rz-seg-btn is-active" type="button" role="tab" data-tab="search">Search</button>
        <button class="rz-seg-btn" type="button" role="tab" data-tab="cases">Classic cases</button>
      </div>
      <div class="rz-panel" data-panel></div>
    </section>`

  const panel = container.querySelector<HTMLElement>('[data-panel]')
  const btns = container.querySelectorAll<HTMLButtonElement>('.rz-seg-btn')
  if (!panel) return

  function select(tab: Tab): void {
    for (const b of btns) b.classList.toggle('is-active', b.dataset.tab === tab)
    if (tab === 'cases')
      renderCases(container, setHead, panel as HTMLElement, onPicked)
    else renderSearch(container, setHead, panel as HTMLElement, onPicked)
  }

  for (const b of btns) {
    b.addEventListener('click', () =>
      select((b.dataset.tab as Tab) ?? 'search'),
    )
  }
  select('search')
}

function renderSearch(
  container: HTMLElement,
  setHead: SetHead,
  panel: HTMLElement,
  onPicked: (route: string) => void,
): void {
  panel.innerHTML = `<input class="rz-input" type="search" inputmode="search"
        autocomplete="off" spellcheck="false"
        placeholder="Search the Zen canon…" aria-label="Search the Zen canon" />
      <div class="rz-results" data-results>
        <p class="rz-hint">Search by title, master, or teaching.</p>
      </div>`

  const input = panel.querySelector<HTMLInputElement>('.rz-input')
  const results = panel.querySelector<HTMLElement>('[data-results]')
  if (!input || !results) return

  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0
  input.addEventListener('input', () => {
    const q = input.value.trim()
    if (timer) clearTimeout(timer)
    if (!q) {
      results.innerHTML = `<p class="rz-hint">Search by title, master, or teaching.</p>`
      return
    }
    timer = setTimeout(() => {
      const mine = ++seq
      results.innerHTML = `<p class="rz-hint">Searching…</p>`
      void fetchSearch(q).then(rsp => {
        if (mine !== seq) return // a newer query superseded this one
        renderHits(container, setHead, results, rsp.hits, onPicked)
      })
    }, 250)
  })
  // Only auto-focus on a device with a fine pointer; on touch this would pop the
  // mobile keyboard the moment the composer mounts.
  if (window.matchMedia('(pointer:fine)').matches) input.focus()
}

function renderHits(
  container: HTMLElement,
  setHead: SetHead,
  results: HTMLElement,
  hits: SearchHit[],
  onPicked: (route: string) => void,
): void {
  if (!hits.length) {
    results.innerHTML = `<p class="rz-hint">Nothing found. Try another word.</p>`
    return
  }
  results.innerHTML = hits
    .map(h => rowHtml(h.route, h.title, h.titleZh, h.kind))
    .join('')
  wireRows(container, setHead, results, onPicked)
}

function renderCases(
  container: HTMLElement,
  setHead: SetHead,
  panel: HTMLElement,
  onPicked: (route: string) => void,
): void {
  panel.innerHTML = `<div class="rz-results" data-results>
      ${CASES.map(c => rowHtml(c.route, c.label)).join('')}
    </div>`
  const results = panel.querySelector<HTMLElement>('[data-results]')
  if (results) wireRows(container, setHead, results, onPicked)
}

function rowHtml(
  route: string,
  main: string,
  sub?: string,
  kind?: string,
): string {
  return `<button class="rz-row" type="button" data-route="${escapeHtml(route)}"${kind ? ` data-kind="${escapeHtml(kind)}"` : ''}>
      <span class="rz-row-text">
        <span class="rz-row-main">${escapeHtml(main)}</span>
        ${sub ? `<span class="rz-row-sub" lang="zh-Hant">${escapeHtml(sub)}</span>` : ''}
      </span>
      ${kind ? `<span class="rz-chip">${escapeHtml(kind)}</span>` : ''}
    </button>`
}

function wireRows(
  container: HTMLElement,
  setHead: SetHead,
  scope: HTMLElement,
  onPicked: (route: string) => void,
): void {
  for (const row of scope.querySelectorAll<HTMLButtonElement>('.rz-row')) {
    row.addEventListener('click', () => {
      const route = row.dataset.route
      if (!route) return
      // A master hit is a whole-card route (bare `master/<slug>`), not a passage
      // with lines — skip the line-range picker and advance straight to Step 2.
      if (row.dataset.kind === 'master') onPicked(route)
      else void openRange(container, setHead, route, onPicked)
    })
  }
}

/** Compact work·case label for the range-picker's sticky head. */
function rangeLabel(content: RenderedContent): string {
  const a = content.attribution
  return [a.workZh, a.work, content.caseLabel || content.title]
    .filter(Boolean)
    .join(' · ')
}

async function openRange(
  container: HTMLElement,
  setHead: SetHead,
  route: string,
  onPicked: (route: string) => void,
): Promise<void> {
  // Back lives in the STICKY head now (so it never scrolls out of reach in a long
  // range list) and returns to Step 1. Pin it before the async resolve.
  const backToPick = (): void => mountComposePick(container, setHead, onPicked)
  setHead('', backToPick)
  container.innerHTML = `<section class="rz-compose">
      <div class="rz-range" data-range><p class="rz-hint">Loading passage…</p></div>
    </section>`
  const box = container.querySelector<HTMLElement>('[data-range]')
  if (!box) return

  const rsp = await fetchResolve(route)
  if (!rsp?.content.lines.length) {
    box.innerHTML = `<p class="rz-hint">This passage couldn’t be loaded. Try another.</p>`
    return
  }
  // Now the work·case label is known — show it beside Back in the head.
  setHead(rangeLabel(rsp.content), backToPick)
  renderRange(box, route, rsp.content, onPicked)
}

function renderRange(
  box: HTMLElement,
  route: string,
  content: RenderedContent,
  onPicked: (route: string) => void,
): void {
  const parsed = parseRoute(route)
  const workId = parsed?.workId || content.workId
  const translator = parsed?.translator || ''
  const lines = content.lines
  // Selection: [] = whole passage; [i] = single line; [a,b] = a-b span.
  let sel: number[] = []

  // Commit the current selection (empty = whole passage) to Step 2.
  function commit(): void {
    const [a, b] = span(sel, lines.length)
    const startId = lines[a]?.id ?? ''
    const endId = lines[b]?.id ?? ''
    if (!startId || !endId) return
    const tail = translator ? `/${translator}` : ''
    onPicked(`${workId}/${startId}-${endId}${tail}`)
  }

  // A plain-language status of what will be posted, so the tap-first/tap-last
  // model (and its "third tap restarts the range" reset) reads as intentional.
  function statusText(): string {
    if (sel.length === 0)
      return 'Whole passage — or tap the first line to narrow it'
    if (sel.length === 1) return 'First line set — tap the last line'
    const [lo, hi] = span(sel, lines.length)
    return `Lines ${lo + 1}–${hi + 1} selected (${hi - lo + 1})`
  }

  function paint(): void {
    // Before the first tap the whole passage is implied — but keep every line
    // UNWASHED (no gold) so mount reads as a quiet quotation, not a gold surface.
    // The gold wash appears only once the user has actually tapped a line.
    const hasSel = sel.length > 0
    const [lo, hi] = span(sel, lines.length)
    box.innerHTML = `<p class="rz-kicker">Tap a first line, then a last line</p>
      <p class="rz-status">${statusText()}</p>
      <div class="rz-picklines">
        ${lines.map((l, i) => pickLineHtml(l, i, hasSel && i >= lo && i <= hi)).join('')}
      </div>
      <div class="rz-actionbar">
        <button class="rz-textbtn" type="button" data-whole>Use whole passage</button>
        <button class="rz-pill" type="button" data-continue>${hasSel ? 'Continue' : 'Continue with whole passage'}</button>
      </div>`

    for (const el of box.querySelectorAll<HTMLElement>('.rz-pickline')) {
      el.addEventListener('click', () => {
        const i = Number(el.dataset.i)
        const first = sel[0]
        sel = sel.length === 1 && first !== undefined ? [first, i] : [i]
        paint()
      })
    }
    box
      .querySelector<HTMLButtonElement>('[data-continue]')
      ?.addEventListener('click', () => commit())
    // Escape hatch for a very long passage: post the whole thing in one tap.
    box
      .querySelector<HTMLButtonElement>('[data-whole]')
      ?.addEventListener('click', () => {
        sel = []
        commit()
      })
  }
  paint()
}

/** Inclusive [lo, hi] index span; empty selection = the whole passage. */
function span(sel: number[], len: number): [number, number] {
  if (!sel.length) return [0, Math.max(0, len - 1)]
  return [Math.min(...sel), Math.max(...sel)]
}

function pickLineHtml(l: BilingualLine, i: number, selected: boolean): string {
  return `<button class="rz-pickline${selected ? ' is-sel' : ''}" type="button" data-i="${i}">
      ${l.zh ? `<span class="rz-zh" lang="zh-Hant">${escapeHtml(l.zh)}</span>` : ''}
      ${l.en ? `<span class="rz-en">${escapeHtml(l.en)}</span>` : ''}
    </button>`
}
