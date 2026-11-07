import {
  ARMORY_SCHEMA_VERSION,
  type ArmoryDocument,
  type ArmoryItemKind,
  type InventoryItemInstance,
  type InventoryProfile,
} from './contracts.ts'
import { catalogueDefinitionId } from './catalogue-identity.ts'

type LegacyRecord = Record<string, unknown>

function isRecord(value: unknown): value is LegacyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function isoDateOr(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  return Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value)
    ? value
    : fallback
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function itemKind(value: unknown): ArmoryItemKind {
  return value === 'sticker' || value === 'charm' ? value : 'skin'
}

function migrateItem(
  value: unknown,
  profileId: string,
  index: number,
  now: string,
): InventoryItemInstance | null {
  if (!isRecord(value)) return null

  const definitionId = nonEmptyString(value.definitionId)
  if (!definitionId) return null

  const kind = itemKind(value.kind)
  const oldInstanceId = nonEmptyString(value.instanceId) ?? String(index + 1)
  const id = `legacy:${profileId}:${oldInstanceId}`
  const updatedAt = isoDateOr(value.updatedAt, now)
  const rawFloat = numericValue(value.float)
  const rawSeed = numericValue(value.seed)

  const customization = kind !== 'skin'
    ? null
    : {
        float: rawFloat !== null && rawFloat >= 0 && rawFloat <= 1 ? rawFloat : null,
        seed: rawSeed !== null && Number.isSafeInteger(rawSeed) && rawSeed >= 0 && rawSeed <= 1000
          ? rawSeed
          : null,
        statTrak: value.stattrak === true
          ? { enabled: true, kills: 0 }
          : null,
        customName: typeof value.customName === 'string' && value.customName.trim()
          ? value.customName.trim()
          : null,
      }

  const quantity = kind === 'skin'
    ? 1
    : Number.isSafeInteger(value.quantity) && (value.quantity as number) > 0
      ? value.quantity as number
      : 1

  return {
    id,
    definitionId: catalogueDefinitionId(kind, definitionId),
    kind,
    quantity,
    customization,
    createdAt: now,
    updatedAt,
  }
}

/**
 * Converts the Obsidian localStorage profile shape into the versioned Armory
 * document. The migration is pure and deterministic for a supplied timestamp.
 */
export function migrateLegacyInventory(
  legacyProfiles: unknown,
  legacyActiveProfileId: unknown,
  now = new Date().toISOString(),
): ArmoryDocument {
  const sourceProfiles = Array.isArray(legacyProfiles) ? legacyProfiles : []
  const profiles: InventoryProfile[] = []
  const usedProfileIds = new Set<string>()
  const usedItemIds = new Set<string>()

  sourceProfiles.forEach((source, profileIndex) => {
    if (!isRecord(source)) return

    const requestedId = nonEmptyString(source.id) ?? `profile-${profileIndex + 1}`
    let id = requestedId
    let profileSuffix = profileIndex + 1
    while (usedProfileIds.has(id)) {
      id = `${requestedId}-${profileSuffix++}`
    }
    usedProfileIds.add(id)

    const updatedAt = isoDateOr(source.updatedAt, now)
    const rawItems = Array.isArray(source.items) ? source.items : []
    const items = rawItems
      .map((item, itemIndex) => migrateItem(item, id, itemIndex, now))
      .filter((item): item is InventoryItemInstance => item !== null)
      .map((item, itemIndex) => {
        let itemId = item.id
        let itemSuffix = itemIndex + 2
        while (usedItemIds.has(itemId)) {
          itemId = `${item.id}-${itemSuffix++}`
        }
        usedItemIds.add(itemId)
        return { ...item, id: itemId }
      })

    profiles.push({
      id,
      name: nonEmptyString(source.name) ?? `Inventory ${profileIndex + 1}`,
      items,
      createdAt: now,
      updatedAt,
    })
  })

  if (profiles.length === 0) {
    profiles.push({
      id: 'profile-main',
      name: 'Main inventory',
      items: [],
      createdAt: now,
      updatedAt: now,
    })
  }

  const activeProfileId = typeof legacyActiveProfileId === 'string' &&
      profiles.some(profile => profile.id === legacyActiveProfileId)
    ? legacyActiveProfileId
    : profiles[0].id

  return {
    schemaVersion: ARMORY_SCHEMA_VERSION,
    revision: 0,
    activeProfileId,
    profiles,
  }
}
