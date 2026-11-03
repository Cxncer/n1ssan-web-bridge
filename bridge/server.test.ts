
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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

  // Capture the initially accepted API state.
  const beforeInvalidRequest = await fetch(`${BASE_URL}/skins`)
  assert.equal(beforeInvalidRequest.status, 200)
  const savedState = await beforeInvalidRequest.json()

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
  const updatedState = await updatedResponse.json()

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
  const initial = await readResponse.json()

  assert.equal(initial.data.schemaVersion, 1)
  assert.equal(initial.data.revision, 0)
  assert.equal(initial.data.profiles.length, 1)

  const timestamp = new Date().toISOString()
  const nextDocument = {
    ...initial.data,
    profiles: [{
      ...initial.data.profiles[0],
      items: [{
        id: 'armory-test-item',
        definitionId: 'skin:ak47-redline',
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
  const saved = await saveResponse.json()
  assert.equal(saved.data.revision, 1)
  assert.equal(saved.data.profiles[0].items.length, 1)

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
  const finalState = await finalResponse.json()
  assert.equal(finalState.data.revision, 1)
  assert.equal(finalState.data.profiles[0].items[0].id, 'armory-test-item')
})
