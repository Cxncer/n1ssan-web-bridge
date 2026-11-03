export const ARMORY_SCHEMA_VERSION = 1 as const

export type ArmoryTeam = 'T' | 'CT'
export type ArmoryItemType =
  | 'weapon'
  | 'knife'
  | 'gloves'
  | 'agent'
  | 'zeus'
  | 'sticker'
  | 'charm'
  | 'case'
  | 'container'
  | 'music_kit'
  | 'patch'
  | 'graffiti'
  | 'other'

export type JsonPrimitive = string | number | boolean | null
export type ArmoryMetadata = Record<string, JsonPrimitive>

export interface ArmoryFinish {
  paintKitId: number
  wear: number
  seed: number
}

export interface ArmoryStatTrak {
  enabled: boolean
  kills: number | null
}

export interface ArmorySticker {
  slot: number
  kitId: number
  wear: number
  rotation: number
  offsetX: number
  offsetY: number
  schema: number
}

export interface ArmoryCharm {
  kitId: number
  seed: number
  x: number
  y: number
  z: number
  stickerKitId: number | null
  highlightId: number | null
}

export interface ArmoryItem {
  instanceId: string
  definitionId: number
  type: ArmoryItemType
  name: string
  finish: ArmoryFinish | null
  statTrak: ArmoryStatTrak
  customName: string | null
  stickers: ArmorySticker[]
  charm: ArmoryCharm | null
  metadata: ArmoryMetadata
}

export interface ArmoryEquipmentAssignment {
  team: ArmoryTeam
  slot: string
  instanceId: string
}

export interface ArmoryInventoryProfile {
  profileId: string
  name: string
  items: ArmoryItem[]
  equipment: ArmoryEquipmentAssignment[]
}

export interface ArmoryDocument {
  schemaVersion: typeof ARMORY_SCHEMA_VERSION
  catalogueVersion: string
  profiles: ArmoryInventoryProfile[]
}

export interface ArmoryValidationResult {
  valid: boolean
  errors: string[]
}

const ITEM_TYPES = new Set<ArmoryItemType>([
  'weapon', 'knife', 'gloves', 'agent', 'zeus', 'sticker', 'charm',
  'case', 'container', 'music_kit', 'patch', 'graffiti', 'other',
])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isWear(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
}

function validateItem(value: unknown, path: string, errors: string[]): value is ArmoryItem {
  if (!isObject(value)) {
    errors.push(`${path}: expected an object`)
    return false
  }

  if (!isNonEmptyString(value.instanceId)) errors.push(`${path}.instanceId: expected a non-empty string`)
  if (!isNonNegativeInteger(value.definitionId)) errors.push(`${path}.definitionId: expected a non-negative safe integer`)
  if (typeof value.type !== 'string' || !ITEM_TYPES.has(value.type as ArmoryItemType)) {
    errors.push(`${path}.type: unsupported item type`)
  }
  if (!isNonEmptyString(value.name)) errors.push(`${path}.name: expected a non-empty string`)

  if (value.finish !== null) {
    if (!isObject(value.finish)) {
      errors.push(`${path}.finish: expected an object or null`)
    } else {
      if (!isNonNegativeInteger(value.finish.paintKitId)) errors.push(`${path}.finish.paintKitId: expected a non-negative safe integer`)
      if (!isWear(value.finish.wear)) errors.push(`${path}.finish.wear: expected a finite number from 0 to 1`)
      if (!isNonNegativeInteger(value.finish.seed)) errors.push(`${path}.finish.seed: expected a non-negative safe integer`)
    }
  }

  if (!isObject(value.statTrak)) {
    errors.push(`${path}.statTrak: expected an object`)
  } else {
    if (typeof value.statTrak.enabled !== 'boolean') errors.push(`${path}.statTrak.enabled: expected a boolean`)
    if (value.statTrak.kills !== null && !isNonNegativeInteger(value.statTrak.kills)) {
      errors.push(`${path}.statTrak.kills: expected a non-negative safe integer or null`)
    }
    if (value.statTrak.enabled === false && value.statTrak.kills !== null) {
      errors.push(`${path}.statTrak.kills: must be null when StatTrak is disabled`)
    }
  }

  if (value.customName !== null && typeof value.customName !== 'string') {
    errors.push(`${path}.customName: expected a string or null`)
  }

  if (!Array.isArray(value.stickers)) {
    errors.push(`${path}.stickers: expected an array`)
  } else {
    if (value.stickers.length > 6) errors.push(`${path}.stickers: maximum of six sticker slots`)
    const seenSlots = new Set<number>()
    value.stickers.forEach((sticker, index) => {
      const stickerPath = `${path}.stickers[${index}]`
      if (!isObject(sticker)) {
        errors.push(`${stickerPath}: expected an object`)
        return
      }
      if (!isNonNegativeInteger(sticker.slot) || sticker.slot > 5) {
        errors.push(`${stickerPath}.slot: expected an integer from 0 to 5`)
      } else if (seenSlots.has(sticker.slot)) {
        errors.push(`${stickerPath}.slot: duplicate sticker slot`)
      } else {
        seenSlots.add(sticker.slot)
      }
      if (!isNonNegativeInteger(sticker.kitId)) errors.push(`${stickerPath}.kitId: expected a non-negative safe integer`)
      if (!isWear(sticker.wear)) errors.push(`${stickerPath}.wear: expected a finite number from 0 to 1`)
      for (const field of ['rotation', 'offsetX', 'offsetY'] as const) {
        if (!isFiniteNumber(sticker[field])) errors.push(`${stickerPath}.${field}: expected a finite number`)
      }
      if (typeof sticker.schema !== 'number' || !Number.isSafeInteger(sticker.schema) || sticker.schema < -1) {
        errors.push(`${stickerPath}.schema: expected an integer greater than or equal to -1`)
      }
    })
  }

  if (value.charm !== null) {
    if (!isObject(value.charm)) {
      errors.push(`${path}.charm: expected an object or null`)
    } else {
      if (!isNonNegativeInteger(value.charm.kitId)) errors.push(`${path}.charm.kitId: expected a non-negative safe integer`)
      if (!isNonNegativeInteger(value.charm.seed)) errors.push(`${path}.charm.seed: expected a non-negative safe integer`)
      for (const field of ['x', 'y', 'z'] as const) {
        if (!isFiniteNumber(value.charm[field])) errors.push(`${path}.charm.${field}: expected a finite number`)
      }
      for (const field of ['stickerKitId', 'highlightId'] as const) {
        if (value.charm[field] !== null && !isNonNegativeInteger(value.charm[field])) {
          errors.push(`${path}.charm.${field}: expected a non-negative safe integer or null`)
        }
      }
    }
  }

  if (!isObject(value.metadata)) {
    errors.push(`${path}.metadata: expected an object`)
  } else {
    for (const [key, metadataValue] of Object.entries(value.metadata)) {
      if (!isJsonPrimitive(metadataValue)) errors.push(`${path}.metadata.${key}: expected a JSON primitive`)
    }
  }

  return true
}

function expectedTypeForEquipmentSlot(slot: string): ArmoryItemType {
  if (slot === 'melee') return 'knife'
  if (slot === 'clothing_hands') return 'gloves'
  if (slot === 'agent') return 'agent'
  if (slot === 'zeus') return 'zeus'
  return 'weapon'
}

export function validateArmoryDocument(value: unknown): ArmoryValidationResult {
  const errors: string[] = []
  if (!isObject(value)) return { valid: false, errors: ['document: expected an object'] }

  if (value.schemaVersion !== ARMORY_SCHEMA_VERSION) {
    errors.push(`schemaVersion: expected ${ARMORY_SCHEMA_VERSION}`)
  }
  if (!isNonEmptyString(value.catalogueVersion)) errors.push('catalogueVersion: expected a non-empty string')
  if (!Array.isArray(value.profiles)) {
    errors.push('profiles: expected an array')
    return { valid: false, errors }
  }

  const profileIds = new Set<string>()
  value.profiles.forEach((profile, profileIndex) => {
    const profilePath = `profiles[${profileIndex}]`
    if (!isObject(profile)) {
      errors.push(`${profilePath}: expected an object`)
      return
    }
    if (!isNonEmptyString(profile.profileId)) {
      errors.push(`${profilePath}.profileId: expected a non-empty string`)
    } else if (profileIds.has(profile.profileId)) {
      errors.push(`${profilePath}.profileId: duplicate profile ID`)
    } else {
      profileIds.add(profile.profileId)
    }
    if (!isNonEmptyString(profile.name)) errors.push(`${profilePath}.name: expected a non-empty string`)

    if (!Array.isArray(profile.items)) {
      errors.push(`${profilePath}.items: expected an array`)
      return
    }
    if (!Array.isArray(profile.equipment)) errors.push(`${profilePath}.equipment: expected an array`)

    const itemsById = new Map<string, ArmoryItem>()
    profile.items.forEach((item, itemIndex) => {
      const itemPath = `${profilePath}.items[${itemIndex}]`
      if (validateItem(item, itemPath, errors) && isNonEmptyString(item.instanceId)) {
        if (itemsById.has(item.instanceId)) errors.push(`${itemPath}.instanceId: duplicate instance ID`)
        else itemsById.set(item.instanceId, item)
      }
    })

    if (!Array.isArray(profile.equipment)) return
    const occupiedSlots = new Set<string>()
    profile.equipment.forEach((assignment, assignmentIndex) => {
      const assignmentPath = `${profilePath}.equipment[${assignmentIndex}]`
      if (!isObject(assignment)) {
        errors.push(`${assignmentPath}: expected an object`)
        return
      }
      if (assignment.team !== 'T' && assignment.team !== 'CT') errors.push(`${assignmentPath}.team: expected T or CT`)
      if (!isNonEmptyString(assignment.slot)) errors.push(`${assignmentPath}.slot: expected a non-empty string`)
      if (!isNonEmptyString(assignment.instanceId)) {
        errors.push(`${assignmentPath}.instanceId: expected a non-empty string`)
        return
      }
      if (!itemsById.has(assignment.instanceId)) {
        errors.push(`${assignmentPath}.instanceId: references an item that does not exist`)
        return
      }
      if (isNonEmptyString(assignment.slot)) {
        const slotKey = `${String(assignment.team)}:${assignment.slot}`
        if (occupiedSlots.has(slotKey)) errors.push(`${assignmentPath}.slot: duplicate equipment assignment`)
        occupiedSlots.add(slotKey)
        const item = itemsById.get(assignment.instanceId)!
        const expectedType = expectedTypeForEquipmentSlot(assignment.slot)
        if (item.type !== expectedType) {
          errors.push(`${assignmentPath}.slot: ${assignment.slot} requires item type ${expectedType}`)
        }
      }
    })
  })

  return { valid: errors.length === 0, errors }
}
