import type {BilingualLine, RenderedContent} from '../../shared/api.ts'
import type {RzRoute} from '../../shared/route.ts'
import {masterByName} from '../data/corpus-data.ts'
import type {ContentProvider} from './provider.ts'

// Minimal Zen-master card (R1): resolves an ingested `master/<slug>` link to a
// one-line bio card from the cached masters.json corpus (corpus-data.ts). Not the
// full SPA profile — just enough to render the master honestly in-feed. Not found
// → undefined, so the resolve chain falls through to the sample fallback.

export const masterProvider: ContentProvider = {
  name: 'master',
  async resolve(route: RzRoute): Promise<RenderedContent | undefined> {
    if (route.kind !== 'master') return undefined
    const raw = route.name?.trim()
    if (!raw) return undefined

    // route.name is already underscore→space normalized by the parser; the raw
    // retry is belt-and-suspenders for any caller that skips that step.
    const spaced = raw.replace(/_/g, ' ')
    const master =
      (await masterByName(spaced)) ??
      (spaced === raw ? undefined : await masterByName(raw))
    if (!master) return undefined

    const primary = master.names[0] ?? spaced
    const han = master.names[1]
    const dates = master.floruit
      ? `fl. ${master.floruit}`
      : master.death
        ? `d. ${master.death}`
        : ''
    const work = [master.school, dates].filter(Boolean).join(' · ')

    const notes = master.notes?.trim()
    const lines: BilingualLine[] = notes
      ? [{id: 'bio', zh: '', en: notes, role: 'comment'}]
      : []

    const slug = encodeURIComponent(primary.replace(/ /g, '_'))
    return {
      kind: 'master',
      workId: primary,
      title: primary,
      titleZh: han || undefined,
      lines,
      attribution: {work, master: primary},
      rzLink: `https://readzen.pages.dev/#/master/${slug}`,
    }
  },
}
