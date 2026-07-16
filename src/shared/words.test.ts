// countWords must agree between the client word-counter, the server compose
// gate, and the ingestion form handler — a single shared definition (words.ts).

import assert from 'node:assert/strict'
import test from 'node:test'
import {countWords} from './words.ts'

test('empty string -> 0', () => {
  assert.equal(countWords(''), 0)
})

test('two latin words -> 2', () => {
  assert.equal(countWords('two words'), 2)
})

test('leading/trailing/collapsing whitespace -> 2', () => {
  assert.equal(countWords('  spaced   out  '), 2)
})

test('whitespace only -> 0', () => {
  assert.equal(countWords('   \t\n  '), 0)
})

test('200 hanzi -> 200 (one word per CJK codepoint)', () => {
  assert.equal(countWords('\u4e00'.repeat(200)), 200)
})

test('mixed latin + CJK -> 2 latin + 2 cjk = 4', () => {
  assert.equal(countWords('Zhaozhou \u8d99\u5dde said'), 4)
})

test('realistic ~205-word English paragraph is >= 200', () => {
  const para = Array.from({length: 205}, (_, i) => `word${i}`).join(' ')
  assert.equal(countWords(para), 205)
  assert.ok(countWords(para) >= 200)
})
