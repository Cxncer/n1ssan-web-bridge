import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArmoryDocument } from '../src/armory/contracts.ts'
import { createEmptyEquipmentDocument } from '../src/armory/equipment.ts'
import {
  ARMORY_EQUIPMENT_BRIDGE_URL,
  ArmoryEquipmentBridgeError,
  readArmoryEquipment,
  writeArmoryEquipment,
} from '../src/armory/equipment-client.ts'

const timestamp = '2026-11-04T00:00:00.000Z'
const armory: ArmoryDocument = {
  schemaVersion: 1,
  revision: 4,
  activeProfileId: 'profile-main',
  profiles: [{
    id: 'profile-main',
    name: 'Main inventory',
    items: [{
      id: 'instance-ak',
      definitionId: 'cs2:skin:n1ssan-skins:123',
      kind: 'skin',
      quantity: 1,
      customization: { float: 0.18, seed: 413, statTrak: null, customName: null },
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
}
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

test('reads canonical equipment and reports stale assignments without hiding the document', async () => {
  const document = createEmptyEquipmentDocument(armory)
  document.inventoryRevision = 3
  let requestedUrl = ''
  const result = await readArmoryEquipment(armory, async input => {
    requestedUrl = String(input)
    return jsonResponse(200, { data: document, validationErrors: ['inventory changed'] })
  })
  assert.equal(requestedUrl, `${ARMORY_EQUIPMENT_BRIDGE_URL}/armory/equipment`)
  assert.deepEqual(result.data, document)
  assert.deepEqual(result.validationErrors, ['inventory changed'])
})

test('writes equipment using the current inventory revision', async () => {
  const document = createEmptyEquipmentDocument(armory)
  document.assignments = [{ loadoutProfileId: 'loadout-main', team: 'T', slot: 'weapon', target: 'AK-47', itemInstanceId: 'instance-ak' }]
  let requestInit: RequestInit | undefined
  const result = await writeArmoryEquipment(document, armory, async (_input, init) => {
    requestInit = init
    return jsonResponse(200, { data: document })
  })
  assert.deepEqual(result, document)
  assert.equal(requestInit?.method, 'PUT')
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    expectedInventoryRevision: armory.revision,
    data: document,
  })
})

test('rejects invalid assignments before making a Bridge request', async () => {
  const document = createEmptyEquipmentDocument(armory)
  document.assignments = [{ loadoutProfileId: 'loadout-main', team: 'T', slot: 'weapon', target: 'AK-47', itemInstanceId: 'missing' }]
  await assert.rejects(
    writeArmoryEquipment(document, armory, async () => assert.fail('Bridge must not be called')),
    error => error instanceof ArmoryEquipmentBridgeError && error.code === 'VALIDATION_FAILED',
  )
})

test('preserves Bridge revision conflicts', async () => {
  const document = createEmptyEquipmentDocument(armory)
  await assert.rejects(
    writeArmoryEquipment(document, armory, async () => jsonResponse(409, {
      error: { code: 'REVISION_CONFLICT', message: 'Inventory changed', details: ['Reload before retrying'] },
    })),
    error => error instanceof ArmoryEquipmentBridgeError && error.status === 409 && error.code === 'REVISION_CONFLICT',
  )
})
