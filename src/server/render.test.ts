// Unit tests for the network-free render helpers: postData v2 (with the ≤240
// commentary teaser + ≤2KB budget) and the textFallback ordering (case blocks →
// --- → commentary → cite → link).

import assert from 'node:assert/strict'
import test from 'node:test'
import type {RenderedContent} from '../shared/api.ts'
import {truncateFallback} from './ingest.ts'
import {buildPostData, buildTextFallback} from './render.ts'

function content(overrides: Partial<RenderedContent> = {}): RenderedContent {
  return {
    kind: 'case',
    workId: 'pd.wumenguan-1632',
    title: 'The Gateless Gate',
    titleZh: '無門關',
    caseLabel: 'Case 1',
    lines: [
      {
        id: 'l01',
        zh: '趙州和尚因僧問狗子還有佛性也無',
        en: 'A monk asked Zhaozhou.',
      },
      {id: 'l02', zh: '州云無', en: 'Zhaozhou said: Wu.'},
    ],
    attribution: {
      work: 'The Gateless Gate',
      workZh: '無門關',
      cbetaId: 'T48n2005',
      translator: 'Fabulu',
      license: 'CC BY',
    },
    rzLink: 'https://readzen.pages.dev/#/pd.wumenguan-1632/wm32.case01.l01',
    ...overrides,
  }
}

test('buildPostData: v2 with a ≤240-char commentary teaser', () => {
  const pd = buildPostData(content(), 'x'.repeat(400))
  assert.equal(pd.v, 2)
  assert.ok(pd.cm, 'cm teaser present when commentary given')
  assert.ok((pd.cm?.length ?? 0) <= 240, `cm ${pd.cm?.length} ≤ 240`)
})

test('buildPostData: no commentary → cm omitted', () => {
  const pd = buildPostData(content())
  assert.equal(pd.v, 2)
  assert.equal(pd.cm, undefined)
})

test('buildPostData: stays under the 2KB cap on the worst case', () => {
  const big = content({
    lines: [{id: 'l', zh: '無'.repeat(200), en: 'nothing '.repeat(200)}],
  })
  const bytes = Buffer.byteLength(
    JSON.stringify(buildPostData(big, '字'.repeat(400))),
  )
  assert.ok(bytes <= 2048, `postData ${bytes} bytes ≤ 2048`)
})

test('buildTextFallback: commentary sits near the top (before the case + rule), so a long passage never clamps it out', () => {
  const out = buildTextFallback(content(), 'This koan points at the Wu.')
  const commentAt = out.indexOf('This koan points at the Wu.')
  const ruleAt = out.indexOf('\n---\n')
  const caseAt = out.indexOf('趙州和尚')
  const citeAt = out.indexOf('tr. Fabulu')
  const linkAt = out.indexOf('Read the full case')
  assert.ok(commentAt > 0, 'has commentary')
  assert.ok(ruleAt > 0, 'has a --- rule')
  assert.ok(commentAt < ruleAt, 'commentary precedes the rule')
  assert.ok(ruleAt < caseAt, 'rule precedes the quoted case')
  assert.ok(caseAt < citeAt, 'case precedes cite')
  assert.ok(citeAt < linkAt, 'cite precedes read-more link')
})

test('buildTextFallback: no commentary → no rule injected', () => {
  const out = buildTextFallback(content())
  assert.equal(out.includes('\n---\n'), false)
})

test('buildTextFallback: a >38k-char case keeps the full commentary + read-more after truncateFallback', () => {
  const commentary = 'This koan points at the Wu. '.repeat(60).trim()
  const huge = content({
    lines: Array.from({length: 4000}, (_, i) => ({
      id: `l${i}`,
      zh: '趙州和尚因僧問狗子還有佛性也無',
      en: 'A monk asked Zhaozhou whether a dog has buddha-nature.',
    })),
  })
  const full = buildTextFallback(huge, commentary)
  assert.ok(full.length > 38000, 'the raw fallback exceeds the 38k budget')
  const clamped = truncateFallback(full, huge.rzLink, 38000)
  assert.ok(clamped.length <= 38000, 'clamped within budget')
  assert.ok(clamped.includes(commentary), 'full commentary survives the clamp')
  assert.ok(clamped.includes('Read the full case'), 'read-more link present')
})
