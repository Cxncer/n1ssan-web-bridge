import type { ArmoryDocument } from './contracts.ts'

export const ARMORY_EQUIPMENT_SCHEMA_VERSION = 1 as const
export type EquipmentTeam = 'T' | 'CT'
export type EquipmentSlot = 'weapon' | 'agent' | 'knife' | 'gloves' | 'zeus'

/** A loadout assignment points to an owned Armory instance, never a catalogue ID. */
export type EquippedItemAssignment = {
  /** Loadout Builder profile; allows several saved loadouts per Armory inventory. */
  loadoutProfileId: string
  team: EquipmentTeam
  slot: EquipmentSlot
  /** Weapon name for weapon slots; the slot name for agent/knife/gloves/zeus. */
  target: string
  itemInstanceId: string
}

export type ArmoryEquipmentDocument = {
  schemaVersion: typeof ARMORY_EQUIPMENT_SCHEMA_VERSION
  inventoryRevision: number
  profileId: string
  assignments: EquippedItemAssignment[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isTeam = (value: unknown): value is EquipmentTeam => value === 'T' || value === 'CT'
const isSlot = (value: unknown): value is EquipmentSlot =>
  value === 'weapon' || value === 'agent' || value === 'knife' || value === 'gloves' || value === 'zeus'

export function createEmptyEquipmentDocument(armory: ArmoryDocument): ArmoryEquipmentDocument {
  return {
    schemaVersion: ARMORY_EQUIPMENT_SCHEMA_VERSION,
    inventoryRevision: armory.revision,
    profileId: armory.activeProfileId,
    assignments: [],
  }
}

/** Validate assignments against the current active inventory snapshot. */
export function validateArmoryEquipmentDocument(
  value: unknown,
  armory: ArmoryDocument,
): string[] {
  if (!isRecord(value)) return ['document: expected an object']
  const errors: string[] = []
  if (value.schemaVersion !== ARMORY_EQUIPMENT_SCHEMA_VERSION) errors.push('schemaVersion: unsupported version')
  if (value.inventoryRevision !== armory.revision) errors.push('inventoryRevision: inventory changed; reload equipment before saving')
  if (value.profileId !== armory.activeProfileId) errors.push('profileId: must match the active Armory profile')
  if (!Array.isArray(value.assignments)) {
    errors.push('assignments: expected an array')
    return errors
  }
  if (value.assignments.length > 1000) errors.push('assignments: maximum of 1000 assignments exceeded')

  const profile = armory.profiles.find(entry => entry.id === armory.activeProfileId)
  const instances = new Map((profile?.items ?? []).map(item => [item.id, item]))
  const assignmentKeys = new Set<string>()
  const equippedInstances = new Set<string>()

  value.assignments.forEach((candidate, index) => {
    const prefix = `assignments[${index}]`
    if (!isRecord(candidate)) {
      errors.push(`${prefix}: expected an object`)
      return
    }
    if (typeof candidate.loadoutProfileId !== 'string' || !candidate.loadoutProfileId.trim()) errors.push(`${prefix}.loadoutProfileId: expected a non-empty Loadout Builder profile ID`)
    if (!isTeam(candidate.team)) errors.push(`${prefix}.team: expected T or CT`)
    if (!isSlot(candidate.slot)) errors.push(`${prefix}.slot: unsupported equipment slot`)
    if (typeof candidate.target !== 'string' || !candidate.target.trim()) {
      errors.push(`${prefix}.target: expected a non-empty target`)
    } else if (isSlot(candidate.slot) && candidate.slot !== 'weapon' && candidate.target !== candidate.slot) {
      errors.push(`${prefix}.target: non-weapon target must match its slot`)
    }
    if (typeof candidate.itemInstanceId !== 'string' || !candidate.itemInstanceId.trim()) {
      errors.push(`${prefix}.itemInstanceId: expected an Armory instance ID`)
      return
    }

    if (isTeam(candidate.team) && isSlot(candidate.slot) && typeof candidate.target === 'string' && candidate.target.trim()) {
      const key = [candidate.loadoutProfileId, candidate.team, candidate.slot, candidate.target.trim().toLowerCase()].join('|')
      if (assignmentKeys.has(key)) errors.push(`${prefix}: duplicate team/slot/target assignment`)
      assignmentKeys.add(key)
      const instanceKey = `${candidate.loadoutProfileId}|${candidate.team}|${candidate.itemInstanceId}`
      if (equippedInstances.has(instanceKey)) errors.push(`${prefix}.itemInstanceId: item is assigned more than once for this team`)
      equippedInstances.add(instanceKey)
    }

    const item = instances.get(candidate.itemInstanceId)
    if (!item) {
      errors.push(`${prefix}.itemInstanceId: item does not exist in the active profile`)
    } else if (item.kind !== 'skin' || item.quantity !== 1) {
      errors.push(`${prefix}.itemInstanceId: only individual skin instances can be equipped`)
    }
  })

  return errors
}

export function assertValidArmoryEquipmentDocument(
  value: unknown,
  armory: ArmoryDocument,
): asserts value is ArmoryEquipmentDocument {
  const errors = validateArmoryEquipmentDocument(value, armory)
  if (errors.length) throw new Error(`Invalid Armory equipment document: ${errors.join('; ')}`)
}
