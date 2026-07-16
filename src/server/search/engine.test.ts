// Unit tests for the PURE search functions against small fixture arrays (no
// network, no Redis). searchAll's blank-guard is exercised too: an empty query
// returns before any fetch, so it is safe to call here.

import assert from 'node:assert/strict'
import test from 'node:test'
import type {MasterRec, TitleRec} from '../data/corpus-data.ts'
import {searchAll, searchMasters, searchTitles} from './engine.ts'

const master = (names: string[]): MasterRec => ({
  names,
  notes: '',
  school: '',
  teacher: '',
})

const title = (
  path: string,
  zh: string,
  en: string,
  enShort: string,
): TitleRec => ({path, zh, en, enShort, zhHash: 'h'})

const HUIYUAN = master(['Huiyuan of Lushan', '廬山慧遠', '慧遠'])

test('master alias matching: pinyin, Han substring, exact Han', () => {
  assert.equal(searchMasters('huiyuan', [HUIYUAN]).length, 1)
  assert.equal(searchMasters('廬山', [HUIYUAN]).length, 1)
  assert.equal(searchMasters('慧遠', [HUIYUAN]).length, 1)
})

test('master break-on-first: multiple alias matches → one hit', () => {
  // '慧遠' is a substring of both names[1] and names[2]; still one hit.
  const hits = searchMasters('慧遠', [HUIYUAN])
  assert.equal(hits.length, 1)
})

test('master hit shape: slug underscores BEFORE encode, no %20', () => {
  const hit = searchMasters('huiyuan', [HUIYUAN])[0]
  assert.ok(hit)
  assert.equal(hit.kind, 'master')
  assert.equal(hit.workId, 'Huiyuan_of_Lushan')
  assert.equal(hit.title, 'Huiyuan of Lushan')
  assert.equal(hit.titleZh, '廬山慧遠')
  assert.equal(hit.route, 'master/Huiyuan_of_Lushan')
  assert.ok(!hit.route.includes('%20'))
  assert.ok(!hit.route.includes('#/'))
})

test('master titleZh undefined when only one name', () => {
  const hit = searchMasters('solo', [master(['Solo'])])[0]
  assert.ok(hit)
  assert.equal(hit.titleZh, undefined)
})

test('master cap: 8 matching masters → 5', () => {
  const masters = Array.from({length: 8}, (_, i) => master([`Zen Master ${i}`]))
  assert.equal(searchMasters('zen master', masters).length, 5)
})

test('title workId derivation: CBETA path → T-id', () => {
  const t = title(
    'T/T48/T48n2005.xml',
    'Wu Men Guan',
    'The Gateless Barrier',
    'Gateless Barrier',
  )
  const hit = searchTitles('gateless', [t])[0]
  assert.ok(hit)
  assert.equal(hit.kind, 'title')
  assert.equal(hit.workId, 'T48n2005')
  assert.equal(hit.route, 'T48n2005')
  assert.equal(hit.title, 'The Gateless Barrier')
  assert.equal(hit.titleZh, 'Wu Men Guan')
})

test('title workId derivation: OpenZen path → dotted pub.slug', () => {
  const t = title(
    'ws/gateless-barrier/gateless-barrier.xml',
    '無門關',
    'Gateless',
    'Gateless',
  )
  const hit = searchTitles('無門', [t])[0]
  assert.ok(hit)
  assert.equal(hit.workId, 'ws.gateless-barrier')
  assert.equal(hit.route, 'ws.gateless-barrier')
})

test('title blob matches across zh, en, enShort, and path', () => {
  const t = title('T/T48/T48n2005.xml', '趙州', 'Zhaozhou', 'Zhao')
  assert.equal(searchTitles('趙州', [t]).length, 1) // zh
  assert.equal(searchTitles('zhaozhou', [t]).length, 1) // en
  assert.equal(searchTitles('zhao', [t]).length, 1) // enShort
  assert.equal(searchTitles('t48n2005', [t]).length, 1) // path
  assert.equal(searchTitles('nomatch-xyz', [t]).length, 0)
})

test('title fallback title = en || enShort || zh', () => {
  const t = title('T/T48/T48n2005.xml', 'ZhOnly', '', 'ShortOnly')
  const hit = searchTitles('shortonly', [t])[0]
  assert.ok(hit)
  assert.equal(hit.title, 'ShortOnly') // en empty → enShort
})

test('title cap: 60 matching titles → 50', () => {
  const titles = Array.from({length: 60}, (_, i) =>
    title(`T/T48/T48n${1000 + i}.xml`, 'z', 'match', 's'),
  )
  assert.equal(searchTitles('match', titles).length, 50)
})

test('title routes never carry a #/ prefix', () => {
  const hits = searchTitles('match', [title('ws/x/x.xml', 'z', 'match', 's')])
  for (const h of hits) assert.ok(!h.route.startsWith('#/'))
})

test('searchAll blank / whitespace query → [] (no fetch)', async () => {
  assert.deepEqual(await searchAll(''), [])
  assert.deepEqual(await searchAll('   '), [])
})
