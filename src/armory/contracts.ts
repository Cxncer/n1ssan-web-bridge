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

/** One sticker applied to an item in CS2, exactly as the game holds it. */
export type StickerAttachment = {
  /** "sticker slot N", 0-5. */
  slot: number
  /** Sticker kit id ("sticker slot N id"). */
  kitId: number
  wear: number
  scale: number
  rotation: number
  offsetX: number
  offsetY: number
  /** The position the offsets are relative to; null when the game holds none. */
  schema: number | null
  /** Armory sticker instance this consumed, when it could be resolved. */
  sourceInstanceId: string | null
}

/** The charm hanging on an item. */
export type CharmAttachment = {
  /** Keychain id ("keychain slot 0 id"). */
  kitId: number
  seed: number
  x: number
  y: number
  z: number
  /** A Sticker Slab's sealed sticker. */
  stickerKitId: number | null
  /** A Major highlight clip. */
  highlightId: number | null
  sourceInstanceId: string | null
}

/**
 * Attachment state observed in CS2, per item instance. Written by the native
 * runtime when the player changes stickers or a charm in the game's own
 * inventory screen; never applied by the Bridge.
 */
export type ItemAttachments = {
  stickers: StickerAttachment[]
  charm: CharmAttachment | null
  /** Where the state came from; only `native` records may be replaced later. */
  origin: 'native' | 'legacy' | 'manual'
  observedAt: string | null
  observedInventoryRevision: number | null
}

/** An inventory instance describes an owned item, not its catalogue definition. */
export type InventoryItemInstance = {
  id: string
  definitionId: string
  kind: ArmoryItemKind
  /** Skins are individual instances. Stickers and charms may be quantity-stacked. */
  quantity: number
  customization: SkinCustomization | null
  /** Stickers and charm on a weapon. Absent means never observed. */
  attachments?: ItemAttachments | null
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

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

// Optional fields may be omitted entirely; null means "the game holds none".
const isSafeIdOrNull = (value: unknown): boolean =>
  value === undefined || value === null || (Number.isSafeInteger(value) && (value as number) >= 0)

const isStringOrNull = (value: unknown): boolean =>
  value === undefined || value === null || typeof value === 'string'

const isUnitRange = (value: unknown): boolean =>
  isFiniteNumber(value) && (value as number) >= 0 && (value as number) <= 1

/** Validates the attachment block of one item instance. */
export function validateAttachments(value: unknown, prefix: string): string[] {
  const errors: string[] = []

  if (!isRecord(value)) return [`${prefix}.attachments: expected an object`]

  if (!Array.isArray(value.stickers)) {
    errors.push(`${prefix}.attachments.stickers: expected an array`)
  } else {
    if (value.stickers.length > 6) {
      errors.push(`${prefix}.attachments.stickers: at most six sticker slots`)
    }

    const slots = new Set<number>()
    value.stickers.forEach((sticker, index) => {
      const p = `${prefix}.attachments.stickers[${index}]`
      if (!isRecord(sticker)) {
        errors.push(`${p}: expected an object`)
        return
      }

      if (!Number.isSafeInteger(sticker.slot) || (sticker.slot as number) < 0 || (sticker.slot as number) > 5) {
        errors.push(`${p}.slot: expected an integer from 0 to 5`)
      } else if (slots.has(sticker.slot as number)) {
        errors.push(`${p}.slot: duplicate sticker slot`)
      } else {
        slots.add(sticker.slot as number)
      }

      if (!Number.isSafeInteger(sticker.kitId) || (sticker.kitId as number) <= 0) {
        errors.push(`${p}.kitId: expected a positive sticker kit id`)
      }
      if (!isUnitRange(sticker.wear)) errors.push(`${p}.wear: expected a number from 0 to 1`)
      if (!isFiniteNumber(sticker.scale) || (sticker.scale as number) <= 0) {
        errors.push(`${p}.scale: expected a positive number`)
      }
      if (!isFiniteNumber(sticker.rotation)) errors.push(`${p}.rotation: expected a number`)
      if (!isFiniteNumber(sticker.offsetX) || !isFiniteNumber(sticker.offsetY)) {
        errors.push(`${p}: placement values must be finite`)
      }
      if (!isSafeIdOrNull(sticker.schema)) errors.push(`${p}.schema: expected null or a safe integer`)
      if (!isStringOrNull(sticker.sourceInstanceId)) {
        errors.push(`${p}.sourceInstanceId: expected a string or null`)
      }
    })
  }

  if (value.charm !== null) {
    const charm = value.charm
    if (!isRecord(charm)) {
      errors.push(`${prefix}.attachments.charm: expected an object or null`)
    } else {
      if (!Number.isSafeInteger(charm.kitId) || (charm.kitId as number) <= 0) {
        errors.push(`${prefix}.attachments.charm.kitId: expected a positive keychain id`)
      }
      if (!Number.isSafeInteger(charm.seed) || (charm.seed as number) < 0) {
        errors.push(`${prefix}.attachments.charm.seed: expected a non-negative safe integer`)
      }
      if (!isFiniteNumber(charm.x) || !isFiniteNumber(charm.y) || !isFiniteNumber(charm.z)) {
        errors.push(`${prefix}.attachments.charm: placement values must be finite`)
      }
      if (!isSafeIdOrNull(charm.stickerKitId)) {
        errors.push(`${prefix}.attachments.charm.stickerKitId: expected null or a safe integer`)
      }
      if (!isSafeIdOrNull(charm.highlightId)) {
        errors.push(`${prefix}.attachments.charm.highlightId: expected null or a safe integer`)
      }
      if (!isStringOrNull(charm.sourceInstanceId)) {
        errors.push(`${prefix}.attachments.charm.sourceInstanceId: expected a string or null`)
      }
    }
  }

  if (value.origin !== 'native' && value.origin !== 'legacy' && value.origin !== 'manual') {
    errors.push(`${prefix}.attachments.origin: expected native, legacy or manual`)
  }
  if (value.observedAt !== null && value.observedAt !== undefined && !isIsoDate(value.observedAt)) {
    errors.push(`${prefix}.attachments.observedAt: expected an ISO date or null`)
  }
  if (value.observedInventoryRevision !== null && value.observedInventoryRevision !== undefined &&
      (!Number.isSafeInteger(value.observedInventoryRevision) || (value.observedInventoryRevision as number) < 0)) {
    errors.push(`${prefix}.attachments.observedInventoryRevision: expected null or a non-negative safe integer`)
  }

  return errors
}

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

      if (item.attachments !== undefined && item.attachments !== null) {
        errors.push(...validateAttachments(item.attachments, itemPrefix))
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
