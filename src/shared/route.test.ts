// The ported parseRoute must agree with ReadZen's route table (lib/route.js)
// and, transitively, the desktop ZenUriParser.cs.

import assert from 'node:assert/strict'
import test from 'node:test'
import {parseRoute} from './route.ts'

test('empty / null → null', () => {
  assert.equal(parseRoute(''), null)
  assert.equal(parseRoute(null), null)
})

test('passage: bare CBETA file-id', () => {
  const r = parseRoute('T48n2005')
  assert.equal(r?.kind, 'passage')
  assert.equal(r?.workId, 'T48n2005')
  assert.equal(r?.corpus, 'cbeta')
  assert.equal(r?.hasExplicitRange, false)
})

test('passage: range + side + translator', () => {
  const r = parseRoute('T48n2005/0292a26-0292a29/en/Fabulu')
  assert.equal(r?.kind, 'passage')
  assert.equal(r?.startLine, '0292a26')
  assert.equal(r?.endLine, '0292a29')
  assert.equal(r?.mode, 'en')
  assert.equal(r?.translator, 'Fabulu')
  assert.equal(r?.hasExplicitRange, true)
})

test('passage: OpenZen work + per-case line id', () => {
  const r = parseRoute('ws.gateless-barrier/wm32.case01.l01')
  assert.equal(r?.kind, 'passage')
  assert.equal(r?.corpus, 'openzen')
  assert.equal(r?.workId, 'ws.gateless-barrier')
  assert.equal(r?.startLine, 'wm32.case01.l01')
})

test('passage: scroll query param', () => {
  const r = parseRoute('T48n2005?scroll=0292a23')
  assert.equal(r?.kind, 'passage')
  assert.equal(r?.scroll, '0292a23')
})

test('legacy #/passage/ prefix is stripped', () => {
  const r = parseRoute('passage/T48n2005')
  assert.equal(r?.kind, 'passage')
  assert.equal(r?.workId, 'T48n2005')
})

test('master: underscores → spaces', () => {
  const r = parseRoute('master/Linji_Yixuan')
  assert.equal(r?.kind, 'master')
  assert.equal(r?.name, 'Linji Yixuan')
})

test('search: query param', () => {
  const r = parseRoute('search?q=無')
  assert.equal(r?.kind, 'search')
  assert.equal(r?.q, '無')
})

test('lineage: focus underscores → spaces', () => {
  const r = parseRoute('lineage?focus=Linji_Yixuan')
  assert.equal(r?.kind, 'lineage')
  assert.equal(r?.focus, 'Linji Yixuan')
})

test('dict: browse vs single lookup', () => {
  assert.equal(parseRoute('dict')?.kind, 'dict-browse')
  const r = parseRoute('dict/無門')
  assert.equal(r?.kind, 'dictionary')
  assert.equal(r?.term, '無門')
})

test('term: entry + user', () => {
  const r = parseRoute('term/emptiness/Fabulu')
  assert.equal(r?.kind, 'termbase')
  assert.equal(r?.entry, 'emptiness')
  assert.equal(r?.user, 'Fabulu')
})

test('masters: school + q', () => {
  const r = parseRoute('masters?school=Linji&q=zhao')
  assert.equal(r?.kind, 'masters')
  assert.equal(r?.school, 'Linji')
  assert.equal(r?.q, 'zhao')
})

test('compare: full form', () => {
  const r = parseRoute(
    'compare/T48n2005/orig/me/community?from=0292a26&to=0292a29',
  )
  assert.equal(r?.kind, 'compare')
  assert.equal(r?.fileId, 'T48n2005')
  assert.equal(r?.sourceA, 'me')
  assert.equal(r?.sourceB, 'community')
  assert.equal(r?.from, '0292a26')
})

test('tags: fileId + user + tag', () => {
  const r = parseRoute('tags/T48n2005/Fabulu/tag1')
  assert.equal(r?.kind, 'tags')
  assert.equal(r?.fileId, 'T48n2005')
  assert.equal(r?.user, 'Fabulu')
  assert.equal(r?.tagId, 'tag1')
})

test('scholar: new canonical form', () => {
  const r = parseRoute('scholar/Fabulu/mycollection')
  assert.equal(r?.kind, 'scholar')
  assert.equal(r?.user, 'Fabulu')
  assert.equal(r?.collectionId, 'mycollection')
})

test('scholar-graph: /graph marker', () => {
  const r = parseRoute('scholar/Fabulu/mycollection/graph')
  assert.equal(r?.kind, 'scholar-graph')
})

test('unknown: unrecognized route', () => {
  const r = parseRoute('totally-not-a-route')
  assert.equal(r?.kind, 'unknown')
})
