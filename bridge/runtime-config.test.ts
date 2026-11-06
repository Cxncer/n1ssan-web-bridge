import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildLoadoutRuntimeCatalogue,
  projectLoadoutRuntime,
  type LoadoutSelectionSnapshot,
} from '../src/armory/runtime-config.ts'

// Catalogue metadata only. There is no Armory inventory in this path.
const catalogue = buildLoadoutRuntimeCatalogue([
  { id: 3031258594, weapon: 'AK-47', name: 'Bloodsport', type: 'Rifles', paintKit: 639, minFloat: 0, maxFloat: 0.8 },
  { id: 'skin-85646e9ca45c', weapon: 'Bayonet', name: 'Doppler · Phase 2', type: 'Knives', paintIndex: 419, minFloat: 0, maxFloat: 0.08 },
  { id: 279, weapon: 'AWP', name: 'Asiimov', type: 'Snipers', paintKit: 279 },
])

const schema = {
  itemDefinitions: [
    { definitionIndex: 7, compatiblePaintKitIds: [0, 639] },
    { definitionIndex: 500, compatiblePaintKitIds: [0, 419] },
    { definitionIndex: 9, compatiblePaintKitIds: [0, 279] },
  ],
}

const noEquipment = { agent: null, knife: null, gloves: null, zeus: null }

function selection(overrides: Partial<LoadoutSelectionSnapshot> = {}): LoadoutSelectionSnapshot {
  return {
    loadouts: { T: {}, CT: {} },
    equipment: { T: { ...noEquipment }, CT: { ...noEquipment } },
    ...overrides,
  }
}

test('projects any catalogue skin, with float and seed from the Loadout settings', () => {
  const result = projectLoadoutRuntime(selection({
    loadouts: { T: { 'AK-47': 3031258594 }, CT: {} },
    skinSettings: { T: { 'AK-47:3031258594': { float: 0.12, seed: 7 } }, CT: {} },
  }), catalogue, schema, 'loadout-main')

  assert.equal(result.document.activeLoadoutProfileId, 'loadout-main')
  assert.deepEqual(result.document.skins, [{
    weapon: 'AK-47',
    name: 'Bloodsport',
    paintKit: 639,
    float: 0.12,
    seed: 7,
    team: 'T',
    slot: 'weapon',
    definitionId: 'cs2:skin:n1ssan-skins:3031258594',
  }])
  assert.deepEqual(result.skipped, [])
})

test('projects expanded knife identities without any inventory relationship', () => {
  const result = projectLoadoutRuntime(selection({
    equipment: {
      T: { ...noEquipment, knife: 'skin-85646e9ca45c' },
      CT: { ...noEquipment },
    },
  }), catalogue, schema)

  assert.equal(result.document.skins.length, 1)
  assert.equal(result.document.skins[0].weapon, 'Bayonet')
  assert.equal(result.document.skins[0].paintKit, 419)
  assert.equal(result.document.skins[0].slot, 'knife')
})

test('falls back to catalogue minimum wear and seed 0 when no settings exist', () => {
  const result = projectLoadoutRuntime(selection({
    loadouts: { T: { 'AK-47': 3031258594 }, CT: {} },
  }), catalogue, schema)

  assert.equal(result.document.skins[0].float, 0)
  assert.equal(result.document.skins[0].seed, 0)
})

test('skips catalogue IDs that do not exist instead of failing the whole profile', () => {
  const result = projectLoadoutRuntime(selection({
    loadouts: { T: { 'AK-47': 999999 }, CT: {} },
  }), catalogue, schema)

  assert.equal(result.document.skins.length, 0)
  assert.match(result.skipped[0].reason, /catalogue entry not found/)
})

test('skips paint kits the live schema marks incompatible', () => {
  const result = projectLoadoutRuntime(selection({
    loadouts: { T: { 'AK-47': 3031258594 }, CT: {} },
  }), catalogue, { itemDefinitions: [{ definitionIndex: 7, compatiblePaintKitIds: [0] }] })

  assert.equal(result.document.skins.length, 0)
  assert.match(result.skipped[0].reason, /not compatible/)
})

test('reports agent and zeus slots as unsupported by the native loadout', () => {
  const result = projectLoadoutRuntime(selection({
    equipment: {
      T: { ...noEquipment, agent: 123, zeus: 456 },
      CT: { ...noEquipment },
    },
  }), catalogue, schema)

  assert.equal(result.document.skins.length, 0)
  assert.equal(result.skipped.length, 2)
  assert.ok(result.skipped.every(item => /not applied by the native runtime yet/.test(item.reason)))
})

test('produces an empty document for an empty loadout', () => {
  const result = projectLoadoutRuntime(selection(), catalogue, schema)

  assert.deepEqual(result.document.skins, [])
  assert.deepEqual(result.skipped, [])
})
