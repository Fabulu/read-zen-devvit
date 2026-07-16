import {context, navigateTo} from '@devvit/web/client'
import type {RenderedContent} from '../shared/api.ts'
import {countWords} from '../shared/words.ts'
import {fetchComposeSubmit, fetchResolve} from './fetch.ts'
import {contentCardHtml, contentHeadHtml, escapeHtml} from './post-card.ts'

// Composer Step 2 — the substance gate. The preview box holds the EXACT
// contentCardHtml output (same builder the reader posts with, so what you see is
// what gets posted), then a required TITLE field and a required COMMENTARY field
// with a live word counter. Post stays disabled until the title has ≥3 chars and
// the commentary has ≥200 words (`countWords`, shared with the server, which
// re-validates — the client never trusts its own count). Failures surface as a
// quiet inline message, never a crash. A Back button returns to Step 1 via the
// caller-supplied `onBack`.

/** At least this many words of commentary before a post may be made. */
const WORD_MIN = 200

/**
 * Sticky-head setter, threaded from reader.ts: `setHead(label, onBack?)` renders
 * the composer's Back button + step kicker into the pinned head so they stay
 * reachable while the step body scrolls.
 */
type SetHead = (label: string, onBack?: () => void) => void

/** The Post button's label, using the live subreddit name when available. */
function postLabel(): string {
  const sub = context.subredditName
  return sub ? `Post to r/${sub}` : 'Post to the community'
}

/** The sticky-head label for Step 2, e.g. "Share to r/zen". */
function headLabel(): string {
  const sub = context.subredditName
  return sub ? `Share to r/${sub}` : 'Share to the community'
}

/**
 * Mount Step 2 for a line-ranged route. `setHead` pins Back + kicker in the
 * sticky head (so Back never scrolls out of reach in a long step); `onBack`
 * re-mounts Step 1.
 */
export function mountCompose(
  container: HTMLElement,
  setHead: SetHead,
  route: string,
  onBack: () => void,
): void {
  void render(container, setHead, route, onBack)
}

async function render(
  container: HTMLElement,
  setHead: SetHead,
  route: string,
  onBack: () => void,
): Promise<void> {
  // Pin Back + the step kicker in the sticky head immediately (before the async
  // resolve) so they're reachable even while the preview loads.
  setHead(headLabel(), onBack)
  container.innerHTML = `<p class="rz-hint">Loading preview…</p>`
  const rsp = await fetchResolve(route)
  if (!rsp?.content.lines.length) {
    container.innerHTML = `<p class="rz-hint">This passage couldn’t be loaded.</p>`
    return
  }
  const content = rsp.content
  const label = postLabel()

  container.innerHTML = `<section class="rz-compose">
      <div class="rz-preview-box">
        ${contentHeadHtml(content)}
        ${contentCardHtml(content)}
      </div>
      <label class="rz-field">
        <span class="rz-field-label">Your title</span>
        <input class="rz-input" type="text" maxlength="300" data-title
          placeholder="${escapeHtml(buildTitle(content))}" />
        <span class="rz-field-note">A title in your own words — the work’s name is just a starting point.</span>
      </label>
      <label class="rz-field">
        <span class="rz-field-labelrow">
          <span class="rz-field-label">Your commentary</span>
          <span class="rz-count" data-count aria-live="polite">0 / ${WORD_MIN} words</span>
        </span>
        <textarea class="rz-textarea" rows="8" maxlength="10000" data-commentary
          placeholder="What does this case say? Why did you pick it?"></textarea>
      </label>
      <p class="rz-helper" data-helper>Substantive posts only: at least ${WORD_MIN} words of your own commentary go with the passage.</p>
      <div class="rz-actionbar">
        <button class="rz-pill" type="button" data-post disabled>${label}</button>
      </div>
      <p class="rz-error" data-error hidden></p>
    </section>`

  const titleEl = container.querySelector<HTMLInputElement>('[data-title]')
  const textarea =
    container.querySelector<HTMLTextAreaElement>('[data-commentary]')
  const countEl = container.querySelector<HTMLElement>('[data-count]')
  const helperEl = container.querySelector<HTMLElement>('[data-helper]')
  const btn = container.querySelector<HTMLButtonElement>('[data-post]')
  const err = container.querySelector<HTMLElement>('[data-error]')
  if (!titleEl || !textarea || !countEl || !helperEl || !btn || !err) return

  // Recompute the gate on every keystroke: counter text + met-state, helper
  // visibility, and the Post button's disabled state. Neutral throughout (the
  // counter is information, not an alarm) — no gold, no red, no animation.
  function refresh(): void {
    if (!textarea || !countEl || !helperEl || !titleEl || !btn) return
    const words = countWords(textarea.value)
    const wordsOk = words >= WORD_MIN
    countEl.textContent = wordsOk
      ? `${words} words`
      : `${words} / ${WORD_MIN} words`
    countEl.classList.toggle('is-met', wordsOk)
    helperEl.hidden = wordsOk
    const titleOk = titleEl.value.trim().length >= 3
    btn.disabled = !(titleOk && wordsOk)
  }
  titleEl.addEventListener('input', refresh)
  textarea.addEventListener('input', refresh)
  refresh()

  btn.addEventListener('click', () => {
    if (btn.disabled) return
    err.hidden = true
    btn.disabled = true
    btn.textContent = 'Posting…'
    const title = titleEl.value.trim()
    const commentary = textarea.value
    void fetchComposeSubmit({route, title, commentary}).then(res => {
      if ('error' in res) {
        err.textContent = res.detail
          ? `${res.error} (${res.detail})`
          : res.error
        err.hidden = false
        btn.textContent = label
        refresh()
        return
      }
      // Non-fatal: the post landed but USER attribution was lost, so it was
      // posted as ReadZen. The post WAS created — do NOT re-enable the pill
      // (refresh() would invite a duplicate submit). Surface WHY (don't
      // auto-navigate) plus a quiet "View post ›" link so the flow resolves.
      if (res.fallbackReason) {
        err.innerHTML = `Posted as ReadZen (couldn’t post as you: ${escapeHtml(res.fallbackReason)}). <a href="#" class="rz-viewpost" data-url>View post ›</a>`
        err.hidden = false
        err
          .querySelector<HTMLAnchorElement>('.rz-viewpost')
          ?.addEventListener('click', ev => {
            ev.preventDefault()
            navigateTo(res.url)
          })
        // Leave Post disabled with its label restored; the submission succeeded.
        btn.textContent = label
        return
      }
      navigateTo(res.url)
    })
  })
}

/** A concise title suggestion from the resolved content — the placeholder ONLY;
 *  the submitted title is always the user's own typed text. */
function buildTitle(c: RenderedContent): string {
  const t = [c.caseLabel, c.title, c.titleZh].filter(Boolean).join(' · ')
  return t.length > 300 ? t.slice(0, 300) : t
}
