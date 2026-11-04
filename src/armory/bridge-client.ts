import {
  validateArmoryDocument,
  type ArmoryDocument,
} from './contracts.ts'

export const ARMORY_BRIDGE_URL = 'http://127.0.0.1:3210'

export class ArmoryBridgeError extends Error {
  readonly status: number
  readonly code: string | null
  readonly details: string[]

  constructor(message: string, status: number, code: string | null = null, details: string[] = []) {
    super(message)
    this.name = 'ArmoryBridgeError'
    this.status = status
    this.code = code
    this.details = details
  }
}

type JsonRecord = Record<string, unknown>
type ArmoryFetcher = typeof fetch

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new ArmoryBridgeError(
      'The n1ssan Bridge returned an unreadable response.',
      response.status,
    )
  }
}

function responseError(payload: unknown, status: number): ArmoryBridgeError {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {}
  const message = typeof error.message === 'string'
    ? error.message
    : `Armory request failed (HTTP ${status}).`
  const code = typeof error.code === 'string' ? error.code : null
  const details = Array.isArray(error.details)
    ? error.details.filter((detail): detail is string => typeof detail === 'string')
    : []
  return new ArmoryBridgeError(message, status, code, details)
}

function extractDocument(payload: unknown, status: number): ArmoryDocument {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new ArmoryBridgeError('The n1ssan Bridge returned an invalid Armory response.', status)
  }

  const errors = validateArmoryDocument(payload.data)
  if (errors.length > 0) {
    throw new ArmoryBridgeError(
      `The n1ssan Bridge returned an invalid Armory document: ${errors.join('; ')}`,
      status,
      'INVALID_RESPONSE',
      errors,
    )
  }

  return payload.data as unknown as ArmoryDocument
}

export async function readArmoryDocument(
  fetcher: ArmoryFetcher = fetch,
): Promise<ArmoryDocument> {
  let response: Response
  try {
    response = await fetcher(`${ARMORY_BRIDGE_URL}/armory`)
  } catch {
    throw new ArmoryBridgeError(
      'Could not connect to the n1ssan Bridge. Make sure DOMINATE has started it.',
      0,
      'CONNECTION_FAILED',
    )
  }

  const payload = await readJson(response)
  if (!response.ok) throw responseError(payload, response.status)
  return extractDocument(payload, response.status)
}

export async function writeArmoryDocument(
  document: ArmoryDocument,
  expectedRevision: number,
  fetcher: ArmoryFetcher = fetch,
): Promise<ArmoryDocument> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new ArmoryBridgeError('Armory expectedRevision must be a non-negative safe integer.', 0)
  }
  if (document.revision !== expectedRevision) {
    throw new ArmoryBridgeError('Armory document revision does not match expectedRevision.', 0)
  }

  let response: Response
  try {
    response = await fetcher(`${ARMORY_BRIDGE_URL}/armory`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision, data: document }),
    })
  } catch {
    throw new ArmoryBridgeError(
      'Could not connect to the n1ssan Bridge while saving Armory.',
      0,
      'CONNECTION_FAILED',
    )
  }

  const payload = await readJson(response)
  if (!response.ok) throw responseError(payload, response.status)
  return extractDocument(payload, response.status)
}
