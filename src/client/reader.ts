import {context, navigateTo, requestExpandedMode} from '@devvit/web/client'
import type {RzPostData} from '../shared/api.ts'
import {mountCompose} from './compose.ts'
import {mountComposePick} from './compose-pick.ts'
import {fetchResolve} from './fetch.ts'
import {contentCardHtml, escapeHtml, previewCardHtml} from './post-card.ts'
import {applyTheme} from './theme.ts'

// Stamp data-theme before first paint so the reader chrome matches Reddit's scheme.
applyTheme()

// One entrypoint, one flex-column shell, two modes:
//   • a quotation post (has postData) → CONTENT mode: instant preview + sticky
//     work·case head, then the full bilingual case + the author's commentary
//     from /api/resolve. No compose affordance — a content post IS a quotation.
//   • the hub post (no postData) → COMPOSER mode: search → pick → title +
//     200-word commentary → post, inside the same scroll column.
// The shell is a fixed flex column: a sticky head, a `.rz-scroll` reading/step
// column (the only thing that scrolls), and a pinned bottom bar carrying the
// Privacy·Terms legal links (compliance: present in EVERY mode) on the left and
// an optional "More room ›" expand link on the right.

const PRIVACY_URL = 'https://readzen-legal.pages.dev/privacy/'
const TERMS_URL = 'https://readzen-legal.pages.dev/terms/'

interface Shell {
  head: HTMLElement
  mount: HTMLElement
}

function wireLegal(app: HTMLElement): void {
  for (const a of app.querySelectorAll<HTMLAnchorElement>('.rz-legal a')) {
    a.addEventListener('click', ev => {
      ev.preventDefault()
      const url = a.dataset.url
      if (url) navigateTo(url)
    })
  }
}

// "More room ›" requests the expanded webview. Inline is capped ~512px; expanded
// is taller — so hide the link once we're already roomy (min-height ≥ 600px),
// re-checked on resize. Offered, never required.
function wireMoreRoom(link: HTMLElement): void {
  const mq = window.matchMedia('(min-height: 600px)')
  const sync = (): void => {
    link.hidden = mq.matches
  }
  sync()
  mq.addEventListener('change', sync)
  window.addEventListener('resize', sync)
  link.addEventListener('click', ev => {
    ev.preventDefault()
    requestExpandedMode(ev, 'reader')
  })
}

/** Build the flex shell: sticky head + scroll-mounted body + pinned bottom bar. */
function buildShell(app: HTMLElement): Shell {
  app.innerHTML = `<div class="rz-stickyhead" id="rz-head"></div>
    <div class="rz-scroll"><div id="rz-mount"></div></div>
    <div class="rz-bottombar">
      <div class="rz-legal">
        <a href="#" data-url="${PRIVACY_URL}">Privacy</a>
        <span aria-hidden="true">·</span>
        <a href="#" data-url="${TERMS_URL}">Terms</a>
      </div>
      <a href="#" class="rz-moreroom" data-moreroom hidden>More room ›</a>
    </div>`
  wireLegal(app)
  const moreRoom = app.querySelector<HTMLElement>('[data-moreroom]')
  if (moreRoom) wireMoreRoom(moreRoom)
  const head = document.getElementById('rz-head')
  const mount = document.getElementById('rz-mount')
  if (!head || !mount) throw new Error('shell nodes missing')
  return {head, mount}
}

/**
 * Build a sticky-head setter bound to the head element. `setHead(label, onBack?)`
 * renders the composer's Back button + step kicker INTO the pinned head, so they
 * stay reachable while a long step body scrolls (spec §B2). Empty label + no
 * onBack hides the head entirely (FIX 7 — no bare hairline strip).
 */
function makeSetHead(
  head: HTMLElement,
): (l: string, onBack?: () => void) => void {
  return (label, onBack) => {
    const back = onBack
      ? `<button class="rz-back" type="button">&lsaquo; Back</button>`
      : ''
    const sep =
      onBack && label
        ? `<span class="rz-headsep" aria-hidden="true">·</span>`
        : ''
    const text = label
      ? `<span class="rz-minihead">${escapeHtml(label)}</span>`
      : ''
    head.innerHTML =
      back || text ? `<div class="rz-headrow">${back}${sep}${text}</div>` : ''
    head.hidden = !head.innerHTML
    if (onBack)
      head
        .querySelector<HTMLButtonElement>('.rz-back')
        ?.addEventListener('click', onBack)
  }
}

/** Enter the composer (Step 1 → Step 2), reusing the same mount + sticky head. */
function enterCompose(
  mount: HTMLElement,
  setHead: (l: string, onBack?: () => void) => void,
): void {
  mountComposePick(mount, setHead, route =>
    mountCompose(mount, setHead, route, () => enterCompose(mount, setHead)),
  )
}

async function main(): Promise<void> {
  const app = document.getElementById('app')
  if (!app) return
  const {head, mount} = buildShell(app)
  const pd = context.postData as unknown as RzPostData | undefined

  // Hub post (no embedded quotation) → composer. Keep the sticky head VISIBLE:
  // each composer step pins its Back button + kicker there (spec §B2) so they
  // never scroll out of reach; the setter manages head visibility per step.
  if (!pd?.v) {
    enterCompose(mount, makeSetHead(head))
    return
  }

  // Quotation post → reader. No sticky head in content mode: Reddit renders the
  // native post title above us, so the work·case rides in the cite instead. Paint
  // the embedded preview synchronously (case + commentary teaser), then hydrate
  // the full case and the author's commentary from /api/resolve.
  head.hidden = true
  mount.innerHTML = previewCardHtml(pd)
  try {
    const rsp = await fetchResolve(pd.route)
    if (rsp) {
      mount.innerHTML = contentCardHtml(rsp.content, rsp.commentary)
    }
  } catch (err) {
    console.error(err)
  }
}

void main()
