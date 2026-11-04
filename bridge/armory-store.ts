import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  ARMORY_SCHEMA_VERSION,
  validateArmoryDocument,
  type ArmoryDocument,
} from '../src/armory/contracts.ts'

export class ArmoryRevisionConflictError extends Error {
  constructor() {
    super('Armory changed since it was last read')
    this.name = 'ArmoryRevisionConflictError'
  }
}

export class ArmoryValidationError extends Error {
  readonly details: string[]

  constructor(details: string[]) {
    super('Armory document validation failed')
    this.name = 'ArmoryValidationError'
    this.details = details
  }
}

function createEmptyDocument(): ArmoryDocument {
  const now = new Date().toISOString()
  return {
    schemaVersion: ARMORY_SCHEMA_VERSION,
    revision: 0,
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

function cloneDocument(document: ArmoryDocument): ArmoryDocument {
  return structuredClone(document)
}

export class ArmoryStore {
  private document: ArmoryDocument = createEmptyDocument()
  private writeQueue: Promise<void> = Promise.resolve()

  private readonly filePath: string

constructor(filePath: string) {
  this.filePath = filePath
}

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })

    try {
      this.document = await this.readDocument(this.filePath)
      return
    } catch (primaryError) {
      if ((primaryError as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          this.document = await this.readDocument(`${this.filePath}.bak`)
          await this.persist(this.document, false)
          return
        } catch (backupError) {
          if ((backupError as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw new Error('Armory primary and backup files could not be restored', {
              cause: backupError,
            })
          }

          this.document = createEmptyDocument()
          await this.persist(this.document)
          return
        }
      }

      try {
        this.document = await this.readDocument(`${this.filePath}.bak`)
      } catch (backupError) {
        throw new Error('Armory storage is invalid and its backup is unavailable', {
          cause: backupError,
        })
      }

      // Keep the invalid primary file intact; persist the validated backup.
      const damagedPath = `${this.filePath}.corrupt-${Date.now()}`
      await copyFile(this.filePath, damagedPath)
      await this.persist(this.document, false)
    }
  }

  read(): ArmoryDocument {
    return cloneDocument(this.document)
  }

  replace(expectedRevision: number, candidate: unknown): Promise<ArmoryDocument> {
    const operation = this.writeQueue.then(async () => {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new ArmoryValidationError(['expectedRevision: expected a non-negative safe integer'])
      }

      if (expectedRevision !== this.document.revision) {
        throw new ArmoryRevisionConflictError()
      }

      const errors = validateArmoryDocument(candidate)
      if (errors.length > 0) throw new ArmoryValidationError(errors)

      if (
        typeof candidate !== 'object' ||
        candidate === null ||
        (candidate as Record<string, unknown>).revision !== expectedRevision
      ) {
        throw new ArmoryValidationError([
          'data.revision: must match expectedRevision',
        ])
      }

      const next = {
        ...(candidate as ArmoryDocument),
        revision: this.document.revision + 1,
      }

      const nextErrors = validateArmoryDocument(next)
      if (nextErrors.length > 0) throw new ArmoryValidationError(nextErrors)

      await this.persist(next)
      this.document = next
      return cloneDocument(next)
    })

    this.writeQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async readDocument(filePath: string): Promise<ArmoryDocument> {
    const contents = await readFile(filePath, 'utf8')
    const parsed: unknown = JSON.parse(contents)
    const errors = validateArmoryDocument(parsed)

    if (errors.length > 0) {
      throw new ArmoryValidationError(errors)
    }

    return parsed as ArmoryDocument
  }

  private async persist(document: ArmoryDocument, backupCurrent = true): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp`
    const backupPath = `${this.filePath}.bak`

    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')

    if (backupCurrent) {
      try {
        await copyFile(this.filePath, backupPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }

    await rename(temporaryPath, this.filePath)
  }
}
