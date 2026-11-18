import type { IndexSource } from '../catalog.ts'

export const collectionIds = ['academy', 'community', 'official', 'other'] as const

type CollectionId = typeof collectionIds[number]

export function groupCollections(sources: readonly IndexSource[]): Record<CollectionId, IndexSource[]> {
  const groups: Record<CollectionId, IndexSource[]> = { academy: [], community: [], official: [], other: [] }
  for (const source of sources) {
    // Older Plugin Academy catalogs used "official" for Featured.
    const legacyFeatured = source.curation === 'official' && source.publisher.id === 'plugin.academy'
      && source.id === 'https://plugin.academy/catalogs/dsh/featured'
    const id = legacyFeatured ? 'academy' : source.curation ?? 'other'
    groups[id].push(source)
  }
  return groups
}
