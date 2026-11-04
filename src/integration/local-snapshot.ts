import type { ArmoryDocument, InventoryItemInstance } from '../armory/contracts.ts'
import {
  createEmptyEquipmentDocument,
  validateArmoryEquipmentDocument,
  type ArmoryEquipmentDocument,
  type EquippedItemAssignment,
} from '../armory/equipment.ts'

export const LOCAL_INTEGRATION_SCHEMA_VERSION = 2 as const

export type ResolvedEquipmentAssignment = EquippedItemAssignment & { item: InventoryItemInstance }

export type LegacySelectionItem = Record<string, unknown> & {
  id: number
  weapon: string
  name: string
  team: 'T' | 'CT'
  slot: 'weapon' | 'agent' | 'knife' | 'gloves' | 'zeus'
}

export type LegacyLoadoutInfo = {
  id: number
  profile: string
  team: 'T' | 'CT'
  teams: ('T' | 'CT')[]
  receivedAt: string
  itemCount: number
}

export type LocalIntegrationSnapshot = {
  contract: 'n1ssan.local-integration'
  schemaVersion: typeof LOCAL_INTEGRATION_SCHEMA_VERSION
  generatedAt: string
  inventory: {
    source: 'armory-api'
    schemaVersion: ArmoryDocument['schemaVersion']
    revision: number
    activeProfileId: string
    activeProfileItemCount: number
    profileCount: number
  }
  equipment: {
    source: 'armory-equipment-api'
    state: 'available' | 'empty' | 'stale'
    inventoryRevision: number
    profileId: string
    assignments: ResolvedEquipmentAssignment[]
    validationErrors: string[]
  }
  selection: {
    source: 'legacy-skins-api'
    state: 'available' | 'empty'
    loadout: LegacyLoadoutInfo | null
    items: LegacySelectionItem[]
  }
}

/** Build a read-only integration view without conflating canonical equipment and legacy selections. */
export function createLocalIntegrationSnapshot(
  armory: ArmoryDocument,
  selectedItems: LegacySelectionItem[],
  loadout: LegacyLoadoutInfo | null,
  generatedAt = new Date().toISOString(),
  equipment: ArmoryEquipmentDocument | null = null,
): LocalIntegrationSnapshot {
  const activeProfile = armory.profiles.find(profile => profile.id === armory.activeProfileId)
  const currentEquipment = equipment ?? createEmptyEquipmentDocument(armory)
  const validationErrors = validateArmoryEquipmentDocument(currentEquipment, armory)
  const resolvedAssignments: ResolvedEquipmentAssignment[] = []
  if (validationErrors.length === 0 && activeProfile) {
    currentEquipment.assignments.forEach((assignment, index) => {
      const item = activeProfile.items.find(candidate => candidate.id === assignment.itemInstanceId)
      if (!item) {
        validationErrors.push(`assignments[${index}].itemInstanceId: item could not be resolved`)
        return
      }
      resolvedAssignments.push({ ...structuredClone(assignment), item: structuredClone(item) })
    })
  }
  const equipmentState = validationErrors.length > 0
    ? 'stale'
    : resolvedAssignments.length > 0 ? 'available' : 'empty'

  return {
    contract: 'n1ssan.local-integration',
    schemaVersion: LOCAL_INTEGRATION_SCHEMA_VERSION,
    generatedAt,
    inventory: {
      source: 'armory-api',
      schemaVersion: armory.schemaVersion,
      revision: armory.revision,
      activeProfileId: armory.activeProfileId,
      activeProfileItemCount: activeProfile?.items.length ?? 0,
      profileCount: armory.profiles.length,
    },
    equipment: {
      source: 'armory-equipment-api',
      state: equipmentState,
      inventoryRevision: currentEquipment.inventoryRevision,
      profileId: currentEquipment.profileId,
      assignments: validationErrors.length ? [] : resolvedAssignments,
      validationErrors,
    },
    selection: {
      source: 'legacy-skins-api',
      state: loadout && selectedItems.length > 0 ? 'available' : 'empty',
      loadout: loadout ? structuredClone(loadout) : null,
      items: structuredClone(selectedItems),
    },
  }
}
