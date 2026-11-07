
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  ArmoryDocument,
  ArmoryReadResponse,
  ArmoryWriteResponse,
} from '../src/armory/contracts.ts'

type LegacySkinsResponse = {
  skins: Array<Record<string, unknown>>
  loadout: {
    id: number
    profile: string
    team: 'T' | 'CT'
    teams: ('T' | 'CT')[]
    receivedAt: string
    itemCount: number
  } | null
}

const HOST = '127.0.0.1'
const PORT = 3211
const BASE_URL = `http://${HOST}:${PORT}`

let tempDir: string
let dataFile: string
let server: ChildProcess | undefined

async function startServer(): Promise<void> {
  server = spawn(
    process.execPath,
    ['--import', 'tsx', 'bridge/server.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        N1SSAN_PORT: String(PORT),
        N1SSAN_DATA_FILE: dataFile,
        N1SSAN_ARMORY_FILE: path.join(tempDir, 'armory-data.json'),
        N1SSAN_EQUIPMENT_FILE: path.join(tempDir, 'armory-equipment.json'),
      },
      stdio: 'ignore',
    },
  )

  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Test Bridge exited with code ${server.exitCode}`)
    }

    try {
      const response = await fetch(`${BASE_URL}/health`)
      if (response.ok) return
    } catch {
      // The test server may still be starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error('Test Bridge did not become healthy within 10 seconds')
}

async function stopServer(): Promise<void> {
  if (!server || server.exitCode !== null) {
    server = undefined
    return
  }

  const currentServer = server
  const exited = new Promise<void>((resolve) => {
    currentServer.once('exit', () => resolve())
  })

  currentServer.kill()
  await exited
  server = undefined
}

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'n1ssan-bridge-test-'))
  dataFile = path.join(tempDir, 'test-data.json')
  await startServer()
})

after(async () => {
  await stopServer()
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('DOMINATE can reset a previous workspace selection to neutral', async () => {
  const selected = await fetch(`${BASE_URL}/runtime-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'armory' }),
  })
  assert.equal(selected.status, 200)

  const reset = await fetch(`${BASE_URL}/runtime-mode/reset`, { method: 'POST' })
  assert.equal(reset.status, 200)
  assert.deepEqual(await reset.json(), { mode: 'unknown' })

  const persisted = JSON.parse(
    await readFile(path.join(tempDir, 'runtime-mode.json'), 'utf8'),
  ) as { mode: string }
  assert.equal(persisted.mode, 'unknown')
})

test('Bridge validates submissions, backs up previous data, and restores saved data after restart', async () => {
  const validLoadout = {
    profile: 'Automated Test',
    team: 'T',
    skins: [
      {
        id: 3674384353,
        weapon: 'AK-47',
        name: 'Test Skin',
        slot: 'weapon',
        team: 'T',
        equippedFor: 'AK-47',
        float: 0.41,
        seed: 0,
      },
    ],
  }

  // A valid loadout should be accepted.
  const validResponse = await fetch(`${BASE_URL}/skins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validLoadout),
  })

  assert.equal(validResponse.status, 200)

  // The integration contract exposes inventory and the legacy equipped selection
  // as separate sources; it must not pretend legacy IDs are Armory instance IDs.
  const integrationResponse = await fetch(`${BASE_URL}/integration/snapshot`)
  assert.equal(integrationResponse.status, 200)
  const integration = await integrationResponse.json() as {
    data: {
      contract: string
      schemaVersion: number
      inventory: { source: string; activeProfileItemCount: number; items: unknown[] }
      selection: { source: string; state: string; items: Array<Record<string, unknown>> }
    }
  }
  assert.equal(integration.data.contract, 'n1ssan.local-integration')
  assert.equal(integration.data.schemaVersion, 3)
  assert.equal(integration.data.inventory.source, 'armory-api')
  assert.equal(integration.data.inventory.activeProfileItemCount, 0)
  assert.deepEqual(integration.data.inventory.items, [])
  assert.equal(integration.data.selection.source, 'legacy-skins-api')
  assert.equal(integration.data.selection.state, 'available')
  assert.equal(integration.data.selection.items[0].weapon, 'AK-47')

  // Capture the initially accepted API state.
  const beforeInvalidRequest = await fetch(`${BASE_URL}/skins`)
  assert.equal(beforeInvalidRequest.status, 200)
  const savedState =
  await beforeInvalidRequest.json() as LegacySkinsResponse

  // An invalid ID should be rejected.
  const invalidLoadout = {
    ...validLoadout,
    skins: [
      {
        ...validLoadout.skins[0],
        id: 'not-a-number',
      },
    ],
  }

  const invalidResponse = await fetch(`${BASE_URL}/skins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(invalidLoadout),
  })

  assert.equal(invalidResponse.status, 400)

  // Rejected data must not overwrite the accepted state.
  const afterInvalidRequest = await fetch(`${BASE_URL}/skins`)
  assert.deepEqual(await afterInvalidRequest.json(), savedState)

  // Submit a second valid loadout to trigger a backup.
  const updatedLoadout = {
    ...validLoadout,
    profile: 'Updated Test',
  }

  const updateResponse = await fetch(`${BASE_URL}/skins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updatedLoadout),
  })

  assert.equal(updateResponse.status, 200)

  // The backup should contain the previously persisted state.
  const backupContents = await readFile(`${dataFile}.bak`, 'utf8')
  const backupState = JSON.parse(backupContents)

  assert.equal(backupState.version, 1)
  assert.deepEqual(backupState.skins, savedState.skins)
  assert.deepEqual(backupState.loadout, savedState.loadout)
  assert.equal(backupState.loadout.profile, 'Automated Test')

  // Capture the updated API state for the restart check.
  const updatedResponse = await fetch(`${BASE_URL}/skins`)
  assert.equal(updatedResponse.status, 200)
  const updatedState =
    await updatedResponse.json() as LegacySkinsResponse

  // Restart the isolated Bridge using the same test data file.
  await stopServer()
  await startServer()

  const afterRestart = await fetch(`${BASE_URL}/skins`)
  assert.equal(afterRestart.status, 200)
  assert.deepEqual(await afterRestart.json(), updatedState)
})


test('Armory API persists complete profiles and rejects stale or invalid writes', async () => {
  const readResponse = await fetch(`${BASE_URL}/armory`)
  assert.equal(readResponse.status, 200)
  const initial =
  await readResponse.json() as ArmoryReadResponse

  assert.equal(initial.data.schemaVersion, 1)
  assert.equal(initial.data.revision, 0)
  assert.equal(initial.data.profiles.length, 1)

  const timestamp = new Date().toISOString()
  const nextDocument: ArmoryDocument = {
  ...initial.data,
  profiles: [{
    ...initial.data.profiles[0],
    items: [{
      id: 'armory-test-item',
      definitionId: 'cs2:skin:n1ssan-skins:1134884231',
      kind: 'skin',
      quantity: 1,
      customization: {
        float: 0.18,
        seed: 413,
        statTrak: { enabled: true, kills: 12 },
        customName: null,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    updatedAt: timestamp,
  }],
}

  const saveResponse = await fetch(`${BASE_URL}/armory`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: initial.data.revision,
      data: nextDocument,
    }),
  })

  assert.equal(saveResponse.status, 200)
  const saved = await saveResponse.json() as ArmoryWriteResponse
  assert.equal(saved.data.revision, 1)
  assert.equal(saved.data.profiles[0].items.length, 1)

  // Explicit Armory Apply writes the current profile projection before
  // switching the native runtime mode.
  const applyResponse = await fetch(`${BASE_URL}/armory/apply`, { method: 'POST' })
  const applyBody = await applyResponse.json()
console.log('ARMORY APPLY DEBUG:', JSON.stringify(applyBody, null, 2))
assert.equal(applyResponse.status, 200)
  const applied = applyBody as {
    mode: string
    runtime: { written: boolean; itemCount: number; skipped: number }
  }
  assert.equal(applied.mode, 'armory')
  assert.equal(applied.runtime.written, true)
  assert.equal(applied.runtime.itemCount, 1)

  const armoryRuntime = JSON.parse(
    await readFile(path.join(tempDir, 'armory-inventory.json'), 'utf8'),
  ) as { source: string; items: unknown[] }
  assert.equal(armoryRuntime.source, 'armory')
  assert.equal(armoryRuntime.items.length, 1)

  const selectedMode = JSON.parse(
    await readFile(path.join(tempDir, 'runtime-mode.json'), 'utf8'),
  ) as { mode: string }
  assert.equal(selectedMode.mode, 'armory')

  // Canonical equipment references the unique owned instance, not a catalogue ID.
  const equipmentRead = await fetch(`${BASE_URL}/armory/equipment`)
  assert.equal(equipmentRead.status, 200)
  const equipmentCurrent = await equipmentRead.json() as { data: { schemaVersion: number; inventoryRevision: number; profileId: string; assignments: unknown[] } }
  assert.equal(equipmentCurrent.data.inventoryRevision, saved.data.revision)
  assert.equal(equipmentCurrent.data.assignments.length, 0)
  const equipmentDocument = {
    schemaVersion: 1,
    inventoryRevision: saved.data.revision,
    profileId: saved.data.activeProfileId,
    assignments: [{ loadoutProfileId: 'loadout-main', team: 'T', slot: 'weapon', target: 'AK-47', itemInstanceId: 'armory-test-item' }],
  }
  const equipmentSave = await fetch(`${BASE_URL}/armory/equipment`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedInventoryRevision: saved.data.revision, data: equipmentDocument }),
  })
  assert.equal(equipmentSave.status, 200)
  const equipmentSaved = await equipmentSave.json() as { data: typeof equipmentDocument }
  assert.equal(equipmentSaved.data.assignments[0].itemInstanceId, 'armory-test-item')

  const integrationSnapshot = await fetch(`${BASE_URL}/integration/snapshot`)
  const integrationData = await integrationSnapshot.json() as { data: { inventory: { activeProfileItemCount: number; items: Array<{ id: string; definitionId: string; customization: { float: number } }> }; equipment: { state: string; assignments: Array<{ itemInstanceId: string }> } } }
  assert.equal(integrationData.data.inventory.activeProfileItemCount, 1)
  assert.equal(integrationData.data.inventory.items[0].id, 'armory-test-item')
  assert.equal(integrationData.data.inventory.items[0].customization.float, 0.18)
  assert.equal(integrationData.data.equipment.state, 'available')
  assert.equal(integrationData.data.equipment.assignments[0].itemInstanceId, 'armory-test-item')

  const simulationResponse = await fetch(`${BASE_URL}/integration/simulator`)
  assert.equal(simulationResponse.status, 200)
  const simulation = await simulationResponse.json() as { data: { status: string; assignments: Array<{ item: { id: string; customization: { float: number } } }> } }
  assert.equal(simulation.data.status, 'ready')
  assert.equal(simulation.data.assignments[0].item.id, 'armory-test-item')
  assert.equal(simulation.data.assignments[0].item.customization.float, 0.18)

  const staleEquipmentSave = await fetch(`${BASE_URL}/armory/equipment`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedInventoryRevision: 0, data: { ...equipmentDocument, inventoryRevision: 0 } }),
  })
  assert.equal(staleEquipmentSave.status, 409)

  const staleResponse = await fetch(`${BASE_URL}/armory`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: initial.data.revision,
      data: nextDocument,
    }),
  })

  assert.equal(staleResponse.status, 409)

  const invalidDocument = structuredClone(saved.data)
  invalidDocument.profiles[0].items[0].quantity = 2
  const invalidResponse = await fetch(`${BASE_URL}/armory`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: saved.data.revision,
      data: invalidDocument,
    }),
  })

    assert.equal(invalidResponse.status, 400)

  await stopServer()
  await startServer()

  const finalResponse = await fetch(`${BASE_URL}/armory`)
  assert.equal(finalResponse.status, 200)

  const finalState =
    await finalResponse.json() as ArmoryReadResponse

  assert.equal(finalState.data.revision, saved.data.revision)
  assert.deepEqual(finalState.data.profiles, saved.data.profiles)

  const restoredEquipment = await fetch(`${BASE_URL}/armory/equipment`)
  assert.equal(restoredEquipment.status, 200)
  const restoredEquipmentBody = await restoredEquipment.json() as { data: { assignments: Array<{ itemInstanceId: string }> }; validationErrors: string[] }
  assert.deepEqual(restoredEquipmentBody.validationErrors, [])
  assert.equal(restoredEquipmentBody.data.assignments[0].itemInstanceId, 'armory-test-item')

  // Any inventory revision change invalidates the previous equipment snapshot.
  const changedArmory = structuredClone(finalState.data)
  changedArmory.profiles[0].name = 'Renamed after equipment save'
  const changedArmoryResponse = await fetch(`${BASE_URL}/armory`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: finalState.data.revision, data: changedArmory }),
  })
  assert.equal(changedArmoryResponse.status, 200)
  const changedArmoryState = await changedArmoryResponse.json() as ArmoryReadResponse

  const staleEquipmentRead = await fetch(`${BASE_URL}/armory/equipment`)
  const staleEquipmentBody = await staleEquipmentRead.json() as { validationErrors: string[] }
  assert.ok(staleEquipmentBody.validationErrors.some(error => error.includes('inventory changed')))

  const staleSnapshotResponse = await fetch(`${BASE_URL}/integration/snapshot`)
  const staleSnapshot = await staleSnapshotResponse.json() as { data: { equipment: { state: string; assignments: unknown[] }; inventory: { items: unknown[] } } }
  assert.equal(staleSnapshot.data.equipment.state, 'stale')
  assert.deepEqual(staleSnapshot.data.equipment.assignments, [])
  assert.equal(staleSnapshot.data.inventory.items.length, 1)

  const staleSimulationResponse = await fetch(`${BASE_URL}/integration/simulator`)
  const staleSimulation = await staleSimulationResponse.json() as { data: { status: string; assignments: unknown[] } }
  assert.equal(staleSimulation.data.status, 'stale')
  assert.deepEqual(staleSimulation.data.assignments, [])

  // An intentionally empty active profile is a clear operation, not a failed
  // projection. The native DLL uses the empty document to remove managed items.
  const clearedArmory = structuredClone(changedArmoryState.data)
  clearedArmory.profiles[0].items = []
  const clearSave = await fetch(`${BASE_URL}/armory`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: changedArmoryState.data.revision,
      data: clearedArmory,
    }),
  })
  assert.equal(clearSave.status, 200)

  const clearApply = await fetch(`${BASE_URL}/armory/apply`, { method: 'POST' })
  assert.equal(clearApply.status, 200)
  const clearResult = await clearApply.json() as {
    mode: string
    runtime: { written: boolean; itemCount: number; skipped: number }
  }
  assert.equal(clearResult.mode, 'armory')
  assert.equal(clearResult.runtime.written, true)
  assert.equal(clearResult.runtime.itemCount, 0)
  assert.equal(clearResult.runtime.skipped, 0)

  const clearedRuntime = JSON.parse(
    await readFile(path.join(tempDir, 'armory-inventory.json'), 'utf8'),
  ) as { items: unknown[] }
  assert.deepEqual(clearedRuntime.items, [])
})
