import type { ArmoryDocument } from './contracts.ts'
import type { ArmoryEquipmentDocument, EquippedItemAssignment, EquipmentSlot, EquipmentTeam } from './equipment.ts'
import { catalogueDefinitionId } from './catalogue-identity.ts'

export type LoadoutCatalogueItem = {
  id: number
  weapon: string
  type: string
}

export type LoadoutSelection = {
  loadoutProfileId: string
  loadouts: Record<EquipmentTeam, Record<string, number | null>>
  equipment: Record<EquipmentTeam, Record<Exclude<EquipmentSlot, 'weapon'>, number | null>>
}

const equipmentSlots = ['agent', 'knife', 'gloves', 'zeus'] as const

function definitionIdFor(item: LoadoutCatalogueItem): string {
  const source = item.type.toLowerCase().includes('knife') ? 'n1ssan-knives' : 'n1ssan-skins'
  return catalogueDefinitionId('skin', item.id, source)
}

/**
 * Converts catalogue selections into owned Armory instance assignments.
 * It never creates inventory items and never treats catalogue IDs as instance IDs.
 */
export function buildProfileEquipmentAssignments(
  selection: LoadoutSelection,
  catalogue: LoadoutCatalogueItem[],
  armory: ArmoryDocument,
): EquippedItemAssignment[] {
  const profile = armory.profiles.find(entry => entry.id === armory.activeProfileId)
  if (!profile) throw new Error('The active Armory inventory profile could not be found.')
  const definitions = new Map(catalogue.map(item => [item.id, item]))
  const byDefinition = new Map<string, string[]>()
  for (const item of profile.items) {
    if (item.kind !== 'skin' || item.quantity !== 1) continue
    const ids = byDefinition.get(item.definitionId) ?? []
    ids.push(item.id)
    byDefinition.set(item.definitionId, ids)
  }

  const assignments: EquippedItemAssignment[] = []
  for (const team of ['T', 'CT'] as const) {
    const usedInstances = new Set<string>()
    const add = (slot: EquipmentSlot, target: string, catalogueId: number | null) => {
      if (catalogueId === null) return
      const item = definitions.get(catalogueId)
      if (!item) throw new Error(`Selected catalogue item ${catalogueId} is no longer available.`)
      const definitionId = definitionIdFor(item)
      const instanceId = (byDefinition.get(definitionId) ?? []).find(id => !usedInstances.has(id))
      if (!instanceId) {
        throw new Error(`${team} · ${target}: ${item.weapon} | catalogue item #${catalogueId} is not owned in the active Armory inventory.`)
      }
      usedInstances.add(instanceId)
      assignments.push({
        loadoutProfileId: selection.loadoutProfileId,
        team,
        slot,
        target,
        itemInstanceId: instanceId,
      })
    }

    for (const [weapon, catalogueId] of Object.entries(selection.loadouts[team])) {
      add('weapon', weapon, catalogueId)
    }
    for (const slot of equipmentSlots) {
      add(slot, slot, selection.equipment[team][slot])
    }
  }
  return assignments
}

/** Replaces one Loadout Builder profile without disturbing other saved profiles. */
export function replaceProfileEquipmentAssignments(
  document: ArmoryEquipmentDocument,
  profileId: string,
  assignments: EquippedItemAssignment[],
): ArmoryEquipmentDocument {
  return {
    ...document,
    assignments: [
      ...document.assignments.filter(item => item.loadoutProfileId !== profileId),
      ...assignments,
    ],
  }
}
