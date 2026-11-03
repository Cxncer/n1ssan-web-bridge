import {
  type ArmoryItemKind,
  type CatalogueDefinition,
  type CatalogueSource,
} from './contracts.ts'

export type CatalogueSourceRecord = {
  id: string | number
  kind?: ArmoryItemKind
  weapon?: string
  name: string
  type?: string
  rarity?: string | null
  image?: string | null
  color?: string | null
  art?: string | null
  description?: string | null
  minFloat?: number | null
  maxFloat?: number | null
  phase?: string | null
  patternId?: string | null
  paintKit?: number | string | null
  paintIndex?: number | string | null
  gameDefinitionId?: number | null
  stickerKitId?: number | null
  keychainId?: number | null
  source?: CatalogueSource
}

function inferSource(kind: ArmoryItemKind, sourceId: string): CatalogueSource {
  if (kind === 'sticker') return 'bymykel-stickers'
  if (kind === 'charm') return 'bymykel-keychains'
  if (/^skin-[a-z0-9-]+$/i.test(sourceId)) return 'n1ssan-knives'
  if (/^\d+$/.test(sourceId)) return 'n1ssan-skins'
  return 'external'
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * Creates a stable, kind- and source-namespaced catalogue identity.
 * Existing IDs already in this format are returned unchanged.
 */
export function catalogueDefinitionId(
  kind: ArmoryItemKind,
  sourceIdValue: string | number,
  sourceOverride?: CatalogueSource,
): string {
  let sourceId = String(sourceIdValue).trim()
  if (!sourceId) throw new Error('Catalogue source ID cannot be empty')

  const canonicalPrefix = `cs2:${kind}:`
  if (sourceId.startsWith(canonicalPrefix)) return sourceId

  const legacyPrefix = `${kind}:`
  if (sourceId.startsWith(legacyPrefix)) sourceId = sourceId.slice(legacyPrefix.length)

  const source = sourceOverride ?? inferSource(kind, sourceId)
  return `cs2:${kind}:${source}:${encodeURIComponent(sourceId)}`
}

/**
 * Normalizes one existing Obsidian catalogue row into the Armory definition
 * contract. Only source fields with known semantics are mapped to game IDs.
 * Provider sticker/keychain IDs are deliberately not treated as runtime kit IDs.
 */
export function toCatalogueDefinition(record: CatalogueSourceRecord): CatalogueDefinition {
  const kind = record.kind ?? 'skin'
  const sourceId = String(record.id).trim()
  const source = record.source ?? inferSource(kind, sourceId)
  const rawPaintKit = record.paintKit ?? record.paintIndex

  return {
    id: catalogueDefinitionId(kind, sourceId, source),
    source,
    sourceId,
    kind,
    displayName: record.name,
    itemName: record.name,
    catalogueWeaponName: kind === 'skin' ? record.weapon ?? null : null,
    category: record.type ?? 'Other',
    rarity: record.rarity ?? null,
    image: record.image ?? null,
    color: record.color ?? null,
    art: record.art ?? null,
    description: record.description ?? null,
    // No current static catalogue row carries a verified CS2 item definition index.
    gameDefinitionId: positiveInteger(record.gameDefinitionId),
    // skins.json.paintKit and knife-skins.json.paintIndex are paint-kit identifiers.
    paintKitId: positiveInteger(rawPaintKit),
    // ByMykel's sticker-1 / keychain-1 IDs are provider IDs, not proven ItemSchema IDs.
    stickerKitId: positiveInteger(record.stickerKitId),
    keychainId: positiveInteger(record.keychainId),
    minFloat: typeof record.minFloat === 'number' ? record.minFloat : null,
    maxFloat: typeof record.maxFloat === 'number' ? record.maxFloat : null,
    phase: record.phase ?? null,
    patternId: record.patternId ?? null,
    paintIndex: record.paintIndex === undefined || record.paintIndex === null
      ? null
      : String(record.paintIndex),
  }
}
