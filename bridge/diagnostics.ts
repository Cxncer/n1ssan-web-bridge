// n1ssan Bridge / diagnostics
// One classification pass over every runtime status source so the Launcher,
// Bridge, and UI describe a fault with the same code and the same next action.
// The failure taxonomy is documented in failure-taxonomy.md at the project root.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const STATUS_PROTOCOL = 2
export const HEARTBEAT_TIMEOUT_MS = 30_000

export type DiagnosticCondition = 'READY' | 'DEGRADED' | 'STALE' | 'FAILED' | 'UNKNOWN'

export type DiagnosticCode =
  | 'OK'
  | 'W_STATUS_MISSING'
  | 'W_STATUS_STALE'
  | 'W_OPTIONAL_FEATURE_UNAVAILABLE'
  | 'W_STATUS_PROTOCOL'
  | 'E_STATUS_INVALID'
  | 'E_DLL_INIT_FAILED'
  | 'E_BRIDGE_UNAVAILABLE'

export type DllStatusRecord = {
  protocol: number
  timestamp: string
  processId: number
  buildId: string
  state: string
  reason: string
  code: string
}

export type DiagnosticSource = {
  id: 'dll' | 'bridge' | 'injector'
  label: string
  condition: DiagnosticCondition
  code: DiagnosticCode
  message: string
  action: string
  updatedAt: string | null
}

export type DiagnosticsDocument = {
  protocol: number
  generatedAt: string
  condition: DiagnosticCondition
  sources: DiagnosticSource[]
}

const STATUS_FIELD_COUNT_V1 = 7
const STATUS_FIELD_COUNT_V2 = 8

export function parseStatusRecord(line: string): DllStatusRecord | null {
  const text = line.trim()
  if (!text) return null

  const fields = text.split('|')
  if (fields[0] !== 'N1SSAN_STATUS') return null
  if (fields.length !== STATUS_FIELD_COUNT_V1 && fields.length !== STATUS_FIELD_COUNT_V2) return null

  const protocol = Number(fields[1])
  if (!Number.isInteger(protocol) || protocol < 1 || protocol > STATUS_PROTOCOL) return null

  const processId = Number(fields[3])
  if (!Number.isInteger(processId) || processId <= 0) return null

  if (!fields[6].startsWith('reason=')) return null

  const reason = fields[6].slice('reason='.length)
  if (!reason) return null

  let code = ''
  if (fields.length === STATUS_FIELD_COUNT_V2 && fields[7].startsWith('code='))
    code = fields[7].slice('code='.length)

  return {
    protocol,
    timestamp: fields[2],
    processId,
    buildId: fields[4],
    state: fields[5].trim(),
    reason,
    code,
  }
}

const DLL_FAILURE_ACTIONS: Record<string, string> = {
  E_MINHOOK_LOAD: 'Check that MinHook.dll sits next to n1ssan-dll.dll and re-inject.',
  E_CLIENT_MODULE: 'Wait for Counter-Strike 2 to finish loading, then re-inject.',
  E_BRIDGE_DIRECTORY: 'Start the Bridge from the launcher so the DLL can find its runtime directory.',
  E_FUNCTION_RESOLUTION: 'The build predates this CS2 update. Update signatures before injecting.',
  E_INVENTORY_RUNTIME: 'Close CS2, restart it with -allow_third_party_software, then re-inject.',
  E_FSN_HOOK: 'Another module already hooks FrameStageNotify. Close overlay software and re-inject.',
  E_MODE_WORKER: 'Restart CS2; the runtime-mode worker thread could not be created.',
}

function resolveAction(code: string): string {
  return DLL_FAILURE_ACTIONS[code] ?? 'Review the DLL session log in %LOCALAPPDATA%\\n1ssan\\logs.'
}

export function classifyDllStatus(
  record: DllStatusRecord | null,
  nowMs: number = Date.now(),
): { condition: DiagnosticCondition; code: DiagnosticCode; message: string; action: string; updatedAt: string | null } {
  if (!record) {
    return {
      condition: 'UNKNOWN',
      code: 'W_STATUS_MISSING',
      message: 'No DLL status record yet',
      action: 'Start Counter-Strike 2 and apply from the launcher so the DLL can publish a status record.',
      updatedAt: null,
    }
  }

  const reported = Date.parse(record.timestamp)
  const age = Number.isFinite(reported) ? nowMs - reported : Number.POSITIVE_INFINITY
  const updatedAt = Number.isFinite(reported) ? new Date(reported).toISOString() : null

  if (!Number.isFinite(age)) {
    return {
      condition: 'UNKNOWN',
      code: 'E_STATUS_INVALID',
      message: `Unreadable status timestamp · ${record.reason}`,
      action: 'The status record is corrupt; re-inject the DLL to rewrite it.',
      updatedAt,
    }
  }

  // FAILED is terminal for the session: it stays meaningful after the worker exits.
  if (record.state === 'FAILED') {
    return {
      condition: 'FAILED',
      code: (record.code || 'E_DLL_INIT_FAILED') as DiagnosticCode,
      message: `DLL initialization failed · ${record.reason}`,
      action: record.code ? resolveAction(record.code) : resolveAction(''),
      updatedAt,
    }
  }

  if (age > HEARTBEAT_TIMEOUT_MS) {
    return {
      condition: 'STALE',
      code: 'W_STATUS_STALE',
      message: `DLL status stale (${Math.max(0, Math.round(age / 1000))}s since the last heartbeat)`,
      action: 'CS2 may have closed or the DLL unloaded. Confirm the game is running, then re-inject.',
      updatedAt,
    }
  }

  switch (record.state) {
    case 'READY':
      return {
        condition: 'READY',
        code: 'OK',
        message: `DLL ready · ${record.reason}`,
        action: 'No action required.',
        updatedAt,
      }
    case 'DEGRADED':
      return {
        condition: 'DEGRADED',
        code: (record.code || 'W_OPTIONAL_FEATURE_UNAVAILABLE') as DiagnosticCode,
        message: `DLL ready with a missing optional feature · ${record.reason}`,
        action: 'Skins and attachments still apply; glove schema support needs a signature refresh.',
        updatedAt,
      }
    case 'CHECKS_PASSED':
      return {
        condition: 'READY',
        code: (record.code || 'OK') as DiagnosticCode,
        message: 'Initialization checks passed · awaiting the first heartbeat',
        action: 'No action required.',
        updatedAt,
      }
    case 'INITIALIZING':
      return {
        condition: 'UNKNOWN',
        code: 'OK',
        message: 'DLL initializing',
        action: 'No action required.',
        updatedAt,
      }
    default:
      return {
        condition: 'UNKNOWN',
        code: 'E_STATUS_INVALID',
        message: `Unknown DLL state "${record.state}"`,
        action: 'The DLL and this Bridge disagree about the status contract; update both components.',
        updatedAt,
      }
  }
}

export function statusDirectories(
  env: NodeJS.ProcessEnv = process.env,
  tempDirectory: string = os.tmpdir(),
  homeDirectory: string = os.homedir(),
): string[] {
  const local = env.LOCALAPPDATA ?? path.join(homeDirectory, 'AppData', 'Local')
  return [
    path.join(local, 'n1ssan', 'status'),
    path.join(tempDirectory, 'n1ssan', 'status'),
  ]
}

export function readLatestDllStatus(
  directories: string[] = statusDirectories(),
): { record: DllStatusRecord; file: string } | null {
  for (const directory of directories) {
    let files: string[]
    try {
      files = readdirSync(directory).filter(name => /^cs2-\d+\.status$/.test(name))
    } catch {
      continue
    }

    let newest: { file: string; mtime: number } | null = null
    for (const name of files) {
      const file = path.join(directory, name)
      try {
        const mtime = statSync(file).mtimeMs
        if (!newest || mtime > newest.mtime) newest = { file, mtime }
      } catch {
        // A status file being replaced mid-listing is not an error.
      }
    }

    if (!newest) continue

    try {
      const record = parseStatusRecord(readFileSync(newest.file, 'utf8'))
      if (record) return { record, file: newest.file }
    } catch {
      // Fall through to the next directory.
    }
  }

  return null
}

export type BuildDiagnosticsInput = {
  dll: DllStatusRecord | null
  bridge: { online: boolean; runtimeMode: string; armoryRevision: number; itemCount: number }
  injectorOutcome?: { code: string; message: string; updatedAt: string | null } | null
  nowMs?: number
}

const SEVERITY: Record<DiagnosticCondition, number> = {
  READY: 0,
  UNKNOWN: 1,
  STALE: 2,
  DEGRADED: 3,
  FAILED: 4,
}

export function worstCondition(conditions: DiagnosticCondition[]): DiagnosticCondition {
  return conditions.reduce<DiagnosticCondition>(
    (worst, next) => (SEVERITY[next] > SEVERITY[worst] ? next : worst),
    'READY',
  )
}

export function buildDiagnostics(input: BuildDiagnosticsInput): DiagnosticsDocument {
  const nowMs = input.nowMs ?? Date.now()
  const dll = classifyDllStatus(input.dll, nowMs)

  const sources: DiagnosticSource[] = [
    {
      id: 'dll',
      label: 'Native runtime',
      condition: dll.condition,
      code: dll.code,
      message: dll.message,
      action: dll.action,
      updatedAt: dll.updatedAt,
    },
    {
      id: 'bridge',
      label: 'Bridge connection',
      condition: input.bridge.online ? 'READY' : 'FAILED',
      code: input.bridge.online ? 'OK' : 'E_BRIDGE_UNAVAILABLE',
      message: input.bridge.online
        ? `Bridge online · ${input.bridge.runtimeMode} mode · revision ${input.bridge.armoryRevision}`
        : 'Bridge API is not reachable',
      action: input.bridge.online
        ? 'No action required.'
        : 'Start the launcher (or the Bridge) before opening the Armory.',
      updatedAt: new Date(nowMs).toISOString(),
    },
    {
      id: 'injector',
      label: 'Loader result',
      condition: input.injectorOutcome
        ? (input.injectorOutcome.code === 'OK' ? 'READY' : 'FAILED')
        : 'UNKNOWN',
      code: (input.injectorOutcome?.code ?? 'W_STATUS_MISSING') as DiagnosticCode,
      message: input.injectorOutcome?.message ?? 'No injector result recorded for this session',
      action: input.injectorOutcome?.code === 'OK'
        ? 'No action required.'
        : 'Injection is reported by the launcher; re-run Apply to retry.',
      updatedAt: input.injectorOutcome?.updatedAt ?? null,
    },
  ]

  return {
    protocol: STATUS_PROTOCOL,
    generatedAt: new Date(nowMs).toISOString(),
    condition: worstCondition(sources.map(source => source.condition)),
    sources,
  }
}
