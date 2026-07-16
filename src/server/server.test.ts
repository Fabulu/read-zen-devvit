import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import type {AddressInfo, Server} from 'node:net'
import {after, before, test} from 'node:test'
import {type Context, runWithContext} from '@devvit/web/server'
import {Endpoint, type ErrorRsp} from '../shared/api.ts'
import {parseReadZenLink} from '../shared/extract.ts'
import {parseRoute} from '../shared/route.ts'
import {onReq, parseResolveRoute} from './server.ts'

let server: Server
let serverURL: string

before(async () => {
  server = createServer(async (req, rsp) => {
    await runWithContext(
      {
        appName: 'read-zen',
        postId: 't3_123',
        userId: 't2_123',
        username: 'username',
      } as unknown as Context,
      () => onReq(req, rsp),
    )
  })
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const info = server.address() as AddressInfo
  serverURL = `http://127.0.0.1:${info.port}`
})

after(async () => {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()))
  })
})

test('search route matches despite a query string', async () => {
  // Guards the router fix: `api/search?q=dog` must dispatch to Endpoint.Search
  // (a real handler now) rather than fall through to a 404 on the query string.
  const rsp = await fetch(`${serverURL}/${Endpoint.Search}?q=dog`)
  assert.notEqual(rsp.status, 404)
})

test('wrong method', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.Resolve}`)
  assert.equal(rsp.status, 404)
  assert.deepEqual<ErrorRsp>(await rsp.json(), {
    error: 'not found',
    status: 404,
  })
})

test('404', async () => {
  const rsp = await fetch(serverURL)
  assert.equal(rsp.status, 404)
  assert.deepEqual<ErrorRsp>(await rsp.json(), {
    error: 'not found',
    status: 404,
  })
})

// FIX 1: the server used to parse BARE client routes (search hits, classic
// cases, range-picker output) with the URL-only `parseReadZenLink` extractor,
// which returns null for anything lacking a `zen://`/host prefix — so every
// composer + expand route 400'd. `parseResolveRoute` now tries the bare-capable
// `parseRoute` first and falls back to the extractor for the reader's full URL.
test('parseResolveRoute resolves bare client routes (FIX 1)', () => {
  // Repro inputs from the reviewer, each of which parseReadZenLink returned null
  // for (the bug) but parseRoute reads.
  const passage = parseResolveRoute('T48n2005/0292a26-0292a29')
  assert.equal(passage?.kind, 'passage')
  assert.equal(parseReadZenLink('T48n2005/0292a26-0292a29'), null)

  assert.equal(parseResolveRoute('master/Huiyuan_of_Lushan')?.kind, 'master')

  const kase = parseResolveRoute(
    'pd.wumenguan-1632/wm32.case01.l01-wm32.case01.l02/Fabulu',
  )
  assert.equal(kase?.kind, 'passage')
})

test('parseResolveRoute still accepts the reader full-URL route (fallback)', () => {
  const route = parseResolveRoute(
    'https://readzen.pages.dev/#/T48n2005/0292a26-0292a29',
  )
  assert.equal(route?.kind, 'passage')
  assert.equal(route?.workId, 'T48n2005')
})

test('parseResolveRoute returns null for unparseable input', () => {
  assert.equal(parseResolveRoute(''), null)
  assert.equal(parseResolveRoute('not a route at all'), null)
})

// bare route parsed → passage; direct parseRoute is what the composer/expand
// handlers now use (kind 'unknown' → their existing error responses).
test('parseRoute reads the composer/expand bare routes directly', () => {
  assert.equal(parseRoute('master/Huiyuan_of_Lushan')?.kind, 'master')
  assert.equal(
    parseRoute('pd.wumenguan-1632/wm32.case01.l01-wm32.case01.l02/Fabulu')
      ?.kind,
    'passage',
  )
})

// ---- compose gate: server enforces title(≥3) + commentary(≥200 words) ----

async function compose(body: {
  route: string
  title: string
  commentary: string
}): Promise<{status: number; json: {error?: string}}> {
  const rsp = await fetch(`${serverURL}/${Endpoint.ComposeSubmit}`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
  })
  return {status: rsp.status, json: (await rsp.json()) as {error?: string}}
}

const OK_ROUTE = 'T48n2005/0292a26-0292a29'
const WORDS_200 = 'word '.repeat(200) // countWords → 200
const WORDS_199 = 'word '.repeat(199) // countWords → 199

test('compose: empty title → 400 title-required (before any resolve)', async () => {
  const {status, json} = await compose({
    route: OK_ROUTE,
    title: '  ',
    commentary: WORDS_200,
  })
  assert.equal(status, 400)
  assert.equal(json.error, 'A title of your own is required.')
})

test('compose: 199-word commentary → 400 with the live count', async () => {
  const {status, json} = await compose({
    route: OK_ROUTE,
    title: 'My own title',
    commentary: WORDS_199,
  })
  assert.equal(status, 400)
  assert.match(json.error ?? '', /at least 200 words \(currently 199\)/)
})

test('compose: title + ≥200 words passes the gate (fails later on resolve, not on validation)', async () => {
  // With no live corpus in the harness, resolveContent returns null → the
  // passage-load 400. Crucially the error is NOT either gate message, proving
  // both the title and word-count checks passed.
  const {json} = await compose({
    route: OK_ROUTE,
    title: 'My own title',
    commentary: WORDS_200,
  })
  assert.equal(json.error, 'That passage could not be loaded.')
})

test('resolve endpoint no longer 400s on a bare route (FIX 1, end-to-end)', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.Resolve}`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({route: 'T48n2005/0292a26-0292a29'}),
  })
  // Before FIX 1 this bare route returned 400 'unresolvable route'. Now it parses;
  // without live redis/network the harness degrades to 404 'content not found',
  // but crucially it is NOT the 400 parse rejection.
  assert.notEqual(rsp.status, 400)
})
