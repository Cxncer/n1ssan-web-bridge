import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArmoryDocument } from '../src/armory/contracts.ts'
import { createLocalIntegrationSnapshot } from '../src/integration/local-snapshot.ts'

const timestamp = '2026-11-04T06:00:00.000Z'

const armory: ArmoryDocument = {
  schemaVersion: 1,
  revision: 7,
  activeProfileId: 'profile-main',
  profiles: [{
    id: 'profile-main',
    name: 'Main inventory',
    createdAt: timestamp,
    updatedAt: timestamp,
    items: [{
      id: 'armory-instance-1',
      definitionId: 'cs2:skin:n1ssan-skins:123',
      kind: 'skin',
      quantity: 1,
      customization: { float: 0.18, seed: 413, statTrak: null, customName: null },
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
  }],
}

test('local integration snapshot keeps Armory inventory and legacy selection separate', () => {
  const selected = [{
    id: 123,
    weapon: 'AK-47',
    name: 'Redline',
    team: 'T' as const,
    slot: 'weapon' as const,
    equippedFor: 'AK-47',
    float: 0.18,
    seed: 413,
    paintKit: 282,
  }]
  const loadout = {
    id: 4,
    profile: 'Main loadout',
    team: 'T' as const,
    teams: ['T' as const, 'CT' as const],
    receivedAt: timestamp,
    itemCount: 1,
  }

  const snapshot = createLocalIntegrationSnapshot(armory, selected, loadout, timestamp)

  assert.equal(snapshot.contract, 'n1ssan.local-integration')
  assert.equal(snapshot.schemaVersion, 1)
  assert.equal(snapshot.generatedAt, timestamp)
  assert.deepEqual(snapshot.inventory, {
    source: 'armory-api',
    schemaVersion: 1,
    revision: 7,
    activeProfileId: 'profile-main',
    activeProfileItemCount: 1,
    profileCount: 1,
  })
  assert.equal(snapshot.selection.source, 'legacy-skins-api')
  assert.equal(snapshot.selection.state, 'available')
  assert.equal(snapshot.selection.loadout?.profile, 'Main loadout')
  assert.deepEqual(snapshot.selection.items, selected)

  // Snapshot consumers cannot mutate the Bridge's source objects.
  snapshot.selection.items[0].name = 'Changed by consumer'
  assert.equal(selected[0].name, 'Redline')
})

test('local integration snapshot reports an empty legacy selection without inventing equipped items', () => {
  const snapshot = createLocalIntegrationSnapshot(armory, [], null, timestamp)

  assert.equal(snapshot.selection.state, 'empty')
  assert.equal(snapshot.selection.loadout, null)
  assert.deepEqual(snapshot.selection.items, [])
  assert.equal(snapshot.inventory.activeProfileItemCount, 1)
})
