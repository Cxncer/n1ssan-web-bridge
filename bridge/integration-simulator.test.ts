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
  schemaVersion: 2,
  inventory: { revision: 7 },
  equipment: {
    state: 'available',
    validationErrors: [],
    assignments: [{ team: 'T', slot: 'weapon', target: 'AK-47', itemInstanceId: item.id, item }],
  },
}

test('integration simulator resolves the selected owned instance and customization', () => {
  const report = simulateLocalIntegration(snapshot)
  assert.equal(report.status, 'ready')
  assert.equal(report.inventoryRevision, 7)
  assert.equal(report.assignments.length, 1)
  assert.equal(report.assignments[0].item.definitionId, item.definitionId)
  assert.equal(report.assignments[0].item.customization?.float, 0.18)
})

test('integration simulator blocks stale or malformed snapshots', () => {
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
})
