import type {RenderedContent, RzPostData} from '../shared/api.ts'

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Attribution caption line, e.g. "無門關 · The Gateless Gate · Case 1". */
export function attrLine(content: RenderedContent): string {
  const a = content.attribution
  return [a.workZh, a.work, content.caseLabel].filter(Boolean).join(' · ')
}

/**
 * Compact ≤2KB preview (postData v2) embedded in the post at submit. reader.ts
 * reads it back synchronously and paints the in-feed quotation card with zero
 * fetch. When `commentary` is present, `cm` carries a ≤240-char teaser so the
 * first paint shows the author's note before `/api/resolve` hydrates. Budget:
 * zh≤60 + en≤140 + short attr + route + cm≤240 stays well under the 2KB cap.
 */
export function buildPostData(
  content: RenderedContent,
  commentary?: string,
): RzPostData {
  const zh = content.lines.map(l => l.zh).join('')
  const en = content.lines
    .map(l => l.en ?? '')
    .filter(Boolean)
    .join(' ')
  const pd: RzPostData = {
    v: 2,
    route: content.rzLink,
    preview: {
      zh: truncate(zh, 60),
      en: truncate(en, 140),
      attr: attrLine(content),
    },
  }
  const cm = commentary?.trim()
  if (cm) pd.cm = truncate(cm, 240)
  return pd
}

/**
 * Old-Reddit / universal fallback. Block order:
 *   title → (commentary + `---` rule, when present) → quoted case (ZH blockquote
 *   + EN) → attribution → link.
 *
 * The author's commentary is the substantive, REQUIRED contribution, so it is
 * emitted near the TOP (right after the title/attribution, before the long case
 * lines). The downstream `truncateFallback` keeps whole `\n\n` blocks FROM THE
 * START until the ~38k budget fills, so a monster passage now clamps the QUOTED
 * CASE (with a read-more link) and never the user's commentary — which, in the
 * old order, was the first thing dropped.
 */
export function buildTextFallback(
  content: RenderedContent,
  commentary?: string,
): string {
  const lines: string[] = []
  lines.push(
    `**${content.titleZh ?? ''} ${content.title}** — ${content.caseLabel ?? ''}`.trim(),
  )
  lines.push('')
  const cm = commentary?.trim()
  if (cm) {
    lines.push(cm)
    lines.push('')
    lines.push('---')
    lines.push('')
  }
  for (const l of content.lines) {
    lines.push(`> ${l.zh}`)
    if (l.en) lines.push(`> ${l.en}`)
    lines.push('')
  }
  const a = content.attribution
  const cite = [
    a.work,
    a.cbetaId,
    a.translator && `tr. ${a.translator}`,
    a.license,
  ]
    .filter(Boolean)
    .join(' · ')
  lines.push(`*${cite}*`)
  lines.push('')
  lines.push(`[Read the full case in ReadZen ›](${content.rzLink})`)
  return lines.join('\n')
}
