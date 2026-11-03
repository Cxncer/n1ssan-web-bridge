import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateArmoryDocument } from '../src/armory/contracts.ts'
import { migrateLegacyInventory } from '../src/armory/migrate-legacy.ts'
import { fromArmoryDocument, toArmoryDocument } from '../src/armory/obsidian-adapter.ts'
import { catalogueDefinitionId, toCatalogueDefinition } from '../src/armory/catalogue-identity.ts'

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
  assert.equal(view.items[0].float, '0.18')
  assert.equal(view.items[0].seed, '413')
  assert.equal(view.items[0].stattrak, true)
  assert.equal(view.items[0].stattrakKills, 120)
  assert.equal(view.items[1].quantity, 3)

  const restored = toArmoryDocument(view.profiles, view.activeId, source.revision)
  assert.deepEqual(validateArmoryDocument(restored), [])
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
  assert.equal(awp.gameDefinitionId, null)
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
