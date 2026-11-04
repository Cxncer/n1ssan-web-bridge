import type { InventoryItemInstance } from '../armory/contracts.ts'
import type { EquippedItemAssignment } from '../armory/equipment.ts'

export type ResolvedEquipmentAssignment = EquippedItemAssignment & {
  item: InventoryItemInstance
}

export type IntegrationSimulationReport = {
  status: 'ready' | 'empty' | 'stale' | 'unsupported'
  schemaVersion: number | null
  inventoryRevision: number | null
  assignments: ResolvedEquipmentAssignment[]
  errors: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Validates the local data hand-off only; it never attaches to or modifies CS2. */
export function simulateLocalIntegration(value: unknown): IntegrationSimulationReport {
  if (!isRecord(value) || value.contract !== 'n1ssan.local-integration' || value.schemaVersion !== 2 || !isRecord(value.equipment)) {
    return { status: 'unsupported', schemaVersion: isRecord(value) && typeof value.schemaVersion === 'number' ? value.schemaVersion : null, inventoryRevision: null, assignments: [], errors: ['Unsupported or malformed integration snapshot'] }
  }

  const equipment = value.equipment
  const inventoryRevision = isRecord(value.inventory) && Number.isSafeInteger(value.inventory.revision)
    ? value.inventory.revision as number
    : null
  if (equipment.state === 'stale') {
    const details = Array.isArray(equipment.validationErrors)
      ? equipment.validationErrors.filter((entry): entry is string => typeof entry === 'string')
      : []
    return { status: 'stale', schemaVersion: 2, inventoryRevision, assignments: [], errors: details.length ? details : ['Equipment snapshot is stale'] }
  }
  if (equipment.state === 'empty') {
    if (Array.isArray(equipment.assignments) && equipment.assignments.length === 0) {
      return { status: 'empty', schemaVersion: 2, inventoryRevision, assignments: [], errors: [] }
    }
    return { status: 'stale', schemaVersion: 2, inventoryRevision, assignments: [], errors: ['Empty equipment state contains assignments'] }
  }
  if (equipment.state !== 'available' || !Array.isArray(equipment.assignments)) {
    return { status: 'unsupported', schemaVersion: 2, inventoryRevision, assignments: [], errors: ['Invalid equipment state or assignments'] }
  }

  const errors: string[] = []
  const assignments: ResolvedEquipmentAssignment[] = []
  equipment.assignments.forEach((candidate, index) => {
    const prefix = `equipment.assignments[${index}]`
    if (!isRecord(candidate) || !isRecord(candidate.item)) {
      errors.push(`${prefix}: assignment or resolved item is missing`)
      return
    }
    const item = candidate.item
    if (candidate.team !== 'T' && candidate.team !== 'CT') errors.push(`${prefix}.team: invalid team`)
    if (!['weapon', 'agent', 'knife', 'gloves', 'zeus'].includes(String(candidate.slot))) errors.push(`${prefix}.slot: invalid slot`)
    if (typeof candidate.target !== 'string' || !candidate.target.trim()) errors.push(`${prefix}.target: missing target`)
    if (typeof candidate.itemInstanceId !== 'string' || item.id !== candidate.itemInstanceId) errors.push(`${prefix}.item: instance reference mismatch`)
    if (item.kind !== 'skin' || item.quantity !== 1) errors.push(`${prefix}.item: expected an individual skin instance`)
    if (typeof item.definitionId !== 'string' || !item.definitionId.trim()) errors.push(`${prefix}.item.definitionId: missing canonical definition`)
    if (
      (candidate.team === 'T' || candidate.team === 'CT') &&
      ['weapon', 'agent', 'knife', 'gloves', 'zeus'].includes(String(candidate.slot)) &&
      typeof candidate.target === 'string' && candidate.target.trim() &&
      typeof candidate.itemInstanceId === 'string' && item.id === candidate.itemInstanceId &&
      item.kind === 'skin' && item.quantity === 1 &&
      typeof item.definitionId === 'string' && item.definitionId.trim()
    ) {
      assignments.push({
        team: candidate.team,
        slot: candidate.slot as EquippedItemAssignment['slot'],
        target: candidate.target,
        itemInstanceId: candidate.itemInstanceId,
        item: structuredClone(item) as InventoryItemInstance,
      })
    }
  })

  return errors.length
    ? { status: 'stale', schemaVersion: 2, inventoryRevision, assignments: [], errors }
    : { status: 'ready', schemaVersion: 2, inventoryRevision, assignments, errors: [] }
}
