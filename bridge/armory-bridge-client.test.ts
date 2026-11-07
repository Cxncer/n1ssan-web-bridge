import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ARMORY_BRIDGE_URL,
  ArmoryBridgeError,
  readArmoryDocument,
  writeArmoryDocument,
} from '../src/armory/bridge-client.ts'
import type { ArmoryDocument } from '../src/armory/contracts.ts'

const timestamp = '2026-11-04T00:00:00.000Z'

function document(revision = 0): ArmoryDocument {
  return {
    schemaVersion: 1,
    revision,
    activeProfileId: 'profile-main',
    profiles: [{
      id: 'profile-main',
      name: 'Main inventory',
      items: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('reads and validates the canonical Armory document from Bridge', async () => {
  const expected = document(3)
  let requestedUrl = ''

  const result = await readArmoryDocument(async input => {
    requestedUrl = String(input)
    return jsonResponse(200, { data: expected })
  })

  assert.equal(requestedUrl, `${ARMORY_BRIDGE_URL}/armory`)
  assert.deepEqual(result, expected)
})

test('writes a complete document with the expected revision', async () => {
  const candidate = document(4)
  const saved = document(5)
  let requestInit: RequestInit | undefined

  const result = await writeArmoryDocument(candidate, 4, async (_input, init) => {
    requestInit = init
    return jsonResponse(200, { data: saved })
  })

  assert.equal(requestInit?.method, 'PUT')
  assert.equal((requestInit?.headers as Record<string, string>)['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    expectedRevision: 4,
    data: candidate,
  })
  assert.deepEqual(result, saved)
})

test('preserves revision-conflict details from Bridge', async () => {
  await assert.rejects(
    writeArmoryDocument(document(2), 2, async () => jsonResponse(409, {
      error: {
        code: 'REVISION_CONFLICT',
        message: 'Armory changed since it was last read',
        details: ['Reload the latest Armory document before retrying'],
      },
    })),
    error => {
      assert.ok(error instanceof ArmoryBridgeError)
      assert.equal(error.status, 409)
      assert.equal(error.code, 'REVISION_CONFLICT')
      assert.deepEqual(error.details, ['Reload the latest Armory document before retrying'])
      return true
    },
  )
})

test('rejects malformed documents returned by Bridge', async () => {
  await assert.rejects(
    readArmoryDocument(async () => jsonResponse(200, {
      data: { schemaVersion: 1, revision: -1, profiles: [] },
    })),
    error => error instanceof ArmoryBridgeError && error.code === 'INVALID_RESPONSE',
  )
})

test('rejects a write when document and expected revisions differ', async () => {
  await assert.rejects(
    writeArmoryDocument(document(3), 2, async () => {
      assert.fail('Bridge must not be called for a mismatched local revision')
    }),
    error => error instanceof ArmoryBridgeError && /does not match/.test(error.message),
  )
})

test('reports a Bridge connection failure without pretending the write succeeded', async () => {
  await assert.rejects(
    readArmoryDocument(async () => { throw new Error('offline') }),
    error => error instanceof ArmoryBridgeError && error.code === 'CONNECTION_FAILED',
  )
})
