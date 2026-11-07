import { toCatalogueDefinition, type CatalogueSourceRecord } from './catalogue-identity.ts'
import type {
  ArmoryDocument,
  CatalogueDefinition,
  InventoryItemInstance,
} from './contracts.ts'
import type { LiveSchemaItem } from './runtime-config.ts'

/**
 * Inventory document consumed by the native runtime to recreate the active
 * Armory profile inside CS2's local inventory.
 *
 * This is independent of Loadout: it describes what the player owns, not what
 * is equipped.
 */
export type ArmoryInventoryItem = {
  instanceId: string
  definitionId: string
  definitionIndex: number
  paintKit: number
  float: number
  seed: number
  statTrak: boolean
  quality: number
  rarity: number
  customName: string | null
  kind: 'skin' | 'sticker' | 'charm'
  stickerKit?: number
  keychain?: number
  keychainSeed?: number
  /** Stickers and charm, flattened: one fixed key per value. */
  [attachmentKey: string]: number | string | boolean | null | undefined
}

export type ArmoryInventoryDocument = {
  version: 2
  /** 1 = the runtime understands the flat sticker / charm keys below. */
  attachmentsVersion: 1
  generatedAt: string
  source: 'armory'
  profileId: string
  /** Profile revision this projection was built from. */
  inventoryRevision: number
  items: ArmoryInventoryItem[]
}

export type SkippedInventoryItem = {
  instanceId: string
  definitionId: string
  reason: string
}

export type ArmoryInventoryProjection = {
  document: ArmoryInventoryDocument
  skipped: SkippedInventoryItem[]
}

export type ArmoryCatalogueEntry = {
  definition: CatalogueDefinition
  weapon: string
  name: string
}

const RARITY_NUMBER: Record<string, number> = {
  'Consumer Grade': 1,
  'Base Grade': 1,
  'Industrial Grade': 2,
  'High Grade': 2,
  'Mil-Spec Grade': 3,
  'Mil-Spec': 3,
  'Remarkable': 3,
  'Restricted': 4,
  'Exotic': 4,
  'Classified': 5,
  'Extraordinary': 5,
  'Covert': 6,
  'Master': 6,
  'Contraband': 7,
}

// CS2 base definitions used for the shared sticker / charm items. The kit id
// lives in the "sticker slot 0 id" / "keychain slot 0 id" attributes.
const DEF_STICKER = 1209
const DEF_KEYCHAIN = 1355

/** Catalogue index keyed by canonical Armory definition ID. */
export function buildArmoryCatalogue(
  records: CatalogueSourceRecord[],
): Map<string, ArmoryCatalogueEntry> {
  const index = new Map<string, ArmoryCatalogueEntry>()

  for (const record of records) {
    const definition = toCatalogueDefinition({ ...record })
    index.set(definition.id, {
      definition,
      weapon: (record.weapon ?? '').trim(),
      name: record.name,
    })
  }

  return index
}

function clampFloat(value: number | null | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

function rarityNumber(rarity: string | null): number {
  if (!rarity) return 4
  return RARITY_NUMBER[rarity] ?? 4
}

/**
 * Flattens an instance's attachment state into the runtime document's fixed
 * keys. Kept flat on purpose: the native reader scans a single object per item.
 */
/**
 * Sticker kit / keychain id from a canonical definition id, for catalogue rows
 * the Bridge never receives. "cs2:sticker:bymykel-stickers:sticker-123" -> 123.
 */
export function kitFromDefinitionId(definitionId: string): number | null {
  const tail = definitionId.slice(definitionId.lastIndexOf(':') + 1)
  if (!tail) return null

  const match = /(?:sticker|charm|keychain)-?(\d+)$/i.exec(decodeURIComponent(tail))
  if (!match) return null

  const kit = Number(match[1])
  return Number.isSafeInteger(kit) && kit > 0 ? kit : null
}

function attachmentFields(instance: InventoryItemInstance): Record<string, number> {
  const fields: Record<string, number> = {}
  const attachments = instance.attachments
  if (!attachments) return fields

  for (const sticker of attachments.stickers) {
    const slot = sticker.slot
    fields[`sticker${slot}Kit`] = sticker.kitId
    fields[`sticker${slot}Wear`] = sticker.wear
    fields[`sticker${slot}Scale`] = sticker.scale
    fields[`sticker${slot}Rotation`] = sticker.rotation
    fields[`sticker${slot}OffsetX`] = sticker.offsetX
    fields[`sticker${slot}OffsetY`] = sticker.offsetY
    if (sticker.schema !== null) fields[`sticker${slot}Schema`] = sticker.schema
  }

  const charm = attachments.charm
  if (charm) {
    fields.charmKit = charm.kitId
    fields.charmSeed = charm.seed
    fields.charmX = charm.x
    fields.charmY = charm.y
    fields.charmZ = charm.z
    if (charm.stickerKitId !== null) fields.charmSticker = charm.stickerKitId
    if (charm.highlightId !== null) fields.charmHighlight = charm.highlightId
  }

  return fields
}

export function projectArmoryInventory(
  armory: ArmoryDocument,
  catalogue: Map<string, ArmoryCatalogueEntry>,
  schemaItems: LiveSchemaItem[] | null,
): ArmoryInventoryProjection {
  const profile = armory.profiles.find(item => item.id === armory.activeProfileId)
  const schemaIndex = new Map<number, LiveSchemaItem>()

  for (const item of schemaItems ?? []) {
    if (typeof item.definitionIndex === 'number') schemaIndex.set(item.definitionIndex, item)
  }

  const items: ArmoryInventoryItem[] = []
  const skipped: SkippedInventoryItem[] = []

  for (const instance of profile?.items ?? []) {
    // Skins are individual instances. A stacked sticker or charm is still one
    // item per unit in the game's inventory, so it is projected as that many
    // instances — CS2 consumes one when the player applies it.
    const copies = instance.kind === 'skin' ? 1 : Math.max(1, Math.floor(instance.quantity))

    if (instance.kind === 'skin' && instance.quantity !== 1) {
      skipped.push({
        instanceId: instance.id,
        definitionId: instance.definitionId,
        reason: 'stacked skins are not supported',
      })
      continue
    }

    const entry = catalogue.get(instance.definitionId)

    if (instance.kind === 'sticker' || instance.kind === 'charm') {
      // Sticker and charm catalogues live in the browser and never reach the
      // Bridge, so the kit id also comes from the canonical instance id
      // ("cs2:sticker:bymykel-stickers:sticker-123").
      const kit = (instance.kind === 'sticker'
        ? entry?.definition.stickerKitId
        : entry?.definition.keychainId) ?? kitFromDefinitionId(instance.definitionId)

      if (!kit) {
        skipped.push({
          instanceId: instance.id,
          definitionId: instance.definitionId,
          reason: instance.kind === 'sticker'
            ? 'no sticker kit ID could be resolved'
            : 'no keychain ID could be resolved',
        })
        continue
      }

      const charmSeed = typeof instance.customization?.seed === 'number'
        ? instance.customization.seed
        : 0

      for (let copy = 0; copy < copies; ++copy) {
        items.push({
          instanceId: copies > 1 ? `${instance.id}#${copy}` : instance.id,
          definitionId: instance.definitionId,
          definitionIndex: instance.kind === 'sticker' ? DEF_STICKER : DEF_KEYCHAIN,
          paintKit: 0,
          float: 0.001,
          seed: 0,
          statTrak: false,
          quality: 4,
          rarity: rarityNumber(entry?.definition.rarity ?? null),
          customName: null,
          kind: instance.kind,
          ...(instance.kind === 'sticker'
            ? { stickerKit: kit }
            : { keychain: kit, keychainSeed: charmSeed }),
        })
      }
      continue
    }

    if (!entry) {
      skipped.push({
        instanceId: instance.id,
        definitionId: instance.definitionId,
        reason: 'catalogue definition not found',
      })
      continue
    }

    if (instance.kind !== 'skin') {
      skipped.push({
        instanceId: instance.id,
        definitionId: instance.definitionId,
        reason: `kind '${instance.kind}' is not written to the game inventory yet`,
      })
      continue
    }

    const definitionIndex = entry.definition.gameDefinitionId
    const paintKit = entry.definition.paintKitId ?? 0

    if (!definitionIndex) {
      skipped.push({
        instanceId: instance.id,
        definitionId: instance.definitionId,
        reason: 'no CS2 definition index could be resolved',
      })
      continue
    }

    const schemaItem = schemaIndex.get(definitionIndex)

    if (schemaItems && !schemaItem) {
      skipped.push({
        instanceId: instance.id,
        definitionId: instance.definitionId,
        reason: `definition ${definitionIndex} is not in the live CS2 schema`,
      })
      continue
    }

    if (paintKit !== 0 && schemaItem && Array.isArray(schemaItem.compatiblePaintKitIds) &&
        !schemaItem.compatiblePaintKitIds.includes(paintKit)) {
      skipped.push({
        instanceId: instance.id,
        definitionId: instance.definitionId,
        reason: `paint kit ${paintKit} is not compatible with definition ${definitionIndex}`,
      })
      continue
    }

    const customization = instance.customization
    const statTrak = customization?.statTrak?.enabled === true

    items.push({
      instanceId: instance.id,
      definitionId: instance.definitionId,
      definitionIndex,
      paintKit,
      float: clampFloat(customization?.float ?? entry.definition.minFloat, 0.001),
      seed: typeof customization?.seed === 'number' ? customization.seed : 0,
      statTrak,
      quality: statTrak ? 9 : definitionIndex >= 500 ? 3 : 4,
      rarity: rarityNumber(entry.definition.rarity),
      customName: customization?.customName?.trim() || null,
      kind: 'skin',
      ...attachmentFields(instance),
    })
  }

  return {
    document: {
      version: 2,
      attachmentsVersion: 1,
      generatedAt: new Date().toISOString(),
      source: 'armory',
      profileId: armory.activeProfileId,
      inventoryRevision: armory.revision,
      items,
    },
    skipped,
  }
}
