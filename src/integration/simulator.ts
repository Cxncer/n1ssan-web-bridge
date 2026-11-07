import type { InventoryItemInstance } from '../armory/contracts.ts'
import type { EquippedItemAssignment } from '../armory/equipment.ts'

export type ResolvedEquipmentAssignment = EquippedItemAssignment & { item: InventoryItemInstance }
export type IntegrationSimulationReport = {
  status: 'ready' | 'empty' | 'stale' | 'unsupported'
  schemaVersion: number | null
  inventoryRevision: number | null
  inventoryState: 'available' | 'empty' | 'invalid'
  inventoryItems: InventoryItemInstance[]
  assignments: ResolvedEquipmentAssignment[]
  errors: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function unsupported(schemaVersion: number | null, error: string): IntegrationSimulationReport {
  return { status: 'unsupported', schemaVersion, inventoryRevision: null, inventoryState: 'invalid', inventoryItems: [], assignments: [], errors: [error] }
}

/** Validates the local data hand-off only; it never attaches to or modifies CS2. */
export function simulateLocalIntegration(value: unknown): IntegrationSimulationReport {
  if (!isRecord(value) || value.contract !== 'n1ssan.local-integration' || value.schemaVersion !== 3 || !isRecord(value.inventory) || !isRecord(value.equipment)) {
    return unsupported(isRecord(value) && typeof value.schemaVersion === 'number' ? value.schemaVersion : null, 'Unsupported or malformed integration snapshot')
  }

  const inventory = value.inventory
  const equipment = value.equipment
  const inventoryRevision = Number.isSafeInteger(inventory.revision) ? inventory.revision as number : null
  if (
    inventoryRevision === null ||
    typeof inventory.activeProfileId !== 'string' ||
    !inventory.activeProfileId.trim() ||
    !Array.isArray(inventory.items) ||
    !Number.isSafeInteger(inventory.activeProfileItemCount) ||
    inventory.activeProfileItemCount !== inventory.items.length
  ) {
    return { status: 'stale', schemaVersion: 3, inventoryRevision, inventoryState: 'invalid', inventoryItems: [], assignments: [], errors: ['Inventory snapshot is missing items or its item count does not match'] }
  }

  const inventoryItems: InventoryItemInstance[] = []
  const inventoryById = new Map<string, InventoryItemInstance>()
  const inventoryErrors: string[] = []
  inventory.items.forEach((candidate, index) => {
    const prefix = `inventory.items[${index}]`
    if (!isRecord(candidate)) {
      inventoryErrors.push(`${prefix}: expected an item object`)
      return
    }
    if (typeof candidate.id !== 'string' || !candidate.id.trim()) inventoryErrors.push(`${prefix}.id: missing instance ID`)
    if (typeof candidate.definitionId !== 'string' || !candidate.definitionId.trim()) inventoryErrors.push(`${prefix}.definitionId: missing canonical definition ID`)
    if (!['skin', 'sticker', 'charm'].includes(String(candidate.kind))) inventoryErrors.push(`${prefix}.kind: unsupported item kind`)
    if (!Number.isSafeInteger(candidate.quantity) || (candidate.quantity as number) < 1) inventoryErrors.push(`${prefix}.quantity: expected a positive integer`)
    if (candidate.kind === 'skin' && candidate.quantity !== 1) inventoryErrors.push(`${prefix}.quantity: skins must be individual instances`)
    if (typeof candidate.createdAt !== 'string' || !Number.isFinite(Date.parse(candidate.createdAt))) inventoryErrors.push(`${prefix}.createdAt: invalid timestamp`)
    if (typeof candidate.updatedAt !== 'string' || !Number.isFinite(Date.parse(candidate.updatedAt))) inventoryErrors.push(`${prefix}.updatedAt: invalid timestamp`)
    const valid = typeof candidate.id === 'string' && !!candidate.id.trim() &&
      typeof candidate.definitionId === 'string' && !!candidate.definitionId.trim() &&
      ['skin', 'sticker', 'charm'].includes(String(candidate.kind)) &&
      Number.isSafeInteger(candidate.quantity) && (candidate.quantity as number) >= 1 &&
      !(candidate.kind === 'skin' && candidate.quantity !== 1) &&
      typeof candidate.createdAt === 'string' && Number.isFinite(Date.parse(candidate.createdAt)) &&
      typeof candidate.updatedAt === 'string' && Number.isFinite(Date.parse(candidate.updatedAt))
    if (valid) {
      if (inventoryById.has(candidate.id as string)) {
        inventoryErrors.push(`${prefix}.id: duplicate inventory instance ID`)
        return
      }
      const item = structuredClone(candidate) as unknown as InventoryItemInstance
      inventoryById.set(item.id, item)
      inventoryItems.push(item)
    }
  })
  if (inventoryErrors.length > 0) {
    return { status: 'stale', schemaVersion: 3, inventoryRevision, inventoryState: 'invalid', inventoryItems: [], assignments: [], errors: inventoryErrors }
  }

  const inventoryState = inventoryItems.length > 0 ? 'available' : 'empty'
  const equipmentRevision = Number.isSafeInteger(equipment.inventoryRevision) ? equipment.inventoryRevision as number : null
  if (equipmentRevision !== inventoryRevision || typeof equipment.profileId !== 'string' || equipment.profileId !== inventory.activeProfileId) {
    return { status: 'stale', schemaVersion: 3, inventoryRevision, inventoryState, inventoryItems, assignments: [], errors: ['Equipment profile or inventory revision does not match the inventory snapshot'] }
  }
  if (equipment.state === 'stale') {
    const details = Array.isArray(equipment.validationErrors) ? equipment.validationErrors.filter((entry): entry is string => typeof entry === 'string') : []
    return { status: 'stale', schemaVersion: 3, inventoryRevision, inventoryState, inventoryItems, assignments: [], errors: details.length ? details : ['Equipment snapshot is stale'] }
  }
  if (equipment.state === 'empty') {
    if (Array.isArray(equipment.assignments) && equipment.assignments.length === 0) {
      return { status: 'empty', schemaVersion: 3, inventoryRevision, inventoryState, inventoryItems, assignments: [], errors: [] }
    }
    return { status: 'stale', schemaVersion: 3, inventoryRevision, inventoryState, inventoryItems, assignments: [], errors: ['Empty equipment state contains assignments'] }
  }
  if (equipment.state !== 'available' || !Array.isArray(equipment.assignments)) return unsupported(3, 'Invalid equipment state or assignments')

  const errors: string[] = []
  const assignments: ResolvedEquipmentAssignment[] = []
  equipment.assignments.forEach((candidate, index) => {
    const prefix = `equipment.assignments[${index}]`
    if (!isRecord(candidate) || !isRecord(candidate.item)) {
      errors.push(`${prefix}: assignment or resolved item is missing`)
      return
    }
    const item = candidate.item
    if (typeof candidate.loadoutProfileId !== 'string' || !candidate.loadoutProfileId.trim()) errors.push(`${prefix}.loadoutProfileId: missing Loadout Builder profile`)
    if (candidate.team !== 'T' && candidate.team !== 'CT') errors.push(`${prefix}.team: invalid team`)
    if (!['weapon', 'agent', 'knife', 'gloves', 'zeus'].includes(String(candidate.slot))) errors.push(`${prefix}.slot: invalid slot`)
    if (typeof candidate.target !== 'string' || !candidate.target.trim()) errors.push(`${prefix}.target: missing target`)
    if (typeof candidate.itemInstanceId !== 'string' || item.id !== candidate.itemInstanceId) errors.push(`${prefix}.item: instance reference mismatch`)
    if (typeof candidate.itemInstanceId === 'string' && !inventoryById.has(candidate.itemInstanceId)) errors.push(`${prefix}.item: instance is not present in the active Armory inventory`)
    if (item.kind !== 'skin' || item.quantity !== 1) errors.push(`${prefix}.item: expected an individual skin instance`)
    if (typeof item.definitionId !== 'string' || !item.definitionId.trim()) errors.push(`${prefix}.item.definitionId: missing canonical definition`)
    if (
      (candidate.team === 'T' || candidate.team === 'CT') &&
      ['weapon', 'agent', 'knife', 'gloves', 'zeus'].includes(String(candidate.slot)) &&
      typeof candidate.target === 'string' && candidate.target.trim() &&
      typeof candidate.itemInstanceId === 'string' && item.id === candidate.itemInstanceId &&
      inventoryById.has(candidate.itemInstanceId) &&
      item.kind === 'skin' && item.quantity === 1 &&
      typeof item.definitionId === 'string' && item.definitionId.trim()
    ) {
      assignments.push({
        loadoutProfileId: candidate.loadoutProfileId as string,
        team: candidate.team,
        slot: candidate.slot as EquippedItemAssignment['slot'],
        target: candidate.target,
        itemInstanceId: candidate.itemInstanceId,
        item: structuredClone(item) as unknown as InventoryItemInstance,
      })
    }
  })
  return errors.length
    ? { status: 'stale', schemaVersion: 3, inventoryRevision, inventoryState, inventoryItems, assignments: [], errors }
    : { status: 'ready', schemaVersion: 3, inventoryRevision, inventoryState, inventoryItems, assignments, errors: [] }
}
