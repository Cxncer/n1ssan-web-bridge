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
  const source = /knif|kniv/.test(item.type.toLowerCase()) ? 'n1ssan-knives' : 'n1ssan-skins'
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

export type ResolvedLoadoutSelections = {
  loadouts: Record<EquipmentTeam, Record<string, number | null>>
  equipment: Record<EquipmentTeam, Record<Exclude<EquipmentSlot, 'weapon'>, number | null>>
}

/** Resolves saved Armory assignments back to catalogue IDs for the existing UI. */
export function resolveProfileEquipmentSelections(
  document: ArmoryEquipmentDocument,
  profileId: string,
  catalogue: LoadoutCatalogueItem[],
  armory: ArmoryDocument,
): ResolvedLoadoutSelections {
  const inventory = armory.profiles.find(entry => entry.id === armory.activeProfileId)
  if (!inventory) throw new Error('The active Armory inventory profile could not be found.')
  const catalogueIds = new Map(catalogue.map(item => [definitionIdFor(item), item.id]))
  const loadouts: ResolvedLoadoutSelections['loadouts'] = { T: {}, CT: {} }
  const equipment: ResolvedLoadoutSelections['equipment'] = {
    T: { agent: null, knife: null, gloves: null, zeus: null },
    CT: { agent: null, knife: null, gloves: null, zeus: null },
  }

  for (const assignment of document.assignments.filter(item => item.loadoutProfileId === profileId)) {
    const instance = inventory.items.find(item => item.id === assignment.itemInstanceId)
    if (!instance) throw new Error('A saved assignment points to an item that is no longer in the active Armory inventory.')
    const catalogueId = catalogueIds.get(instance.definitionId)
    if (catalogueId === undefined) {
      throw new Error('A saved Armory item is not present in the current skin catalogue: ' + instance.definitionId)
    }
    if (assignment.slot === 'weapon') loadouts[assignment.team][assignment.target] = catalogueId
    else equipment[assignment.team][assignment.slot] = catalogueId
  }
  return { loadouts, equipment }
}
