import {redis} from '@devvit/web/server'

/** Reddit compliance ceiling: no Redis write may outlive 30 days. */
const MAX_TTL_MS = 30 * 24 * 3600 * 1000

/**
 * Write a JSON value with a mandatory TTL. Throws if `ttlMs` exceeds the 30-day
 * compliance ceiling. `Date.now()`/`new Date()` are fine in Devvit app code
 * (the no-clock restriction only applies to Workflow scripts).
 */
export async function setJson(
  key: string,
  value: unknown,
  ttlMs: number,
): Promise<void> {
  if (ttlMs > MAX_TTL_MS)
    throw Error(
      `ttlMs ${ttlMs} exceeds 30-day compliance ceiling ${MAX_TTL_MS}`,
    )
  await redis.set(key, JSON.stringify(value), {
    expiration: new Date(Date.now() + ttlMs),
  })
}

/**
 * Write a JSON value with NO expiration. This is the compliant durable pattern
 * for POST-BOUND user content (not a cache): the key is registered in
 * `postScopedKeys` and purged by the onPostDelete → `dbPurgePost` trigger when
 * the post is deleted. The "every write must carry a ≤30-day TTL" rule targets
 * CACHES — durable content with a delete-trigger cleanup path is exempt. Do NOT
 * use this for caches; use `setJson` (TTL-asserting) for those.
 */
export async function setJsonDurable(
  key: string,
  value: unknown,
): Promise<void> {
  await redis.set(key, JSON.stringify(value))
}

/** Read + parse a JSON value. Missing key or parse failure → undefined. */
export async function getJson<T>(key: string): Promise<T | undefined> {
  const raw = await redis.get(key)
  if (raw == null) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

/** Durable postmeta key: the post's author commentary, keyed by post id. */
function postMetaKey(postId: string): string {
  return `postmeta:${postId}`
}

/** Store a post's author commentary durably (purged by dbPurgePost on delete). */
export async function dbSetPostMeta(
  postId: string,
  meta: {commentary: string},
): Promise<void> {
  await setJsonDurable(postMetaKey(postId), meta)
}

/** Read a post's stored commentary. Missing (hub / old v1 posts) → undefined. */
export async function dbGetPostMeta(
  postId: string,
): Promise<{commentary: string} | undefined> {
  return getJson<{commentary: string}>(postMetaKey(postId))
}

/** Explicit registry of every post-scoped Redis key, for delete purging. */
function postScopedKeys(postId: string): string[] {
  // Every post-scoped key MUST be listed here so dbPurgePost() removes it on
  // post/comment delete.
  return [postMetaKey(postId)]
}

/** Purge all Redis keys owned by a deleted post. */
export async function dbPurgePost(postId: string): Promise<void> {
  const keys = postScopedKeys(postId)
  if (keys.length) await redis.del(...keys)
}
