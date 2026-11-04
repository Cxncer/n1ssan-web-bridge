import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ArmoryDocument } from '../src/armory/contracts.ts'
import {
  createEmptyEquipmentDocument,
  validateArmoryEquipmentDocument,
  type ArmoryEquipmentDocument,
} from '../src/armory/equipment.ts'

export class EquipmentRevisionConflictError extends Error {
  constructor() { super('Armory inventory changed since equipment was last read'); this.name = 'EquipmentRevisionConflictError' }
}
export class EquipmentValidationError extends Error {
  readonly details: string[]
  constructor(details: string[]) { super('Armory equipment validation failed'); this.name = 'EquipmentValidationError'; this.details = details }
}

function isEquipmentDocumentShape(value: unknown): value is ArmoryEquipmentDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    (value as Record<string, unknown>).schemaVersion === 1 &&
    Number.isSafeInteger((value as Record<string, unknown>).inventoryRevision) &&
    typeof (value as Record<string, unknown>).profileId === 'string' &&
    Array.isArray((value as Record<string, unknown>).assignments)
}

export class ArmoryEquipmentStore {
  private document!: ArmoryEquipmentDocument
  private writeQueue: Promise<void> = Promise.resolve()
  constructor(private readonly filePath: string) {}

  async initialize(armory: ArmoryDocument): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (!isEquipmentDocumentShape(parsed)) {
        throw new Error('Invalid Armory equipment file structure')
      }
      // Keep structurally readable but stale assignments visible to GET/snapshot
      // diagnostics. They cannot be saved or consumed until revalidated.
      this.document = parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.document = createEmptyEquipmentDocument(armory)
      await this.persist(this.document, false)
    }
  }

  read(): ArmoryEquipmentDocument { return structuredClone(this.document) }

  replace(expectedInventoryRevision: number, candidate: unknown, armory: ArmoryDocument): Promise<ArmoryEquipmentDocument> {
    const operation = this.writeQueue.then(async () => {
      if (expectedInventoryRevision !== armory.revision) throw new EquipmentRevisionConflictError()
      if (!candidate || typeof candidate !== 'object' || (candidate as Record<string, unknown>).inventoryRevision !== expectedInventoryRevision) {
        throw new EquipmentValidationError(['inventoryRevision: must match expectedInventoryRevision'])
      }
      const errors = validateArmoryEquipmentDocument(candidate, armory)
      if (errors.length) throw new EquipmentValidationError(errors)
      const next = structuredClone(candidate as ArmoryEquipmentDocument)
      await this.persist(next)
      this.document = next
      return structuredClone(next)
    })
    this.writeQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async persist(document: ArmoryEquipmentDocument, backupCurrent = true): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    if (backupCurrent) {
      try { await copyFile(this.filePath, `${this.filePath}.bak`) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    await rename(temporaryPath, this.filePath)
  }
}
