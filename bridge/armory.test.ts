import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateArmoryDocument } from '../src/armory/contracts.ts'
import { migrateLegacyInventory } from '../src/armory/migrate-legacy.ts'

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
  assert.equal(migrated.profiles[0].items[0].definitionId, '12345')
  assert.equal(migrated.profiles[0].items[0].customization?.float, 0.01842)
  assert.equal(migrated.profiles[0].items[0].customization?.seed, 413)
  assert.deepEqual(migrated.profiles[0].items[0].customization?.statTrak, {
    enabled: true,
    kills: 0,
  })
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
