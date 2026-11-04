import type { ArmoryDocument } from './contracts.ts'
import {
  validateArmoryEquipmentDocument,
  type ArmoryEquipmentDocument,
} from './equipment.ts'

export const ARMORY_EQUIPMENT_BRIDGE_URL = 'http://127.0.0.1:3210'

export class ArmoryEquipmentBridgeError extends Error {
  readonly status: number
  readonly code: string | null
  readonly details: string[]

  constructor(message: string, status: number, code: string | null = null, details: string[] = []) {
    super(message)
    this.name = 'ArmoryEquipmentBridgeError'
    this.status = status
    this.code = code
    this.details = details
  }
}

type JsonRecord = Record<string, unknown>
type EquipmentFetcher = typeof fetch

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new ArmoryEquipmentBridgeError('The n1ssan Bridge returned an unreadable equipment response.', response.status)
  }
}

function responseError(payload: unknown, status: number): ArmoryEquipmentBridgeError {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {}
  return new ArmoryEquipmentBridgeError(
    typeof error.message === 'string' ? error.message : `Armory equipment request failed (HTTP ${status}).`,
    status,
    typeof error.code === 'string' ? error.code : null,
    Array.isArray(error.details) ? error.details.filter((detail): detail is string => typeof detail === 'string') : [],
  )
}

function extractEquipment(payload: unknown, status: number): ArmoryEquipmentDocument {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new ArmoryEquipmentBridgeError('The n1ssan Bridge returned an invalid equipment response.', status)
  }
  const data = payload.data
  if (
    data.schemaVersion !== 1 ||
    !Number.isSafeInteger(data.inventoryRevision) ||
    typeof data.profileId !== 'string' ||
    !Array.isArray(data.assignments)
  ) {
    throw new ArmoryEquipmentBridgeError('The n1ssan Bridge returned a malformed equipment document.', status, 'INVALID_RESPONSE')
  }
  return data as unknown as ArmoryEquipmentDocument
}

export async function readArmoryEquipment(
  armory: ArmoryDocument,
  fetcher: EquipmentFetcher = fetch,
): Promise<{ data: ArmoryEquipmentDocument; validationErrors: string[] }> {
  let response: Response
  try {
    response = await fetcher(`${ARMORY_EQUIPMENT_BRIDGE_URL}/armory/equipment`, { cache: 'no-store' })
  } catch {
    throw new ArmoryEquipmentBridgeError('Could not connect to the n1ssan Bridge. Make sure DOMINATE has started it.', 0, 'CONNECTION_FAILED')
  }
  const payload = await readJson(response)
  if (!response.ok) throw responseError(payload, response.status)
  const data = extractEquipment(payload, response.status)
  const serverErrors = isRecord(payload) && Array.isArray(payload.validationErrors)
    ? payload.validationErrors.filter((entry): entry is string => typeof entry === 'string')
    : []
  const validationErrors = validateArmoryEquipmentDocument(data, armory)
  return { data, validationErrors: serverErrors.length ? serverErrors : validationErrors }
}

export async function writeArmoryEquipment(
  document: ArmoryEquipmentDocument,
  armory: ArmoryDocument,
  fetcher: EquipmentFetcher = fetch,
): Promise<ArmoryEquipmentDocument> {
  const errors = validateArmoryEquipmentDocument(document, armory)
  if (errors.length) {
    throw new ArmoryEquipmentBridgeError(`Armory equipment validation failed: ${errors.join('; ')}`, 0, 'VALIDATION_FAILED', errors)
  }
  let response: Response
  try {
    response = await fetcher(`${ARMORY_EQUIPMENT_BRIDGE_URL}/armory/equipment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedInventoryRevision: armory.revision, data: document }),
    })
  } catch {
    throw new ArmoryEquipmentBridgeError('Could not connect to the n1ssan Bridge while saving equipment.', 0, 'CONNECTION_FAILED')
  }
  const payload = await readJson(response)
  if (!response.ok) throw responseError(payload, response.status)
  return extractEquipment(payload, response.status)
}
