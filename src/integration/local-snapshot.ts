import type { ArmoryDocument } from '../armory/contracts.ts'

export const LOCAL_INTEGRATION_SCHEMA_VERSION = 1 as const

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
  selection: {
    // This is deliberately separate from Armory inventory. The legacy /skins
    // endpoint does not carry canonical Armory instance IDs.
    source: 'legacy-skins-api'
    state: 'available' | 'empty'
    loadout: LegacyLoadoutInfo | null
    items: LegacySelectionItem[]
  }
}

/**
 * Creates a read-only local snapshot for integration tooling and simulators.
 * It does not translate inventory into equipped items: the current Bridge
 * stores those in separate APIs until an explicit equipment model exists.
 */
export function createLocalIntegrationSnapshot(
  armory: ArmoryDocument,
  selectedItems: LegacySelectionItem[],
  loadout: LegacyLoadoutInfo | null,
  generatedAt = new Date().toISOString(),
): LocalIntegrationSnapshot {
  const activeProfile = armory.profiles.find(
    profile => profile.id === armory.activeProfileId,
  )

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
    selection: {
      source: 'legacy-skins-api',
      state: loadout && selectedItems.length > 0 ? 'available' : 'empty',
      loadout: loadout ? structuredClone(loadout) : null,
      items: structuredClone(selectedItems),
    },
  }
}
