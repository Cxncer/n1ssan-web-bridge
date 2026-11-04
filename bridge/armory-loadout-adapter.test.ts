import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArmoryDocument } from '../src/armory/contracts.ts'
import { createEmptyEquipmentDocument, validateArmoryEquipmentDocument } from '../src/armory/equipment.ts'
import { buildProfileEquipmentAssignments, replaceProfileEquipmentAssignments, resolveProfileEquipmentSelections } from '../src/armory/loadout-adapter.ts'

const timestamp = '2026-11-04T06:00:00.000Z'
const armory: ArmoryDocument = {
  schemaVersion: 1,
  revision: 8,
  activeProfileId: 'inventory-main',
  profiles: [{
    id: 'inventory-main',
    name: 'Main inventory',
    createdAt: timestamp,
    updatedAt: timestamp,
    items: [
      { id: 'ak-owned-1', definitionId: 'cs2:skin:n1ssan-skins:10', kind: 'skin', quantity: 1, customization: null, createdAt: timestamp, updatedAt: timestamp },
      { id: 'ak-owned-2', definitionId: 'cs2:skin:n1ssan-skins:10', kind: 'skin', quantity: 1, customization: null, createdAt: timestamp, updatedAt: timestamp },
      { id: 'knife-owned', definitionId: 'cs2:skin:n1ssan-knives:7', kind: 'skin', quantity: 1, customization: null, createdAt: timestamp, updatedAt: timestamp },
    ],
  }],
}
const catalogue = [
  { id: 10, weapon: 'AK-47', type: 'Rifle' },
  { id: 7, weapon: 'Knife', type: 'Knife' },
  { id: 999, weapon: 'M4A1-S', type: 'Rifle' },
]

test('maps catalogue IDs to actual owned instance IDs and keeps T/CT assignments distinct', () => {
  const assignments = buildProfileEquipmentAssignments({
    loadoutProfileId: 'loadout-main',
    loadouts: { T: { 'AK-47': 10 }, CT: { 'AK-47': 10 } },
    equipment: { T: { agent: null, knife: 7, gloves: null, zeus: null }, CT: { agent: null, knife: null, gloves: null, zeus: null } },
  }, catalogue, armory)

  assert.deepEqual(assignments.map(item => item.itemInstanceId), ['ak-owned-1', 'knife-owned', 'ak-owned-2'])
  assert.ok(assignments.every(item => item.loadoutProfileId === 'loadout-main'))
  const document = createEmptyEquipmentDocument(armory)
  document.assignments = assignments
  assert.deepEqual(validateArmoryEquipmentDocument(document, armory), [])
})

test('does not invent ownership when a selected catalogue item is absent from Armory', () => {
  assert.throws(() => buildProfileEquipmentAssignments({
    loadoutProfileId: 'loadout-main',
    loadouts: { T: { 'AK-47': 999 }, CT: {} },
    equipment: { T: { agent: null, knife: null, gloves: null, zeus: null }, CT: { agent: null, knife: null, gloves: null, zeus: null } },
  }, catalogue, armory), /not owned in the active Armory inventory/)
})

test('replaces only the requested Loadout Builder profile assignments', () => {
  const document = createEmptyEquipmentDocument(armory)
  document.assignments = [
    { loadoutProfileId: 'profile-a', team: 'T', slot: 'weapon', target: 'AK-47', itemInstanceId: 'ak-owned-1' },
    { loadoutProfileId: 'profile-b', team: 'CT', slot: 'weapon', target: 'AK-47', itemInstanceId: 'ak-owned-2' },
  ]
  const replacement = replaceProfileEquipmentAssignments(document, 'profile-a', [])
  assert.deepEqual(replacement.assignments, [document.assignments[1]])
})

test('loads profile-scoped canonical assignments back into catalogue selections', () => {
  const document = createEmptyEquipmentDocument(armory)
  document.assignments = [
    { loadoutProfileId: 'loadout-main', team: 'T', slot: 'weapon', target: 'AK-47', itemInstanceId: 'ak-owned-1' },
    { loadoutProfileId: 'loadout-main', team: 'CT', slot: 'knife', target: 'knife', itemInstanceId: 'knife-owned' },
  ]
  const restored = resolveProfileEquipmentSelections(document, 'loadout-main', catalogue, armory)
  assert.equal(restored.loadouts.T['AK-47'], 10)
  assert.equal(restored.equipment.CT.knife, 7)
  assert.equal(restored.equipment.T.knife, null)
})
