import assert from 'node:assert/strict'
import test from 'node:test'
import { collectionIds, groupCollections } from '../src/client/collections.ts'

test('groups by collection in display order, retaining the catalog order within each group', () => {
  const official = { title: 'Official', curation: 'official', publisher: { id: 'publisher.example' } }
  const firstCommunity = { title: 'First', curation: 'community', publisher: { id: 'first.example' } }
  const academy = { title: 'Featured', curation: 'academy', publisher: { id: 'plugin.academy' } }
  const secondCommunity = { title: 'Second', curation: 'community', publisher: { id: 'second.example' } }
  const unclassified = { title: 'Custom source', publisher: {} }
  const groups = groupCollections([official, firstCommunity, unclassified, academy, secondCommunity])
  assert.deepEqual(collectionIds, ['academy', 'community', 'official', 'other'])
  assert.deepEqual(groups, {
    academy: [academy], community: [firstCommunity, secondCommunity], official: [official], other: [unclassified],
  })
})

test('keeps legacy Featured in Academy without reclassifying other official indexes', () => {
  const publisher = { id: 'plugin.academy' }
  const legacy = { title: 'Featured', id: 'https://plugin.academy/catalogs/dsh/featured', curation: 'official', publisher }
  const official = { title: 'Native tools', id: 'https://plugin.academy/catalogs/dsh/official/tools', curation: 'official', publisher }
  const groups = groupCollections([legacy, official])
  assert.deepEqual(groups, { academy: [legacy], community: [], official: [official], other: [] })
  assert.equal(legacy.curation, 'official')
})
