import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { validateArmoryDocument } from '../src/armory/contracts.ts'
import { migrateLegacyInventory } from '../src/armory/migrate-legacy.ts'
import { fromArmoryDocument, toArmoryDocument } from '../src/armory/obsidian-adapter.ts'
import { catalogueDefinitionId, resolveGameDefinitionId, toCatalogueDefinition } from '../src/armory/catalogue-identity.ts'

const timestamp = '2026-11-03T08:00:00.000Z'

const validDocument = () => ({
  schemaVersion: 1,
  revision: 0,
  activeProfileId: 'profile-main',
  profiles: [{
    id: 'profile-main',
    name: 'Main inventory',
    createdAt: timestamp,
    updatedAt: timestamp,
    items: [{
      id: 'item-ak-1',
      definitionId: 'skin:ak47-redline',
      kind: 'skin',
      quantity: 1,
      customization: {
        float: 0.18,
        seed: 413,
        statTrak: { enabled: true, kills: 120 },
        customName: 'Night Shift',
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    }, {
      id: 'item-sticker-stack',
      definitionId: 'sticker:team-logo',
      kind: 'sticker',
      quantity: 3,
      customization: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
  }],
})

test('accepts a valid Armory document with individual skins and stackable stickers', () => {
  assert.deepEqual(validateArmoryDocument(validDocument()), [])
})

test('rejects an active profile that does not exist', () => {
  const document = validDocument()
  document.activeProfileId = 'missing-profile'

  assert.ok(validateArmoryDocument(document).some(error =>
    error.includes('activeProfileId: does not match'),
  ))
})

test('rejects duplicate profile and item instance IDs', () => {
  const document = validDocument()
  document.profiles.push({
    ...document.profiles[0],
    name: 'Duplicate profile',
    items: document.profiles[0].items.map(item => ({ ...item })),
  })

  const errors = validateArmoryDocument(document)
  assert.ok(errors.some(error => error.includes('duplicate profile id')))
  assert.ok(errors.some(error => error.includes('duplicate instance id')))
})

test('rejects invalid skin attributes and stacked skin quantities', () => {
  const document = validDocument()
  document.profiles[0].items[0].quantity = 2
  document.profiles[0].items[0].customization.float = 1.2
  document.profiles[0].items[0].customization.seed = 1001

  const errors = validateArmoryDocument(document)
  assert.ok(errors.some(error => error.includes('skins must be individual instances')))
  assert.ok(errors.some(error => error.includes('float: expected null or a number from 0 to 1')))
  assert.ok(errors.some(error => error.includes('seed: expected null or an integer from 0 to 1000')))
})

test('rejects customization on independent sticker and charm inventory entries', () => {
  const document = validDocument()
  Object.assign(document.profiles[0].items[1], {
    customization: {
      float: null,
      seed: null,
      statTrak: null,
      customName: null,
    },
  })

  assert.ok(validateArmoryDocument(document).some(error =>
    error.includes('only skins may have skin customization'),
  ))
})


test('migrates Obsidian local profiles into Armory without losing supported item data', () => {
  const migrated = migrateLegacyInventory([
    {
      id: 'profile-main',
      name: 'Main inventory',
      updatedAt: 'Just now',
      items: [{
        instanceId: 'old-skin-1',
        definitionId: 12345,
        kind: 'skin',
        quantity: 1,
        float: '0.01842',
        seed: '413',
        stattrak: true,
        customName: 'Night Shift',
      }, {
        instanceId: 'old-sticker',
        definitionId: 'sticker:team-logo',
        kind: 'sticker',
        quantity: 4,
        float: '',
        seed: '',
        stattrak: false,
        customName: '',
      }],
    },
    {
      id: 'profile-clean',
      name: 'Clean setup',
      updatedAt: timestamp,
      items: [],
    },
  ], 'profile-clean', timestamp)

  assert.deepEqual(validateArmoryDocument(migrated), [])
  assert.equal(migrated.activeProfileId, 'profile-clean')
  assert.equal(migrated.profiles[0].items[0].definitionId, 'cs2:skin:n1ssan-skins:12345')
  assert.equal(migrated.profiles[0].items[0].customization?.float, 0.01842)
  assert.equal(migrated.profiles[0].items[0].customization?.seed, 413)
  assert.deepEqual(migrated.profiles[0].items[0].customization?.statTrak, {
    enabled: true,
    kills: 0,
  })
  assert.equal(migrated.profiles[0].items[1].definitionId, 'cs2:sticker:bymykel-stickers:team-logo')
  assert.equal(migrated.profiles[0].items[1].quantity, 4)
  assert.equal(migrated.profiles[0].items[1].customization, null)
})

test('creates a safe empty profile when legacy storage is missing or unusable', () => {
  const migrated = migrateLegacyInventory(null, 'missing-profile', timestamp)

  assert.deepEqual(validateArmoryDocument(migrated), [])
  assert.equal(migrated.activeProfileId, 'profile-main')
  assert.equal(migrated.profiles.length, 1)
  assert.equal(migrated.profiles[0].items.length, 0)
})


test('Obsidian adapter round-trips profile snapshots and skin customization', () => {
  const source = validDocument()
  const view = fromArmoryDocument(source)

  assert.equal(view.activeId, 'profile-main')
  assert.equal(view.items[0].definitionId, 'cs2:skin:external:ak47-redline')
  assert.equal(view.items[1].definitionId, 'cs2:sticker:bymykel-stickers:team-logo')
  assert.equal(view.items[0].float, '0.18')
  assert.equal(view.items[0].seed, '413')
  assert.equal(view.items[0].stattrak, true)
  assert.equal(view.items[0].stattrakKills, 120)
  assert.equal(view.items[1].quantity, 3)

  const restored = toArmoryDocument(view.profiles, view.activeId, source.revision)
  assert.deepEqual(validateArmoryDocument(restored), [])
  assert.equal(restored.profiles[0].items[0].definitionId, 'cs2:skin:external:ak47-redline')
  assert.equal(restored.profiles[0].items[0].customization?.statTrak?.kills, 120)
  assert.equal(restored.profiles[0].items[1].customization, null)
})

test('Obsidian adapter clamps invalid optional values to null and keeps non-skin stacks', () => {
  const document = toArmoryDocument([{
    id: 'profile-adapter',
    name: 'Adapter test',
    updatedAt: timestamp,
    items: [{
      instanceId: 'invalid-skin',
      definitionId: 'skin:test',
      kind: 'skin',
      quantity: 1,
      float: '1.5',
      seed: '1001',
      stattrak: false,
      customName: 'Keep me',
    }, {
      instanceId: 'charm-stack',
      definitionId: 'charm:test',
      kind: 'charm',
      quantity: 5,
      float: '',
      seed: '',
      stattrak: false,
      customName: '',
    }],
  }], 'profile-adapter', 0, timestamp)

  assert.deepEqual(validateArmoryDocument(document), [])
  assert.equal(document.profiles[0].items[0].customization?.float, null)
  assert.equal(document.profiles[0].items[0].customization?.seed, null)
  assert.equal(document.profiles[0].items[0].customization?.customName, 'Keep me')
  assert.equal(document.profiles[0].items[1].quantity, 5)
  assert.equal(document.profiles[0].items[1].customization, null)
})


test('Obsidian adapter leaves non-customizable skin instances without empty customization', () => {
  const document = toArmoryDocument([{
    id: 'profile-agents',
    name: 'Agents',
    updatedAt: timestamp,
    items: [{
      instanceId: 'agent-instance',
      definitionId: 'agent:test',
      kind: 'skin',
      quantity: 1,
      float: '',
      seed: '',
      stattrak: false,
      customName: '',
    }],
  }], 'profile-agents', 0, timestamp)

  assert.equal(document.profiles[0].items[0].customization, null)
})


test('catalogue identities are stable, namespaced by item kind and inferred source', () => {
  assert.equal(catalogueDefinitionId('skin', 2718699708), 'cs2:skin:n1ssan-skins:2718699708')
  assert.equal(catalogueDefinitionId('skin', 'skin-95831ce7c492'), 'cs2:skin:n1ssan-knives:skin-95831ce7c492')
  assert.equal(catalogueDefinitionId('sticker', 'sticker-1'), 'cs2:sticker:bymykel-stickers:sticker-1')
  assert.equal(catalogueDefinitionId('charm', 'keychain-1'), 'cs2:charm:bymykel-keychains:keychain-1')
  assert.equal(
    catalogueDefinitionId('sticker', 'sticker:sticker-1'),
    'cs2:sticker:bymykel-stickers:sticker-1',
  )
  assert.equal(
    catalogueDefinitionId('skin', 'cs2:skin:n1ssan-skins:2718699708'),
    'cs2:skin:n1ssan-skins:2718699708',
  )
  assert.equal(
    catalogueDefinitionId('skin', 'custom-entry', 'external'),
    'cs2:skin:external:custom-entry',
  )
})

test('catalogue normalization maps verified paint-kit fields but does not guess runtime definition or kit IDs', () => {
  const awp = toCatalogueDefinition({
    id: 2718699708,
    weapon: 'AWP',
    name: 'Acheron',
    type: 'Sniper Rifles',
    rarity: 'Restricted',
    paintKit: 788,
  })
  assert.equal(awp.id, 'cs2:skin:n1ssan-skins:2718699708')
  assert.equal(awp.catalogueWeaponName, 'AWP')
  assert.equal(awp.paintKitId, 788)
  assert.equal(awp.gameDefinitionId, 9)
  assert.equal(awp.stickerKitId, null)
  assert.equal(awp.keychainId, null)

  const knife = toCatalogueDefinition({
    id: 'skin-95831ce7c492',
    weapon: 'Bayonet',
    name: 'Doppler · Black Pearl',
    type: 'Knives',
    rarity: 'Covert',
    paintIndex: '417',
    phase: 'Black Pearl',
  })
  assert.equal(knife.id, 'cs2:skin:n1ssan-knives:skin-95831ce7c492')
  assert.equal(knife.paintKitId, 417)
  assert.equal(knife.phase, 'Black Pearl')

  const sticker = toCatalogueDefinition({
    id: 'sticker-1',
    kind: 'sticker',
    name: 'Shooter',
    type: 'Stickers',
  })
  assert.equal(sticker.id, 'cs2:sticker:bymykel-stickers:sticker-1')
  assert.equal(sticker.stickerKitId, null)

  const charm = toCatalogueDefinition({
    id: 'keychain-1',
    kind: 'charm',
    name: "Lil' Ava",
    type: 'Charms',
  })
  assert.equal(charm.id, 'cs2:charm:bymykel-keychains:keychain-1')
  assert.equal(charm.keychainId, null)
})


test('schema indices resolve weapon, knife, glove and agent definitions without name ambiguity', () => {
  assert.equal(resolveGameDefinitionId('AK-47', 'Rifles'), 7)
  assert.equal(resolveGameDefinitionId('AWP', 'Sniper Rifles'), 9)
  assert.equal(resolveGameDefinitionId('Bayonet', 'Knives'), 500)
  assert.equal(resolveGameDefinitionId('Karambit', 'Knives'), 507)
  assert.equal(resolveGameDefinitionId('Sport Gloves', 'Gloves'), 5030)
  assert.equal(resolveGameDefinitionId("'Blueberries' Buckshot | NSWC SEAL", 'CT Agents'), 4619)
  assert.equal(resolveGameDefinitionId('Knife', 'Knives'), null)
  assert.equal(resolveGameDefinitionId('Unknown Weapon', 'Rifles'), null)
})

test('provider def_index values map to sticker-kit and keychain domains, not base item IDs', () => {
  const sticker = toCatalogueDefinition({
    id: 'sticker-123',
    kind: 'sticker',
    name: 'Test Sticker',
    type: 'Stickers',
    def_index: '4',
  })
  const charm = toCatalogueDefinition({
    id: 'keychain-1',
    kind: 'charm',
    name: "Lil' Ava",
    type: 'Charms',
    def_index: '1',
  })

  assert.equal(sticker.gameDefinitionId, null)
  assert.equal(sticker.stickerKitId, 4)
  assert.equal(sticker.keychainId, null)
  assert.equal(charm.gameDefinitionId, null)
  assert.equal(charm.stickerKitId, null)
  assert.equal(charm.keychainId, 1)
})

test('canonical catalogue IDs retain their original source metadata when normalized again', () => {
  const normalized = toCatalogueDefinition({
    id: 'cs2:skin:n1ssan-knives:skin-95831ce7c492',
    name: 'Fade',
    weapon: 'Bayonet',
    paintIndex: '38',
  })

  assert.equal(normalized.id, 'cs2:skin:n1ssan-knives:skin-95831ce7c492')
  assert.equal(normalized.source, 'n1ssan-knives')
  assert.equal(normalized.sourceId, 'skin-95831ce7c492')
  assert.equal(normalized.paintKitId, 38)
})

test('canonical IDs normalize percent-encoded source IDs without changing identity', () => {
  const id = catalogueDefinitionId('skin', 'cs2:skin:external:custom%2Ffinish')
  assert.equal(id, 'cs2:skin:external:custom%2Ffinish')

  const definition = toCatalogueDefinition({
    id,
    name: 'Custom Finish',
  })
  assert.equal(definition.source, 'external')
  assert.equal(definition.sourceId, 'custom/finish')
})

test('malformed canonical-looking IDs are safely treated as source IDs', () => {
  const id = catalogueDefinitionId('skin', 'cs2:skin:unknown:finish')
  assert.equal(id, 'cs2:skin:external:cs2%3Askin%3Aunknown%3Afinish')
})


const staticSkins = JSON.parse(
  readFileSync(new URL('../src/skins.json', import.meta.url), 'utf8'),
) as Array<Parameters<typeof toCatalogueDefinition>[0]>
const expandedKnives = JSON.parse(
  readFileSync(new URL('../src/obsidian/knife-skins.json', import.meta.url), 'utf8'),
) as Array<Parameters<typeof toCatalogueDefinition>[0]>

test('static catalogues contain complete, collision-free canonical definition identities', () => {
  const definitions = [
    ...staticSkins.map(toCatalogueDefinition),
    ...expandedKnives.map((record) => toCatalogueDefinition({
      ...record,
      source: 'n1ssan-knives',
    })),
  ]
  const ids = new Set<string>()

  assert.equal(staticSkins.length, 2005)
  assert.equal(expandedKnives.length, 576)
  assert.equal(definitions.length, 2581)

  for (const definition of definitions) {
    assert.ok(definition.sourceId.trim().length > 0)
    assert.ok(definition.id.startsWith(`cs2:${definition.kind}:${definition.source}:`))
    assert.ok(definition.gameDefinitionId !== null, `missing game definition index: ${definition.catalogueWeaponName}`)
    assert.ok(!ids.has(definition.id), `Duplicate canonical definition ID: ${definition.id}`)
    ids.add(definition.id)
  }

  for (const record of staticSkins) {
    assert.equal(catalogueDefinitionId('skin', record.id), toCatalogueDefinition(record).id)
  }
  for (const record of expandedKnives) {
    assert.equal(
      catalogueDefinitionId('skin', record.id, 'n1ssan-knives'),
      toCatalogueDefinition({ ...record, source: 'n1ssan-knives' }).id,
    )
  }

  assert.equal(ids.size, 2581)
})

test('shared paint-kit IDs do not collapse distinct weapon definitions', () => {
  const bayonetFade = toCatalogueDefinition(
    expandedKnives.find((item) => item.weapon === 'Bayonet' && item.name === 'Fade')!,
  )
  const karambitFade = toCatalogueDefinition(
    expandedKnives.find((item) => item.weapon === 'Karambit' && item.name === 'Fade')!,
  )

  assert.equal(bayonetFade.paintKitId, 38)
  assert.equal(karambitFade.paintKitId, 38)
  assert.notEqual(bayonetFade.id, karambitFade.id)
  assert.notEqual(bayonetFade.sourceId, karambitFade.sourceId)
})

test('rare Doppler variants and Case Hardened seed-based patterns remain represented', () => {
  const names = expandedKnives.map((item) => item.name.toLowerCase())
  assert.equal(names.filter((name) => name.includes('ruby')).length, 18)
  assert.equal(names.filter((name) => name.includes('sapphire')).length, 18)
  assert.equal(names.filter((name) => name.includes('black pearl')).length, 18)
  assert.equal(names.filter((name) => name.includes('emerald')).length, 10)

  const karambitCaseHardened = expandedKnives.find(
    (item) => item.weapon === 'Karambit' && item.name === 'Case Hardened',
  )
  assert.ok(karambitCaseHardened)
  const definition = toCatalogueDefinition(karambitCaseHardened)
  assert.equal(definition.paintKitId, 44)
  assert.ok(definition.patternId)
  assert.equal(names.some((name) => name.includes('blue gem')), false)
})
