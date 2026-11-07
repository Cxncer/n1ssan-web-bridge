import assert from 'node:assert/strict'
import { test } from 'node:test'
import { simulateLocalIntegration } from '../src/integration/simulator.ts'

const item = {
  id: 'armory-instance-1',
  definitionId: 'cs2:skin:n1ssan-skins:123',
  kind: 'skin',
  quantity: 1,
  customization: { float: 0.18, seed: 413, statTrak: null, customName: null },
  createdAt: '2026-11-04T06:00:00.000Z',
  updatedAt: '2026-11-04T06:00:00.000Z',
}
const snapshot = {
  contract: 'n1ssan.local-integration',
  schemaVersion: 3,
  inventory: { revision: 7, activeProfileId: 'profile-main', activeProfileItemCount: 1, items: [item] },
  equipment: {
    state: 'available',
    inventoryRevision: 7,
    profileId: 'profile-main',
    validationErrors: [],
    assignments: [{ loadoutProfileId: 'loadout-main', team: 'T', slot: 'weapon', target: 'AK-47', itemInstanceId: item.id, item }],
  },
}

test('integration simulator validates and exposes Armory-owned inventory instances', () => {
  const report = simulateLocalIntegration(snapshot)
  assert.equal(report.status, 'ready')
  assert.equal(report.inventoryState, 'available')
  assert.equal(report.inventoryItems.length, 1)
  assert.equal(report.inventoryItems[0].id, item.id)
  assert.equal(report.inventoryItems[0].customization?.float, 0.18)
  assert.equal(report.assignments.length, 1)
  assert.equal(report.assignments[0].item.definitionId, item.definitionId)
})

test('integration simulator reports Armory inventory even when no equipment is assigned', () => {
  const report = simulateLocalIntegration({
    ...snapshot,
    equipment: { ...snapshot.equipment, state: 'empty', assignments: [] },
  })
  assert.equal(report.status, 'empty')
  assert.equal(report.inventoryState, 'available')
  assert.deepEqual(report.inventoryItems.map(entry => entry.id), [item.id])
  assert.deepEqual(report.assignments, [])
})

test('integration simulator blocks inventory count mismatches and duplicate instance IDs', () => {
  const countMismatch = simulateLocalIntegration({
    ...snapshot,
    inventory: { ...snapshot.inventory, activeProfileItemCount: 2 },
  })
  assert.equal(countMismatch.status, 'stale')
  assert.equal(countMismatch.inventoryState, 'invalid')

  const duplicate = simulateLocalIntegration({
    ...snapshot,
    inventory: { ...snapshot.inventory, items: [item, item], activeProfileItemCount: 2 },
  })
  assert.equal(duplicate.status, 'stale')
  assert.equal(duplicate.inventoryState, 'invalid')
  assert.ok(duplicate.errors.some(error => error.includes('duplicate inventory instance ID')))
})

test('integration simulator blocks stale equipment and assignments outside active inventory', () => {
  const stale = simulateLocalIntegration({
    ...snapshot,
    equipment: { ...snapshot.equipment, state: 'stale', validationErrors: ['inventory changed'] },
  })
  assert.equal(stale.status, 'stale')
  assert.deepEqual(stale.assignments, [])

  const mismatch = simulateLocalIntegration({
    ...snapshot,
    equipment: { ...snapshot.equipment, assignments: [{ ...snapshot.equipment.assignments[0], itemInstanceId: 'wrong-id' }] },
  })
  assert.equal(mismatch.status, 'stale')
  assert.ok(mismatch.errors.some(error => error.includes('instance reference mismatch')))
  assert.ok(mismatch.errors.some(error => error.includes('not present in the active Armory inventory')))
})
