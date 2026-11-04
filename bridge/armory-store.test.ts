import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  ArmoryRevisionConflictError,
  ArmoryStore,
} from './armory-store.ts'

import type { ArmoryDocument } from '../src/armory/contracts.ts'

function createDocument(revision = 0): ArmoryDocument {
  const now = new Date().toISOString()

  return {
    schemaVersion: 1,
    revision,
    activeProfileId: 'profile-main',
    profiles: [{
      id: 'profile-main',
      name: 'Main inventory',
      items: [],
      createdAt: now,
      updatedAt: now,
    }],
  }
}

async function createTestDirectory() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'n1ssan-armory-store-'),
  )

  return {
    directory,
    filePath: path.join(directory, 'armory.json'),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}

test('creates a valid empty inventory when no storage exists', async (t) => {
  const fixture = await createTestDirectory()
  t.after(fixture.cleanup)

  const store = new ArmoryStore(fixture.filePath)
  await store.initialize()

  const document = store.read()

  assert.equal(document.schemaVersion, 1)
  assert.equal(document.revision, 0)
  assert.equal(document.profiles.length, 1)
  assert.equal(document.activeProfileId, 'profile-main')

  const persisted = JSON.parse(
    await readFile(fixture.filePath, 'utf8'),
  )

  assert.deepEqual(persisted, document)
})

test('restores a missing primary file from a valid backup', async (t) => {
  const fixture = await createTestDirectory()
  t.after(fixture.cleanup)

  const backup = createDocument(7)

  await writeFile(
    `${fixture.filePath}.bak`,
    JSON.stringify(backup),
  )

  const store = new ArmoryStore(fixture.filePath)
  await store.initialize()

  assert.deepEqual(store.read(), backup)

  const restored = JSON.parse(
    await readFile(fixture.filePath, 'utf8'),
  )

  assert.deepEqual(restored, backup)
})

test('restores a corrupt primary from backup and preserves damaged data', async (t) => {
  const fixture = await createTestDirectory()
  t.after(fixture.cleanup)

  const damagedContents = '{ invalid armory JSON'
  const backup = createDocument(4)

  await writeFile(fixture.filePath, damagedContents)
  await writeFile(
    `${fixture.filePath}.bak`,
    JSON.stringify(backup),
  )

  const store = new ArmoryStore(fixture.filePath)
  await store.initialize()

  assert.deepEqual(store.read(), backup)

  const restored = JSON.parse(
    await readFile(fixture.filePath, 'utf8'),
  )

  assert.deepEqual(restored, backup)

  const files = await readdir(fixture.directory)
  const damagedFile = files.find(
    file => file.startsWith('armory.json.corrupt-'),
  )

  assert.ok(damagedFile, 'damaged primary should be preserved')

  const preservedContents = await readFile(
    path.join(fixture.directory, damagedFile!),
    'utf8',
  )

  assert.equal(preservedContents, damagedContents)
})

test('fails safely when both primary and backup are corrupted', async (t) => {
  const fixture = await createTestDirectory()
  t.after(fixture.cleanup)

  const primaryContents = '{ broken primary'
  const backupContents = '{ broken backup'

  await writeFile(fixture.filePath, primaryContents)
  await writeFile(`${fixture.filePath}.bak`, backupContents)

  const store = new ArmoryStore(fixture.filePath)

  await assert.rejects(
    store.initialize(),
    /Armory storage is invalid and its backup is unavailable/,
  )

  assert.equal(
    await readFile(fixture.filePath, 'utf8'),
    primaryContents,
  )

  assert.equal(
    await readFile(`${fixture.filePath}.bak`, 'utf8'),
    backupContents,
  )
})

test('successfully writes new inventory after backup recovery', async (t) => {
  const fixture = await createTestDirectory()
  t.after(fixture.cleanup)

  const backup = createDocument(8)

  await writeFile(
    `${fixture.filePath}.bak`,
    JSON.stringify(backup),
  )

  const store = new ArmoryStore(fixture.filePath)
  await store.initialize()

  const candidate = structuredClone(store.read())
  candidate.profiles[0].name = 'Recovered inventory'

  const saved = await store.replace(8, candidate)

  assert.equal(saved.revision, 9)
  assert.equal(saved.profiles[0].name, 'Recovered inventory')

  const persisted = JSON.parse(
    await readFile(fixture.filePath, 'utf8'),
  )

  assert.deepEqual(persisted, saved)
})

test('allows only one concurrent write using the same revision', async (t) => {
  const fixture = await createTestDirectory()
  t.after(fixture.cleanup)

  const store = new ArmoryStore(fixture.filePath)
  await store.initialize()

  const firstCandidate = store.read()
  firstCandidate.profiles[0].name = 'First writer'

  const secondCandidate = store.read()
  secondCandidate.profiles[0].name = 'Second writer'

  const results = await Promise.allSettled([
    store.replace(0, firstCandidate),
    store.replace(0, secondCandidate),
  ])

  const successful = results.filter(
    result => result.status === 'fulfilled',
  )

  const rejected = results.filter(
    result => result.status === 'rejected',
  )

  assert.equal(successful.length, 1)
  assert.equal(rejected.length, 1)

  assert.ok(
    rejected[0].status === 'rejected' &&
    rejected[0].reason instanceof ArmoryRevisionConflictError,
  )

  assert.equal(store.read().revision, 1)

  const persisted = JSON.parse(
    await readFile(fixture.filePath, 'utf8'),
  )

  assert.equal(persisted.revision, 1)
  assert.ok(
    ['First writer', 'Second writer'].includes(
      persisted.profiles[0].name,
    ),
  )
})
