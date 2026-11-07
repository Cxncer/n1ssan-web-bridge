import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import type {
  LoadoutSelectionSnapshot,
  RuntimeEquipmentSlot,
  RuntimeTeam,
  SelectionId,
} from '../src/armory/runtime-config.ts'

export type StoredLoadoutProfile = LoadoutSelectionSnapshot & {
  id: string
  name: string
  updatedAt: string
}

export type LoadoutProfilesDocument = {
  schemaVersion: 1
  activeProfileId: string
  profiles: StoredLoadoutProfile[]
}

export class LoadoutValidationError extends Error {
  readonly details: string[]

  constructor(details: string[]) {
    super('Loadout profile validation failed')
    this.name = 'LoadoutValidationError'
    this.details = details
  }
}

const TEAMS: RuntimeTeam[] = ['T', 'CT']
const EQUIPMENT_SLOTS: RuntimeEquipmentSlot[] = ['agent', 'knife', 'gloves', 'zeus']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSelectionId(value: unknown): value is SelectionId | null {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

function isSettings(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.float === 'number' && Number.isFinite(value.float) &&
    typeof value.seed === 'number' && Number.isFinite(value.seed)
}

export function validateLoadoutSelection(value: unknown): string[] {
  const errors: string[] = []

  if (!isRecord(value)) return ['expected a Loadout selection object']

  if (!isRecord(value.loadouts)) {
    errors.push('loadouts: expected an object')
  } else {
    for (const team of TEAMS) {
      const teamLoadouts = value.loadouts[team]

      if (!isRecord(teamLoadouts)) {
        errors.push(`loadouts.${team}: expected an object`)
        continue
      }

      for (const [weapon, id] of Object.entries(teamLoadouts)) {
        if (!weapon.trim()) errors.push(`loadouts.${team}: empty weapon key`)
        if (!isSelectionId(id)) errors.push(`loadouts.${team}.${weapon}: expected a catalogue id or null`)
      }
    }
  }

  if (!isRecord(value.equipment)) {
    errors.push('equipment: expected an object')
  } else {
    for (const team of TEAMS) {
      const teamEquipment = value.equipment[team]

      if (!isRecord(teamEquipment)) {
        errors.push(`equipment.${team}: expected an object`)
        continue
      }

      for (const slot of EQUIPMENT_SLOTS) {
        if (!isSelectionId(teamEquipment[slot])) {
          errors.push(`equipment.${team}.${slot}: expected a catalogue id or null`)
        }
      }
    }
  }

  if (value.skinSettings !== undefined) {
    if (!isRecord(value.skinSettings)) {
      errors.push('skinSettings: expected an object')
    } else {
      for (const team of TEAMS) {
        const teamSettings = value.skinSettings[team]

        if (teamSettings === undefined) continue
        if (!isRecord(teamSettings)) {
          errors.push(`skinSettings.${team}: expected an object`)
          continue
        }

        for (const [key, settings] of Object.entries(teamSettings)) {
          if (!isSettings(settings)) {
            errors.push(`skinSettings.${team}.${key}: expected { float, seed } numbers`)
          }
        }
      }
    }
  }

  return errors
}

/**
 * Persists Loadout profiles independently of Armory. Loadout only references
 * shared catalogue IDs; nothing here is an inventory instance.
 */
export class LoadoutProfilesStore {
  private document: LoadoutProfilesDocument = {
    schemaVersion: 1,
    activeProfileId: '',
    profiles: [],
  }

  private writeQueue: Promise<void> = Promise.resolve()
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async initialize(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))

      if (isRecord(parsed) && parsed.schemaVersion === 1 &&
          typeof parsed.activeProfileId === 'string' && Array.isArray(parsed.profiles)) {
        this.document = parsed as LoadoutProfilesDocument
        return
      }

      throw new Error('Invalid Loadout profiles file structure')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // A started store must never be silently empty; recover the backup if present.
        try {
          const backup: unknown = JSON.parse(await readFile(`${this.filePath}.bak`, 'utf8'))

          if (isRecord(backup) && backup.schemaVersion === 1 && Array.isArray(backup.profiles)) {
            this.document = backup as LoadoutProfilesDocument
            return
          }
        } catch {
          // Fall through to the empty document only when there is no readable data.
        }
      }
    }
  }

  read(): LoadoutProfilesDocument {
    return structuredClone(this.document)
  }

  active(): StoredLoadoutProfile | null {
    const profile = this.document.profiles.find(item => item.id === this.document.activeProfileId)
    return profile ? structuredClone(profile) : null
  }

  saveProfile(input: {
    id: string
    name: string
    loadouts: LoadoutSelectionSnapshot['loadouts']
    equipment: LoadoutSelectionSnapshot['equipment']
    skinSettings?: LoadoutSelectionSnapshot['skinSettings']
  }): Promise<StoredLoadoutProfile> {
    const operation = this.writeQueue.then(async () => {
      const errors = validateLoadoutSelection(input)

      if (!input.id.trim()) errors.push('profileId: expected a non-empty Loadout profile ID')
      if (!input.name.trim()) errors.push('name: expected a non-empty Loadout profile name')
      if (errors.length) throw new LoadoutValidationError(errors)

      const profile: StoredLoadoutProfile = {
        id: input.id.trim(),
        name: input.name.trim(),
        loadouts: input.loadouts,
        equipment: input.equipment,
        ...(input.skinSettings ? { skinSettings: input.skinSettings } : {}),
        updatedAt: new Date().toISOString(),
      }

      const profiles = this.document.profiles.filter(item => item.id !== profile.id)
      profiles.push(profile)
      this.document = {
        schemaVersion: 1,
        activeProfileId: profile.id,
        profiles,
      }

      await this.persist()
      return structuredClone(profile)
    })

    this.writeQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async persist(): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(this.document, null, 2)}\n`, 'utf8')

    try {
      await copyFile(this.filePath, `${this.filePath}.bak`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    await rename(temporaryPath, this.filePath)
  }
}
