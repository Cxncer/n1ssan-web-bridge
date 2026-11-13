import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  buildDiagnostics,
  classifyDllStatus,
  parseStatusRecord,
  readInjectorOutcome,
  statusDirectories,
  worstCondition,
} from './diagnostics.ts'
import { armoryFailureCode } from '../src/shared/diagnostics.ts'

const NOW = Date.parse('2026-11-13T10:00:00Z')
const stamp = (offsetMs: number) => new Date(NOW + offsetMs).toISOString().replace(/\.\d{3}Z$/, 'Z')

const v1 = `N1SSAN_STATUS|1|${stamp(0)}|4242|build-3|READY|reason=runtime_worker_heartbeat`
const v2 = `N1SSAN_STATUS|2|${stamp(0)}|4242|build-3|DEGRADED|reason=optional_glove_schema_unavailable signatures=11/11|code=W_OPTIONAL_FEATURE_UNAVAILABLE`

test('status record parsing accepts protocol 1 records without a code field', () => {
  const record = parseStatusRecord(v1)
  assert.ok(record)
  assert.equal(record?.protocol, 1)
  assert.equal(record?.reason, 'runtime_worker_heartbeat')
  assert.equal(record?.code, '')
})

test('status record parsing reads the protocol 2 classification code', () => {
  const record = parseStatusRecord(v2)
  assert.equal(record?.protocol, 2)
  assert.equal(record?.state, 'DEGRADED')
  assert.equal(record?.code, 'W_OPTIONAL_FEATURE_UNAVAILABLE')
})

test('status record parsing rejects unknown protocols and malformed records', () => {
  assert.equal(parseStatusRecord('N1SSAN_STATUS|3|2026-11-13T10:00:00Z|1|b|READY|reason=x'), null)
  assert.equal(parseStatusRecord('N1SSAN_STATUS|1|2026-11-13T10:00:00Z|0|b|READY|reason=x'), null)
  assert.equal(parseStatusRecord('not a status record'), null)
  assert.equal(parseStatusRecord('N1SSAN_STATUS|1|2026-11-13T10:00:00Z|7|b|READY|noreason'), null)
})

test('a live heartbeat classifies as READY', () => {
  const result = classifyDllStatus(parseStatusRecord(v1), NOW + 5_000)
  assert.equal(result.condition, 'READY')
  assert.equal(result.code, 'OK')
})

test('a degraded runtime keeps its optional-feature code', () => {
  const result = classifyDllStatus(parseStatusRecord(v2), NOW + 5_000)
  assert.equal(result.condition, 'DEGRADED')
  assert.equal(result.code, 'W_OPTIONAL_FEATURE_UNAVAILABLE')
})

test('an expired heartbeat is STALE, never READY', () => {
  const result = classifyDllStatus(parseStatusRecord(v1), NOW + 45_000)
  assert.equal(result.condition, 'STALE')
  assert.equal(result.code, 'W_STATUS_STALE')
})

test('FAILED stays terminal and maps its code to a next action', () => {
  const failed = parseStatusRecord(
    `N1SSAN_STATUS|2|${stamp(0)}|4242|build-3|FAILED|reason=minhook_load_failed|code=E_MINHOOK_LOAD`,
  )
  const result = classifyDllStatus(failed, NOW + 120_000)
  assert.equal(result.condition, 'FAILED')
  assert.equal(result.code, 'E_MINHOOK_LOAD')
  assert.match(result.action, /MinHook\.dll/)
})

test('a missing record is unknown, not a failure', () => {
  assert.equal(classifyDllStatus(null).condition, 'UNKNOWN')
  assert.equal(classifyDllStatus(null).code, 'W_STATUS_MISSING')
})

test('the document takes the worst source condition', () => {
  assert.equal(worstCondition(['READY', 'DEGRADED', 'STALE']), 'DEGRADED')
  assert.equal(worstCondition([]), 'READY')
})

test('the document classifies the whole runtime from its sources', () => {
  const document = buildDiagnostics({
    dll: parseStatusRecord(v2),
    bridge: { online: true, runtimeMode: 'armory', armoryRevision: 12, itemCount: 8 },
    nowMs: NOW + 2_000,
  })

  assert.equal(document.protocol, 2)
  assert.equal(document.condition, 'DEGRADED')
  assert.deepEqual(document.sources.map(source => source.id), ['dll', 'bridge', 'injector'])
})

test('a dead Bridge is a failure with a Bridge code', () => {
  const document = buildDiagnostics({
    dll: null,
    bridge: { online: false, runtimeMode: 'armory', armoryRevision: 0, itemCount: 0 },
    nowMs: NOW,
  })

  assert.equal(document.condition, 'FAILED')
  assert.equal(document.sources.find(source => source.id === 'bridge')?.code, 'E_BRIDGE_UNAVAILABLE')
})

test('the injector outcome file is classified by the Bridge', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'n1ssan-injector-'))

  try {
    writeFileSync(
      path.join(directory, 'injector.json'),
      JSON.stringify({
        code: 'E_MODULE_REJECTED',
        ok: false,
        pid: 4242,
        message: 'CS2 unloaded the module',
        atUtc: '2026-11-13T10:00:00Z',
      }),
    )

    const outcome = readInjectorOutcome([directory])
    assert.equal(outcome?.code, 'E_MODULE_REJECTED')
    assert.equal(outcome?.message, 'CS2 unloaded the module')
    assert.equal(outcome?.updatedAt, '2026-11-13T10:00:00Z')

    const document = buildDiagnostics({
      dll: null,
      bridge: { online: true, runtimeMode: 'armory', armoryRevision: 1, itemCount: 0 },
      injectorOutcome: outcome,
      nowMs: NOW,
    })

    const injector = document.sources.find(source => source.id === 'injector')
    assert.equal(injector?.condition, 'FAILED')
    assert.equal(injector?.code, 'E_MODULE_REJECTED')
  }
  finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a missing injector outcome stays unknown', () => {
  assert.equal(readInjectorOutcome([path.join(tmpdir(), 'n1ssan-nonexistent-status')]), null)
})

test('Armory HTTP failures carry the shared taxonomy code', () => {
  assert.equal(armoryFailureCode(409, null), 'E_ARMORY_CONFLICT')
  assert.equal(armoryFailureCode(400, null), 'E_ARMORY_VALIDATION')
  assert.equal(armoryFailureCode(422, null), 'E_ARMORY_VALIDATION')
  assert.equal(armoryFailureCode(404, null), 'E_ARMORY_REJECTED')
  assert.equal(armoryFailureCode(0, null), 'E_ARMORY_UNAVAILABLE')
  assert.equal(armoryFailureCode(503, null), 'E_ARMORY_UNAVAILABLE')
  assert.equal(armoryFailureCode(409, 'E_CUSTOM'), 'E_CUSTOM')
})

test('status directories mirror the DLL and launcher lookup order', () => {
  const directories = statusDirectories(
    { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
    'C:\\Temp',
    'C:\\Users\\test',
  )
  assert.deepEqual(directories, [
    'C:\\Users\\test\\AppData\\Local\\n1ssan\\status',
    'C:\\Temp\\n1ssan\\status',
  ])
})
