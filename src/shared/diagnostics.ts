// n1ssan web / diagnostics client
// Reads the Bridge's consolidated diagnostics document (see bridge/diagnostics.ts).
// The codes and conditions mirror failure-taxonomy.md at the project root so the
// UI never invents its own failure vocabulary.

const BRIDGE_URL = 'http://127.0.0.1:3210'

export type DiagnosticCondition = 'READY' | 'DEGRADED' | 'STALE' | 'FAILED' | 'UNKNOWN'

export type DiagnosticSource = {
  id: string
  label: string
  condition: DiagnosticCondition
  code: string
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

export function isDiagnosticsDocument(value: unknown): value is DiagnosticsDocument {
  if (!value || typeof value !== 'object') return false
  const document = value as Partial<DiagnosticsDocument>
  return typeof document.protocol === 'number' && Array.isArray(document.sources)
}

export async function fetchDiagnostics(fetcher: typeof fetch = fetch): Promise<DiagnosticsDocument | null> {
  try {
    const response = await fetcher(`${BRIDGE_URL}/diagnostics`, { cache: 'no-store' })
    if (!response.ok) return null
    const payload: unknown = await response.json()
    return isDiagnosticsDocument(payload) ? payload : null
  } catch {
    return null
  }
}

export function conditionTone(condition: DiagnosticCondition): string {
  return condition.toLowerCase()
}
