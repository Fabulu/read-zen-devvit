// Unit tests for the network-free pieces of link ingestion: text→route
// partitioning, form labels, and fallback truncation. The reddit/resolveContent
// paths (readTargetBody, expandAsReply, expandAsPost) are verified in playtest.

import assert from 'node:assert/strict'
import test from 'node:test'
import type {ParagraphField, StringField} from '@devvit/web/shared'
import {parseRoute, type RzRoute} from '../shared/route.ts'
import {
  buildExpandForm,
  buildExpandPostForm,
  describeRoute,
  routesFromText,
  truncateFallback,
} from './ingest.ts'

function route(raw: string): RzRoute {
  const r = parseRoute(raw)
  assert.ok(r, `expected a route from: ${raw}`)
  return r
}

// ---- routesFromText: partition renderable vs link-only over mangled bodies ----

test('routesFromText: markdown-wrapped passage is renderable', () => {
  const {renderable, linkOnly} = routesFromText(
    '[the case](https://readzen.pages.dev/#/T48n2005/0292a26)',
  )
  assert.equal(renderable.length, 1)
  assert.equal(linkOnly.length, 0)
  assert.equal(renderable[0]?.kind, 'passage')
  assert.equal(renderable[0]?.workId, 'T48n2005')
})

test('routesFromText: backslash-escaped master is renderable', () => {
  const {renderable, linkOnly} = routesFromText(
    'readzen.pages.dev/#/master/Linji\\_Yixuan',
  )
  assert.equal(renderable.length, 1)
  assert.equal(linkOnly.length, 0)
  assert.equal(renderable[0]?.kind, 'master')
  assert.equal(renderable[0]?.name, 'Linji Yixuan')
})

test('routesFromText: trailing punctuation + missing scheme still parse', () => {
  const {renderable} = routesFromText(
    'look here: readzen.pages.dev/#/T48n2005/0292a26.',
  )
  assert.equal(renderable.length, 1)
  assert.equal(renderable[0]?.startLine, '0292a26')
})

test('routesFromText: lineage + scholar-graph land in linkOnly', () => {
  const {renderable, linkOnly} = routesFromText(
    'graph readzen.pages.dev/#/lineage?focus=Linji_Yixuan and readzen.pages.dev/#/scholar/Fabulu/coll/graph',
  )
  assert.equal(renderable.length, 0)
  assert.equal(linkOnly.length, 2)
  const kinds = linkOnly.map(r => r.kind).sort()
  assert.deepEqual(kinds, ['lineage', 'scholar-graph'])
})

test('routesFromText: mixed body partitions both buckets, renderable-first shape', () => {
  const {renderable, linkOnly} = routesFromText(
    'passage readzen.pages.dev/#/T48n2005/0292a26 and lineage readzen.pages.dev/#/lineage?focus=Zhaozhou_Congshen',
  )
  assert.equal(renderable.length, 1)
  assert.equal(renderable[0]?.kind, 'passage')
  assert.equal(linkOnly.length, 1)
  assert.equal(linkOnly[0]?.kind, 'lineage')
})

test('routesFromText: no links → both buckets empty', () => {
  const {renderable, linkOnly} = routesFromText('just some prose, no links')
  assert.equal(renderable.length, 0)
  assert.equal(linkOnly.length, 0)
})

// ---- describeRoute: a label per renderable kind ----

test('describeRoute: passage with range', () => {
  const label = describeRoute(route('T48n2005/0292a26-0292a29'))
  assert.match(label, /^Passage — T48n2005/)
  assert.match(label, /lines 0292a26-0292a29/)
})

test('describeRoute: passage without range (no line clause)', () => {
  const label = describeRoute(route('T48n2005'))
  assert.equal(label, 'Passage — T48n2005')
})

test('describeRoute: master', () => {
  assert.equal(
    describeRoute(route('master/Huiyuan_of_Lushan')),
    'Master — Huiyuan of Lushan',
  )
})

test('describeRoute: search', () => {
  assert.equal(describeRoute(route('search?q=dog')), 'Search — dog')
})

test('describeRoute: dictionary + termbase', () => {
  assert.equal(describeRoute(route('dict/無門')), 'Dictionary — 無門')
  assert.equal(
    describeRoute(route('term/emptiness/Fabulu')),
    'Termbase — emptiness',
  )
})

test('describeRoute: link-only kind still yields a readable label', () => {
  assert.equal(
    describeRoute(route('lineage?focus=Linji_Yixuan')),
    'Lineage — Linji Yixuan',
  )
})

// ---- truncateFallback: valid-markdown truncation to the char budget ----

const RZ_LINK = 'https://readzen.pages.dev/#/T48n2005/0292a26-0392a26'

/** A realistic multi-pair bilingual fallback well over 9500 chars. */
function bigFallback(): string {
  const lines: string[] = ['**無門關 The Gateless Gate** — Case 1', '']
  for (let i = 0; i < 200; i += 1) {
    lines.push(`> 趙州和尚因僧問狗子還有佛性也無州云無 (pair ${i})`)
    lines.push(
      `> A monk asked Zhaozhou whether a dog has Buddha-nature. (pair ${i})`,
    )
    lines.push('')
  }
  lines.push('*The Gateless Gate · T48n2005 · tr. Fabulu*')
  lines.push('')
  lines.push(`[Read the full case in ReadZen ›](${RZ_LINK})`)
  return lines.join('\n')
}

test('truncateFallback: short input returned unchanged', () => {
  const short = '**Title** — Case 1\n\n> 無\n> Nothing'
  assert.equal(truncateFallback(short, RZ_LINK), short)
})

test('truncateFallback: over-budget input clamps to ≤9500 and ends with read-more', () => {
  const full = bigFallback()
  assert.ok(full.length > 9500, 'fixture should exceed the budget')
  const out = truncateFallback(full, RZ_LINK)
  assert.ok(out.length <= 9500, `expected ≤9500, got ${out.length}`)
  assert.ok(
    out.endsWith(`[Read the full case ›](${RZ_LINK})`),
    'must end with the read-more link',
  )
})

test('truncateFallback: result is valid markdown (no dangling blockquote/link)', () => {
  const out = truncateFallback(bigFallback(), RZ_LINK)
  // Ends with a complete [text](url) token.
  assert.match(out, /\[[^\]]*\]\([^)]*\)$/)
  // No half-open link opener after the final complete link.
  const lastClose = out.lastIndexOf(')')
  assert.equal(
    out.indexOf('[', lastClose),
    -1,
    'no dangling "[" after the final link',
  )
  // The last kept line is not a bare, content-less blockquote marker.
  const linesOut = out.split('\n')
  const lastContent = linesOut.filter(l => l.trim() !== '').pop() ?? ''
  assert.notEqual(lastContent.trim(), '>')
})

test('truncateFallback: keeps the header block', () => {
  const out = truncateFallback(bigFallback(), RZ_LINK)
  assert.ok(
    out.startsWith('**無門關 The Gateless Gate** — Case 1'),
    'header must survive truncation',
  )
})

test('truncateFallback: only whole bilingual pairs survive (no half pair)', () => {
  const out = truncateFallback(bigFallback(), RZ_LINK)
  // Every ZH blockquote line that survived must be immediately followed by its EN line.
  const linesOut = out.split('\n')
  for (let i = 0; i < linesOut.length; i += 1) {
    if (linesOut[i]?.includes('趙州')) {
      assert.ok(
        linesOut[i + 1]?.startsWith('> A monk asked'),
        `ZH line ${i} kept without its EN pair`,
      )
    }
  }
})

// ---- buildExpandForm: post option signals the 200-word bar ----

test('buildExpandForm: the post option advertises the title + 200-word gate', () => {
  const form = buildExpandForm([route('T48n2005/0292a26')], 't3_abc')
  const output = form.fields.find(f => 'name' in f && f.name === 'output') as {
    options: {label: string; value: string}[]
  }
  const post = output.options.find(o => o.value === 'post')
  assert.equal(post?.label, 'Create a post (title + 200-word commentary)')
})

// ---- buildExpandPostForm: field shapes, defaults, and reject-reshow helpText ----

function fieldsOf(form: ReturnType<typeof buildExpandPostForm>): {
  title: StringField
  commentary: ParagraphField
} {
  const title = form.fields.find(
    f => 'name' in f && f.name === 'title',
  ) as StringField
  const commentary = form.fields.find(
    f => 'name' in f && f.name === 'commentary',
  ) as ParagraphField
  return {title, commentary}
}

test('buildExpandPostForm: fresh form — suggestion in helpText, empty defaults, Post label', () => {
  const form = buildExpandPostForm(
    'T48n2005/0292a26',
    'The Gateless Gate · Case 1',
  )
  const {title, commentary} = fieldsOf(form)
  assert.equal(title.type, 'string')
  assert.equal(title.label, 'Your title')
  assert.match(title.helpText ?? '', /Suggestion: The Gateless Gate · Case 1/)
  assert.match(title.helpText ?? '', /use your own words/)
  // NEVER default the title to the suggestion — it must be user-typed.
  assert.equal(title.defaultValue, '')
  assert.notEqual(title.defaultValue, 'The Gateless Gate · Case 1')
  assert.equal(commentary.type, 'paragraph')
  assert.equal(commentary.label, 'Your commentary (at least 200 words)')
  assert.equal(
    commentary.helpText,
    'Substantive posts only: at least 200 words of your own commentary.',
  )
  assert.equal(commentary.defaultValue, '')
  assert.equal(form.acceptLabel, 'Post')
})

test('buildExpandPostForm: reject-reshow — prior text re-seeded, word-count error becomes commentary helpText', () => {
  const form = buildExpandPostForm(
    'T48n2005/0292a26',
    'The Gateless Gate · Case 1',
    {title: 'My draft title', commentary: 'too short so far'},
    {commentary: '3 words so far — 197 more needed.'},
  )
  const {title, commentary} = fieldsOf(form)
  assert.equal(title.defaultValue, 'My draft title')
  assert.equal(commentary.defaultValue, 'too short so far')
  assert.equal(commentary.helpText, '3 words so far — 197 more needed.')
  // A word-count error must not leak into the title field's helpText.
  assert.match(title.helpText ?? '', /Suggestion: The Gateless Gate · Case 1/)
})

test('buildExpandPostForm: reject-reshow — title error targets the TITLE field, commentary keeps its default helpText', () => {
  const form = buildExpandPostForm(
    'T48n2005/0292a26',
    'The Gateless Gate · Case 1',
    {title: 'ok', commentary: 'a'.repeat(0)},
    {title: 'A title of your own is required.'},
  )
  const {title, commentary} = fieldsOf(form)
  assert.equal(title.helpText, 'A title of your own is required.')
  assert.equal(
    commentary.helpText,
    'Substantive posts only: at least 200 words of your own commentary.',
  )
})
