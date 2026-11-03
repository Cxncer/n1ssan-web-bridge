import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateArmoryDocument } from './armory-contract.ts'

test('v1 fixture passes the canonical Armory validator', async () => {
  const fixtureText = await readFile('fixtures/armory-inventory-v1.json', 'utf8')
  const fixture: unknown = JSON.parse(fixtureText)
  const result = validateArmoryDocument(fixture)
  assert.deepEqual(result, { valid: true, errors: [] })
})

test('validator rejects duplicate instance IDs and dangling equipment references', () => {
  const item = {
    instanceId: 'duplicate',
    definitionId: 4,
    type: 'weapon',
    name: 'Glock-18',
    quality: 4,
    rarity: 6,
    origin: 0,
    sourceCaseDefinitionId: null,
    finish: { paintKitId: 38, wear: 0.1, seed: 1 },
    statTrak: { enabled: false, kills: null },
    customName: null,
    stickers: [],
    charm: null,
    metadata: {},
  }
  const document = {
    schemaVersion: 1,
    catalogueVersion: 'test',
    profiles: [{
      profileId: 'p1',
      name: 'Test',
      items: [item, { ...item }],
      equipment: [{ team: 'T', slot: 'pistol1', instanceId: 'missing' }],
    }],
  }

  const result = validateArmoryDocument(document)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes('duplicate instance ID')))
  assert.ok(result.errors.some((error) => error.includes('references an item that does not exist')))
})

test('validator rejects invalid wear, duplicate sticker slots, and incompatible equipment', () => {
  const document = {
    schemaVersion: 1,
    catalogueVersion: 'test',
    profiles: [{
      profileId: 'p1',
      name: 'Test',
      items: [{
        instanceId: 'glove-1',
        definitionId: 5034,
        type: 'gloves',
        name: 'Specialist Gloves',
        quality: 4,
        rarity: 6,
        origin: 0,
        sourceCaseDefinitionId: null,
        finish: { paintKitId: 10063, wear: 1.2, seed: 0 },
        statTrak: { enabled: false, kills: null },
        customName: null,
        stickers: [
          { slot: 0, kitId: 1, wear: 0, rotation: 0, offsetX: 0, offsetY: 0, schema: -1 },
          { slot: 0, kitId: 2, wear: 0, rotation: 0, offsetX: 0, offsetY: 0, schema: -1 },
        ],
        charm: null,
        metadata: {},
      }],
      equipment: [{ team: 'CT', slot: 'melee', instanceId: 'glove-1' }],
    }],
  }

  const result = validateArmoryDocument(document)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes('wear')))
  assert.ok(result.errors.some((error) => error.includes('duplicate sticker slot')))
  assert.ok(result.errors.some((error) => error.includes('requires item type knife')))
})

test('instance IDs are unique across the entire document', () => {
  const sharedItem = {
    instanceId: 'shared-item',
    definitionId: 4,
    type: 'weapon',
    name: 'Glock-18',
    quality: 4,
    rarity: 6,
    origin: 0,
    sourceCaseDefinitionId: null,
    finish: { paintKitId: 38, wear: 0.1, seed: 1 },
    statTrak: { enabled: false, kills: null },
    customName: null,
    stickers: [],
    charm: null,
    metadata: {},
  }
  const document = {
    schemaVersion: 1,
    catalogueVersion: 'test',
    profiles: [
      { profileId: 'p1', name: 'One', items: [sharedItem], equipment: [] },
      { profileId: 'p2', name: 'Two', items: [{ ...sharedItem }], equipment: [] },
    ],
  }

  const result = validateArmoryDocument(document)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes('duplicate instance ID within document')))
})
