import type {ResolveRsp} from '../../shared/api.ts'
import type {RzRoute} from '../../shared/route.ts'
import {githubProvider} from './github.ts'
import {masterProvider} from './master.ts'
import type {ContentProvider} from './provider.ts'
import {sampleProvider} from './sample.ts'

// Tried in order; first with content wins. github first so passages resolve live;
// master second (cached corpus card); sample last as the outage fallback.
const PROVIDERS: ContentProvider[] = [
  githubProvider,
  masterProvider,
  sampleProvider,
]

/** Resolve a parsed route to renderable content, or undefined if none matches. */
export async function resolveContent(
  route: RzRoute,
): Promise<ResolveRsp | undefined> {
  for (const p of PROVIDERS) {
    const content = await p.resolve(route)
    if (content)
      return {content, source: p.name === 'github' ? 'live' : 'sample'}
  }
  return undefined
}
