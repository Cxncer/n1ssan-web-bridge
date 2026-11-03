import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const snapshotPath = resolve(root, process.argv[2] ?? 'src/armory/n1ssan-cs2-schema.json')

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function numericId(value, allowZero = false) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0)
    ? parsed
    : null
}

function requireArray(value, field) {
  if (!Array.isArray(value)) throw new Error(`Snapshot field "${field}" must be an array.`)
  return value
}

function indexUnique(rows, getId, label, errors) {
  const indexed = new Map()

  for (const row of rows) {
    const id = numericId(getId(row), true)
    if (id === null) {
      errors.push(`${label}: invalid ID`)
      continue
    }

    if (indexed.has(id)) {
      errors.push(`${label}: duplicate ID ${id}`)
      continue
    }

    indexed.set(id, row)
  }

  return indexed
}

async function main() {
  let snapshot

  try {
    snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read schema snapshot at ${snapshotPath}: ${error.message}`)
  }

  if (snapshot.schemaVersion !== 1) {
    throw new Error(`Unsupported schema snapshot version: ${snapshot.schemaVersion ?? 'missing'}`)
  }

  const [staticSkins, expandedKnives, definitionIndex] = await Promise.all([
    readFile(resolve(root, 'src/skins.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'src/obsidian/knife-skins.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'src/armory/game-definition-index.json'), 'utf8').then(JSON.parse),
  ])

  const errors = []
  const warnings = []
  const liveItems = indexUnique(
    requireArray(snapshot.itemDefinitions, 'itemDefinitions'),
    (row) => row.definitionIndex,
    'itemDefinitions',
    errors,
  )
  const livePaintKits = indexUnique(
    requireArray(snapshot.livePaintKits, 'livePaintKits'),
    (row) => row.id,
    'livePaintKits',
    errors,
  )
  const paintKitDefinitions = indexUnique(
    requireArray(snapshot.paintKitDefinitions, 'paintKitDefinitions'),
    (row) => row.id,
    'paintKitDefinitions',
    errors,
  )
  const stickerKits = indexUnique(
    requireArray(snapshot.stickerKits, 'stickerKits'),
    (row) => row.id,
    'stickerKits',
    errors,
  )
  const keychains = indexUnique(
    requireArray(snapshot.keychainDefinitions, 'keychainDefinitions'),
    (row) => row.id,
    'keychainDefinitions',
    errors,
  )

  const missingDefinitions = []
  const unresolvedDefinitions = []
  const missingPaintKits = []
  const missingPaintKitFileDefinitions = []
  const mapKeyMismatches = []

  const catalogueRows = [
    ...staticSkins.map((row) => ({ ...row, catalogueSource: 'n1ssan-skins' })),
    ...expandedKnives.map((row) => ({ ...row, catalogueSource: 'n1ssan-knives' })),
  ]

  for (const row of catalogueRows) {
    const isAgent = String(row.type ?? '').toLowerCase().includes('agent')
    const sourceName = isAgent ? row.name : row.weapon
    const sourceKey = normalize(sourceName)
    const sourceMap = isAgent ? definitionIndex.agents : definitionIndex.weapons
    const expectedDefinitionId = numericId(sourceMap?.[sourceKey])

    if (expectedDefinitionId === null) {
      unresolvedDefinitions.push({
        source: row.catalogueSource,
        weapon: row.weapon ?? null,
        name: row.name,
        reason: 'no unambiguous provider definition mapping',
      })
      continue
    }

    const liveDefinition = liveItems.get(expectedDefinitionId)

    if (!liveDefinition) {
      missingDefinitions.push({
        source: row.catalogueSource,
        weapon: row.weapon ?? null,
        name: row.name,
        expectedDefinitionId,
      })
    } else if (numericId(liveDefinition.mapKey, true) !== expectedDefinitionId) {
      mapKeyMismatches.push({
        domain: 'itemDefinition',
        expectedId: expectedDefinitionId,
        mapKey: liveDefinition.mapKey,
        itemName: liveDefinition.itemName,
      })
    }

    const paintKitId = numericId(row.paintKit ?? row.paintIndex, true)

    if (paintKitId === null) {
      if (!isAgent) {
        warnings.push(`No paint-kit ID on ${row.weapon ?? 'unknown item'} | ${row.name}`)
      }
      continue
    }

    if (!livePaintKits.has(paintKitId)) {
      missingPaintKits.push({
        source: row.catalogueSource,
        weapon: row.weapon ?? null,
        name: row.name,
        paintKitId,
      })
    }

    if (!paintKitDefinitions.has(paintKitId)) {
      missingPaintKitFileDefinitions.push({
        source: row.catalogueSource,
        weapon: row.weapon ?? null,
        name: row.name,
        paintKitId,
      })
    }
  }

  for (const [id, kit] of livePaintKits) {
    if (numericId(kit.mapKey, true) !== id) {
      mapKeyMismatches.push({
        domain: 'paintKit',
        expectedId: id,
        mapKey: kit.mapKey,
        name: kit.name,
      })
    }
  }

  if (snapshot.itemsGameLoaded !== true) {
    errors.push('items_game.txt was not successfully parsed.')
  }

  if (snapshot.paintKitMapAvailable !== true) {
    errors.push('The live paint-kit map was not successfully read.')
  }

  if (unresolvedDefinitions.length) {
    errors.push(`${unresolvedDefinitions.length} catalogue rows have no provider definition mapping.`)
  }

  if (missingDefinitions.length) {
    errors.push(`${missingDefinitions.length} catalogue rows reference definitions absent from the live game schema.`)
  }

  if (missingPaintKits.length) {
    errors.push(`${missingPaintKits.length} catalogue rows reference paint kits absent from the live game schema.`)
  }

  if (missingPaintKitFileDefinitions.length) {
    errors.push(`${missingPaintKitFileDefinitions.length} catalogue rows reference paint kits absent from items_game.txt.`)
  }

  if (mapKeyMismatches.length) {
    errors.push(`${mapKeyMismatches.length} live schema map keys do not match their object IDs.`)
  }

  const report = {
    snapshotPath,
    createdAtUtc: snapshot.createdAtUtc ?? null,
    counts: {
      catalogueRows: catalogueRows.length,
      liveItemDefinitions: liveItems.size,
      livePaintKits: livePaintKits.size,
      paintKitFileDefinitions: paintKitDefinitions.size,
      stickerKits: stickerKits.size,
      keychainDefinitions: keychains.size,
    },
    results: {
      unresolvedDefinitions: unresolvedDefinitions.length,
      missingDefinitions: missingDefinitions.length,
      missingPaintKits: missingPaintKits.length,
      missingPaintKitFileDefinitions: missingPaintKitFileDefinitions.length,
      mapKeyMismatches: mapKeyMismatches.length,
      warnings: warnings.length,
      paintKitCompatibility: 'not evaluated; requires per-item generated-material checks',
    },
    errors,
    details: {
      unresolvedDefinitions: unresolvedDefinitions.slice(0, 25),
      missingDefinitions: missingDefinitions.slice(0, 25),
      missingPaintKits: missingPaintKits.slice(0, 25),
      missingPaintKitFileDefinitions: missingPaintKitFileDefinitions.slice(0, 25),
      mapKeyMismatches: mapKeyMismatches.slice(0, 25),
      warnings: warnings.slice(0, 25),
    },
  }

  console.log(JSON.stringify(report, null, 2))

  if (errors.length) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
