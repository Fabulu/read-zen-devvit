import type {RzRoute} from '../../shared/route.ts'
import type {ContentProvider} from './provider.ts'
import {SAMPLE_CASE_01} from './sample-data.ts'

/**
 * Bundled-sample provider: serves the Wumenguan Case 1 koan for its own route.
 * The permanent outage fallback for the flagship case, and (pre-live-provider)
 * the demo's content source.
 */
export const sampleProvider: ContentProvider = {
  name: 'sample',
  async resolve(route: RzRoute): Promise<typeof SAMPLE_CASE_01 | undefined> {
    if (route.workId === SAMPLE_CASE_01.workId) return SAMPLE_CASE_01
    return undefined
  },
}
