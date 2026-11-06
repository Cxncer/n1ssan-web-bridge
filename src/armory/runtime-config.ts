import {
  toCatalogueDefinition,
  type CatalogueSourceRecord,
} from './catalogue-identity.ts'
import type { CatalogueDefinition } from './contracts.ts'

/**
 * Resolved runtime configuration consumed by n1ssan-dll.dll.
 *
 * Loadout is an equipment configuration over the shared skin catalogue. It does
 * not read Armory inventory instances and does not require ownership: every
 * catalogue skin can be equipped. The document shape stays compatible with the
 * legacy `n1ssan-data.json` the DLL already parses.
 */
export type RuntimeTeam = 'T' | 'CT'
export type RuntimeEquipmentSlot = 'agent' | 'knife' | 'gloves' | 'zeus'
export type SelectionId = number | string

export type LoadoutSettings = { float: number; seed: number }

export type LoadoutSelectionSnapshot = {
  loadouts: Record<RuntimeTeam, Record<string, SelectionId | null>>
  equipment: Record<RuntimeTeam, Record<RuntimeEquipmentSlot, SelectionId | null>>
  skinSettings?: Record<RuntimeTeam, Record<string, LoadoutSettings>>
}

export type RuntimeTarget = {
  weapon: string
  name: string
  paintKit: number
  float: number
  seed: number
  team: RuntimeTeam
  slot: string
  definitionId: string
}

export type RuntimeDocument = {
  version: 1
  generatedAt: string
  source: 'loadout'
  activeLoadoutProfileId: string | null
  skins: RuntimeTarget[]
}

export type SkippedSelection = {
  selection: string
  id: string
  reason: string
}

export type LoadoutProjection = {
  document: RuntimeDocument
  skipped: SkippedSelection[]
}

export type LoadoutRuntimeEntry = {
  definition: CatalogueDefinition
  weapon: string
  name: string
}

export type LiveSchemaItem = {
  definitionIndex?: number
  kind?: string
  compatiblePaintKitIds?: number[]
}

export type LiveSchemaSnapshot = {
  itemDefinitions?: LiveSchemaItem[]
}

/** Catalogue index keyed by the selection ID the Loadout UI stores. */
export function buildLoadoutRuntimeCatalogue(
  records: CatalogueSourceRecord[],
): Map<string, LoadoutRuntimeEntry> {
  const index = new Map<string, LoadoutRuntimeEntry>()

  for (const record of records) {
    const definition = toCatalogueDefinition({ ...record, kind: 'skin' })
    index.set(String(record.id), {
      definition,
      weapon: (record.weapon ?? '').trim(),
      name: record.name,
    })
  }

  return index
}

function clampFloat(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.001
  return Math.min(1, Math.max(0, value))
}

function settingsFor(
  selection: LoadoutSelectionSnapshot,
  team: RuntimeTeam,
  key: string,
  id: SelectionId,
): LoadoutSettings | undefined {
  const teamSettings = selection.skinSettings?.[team]
  if (!teamSettings) return undefined
  return teamSettings[`${key}:${id}`]
}

function buildSchemaIndex(schema: LiveSchemaSnapshot | null): Map<number, LiveSchemaItem> {
  const index = new Map<number, LiveSchemaItem>()

  for (const item of schema?.itemDefinitions ?? []) {
    if (typeof item.definitionIndex === 'number') index.set(item.definitionIndex, item)
  }

  return index
}

function validateTarget(
  entry: LoadoutRuntimeEntry,
  paintKit: number,
  schemaIndex: Map<number, LiveSchemaItem>,
  schemaPresent: boolean,
): string | null {
  const definitionIndex = entry.definition.gameDefinitionId

  if (!definitionIndex) return 'no CS2 definition index could be resolved'
  if (!entry.weapon) return 'no weapon label available for the native loadout'
  if (!schemaPresent) return null

  const schemaItem = schemaIndex.get(definitionIndex)

  if (!schemaItem) return `definition ${definitionIndex} is not in the live CS2 schema`

  if (paintKit !== 0 && Array.isArray(schemaItem.compatiblePaintKitIds) &&
      !schemaItem.compatiblePaintKitIds.includes(paintKit)) {
    return `paint kit ${paintKit} is not compatible with definition ${definitionIndex}`
  }

  return null
}

/**
 * Projects one saved Loadout profile into the native runtime document.
 * Every selection is resolved against the shared catalogue only; Armory
 * inventory has no part in this path.
 */
export function projectLoadoutRuntime(
  selection: LoadoutSelectionSnapshot,
  catalogue: Map<string, LoadoutRuntimeEntry>,
  schema: LiveSchemaSnapshot | null,
  loadoutProfileId: string | null = null,
): LoadoutProjection {
  const skins: RuntimeTarget[] = []
  const skipped: SkippedSelection[] = []
  const schemaIndex = buildSchemaIndex(schema)
  const schemaPresent = schema !== null

  const resolve = (
    team: RuntimeTeam,
    slot: string,
    key: string,
    rawId: SelectionId | null,
    settingsKey: string,
  ) => {
    if (rawId === null) return

    const id = String(rawId)
    const entry = catalogue.get(id)

    if (!entry) {
      skipped.push({ selection: `${team} · ${slot} · ${key}`, id, reason: 'catalogue entry not found' })
      return
    }

    const paintKit = entry.definition.paintKitId ?? 0
    const invalid = validateTarget(entry, paintKit, schemaIndex, schemaPresent)

    if (invalid) {
      skipped.push({ selection: `${team} · ${slot} · ${key}`, id, reason: invalid })
      return
    }

    const settings = settingsFor(selection, team, settingsKey, rawId)

    skins.push({
      weapon: entry.weapon,
      name: entry.name,
      paintKit,
      float: clampFloat(settings?.float ?? entry.definition.minFloat),
      seed: typeof settings?.seed === 'number' ? settings.seed : 0,
      team,
      slot,
      definitionId: entry.definition.id,
    })
  }

  for (const team of ['T', 'CT'] as const) {
    for (const [weapon, rawId] of Object.entries(selection.loadouts[team])) {
      resolve(team, 'weapon', weapon, rawId, weapon)
    }

    for (const slot of ['knife', 'gloves', 'agent', 'zeus'] as const) {
      const rawId = selection.equipment[team][slot]

      if (slot === 'agent' || slot === 'zeus') {
        if (rawId !== null) {
          skipped.push({
            selection: `${team} · ${slot}`,
            id: String(rawId),
            reason: `slot '${slot}' is not applied by the native runtime yet`,
          })
        }
        continue
      }

      resolve(team, slot, slot, rawId, slot)
    }
  }

  skins.sort((left, right) =>
    `${left.team}|${left.slot}|${left.weapon}`.localeCompare(`${right.team}|${right.slot}|${right.weapon}`))

  return {
    document: {
      version: 1,
      generatedAt: new Date().toISOString(),
      source: 'loadout',
      activeLoadoutProfileId: loadoutProfileId,
      skins,
    },
    skipped,
  }
}
