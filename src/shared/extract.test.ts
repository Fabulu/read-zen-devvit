// The forgiveness layer: pull ReadZen links out of the messy text real users
// paste ("URLs too because people are stupid").

import assert from 'node:assert/strict'
import test from 'node:test'
import {extractReadZenRoutes, parseReadZenLink} from './extract.ts'
import type {RzRoute} from './route.ts'

function one(text: string): RzRoute {
  const routes = extractReadZenRoutes(text)
  assert.equal(routes.length, 1, `expected exactly 1 route from: ${text}`)
  const r = routes[0]
  assert.ok(r)
  return r
}

test('plain hash URL', () => {
  const r = one('https://readzen.pages.dev/#/T48n2005/0292a26')
  assert.equal(r.kind, 'passage')
  assert.equal(r.workId, 'T48n2005')
  assert.equal(r.startLine, '0292a26')
  assert.equal(r.linkOnly, false)
})

test('pretty path (no hash)', () => {
  const r = one('https://readzen.pages.dev/T48n2005/0292a26')
  assert.equal(r.kind, 'passage')
  assert.equal(r.workId, 'T48n2005')
})

test('no scheme + www', () => {
  const r = one('www.readzen.pages.dev/#/master/Linji_Yixuan')
  assert.equal(r.kind, 'master')
  assert.equal(r.name, 'Linji Yixuan')
})

test('zen:// desktop URI', () => {
  const r = one('zen://T48n2005/0292a26-0292a29/en/Fabulu')
  assert.equal(r.kind, 'passage')
  assert.equal(r.translator, 'Fabulu')
  assert.equal(r.mode, 'en')
})

test('trailing punctuation is stripped', () => {
  const r = one('look here: https://readzen.pages.dev/#/T48n2005/0292a26.')
  assert.equal(r.workId, 'T48n2005')
  assert.equal(r.startLine, '0292a26')
})

test('markdown-wrapped link', () => {
  const r = one('[the case](https://readzen.pages.dev/#/T48n2005/0292a26)')
  assert.equal(r.kind, 'passage')
  assert.equal(r.workId, 'T48n2005')
})

test('angle-bracketed link', () => {
  const r = one('<https://readzen.pages.dev/#/search?q=無>')
  assert.equal(r.kind, 'search')
  assert.equal(r.q, '無')
})

test('lowercased CBETA file-id is canonicalized', () => {
  const r = one('readzen.pages.dev/t48n2005/0292a26')
  assert.equal(r.workId, 'T48n2005')
})

test('lowercased file-id with letter suffix', () => {
  const r = one('readzen.pages.dev/#/t47n1987a/0139a06')
  assert.equal(r.workId, 'T47n1987A')
})

test('Reddit backslash-escaped underscore', () => {
  const r = one('readzen.pages.dev/#/master/Linji\\_Yixuan')
  assert.equal(r.kind, 'master')
  assert.equal(r.name, 'Linji Yixuan')
})

test('share-junk query params are ignored', () => {
  const r = one(
    'readzen.pages.dev/#/T48n2005/0292a26?utm_source=reddit&si=abc123',
  )
  assert.equal(r.kind, 'passage')
  assert.equal(r.workId, 'T48n2005')
})

test('link embedded in prose', () => {
  const r = one(
    'I love this koan https://readzen.pages.dev/#/T48n2005/0292a26 what do you think?',
  )
  assert.equal(r.workId, 'T48n2005')
})

test('multiple distinct links → both, deduped by route', () => {
  const routes = extractReadZenRoutes(
    'compare readzen.pages.dev/#/master/Linji_Yixuan and readzen.pages.dev/#/master/Zhaozhou_Congshen',
  )
  assert.equal(routes.length, 2)
  const names = routes.map(r => r.name).sort()
  assert.deepEqual(names, ['Linji Yixuan', 'Zhaozhou Congshen'])
})

test('same link twice → deduped to one', () => {
  const routes = extractReadZenRoutes(
    'readzen.pages.dev/#/T48n2005/0292a26 ... again readzen.pages.dev/#/T48n2005/0292a26',
  )
  assert.equal(routes.length, 1)
})

test('lineage is link-only', () => {
  const r = one('readzen.pages.dev/#/lineage?focus=Linji_Yixuan')
  assert.equal(r.kind, 'lineage')
  assert.equal(r.linkOnly, true)
})

test('scholar-graph is link-only', () => {
  const r = one('readzen.pages.dev/#/scholar/Fabulu/coll/graph')
  assert.equal(r.kind, 'scholar-graph')
  assert.equal(r.linkOnly, true)
})

test('non-ReadZen URL is ignored', () => {
  assert.deepEqual(extractReadZenRoutes('https://example.com/foo/bar'), [])
})

test('plain prose with no link → nothing', () => {
  assert.deepEqual(
    extractReadZenRoutes('just some text about zen, no links here'),
    [],
  )
})

test('parseReadZenLink convenience returns a single route', () => {
  const r = parseReadZenLink('https://readzen.pages.dev/#/dict/無門')
  assert.equal(r?.kind, 'dictionary')
  assert.equal(r?.term, '無門')
})
