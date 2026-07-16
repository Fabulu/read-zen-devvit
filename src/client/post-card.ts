import type {RenderedContent, RzPostData} from '../shared/api.ts'

// The single source of truth for how a ReadZen passage looks. Used by the reader
// (full content) and, later, the composer preview — so "what you preview" and
// "what you post" can never disagree: they share this builder.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function join(parts: (string | undefined)[], sep: string): string {
  return parts.filter(Boolean).join(sep)
}

/** The instant, zero-fetch card rendered from the post's embedded preview.
 *  The case sits in a native markdown-style blockquote; when the post carries a
 *  commentary teaser (`pd.cm`, v2) it paints below as plain paragraphs, so the
 *  reader sees the author's voice before the full case hydrates. */
export function previewCardHtml(pd: RzPostData): string {
  const cm = pd.cm
    ? `<p class="rz-commentary-text">${escapeHtml(pd.cm)}</p>`
    : ''
  // Emit each paragraph only when it has text (a master-card preview has no zh)
  // — an unconditional empty <p class="rz-zh"> would leave a stray gap.
  const zh = pd.preview.zh
    ? `<p class="rz-zh" lang="zh-Hant">${escapeHtml(pd.preview.zh)}</p>`
    : ''
  const en = pd.preview.en
    ? `<p class="rz-en">${escapeHtml(pd.preview.en)}</p>`
    : ''
  return `<article class="rz-reader">
      <blockquote class="rz-lines"><div class="rz-pair">${zh}${en}</div></blockquote>
      ${cm}
      <p class="rz-attr">${escapeHtml(pd.preview.attr)}</p>
    </article>`
}

/** The compact one-line work·case attribution. The composer preview box prepends
 *  it so its bounded card carries the same header the picker step showed. (In the
 *  posted content card this line is folded into the cite instead — Reddit renders
 *  the native title above the reader, so no sticky head there.) */
export function contentHeadHtml(c: RenderedContent): string {
  const a = c.attribution
  const line = join([a.workZh, a.work, c.caseLabel || c.title], ' · ')
  return line ? `<p class="rz-minihead">${escapeHtml(line)}</p>` : ''
}

/** The full bilingual case, hydrated from /api/resolve. Native selftext idiom:
 *  the case as a markdown-style blockquote, the cite directly beneath it (work·
 *  case merged in — no sticky head in content mode), then the author's commentary
 *  as plain paragraphs. No brand chrome (no ✦ rule, no kicker, no serif). */
export function contentCardHtml(
  c: RenderedContent,
  commentary?: string,
): string {
  const a = c.attribution

  const lines = c.lines
    .map(l => {
      // A zh-less line (e.g. a master's bio note) must not emit an empty
      // paragraph; mirror the conditional the `en` row already has.
      const zh = l.zh
        ? `<p class="rz-zh" lang="zh-Hant">${escapeHtml(l.zh)}</p>`
        : ''
      const en = l.en ? `<p class="rz-en">${escapeHtml(l.en)}</p>` : ''
      if (!zh && !en) return ''
      return `<div class="rz-pair">${zh}${en}</div>`
    })
    .filter(Boolean)
    .join('')

  // The cite carries the full scholarly line: the work·case that used to live in
  // the sticky head is folded in here, ahead of the source id, translator, and
  // license.
  const cite = join(
    [
      a.workZh,
      a.work,
      c.caseLabel || c.title,
      a.cbetaId,
      a.translator ? `tr. ${a.translator}` : undefined,
      a.license,
    ],
    ' · ',
  )

  // Commentary is plain Reddit-Sans paragraphs (`\n\n` → <p>). No kicker, no
  // rule, no byline — Reddit shows the author natively.
  const commentaryBlock = commentary?.trim()
    ? `<section class="rz-commentary">
        ${commentary
          .trim()
          .split(/\n{2,}/)
          .map(p => p.trim())
          .filter(Boolean)
          .map(p => `<p class="rz-commentary-text">${escapeHtml(p)}</p>`)
          .join('')}
      </section>`
    : ''

  return `<article class="rz-reader">
      ${lines ? `<blockquote class="rz-lines">${lines}</blockquote>` : ''}
      <p class="rz-cite">${escapeHtml(cite)}</p>
      ${commentaryBlock}
    </article>`
}
