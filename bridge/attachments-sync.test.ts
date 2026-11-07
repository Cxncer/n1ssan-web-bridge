import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ArmoryDocument } from '../src/armory/contracts.ts'
import { AttachmentsSync } from './attachments-sync.ts'

const now = '2026-11-07T10:00:00.000Z'

function makeDocument(): ArmoryDocument {
  return {
    schemaVersion: 1,
    revision: 4,
    activeProfileId: 'main',
    profiles: [{
      id: 'main',
      name: 'Main',
      createdAt: now,
      updatedAt: now,
      items: [
        {
          id: 'ak-a',
          definitionId: 'cs2:skin:n1ssan-skins:1',
          kind: 'skin',
          quantity: 1,
          customization: { float: 0.12, seed: 1, statTrak: null, customName: null },
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'ak-manual',
          definitionId: 'cs2:skin:n1ssan-skins:1',
          kind: 'skin',
          quantity: 1,
          customization: { float: 0.2, seed: 2, statTrak: null, customName: null },
          attachments: {
            stickers: [],
            charm: null,
            origin: 'manual',
            observedAt: null,
            observedInventoryRevision: null,
          },
          createdAt: now,
          updatedAt: now,
        },
      ],
    }],
  }
}

function stickerRecord(overrides: Record<string, unknown> = {}) {
  return {
    seq: 1,
    instanceId: 'ak-a',
    projectedItemId: '1037597243891028586',
    complete: true,
    stableForMs: 620,
    observedAt: '2026-11-07T10:05:00.000Z',
    attachments: {
      stickers: [{
        slot: 0,
        kitId: 1234,
        wear: 0.12,
        scale: 1,
        rotation: 0,
        offsetX: 0.1,
        offsetY: -0.05,
        schema: 3,
      }],
      charm: null,
    },
    ...overrides,
  }
}

async function run(detection: unknown, document = makeDocument()) {
  const directory = await mkdtemp(path.join(tmpdir(), 'n1ssan-attachments-'))
  const detectionPath = path.join(directory, 'armory-detected-attachments.json')
  const ackPath = path.join(directory, 'armory-attachments-ack.json')

  await writeFile(detectionPath, JSON.stringify(detection), 'utf8')

  let replaced: ArmoryDocument | null = null
  const sync = new AttachmentsSync({
    detectionPath,
    ackPath,
    read: () => document,
    replace: async (_expected, candidate) => {
      replaced = candidate as ArmoryDocument
      return candidate as ArmoryDocument
    },
  })

  const result = await sync.poll()
  const ack = JSON.parse(await readFile(ackPath, 'utf8').catch(() => '{}')) as { ackedSeq?: number }

  return { result, replaced, ack }
}

test('merges a complete observation into the matching instance and acks it', async () => {
  const { result, replaced, ack } = await run({
    profileId: 'main',
    inventoryRevision: 4,
    seq: 1,
    records: [stickerRecord()],
  })

  assert.equal(result.merged, 1)

  const written = replaced as ArmoryDocument | null
  assert.ok(written, 'the document must be written')

  const instance = written.profiles[0].items.find(item => item.id === 'ak-a')
  const attachments = instance?.attachments

  assert.ok(attachments)
  assert.equal(attachments!.origin, 'native')
  assert.equal(attachments!.observedInventoryRevision, 4)
  assert.equal(attachments!.stickers.length, 1)
  assert.deepEqual(attachments!.stickers[0], {
    slot: 0,
    kitId: 1234,
    wear: 0.12,
    scale: 1,
    rotation: 0,
    offsetX: 0.1,
    offsetY: -0.05,
    schema: 3,
  })
  assert.equal(ack.ackedSeq, 1)
})

test('rejects records from another profile instead of cross-writing them', async () => {
  const { result, replaced, ack } = await run({
    profileId: 'someone-else',
    inventoryRevision: 4,
    seq: 7,
    records: [stickerRecord()],
  })

  assert.equal(result.merged, 0)
  assert.equal(replaced, null)
  assert.equal(ack.ackedSeq, 7)
})

test('rejects records built from a different inventory revision', async () => {
  const { result, replaced } = await run({
    profileId: 'main',
    inventoryRevision: 3,
    seq: 2,
    records: [stickerRecord({ seq: 2 })],
  })

  assert.equal(result.merged, 0)
  assert.equal(replaced, null)
})

test('never replaces explicitly authored attachment data with an observation', async () => {
  const { result, replaced } = await run({
    profileId: 'main',
    inventoryRevision: 4,
    seq: 3,
    records: [stickerRecord({ seq: 3, instanceId: 'ak-manual' })],
  })

  assert.equal(result.merged, 0)
  assert.equal(replaced, null)
})

test('incomplete observations are skipped, not saved', async () => {
  const { result, replaced } = await run({
    profileId: 'main',
    inventoryRevision: 4,
    seq: 4,
    records: [stickerRecord({ seq: 4, complete: false })],
  })

  assert.equal(result.merged, 0)
  assert.equal(replaced, null)
})

test('a record for an unknown instance is skipped', async () => {
  const { result, replaced } = await run({
    profileId: 'main',
    inventoryRevision: 4,
    seq: 5,
    records: [stickerRecord({ seq: 5, instanceId: 'missing-instance' })],
  })

  assert.equal(result.merged, 0)
  assert.equal(replaced, null)
})

test('invalid attachment values are rejected by the contract validator', async () => {
  const { result, replaced } = await run({
    profileId: 'main',
    inventoryRevision: 4,
    seq: 6,
    records: [stickerRecord({
      seq: 6,
      attachments: {
        stickers: [{ slot: 9, kitId: 0, wear: 4, scale: 1, rotation: 0, offsetX: 0, offsetY: 0, schema: null }],
        charm: null,
      },
    })],
  })

  assert.equal(result.merged, 0)
  assert.equal(replaced, null)
})
