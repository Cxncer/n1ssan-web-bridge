import type {
  ArmoryDocument,
  ArmoryItemKind,
  InventoryProfile as ArmoryProfile,
} from './contracts.ts'
import { catalogueDefinitionId } from './catalogue-identity.ts'

export type ObsidianInventoryItem = {
  instanceId: string
  definitionId: string
  kind?: ArmoryItemKind
  quantity?: number
  float: string
  seed: string
  stattrak: boolean
  stattrakKills?: number
  customName: string
  createdAt?: string
  updatedAt?: string
}

export type ObsidianInventoryProfile = {
  id: string
  name: string
  items: ObsidianInventoryItem[]
  updatedAt: string
  createdAt?: string
}

function validTimestamp(value: string | undefined, fallback: string): string {
  return value && Number.isFinite(Date.parse(value)) ? value : fallback
}

function parseFloatValue(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null
}

function parseSeedValue(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1000
    ? parsed
    : null
}

export function fromArmoryDocument(document: ArmoryDocument): {
  profiles: ObsidianInventoryProfile[]
  activeId: string
  items: ObsidianInventoryItem[]
} {
  const profiles = document.profiles.map(profile => ({
    id: profile.id,
    name: profile.name,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    items: profile.items.map(item => ({
      instanceId: item.id,
      definitionId: catalogueDefinitionId(item.kind, item.definitionId),
      kind: item.kind,
      quantity: item.quantity,
      float: item.customization?.float === null || item.customization?.float === undefined
        ? ''
        : String(item.customization.float),
      seed: item.customization?.seed === null || item.customization?.seed === undefined
        ? ''
        : String(item.customization.seed),
      stattrak: item.customization?.statTrak?.enabled ?? false,
      stattrakKills: item.customization?.statTrak?.kills ?? 0,
      customName: item.customization?.customName ?? '',
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  }))
  const active = profiles.find(profile => profile.id === document.activeProfileId) ?? profiles[0]

  return {
    profiles,
    activeId: active.id,
    items: active.items.map(item => ({ ...item })),
  }
}

export function toArmoryDocument(
  profiles: ObsidianInventoryProfile[],
  activeProfileId: string,
  revision: number,
  now = new Date().toISOString(),
): ArmoryDocument {
  const mappedProfiles: ArmoryProfile[] = profiles.map(profile => ({
    id: profile.id,
    name: profile.name,
    createdAt: validTimestamp(profile.createdAt, now),
    updatedAt: validTimestamp(profile.updatedAt, now),
    items: profile.items.map(item => {
      const kind = item.kind ?? 'skin'
      const statTrakKills = Number.isSafeInteger(item.stattrakKills) && (item.stattrakKills ?? 0) >= 0
        ? item.stattrakKills ?? 0
        : 0
      const customization = kind !== 'skin'
        ? null
        : {
            float: parseFloatValue(item.float),
            seed: parseSeedValue(item.seed),
            statTrak: item.stattrak || statTrakKills > 0
              ? { enabled: item.stattrak, kills: statTrakKills }
              : null,
            customName: item.customName.trim() || null,
          }
      const hasCustomization = customization !== null && (
        customization.float !== null ||
        customization.seed !== null ||
        customization.statTrak !== null ||
        customization.customName !== null
      )

      return {
        id: item.instanceId,
        definitionId: catalogueDefinitionId(kind, item.definitionId),
        kind,
        quantity: kind === 'skin' ? 1 : Math.max(1, Math.floor(Number(item.quantity) || 1)),
        customization: hasCustomization ? customization : null,
        createdAt: validTimestamp(item.createdAt ?? profile.createdAt, now),
        updatedAt: validTimestamp(item.updatedAt ?? profile.updatedAt, now),
      }
    }),
  }))

  return {
    schemaVersion: 1,
    revision,
    activeProfileId,
    profiles: mappedProfiles,
  }
}
