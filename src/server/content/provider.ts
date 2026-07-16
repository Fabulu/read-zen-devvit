import type {RenderedContent} from '../../shared/api.ts'
import type {RzRoute} from '../../shared/route.ts'

/**
 * A content source. Providers are tried in order (github → sample); the first to
 * return content wins. This is the seam that makes the whole reader buildable
 * before the live GitHub fetch is approved — flip the order/list, nothing else.
 */
export type ContentProvider = {
  name: 'github' | 'master' | 'sample'
  resolve(route: RzRoute): Promise<RenderedContent | undefined>
}
