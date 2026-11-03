import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const snapshotPath = resolve(root, process.argv[2] ?? 'src/armory/n1ssan-cs2-schema.json')

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function numericId(value, allowZero = false) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (value === '') return null
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

  if (snapshot.schemaVersion !== 2) {
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
  const paintKitMapKeyMismatches = []
  const missingCompatibilityData = []
  const incompatiblePaintKitPairs = []
  const checkedDefinitionIds = new Set()
  const checkedCompatibilityPairs = new Set()
  const compatibilityByDefinitionId = new Map()

  for (const [definitionId, item] of liveItems) {
    if (!Array.isArray(item.compatiblePaintKitIds)) {
      missingCompatibilityData.push({ definitionId, itemName: item.itemName ?? null })
      continue
    }

    compatibilityByDefinitionId.set(
      definitionId,
      new Set(item.compatiblePaintKitIds.map((id) => numericId(id, true)).filter((id) => id !== null)),
    )
  }

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

    if (!checkedDefinitionIds.has(expectedDefinitionId)) {
      checkedDefinitionIds.add(expectedDefinitionId)
      if (!liveItems.has(expectedDefinitionId)) {
        missingDefinitions.push({
          source: row.catalogueSource,
          weapon: row.weapon ?? null,
          name: row.name,
          expectedDefinitionId,
        })
      }
    }

    const paintKitId = numericId(row.paintKit ?? row.paintIndex, true)

    if (paintKitId === null) {
      if (!isAgent) {
        warnings.push(`No paint-kit ID on ${row.weapon ?? 'unknown item'} | ${row.name}`)
      }
      continue
    }

    if (paintKitId === 0) continue

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

    if (livePaintKits.has(paintKitId) && paintKitDefinitions.has(paintKitId)) {
      const pairKey = `${expectedDefinitionId}:${paintKitId}`
      if (!checkedCompatibilityPairs.has(pairKey)) {
        checkedCompatibilityPairs.add(pairKey)
        const compatibleIds = compatibilityByDefinitionId.get(expectedDefinitionId)

        if (!compatibleIds) {
          if (!missingCompatibilityData.some((entry) => entry.definitionId === expectedDefinitionId)) {
            missingCompatibilityData.push({
              definitionId: expectedDefinitionId,
              itemName: liveItems.get(expectedDefinitionId)?.itemName ?? null,
            })
          }
        } else if (!compatibleIds.has(paintKitId)) {
          incompatiblePaintKitPairs.push({
            source: row.catalogueSource,
            definitionId: expectedDefinitionId,
            itemName: liveItems.get(expectedDefinitionId)?.itemName ?? null,
            weapon: row.weapon ?? null,
            name: row.name,
            paintKitId,
            paintKitName: paintKitDefinitions.get(paintKitId)?.name ?? null,
          })
        }
      }
    }
  }

  for (const [id, kit] of livePaintKits) {
    if (numericId(kit.mapKey, true) !== id) {
      paintKitMapKeyMismatches.push({
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

  if (snapshot.compatibilityScanAvailable !== true) {
    errors.push('Per-item generated-material compatibility scan was not successfully completed.')
  }

  if (missingCompatibilityData.length) {
    errors.push(`${missingCompatibilityData.length} live item definitions have no compatibility scan data.`)
  }

  if (incompatiblePaintKitPairs.length) {
    errors.push(`${incompatiblePaintKitPairs.length} catalogue weapon/paint-kit pairs have no generated material asset.`)
  }

  if (stickerKits.size === 0) {
    errors.push('No sticker-kit definitions were parsed from items_game.txt.')
  }

  if (keychains.size === 0) {
    errors.push('No keychain definitions were parsed from items_game.txt.')
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

  if (paintKitMapKeyMismatches.length) {
    errors.push(`${paintKitMapKeyMismatches.length} live paint-kit map keys do not match their paint-kit IDs.`)
  }

  const report = {
    snapshotPath,
    createdAtUtc: snapshot.createdAtUtc ?? null,
    counts: {
      catalogueRows: catalogueRows.length,
      uniqueCatalogueDefinitionIdsChecked: checkedDefinitionIds.size,
      liveItemDefinitions: liveItems.size,
      livePaintKits: livePaintKits.size,
      paintKitFileDefinitions: paintKitDefinitions.size,
      stickerKits: stickerKits.size,
      keychainDefinitions: keychains.size,
      compatibilityItemsChecked: snapshot.compatibilityItemsChecked ?? 0,
      compatibilityPairsChecked: snapshot.compatibilityPairsChecked ?? 0,
      compatiblePairsFound: snapshot.compatiblePairsFound ?? 0,
      uniqueCataloguePaintKitPairsChecked: checkedCompatibilityPairs.size,
    },
    results: {
      unresolvedDefinitions: unresolvedDefinitions.length,
      missingDefinitions: missingDefinitions.length,
      missingPaintKits: missingPaintKits.length,
      missingPaintKitFileDefinitions: missingPaintKitFileDefinitions.length,
      itemDefinitionMapKeyComparison: 'not applicable; internal map keys are distinct from definitionIndex',
      paintKitMapKeyMismatches: paintKitMapKeyMismatches.length,
      warnings: warnings.length,
      missingCompatibilityData: missingCompatibilityData.length,
      incompatiblePaintKitPairs: incompatiblePaintKitPairs.length,
      paintKitCompatibility: snapshot.compatibilityScanAvailable === true
        ? (incompatiblePaintKitPairs.length === 0 && missingCompatibilityData.length === 0
          ? 'passed for all catalogue weapon/paint-kit pairs'
          : 'failed; inspect incompatible pairs and missing scan data')
        : 'not evaluated; live generated-material scan unavailable',
    },
    errors,
    details: {
      unresolvedDefinitions: unresolvedDefinitions.slice(0, 25),
      missingDefinitions: missingDefinitions.slice(0, 25),
      missingPaintKits: missingPaintKits.slice(0, 25),
      missingPaintKitFileDefinitions: missingPaintKitFileDefinitions.slice(0, 25),
      paintKitMapKeyMismatches: paintKitMapKeyMismatches.slice(0, 25),
      missingCompatibilityData: missingCompatibilityData.slice(0, 25),
      incompatiblePaintKitPairs: incompatiblePaintKitPairs.slice(0, 50),
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
