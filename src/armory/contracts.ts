/**
 * Armory domain contracts.
 *
 * These types describe n1ssan-owned inventory data. They intentionally do not
 * mirror CS2's internal econ-item / SharedObject representation from Lootline.
 * Adapters at the game-integration boundary will translate between the two.
 */

export const ARMORY_SCHEMA_VERSION = 1 as const

export type ArmoryItemKind = 'skin' | 'sticker' | 'charm'

export type CatalogueSource =
  | 'n1ssan-skins'
  | 'n1ssan-knives'
  | 'bymykel-stickers'
  | 'bymykel-keychains'
  | 'external'

export type SkinCustomization = {
  float: number | null
  seed: number | null
  statTrak: {
    enabled: boolean
    kills: number
  } | null
  customName: string | null
}

/** A catalogue definition describes what an item is, not who owns it. */
export type CatalogueDefinition = {
  /** Canonical identity: cs2:<kind>:<source>:<encoded source ID>. */
  id: string
  source: CatalogueSource
  sourceId: string
  kind: ArmoryItemKind
  displayName: string
  /** Catalogue's display item name; not the engine's internal schema itemName. */
  itemName: string
  /** Human-readable weapon label used for later runtime schema resolution. */
  catalogueWeaponName: string | null
  category: string
  rarity: string | null
  image: string | null
  color: string | null
  art: string | null
  description: string | null
  /** CS2 item definition index (weapon, knife, glove, agent, etc.). */
  gameDefinitionId: number | null
  /** Lootline ItemSchema paint-kit ID; only applicable to weapon finishes. */
  paintKitId: number | null
  /** Lootline ItemSchema sticker-kit ID; independent sticker catalogue entry. */
  stickerKitId: number | null
  /** Lootline ItemSchema keychain ID; independent charm catalogue entry. */
  keychainId: number | null
  minFloat: number | null
  maxFloat: number | null
  /** External catalogue metadata used to distinguish Doppler phases / patterns. */
  phase: string | null
  patternId: string | null
  paintIndex: string | null
}

/** An inventory instance describes an owned item, not its catalogue definition. */
export type InventoryItemInstance = {
  id: string
  definitionId: string
  kind: ArmoryItemKind
  /** Skins are individual instances. Stickers and charms may be quantity-stacked. */
  quantity: number
  customization: SkinCustomization | null
  createdAt: string
  updatedAt: string
}

/** A profile is a complete inventory snapshot. Switching profiles never merges. */
export type InventoryProfile = {
  id: string
  name: string
  items: InventoryItemInstance[]
  createdAt: string
  updatedAt: string
}

export type ArmoryDocument = {
  schemaVersion: typeof ARMORY_SCHEMA_VERSION
  revision: number
  activeProfileId: string
  profiles: InventoryProfile[]
}

export type ArmoryReadResponse = {
  data: ArmoryDocument
}

export type ArmoryWriteRequest = {
  expectedRevision: number
  data: ArmoryDocument
}

export type ArmoryWriteResponse = {
  data: ArmoryDocument
}

export type ArmoryErrorCode =
  | 'VALIDATION_FAILED'
  | 'REVISION_CONFLICT'
  | 'PROFILE_NOT_FOUND'
  | 'ITEM_NOT_FOUND'
  | 'STORAGE_FAILURE'

export type ArmoryErrorResponse = {
  error: {
    code: ArmoryErrorCode
    message: string
    details?: string[]
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  /^\d{4}-\d{2}-\d{2}T/.test(value)

const isItemKind = (value: unknown): value is ArmoryItemKind =>
  value === 'skin' || value === 'sticker' || value === 'charm'

/**
 * Runtime validation is shared by the Bridge and tests. It accepts unknown
 * input so HTTP payloads and persisted JSON are checked at the boundary.
 */
export function validateArmoryDocument(value: unknown): string[] {
  const errors: string[] = []

  if (!isRecord(value)) return ['document: expected an object']

  if (value.schemaVersion !== ARMORY_SCHEMA_VERSION) {
    errors.push(`schemaVersion: expected ${ARMORY_SCHEMA_VERSION}`)
  }

  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
    errors.push('revision: expected a non-negative safe integer')
  }

  if (!isNonEmptyString(value.activeProfileId)) {
    errors.push('activeProfileId: expected a non-empty string')
  }

  if (!Array.isArray(value.profiles) || value.profiles.length === 0) {
    errors.push('profiles: expected at least one profile')
    return errors
  }

  const profileIds = new Set<string>()
  const instanceIds = new Set<string>()
  let activeProfileFound = false

  value.profiles.forEach((profile, profileIndex) => {
    const prefix = `profiles[${profileIndex}]`

    if (!isRecord(profile)) {
      errors.push(`${prefix}: expected an object`)
      return
    }

    if (!isNonEmptyString(profile.id)) {
      errors.push(`${prefix}.id: expected a non-empty string`)
    } else {
      if (profileIds.has(profile.id)) errors.push(`${prefix}.id: duplicate profile id`)
      profileIds.add(profile.id)
      if (profile.id === value.activeProfileId) activeProfileFound = true
    }

    if (!isNonEmptyString(profile.name)) errors.push(`${prefix}.name: expected a non-empty string`)
    if (!isIsoDate(profile.createdAt)) errors.push(`${prefix}.createdAt: expected an ISO date`)
    if (!isIsoDate(profile.updatedAt)) errors.push(`${prefix}.updatedAt: expected an ISO date`)

    if (!Array.isArray(profile.items)) {
      errors.push(`${prefix}.items: expected an array`)
      return
    }

    profile.items.forEach((item, itemIndex) => {
      const itemPrefix = `${prefix}.items[${itemIndex}]`

      if (!isRecord(item)) {
        errors.push(`${itemPrefix}: expected an object`)
        return
      }

      if (!isNonEmptyString(item.id)) {
        errors.push(`${itemPrefix}.id: expected a non-empty string`)
      } else {
        if (instanceIds.has(item.id)) errors.push(`${itemPrefix}.id: duplicate instance id`)
        instanceIds.add(item.id)
      }

      if (!isNonEmptyString(item.definitionId)) {
        errors.push(`${itemPrefix}.definitionId: expected a non-empty string`)
      }

      if (!isItemKind(item.kind)) {
        errors.push(`${itemPrefix}.kind: unsupported item kind`)
      }

      if (!Number.isSafeInteger(item.quantity) || (item.quantity as number) < 1) {
        errors.push(`${itemPrefix}.quantity: expected a positive safe integer`)
      } else if (item.kind === 'skin' && item.quantity !== 1) {
        errors.push(`${itemPrefix}.quantity: skins must be individual instances (quantity 1)`)
      }

      if (item.kind !== 'skin' && item.customization !== null) {
        errors.push(`${itemPrefix}.customization: only skins may have skin customization`)
      }

      if (item.kind === 'skin' && item.customization !== null) {
        const customization = item.customization

        if (!isRecord(customization)) {
          errors.push(`${itemPrefix}.customization: expected an object or null`)
        } else {
          if (
            customization.float !== null &&
            (typeof customization.float !== 'number' ||
              !Number.isFinite(customization.float) ||
              customization.float < 0 ||
              customization.float > 1)
          ) {
            errors.push(`${itemPrefix}.customization.float: expected null or a number from 0 to 1`)
          }

          if (
            customization.seed !== null &&
            (!Number.isSafeInteger(customization.seed) ||
              (customization.seed as number) < 0 ||
              (customization.seed as number) > 1000)
          ) {
            errors.push(`${itemPrefix}.customization.seed: expected null or an integer from 0 to 1000`)
          }

          if (customization.customName !== null &&
              typeof customization.customName !== 'string') {
            errors.push(`${itemPrefix}.customization.customName: expected a string or null`)
          }

          if (customization.statTrak !== null) {
            const statTrak = customization.statTrak
            if (
              !isRecord(statTrak) ||
              typeof statTrak.enabled !== 'boolean' ||
              !Number.isSafeInteger(statTrak.kills) ||
              (statTrak.kills as number) < 0
            ) {
              errors.push(`${itemPrefix}.customization.statTrak: invalid StatTrak data`)
            }
          }
        }
      }

      if (!isIsoDate(item.createdAt)) errors.push(`${itemPrefix}.createdAt: expected an ISO date`)
      if (!isIsoDate(item.updatedAt)) errors.push(`${itemPrefix}.updatedAt: expected an ISO date`)
    })
  })

  if (!activeProfileFound) errors.push('activeProfileId: does not match an existing profile')
  return errors
}

export function assertValidArmoryDocument(value: unknown): asserts value is ArmoryDocument {
  const errors = validateArmoryDocument(value)
  if (errors.length > 0) {
    throw new Error(`Invalid Armory document: ${errors.join('; ')}`)
  }
}
