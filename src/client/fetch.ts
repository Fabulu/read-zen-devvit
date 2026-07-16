import {
  type ComposeSubmitReq,
  type ComposeSubmitRsp,
  Endpoint,
  type ResolveReq,
  type ResolveRsp,
  type SearchRsp,
} from '../shared/api.ts'

/** Resolve a ReadZen route (or link) to its full renderable content. */
export async function fetchResolve(
  route: string,
): Promise<ResolveRsp | undefined> {
  const req: ResolveReq = {route}
  let rsp: Response
  try {
    rsp = await fetch(Endpoint.Resolve, {
      headers: {Accept: 'application/json', 'Content-Type': 'application/json'},
      method: 'POST',
      body: JSON.stringify(req),
    })
  } catch (err) {
    console.error(`HTTP error: ${err instanceof Error ? err.message : err}`)
    return
  }
  if (!rsp.ok) {
    console.error(`HTTP status ${rsp.status}: ${rsp.statusText}`)
    return
  }
  return (await rsp.json()) as ResolveRsp
}

const EMPTY_SEARCH: SearchRsp = {
  hits: [],
  source: 'live',
  fulltextAvailable: false,
}

/**
 * Search the corpus (GET api/search?q=). Any failure — network, non-200, or the
 * P1 501 stub before the server route lands — degrades to an empty result set so
 * the composer shows a quiet "nothing yet" state instead of throwing.
 */
export async function fetchSearch(q: string): Promise<SearchRsp> {
  let rsp: Response
  try {
    rsp = await fetch(`${Endpoint.Search}?q=${encodeURIComponent(q)}`, {
      headers: {Accept: 'application/json'},
    })
  } catch (err) {
    console.error(`HTTP error: ${err instanceof Error ? err.message : err}`)
    return EMPTY_SEARCH
  }
  if (!rsp.ok) return EMPTY_SEARCH
  try {
    return (await rsp.json()) as SearchRsp
  } catch {
    return EMPTY_SEARCH
  }
}

/**
 * Ask the server to submit a passage as a post (POST api/compose/submit). The
 * server re-resolves and re-titles; the client never trusts its own render. Any
 * failure returns `{error}` so the UI can toast it rather than crash — including
 * the 501 stub before PKT-1b wires the route.
 */
export async function fetchComposeSubmit(
  req: ComposeSubmitReq,
): Promise<ComposeSubmitRsp | {error: string; detail?: string}> {
  let rsp: Response
  try {
    rsp = await fetch(Endpoint.ComposeSubmit, {
      headers: {Accept: 'application/json', 'Content-Type': 'application/json'},
      method: 'POST',
      body: JSON.stringify(req),
    })
  } catch (err) {
    return {error: err instanceof Error ? err.message : 'Network error'}
  }
  if (!rsp.ok) {
    let message = `Couldn’t post right now (${rsp.status}).`
    let detail: string | undefined
    try {
      const body = (await rsp.json()) as {error?: string; detail?: string}
      if (body?.error) message = body.error
      if (body?.detail) detail = body.detail
    } catch {
      // non-JSON body — keep the status message
    }
    return {error: message, detail}
  }
  return (await rsp.json()) as ComposeSubmitRsp
}
