import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArmoryDocument } from '../src/armory/contracts.ts'
import { createEmptyEquipmentDocument, validateArmoryEquipmentDocument } from '../src/armory/equipment.ts'

const now = '2026-11-04T06:00:00.000Z'
const armory: ArmoryDocument = {
  schemaVersion: 1, revision: 3, activeProfileId: 'main', profiles: [{
    id: 'main', name: 'Main', createdAt: now, updatedAt: now, items: [
      { id: 'ak-instance-a', definitionId: 'cs2:skin:n1ssan-skins:1', kind: 'skin', quantity: 1, customization: { float: 0.12, seed: 42, statTrak: null, customName: null }, createdAt: now, updatedAt: now },
      { id: 'ak-instance-b', definitionId: 'cs2:skin:n1ssan-skins:1', kind: 'skin', quantity: 1, customization: { float: 0.3, seed: 7, statTrak: null, customName: null }, createdAt: now, updatedAt: now },
      { id: 'sticker-stack', definitionId: 'cs2:sticker:bymykel-stickers:1', kind: 'sticker', quantity: 5, customization: null, createdAt: now, updatedAt: now },
    ],
  }],
}

test('equipment assignments reference unique owned instances and preserve team-specific copies', () => {
  const document = createEmptyEquipmentDocument(armory)
  document.assignments = [
    { loadoutProfileId: 'loadout-main', team: 'T', slot: 'weapon', target: 'AK-47', itemInstanceId: 'ak-instance-a' },
    { loadoutProfileId: 'loadout-main', team: 'CT', slot: 'weapon', target: 'AK-47', itemInstanceId: 'ak-instance-b' },
  ]
  assert.deepEqual(validateArmoryEquipmentDocument(document, armory), [])
})

test('equipment rejects missing instances, stack items, duplicate slots and duplicate team instances', () => {
  const document = createEmptyEquipmentDocument(armory)
  document.assignments = [
    { loadoutProfileId: 'loadout-main', team: 'T', slot: 'weapon', target: 'AK-47', itemInstanceId: 'missing' },
    { loadoutProfileId: 'loadout-main', team: 'T', slot: 'weapon', target: 'AK-47', itemInstanceId: 'ak-instance-a' },
    { loadoutProfileId: 'loadout-main', team: 'T', slot: 'knife', target: 'knife', itemInstanceId: 'ak-instance-a' },
    { loadoutProfileId: 'loadout-main', team: 'T', slot: 'gloves', target: 'gloves', itemInstanceId: 'sticker-stack' },
  ]
  const errors = validateArmoryEquipmentDocument(document, armory)
  assert.ok(errors.some(error => error.includes('does not exist')))
  assert.ok(errors.some(error => error.includes('duplicate team/slot/target')))
  assert.ok(errors.some(error => error.includes('assigned more than once')))
  assert.ok(errors.some(error => error.includes('only individual skin instances')))
})

test('equipment rejects stale inventory revisions and inactive profiles', () => {
  const document = createEmptyEquipmentDocument(armory)
  document.inventoryRevision = 2
  document.profileId = 'other-profile'
  const errors = validateArmoryEquipmentDocument(document, armory)
  assert.ok(errors.some(error => error.includes('inventory changed')))
  assert.ok(errors.some(error => error.includes('active Armory profile')))
})
