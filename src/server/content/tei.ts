import {DOMParser} from 'linkedom'
import {normalizeText} from './paths.ts'

// TEI → line map, ported from ReadZen lib/tei.js (parseTei) onto linkedom so it
// runs server-side. Preserves the display-text semantics that a hand-rolled
// scanner would break: <lb> buckets, first-edition <lb ed=> suppression,
// <app>/<lem> renders + <rdg> suppressed, <g> glyphs, <caesura>, <lg> verse,
// skip <note>/<mulu>/<milestone>. Apparatus/heading DATA is dropped (not needed
// for the reader); the TEXT flow matches the SPA exactly.

const TEXT_NODE = 3
const ELEMENT_NODE = 1

type XNode = {
  nodeType: number
  nodeValue: string | null
  localName: string
  textContent: string | null
  getAttribute(name: string): string | null
  childNodes: {length: number; [i: number]: XNode}
}

type XDoc = {
  getElementsByTagName(name: string): {length: number; [i: number]: XNode}
}

export type TeiLines = {
  titleZh: string
  titleEn: string
  linesById: Map<string, string>
  lineOrder: string[]
}

export function parseTei(xmlText: string): TeiLines {
  const doc = new DOMParser().parseFromString(
    xmlText,
    'text/xml',
  ) as unknown as XDoc
  const body = doc.getElementsByTagName('body')[0]
  if (!body) throw new Error('TEI document is missing a <body> element')

  const linesById = new Map<string, string>()
  const lineOrder: string[] = []
  let currentId: string | null = null
  let inApp = false
  let primaryEd: string | null = null
  let synth = 0

  function ensureLine(id: string): void {
    if (!id) return
    if (!linesById.has(id)) {
      linesById.set(id, '')
      lineOrder.push(id)
    }
  }

  function append(text: string): void {
    if (!currentId || !text) return
    ensureLine(currentId)
    linesById.set(currentId, (linesById.get(currentId) ?? '') + text)
  }

  function walkChildren(node: XNode): void {
    for (let i = 0; i < node.childNodes.length; i += 1) {
      const c = node.childNodes[i]
      if (c) walk(c)
    }
  }

  function walk(node: XNode): void {
    if (node.nodeType === TEXT_NODE) {
      append(node.nodeValue ?? '')
      return
    }
    if (node.nodeType !== ELEMENT_NODE) return

    switch (node.localName) {
      case 'lb': {
        const n = node.getAttribute('n')
        if (n) {
          // Multiple <lb> per line for different editions — keep the first,
          // skip the rest so we don't create empty interleaved buckets.
          const ed = node.getAttribute('ed')
          if (ed) {
            if (!primaryEd) primaryEd = ed
            if (ed !== primaryEd) return
          }
          currentId = n
          ensureLine(n)
        }
        return
      }
      case 'pb':
        ensureLine(`__pb_${synth++}`)
        return
      case 'note':
      case 'mulu':
      case 'milestone':
        return
      case 'g':
        append(node.textContent ?? '')
        return
      case 'caesura':
        append('　')
        return
      case 'app': {
        const prev = inApp
        inApp = true
        walkChildren(node)
        inApp = prev
        return
      }
      case 'rdg':
        if (inApp) return
        walkChildren(node)
        return
      case 'lg':
        ensureLine(`__lg_${synth++}`)
        walkChildren(node)
        ensureLine(`__lg_${synth++}`)
        return
      case 'anchor':
        return
      default:
        walkChildren(node)
    }
  }

  walk(body)
  for (const id of lineOrder)
    linesById.set(id, normalizeText(linesById.get(id)))

  const {titleZh, titleEn} = extractTitles(doc)
  return {titleZh, titleEn, linesById, lineOrder}
}

function extractTitles(doc: XDoc): {titleZh: string; titleEn: string} {
  const stmt = doc.getElementsByTagName('titleStmt')[0]
  if (!stmt) return {titleZh: '', titleEn: ''}
  const titles = (
    stmt as unknown as {
      getElementsByTagName(name: string): {length: number; [i: number]: XNode}
    }
  ).getElementsByTagName('title')
  let zh = ''
  let en = ''
  let fallback = ''
  for (let i = 0; i < titles.length; i += 1) {
    const t = titles[i]
    if (!t) continue
    const text = normalizeText(t.textContent ?? '')
    if (!text) continue
    if (!fallback) fallback = text
    const lang = (
      t.getAttribute('xml:lang') ||
      t.getAttribute('lang') ||
      ''
    ).toLowerCase()
    if (!zh && (lang === 'zh' || lang.startsWith('zh-') || lang === 'chi'))
      zh = text
    if (!en && (lang === 'en' || lang.startsWith('en-') || lang === 'eng'))
      en = text
  }
  return {titleZh: zh || fallback, titleEn: en}
}
