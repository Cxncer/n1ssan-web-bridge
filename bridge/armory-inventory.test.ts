import test from 'node:test'
import assert from 'node:assert/strict'

import type { ArmoryDocument } from '../src/armory/contracts.ts'
import {
  buildArmoryCatalogue,
  projectArmoryInventory,
} from '../src/armory/armory-inventory.ts'

const catalogue = buildArmoryCatalogue([
  { id: 1, weapon: 'AK-47', name: 'Redline', type: 'Rifles', rarity: 'Classified', paintKit: 282, minFloat: 0, maxFloat: 0.8 },
  { id: 'skin-abc', weapon: 'Bayonet', name: 'Fade', type: 'Knives', rarity: 'Covert', paintIndex: 38, minFloat: 0, maxFloat: 0.08 },
])

const schema = [
  { definitionIndex: 7, compatiblePaintKitIds: [0, 282] },
  { definitionIndex: 500, compatiblePaintKitIds: [0, 38] },
]

const timestamp = '2026-11-06T00:00:00.000Z'

function armoryWith(items: ArmoryDocument['profiles'][number]['items']): ArmoryDocument {
  return {
    schemaVersion: 1,
    revision: 1,
    activeProfileId: 'profile-main',
    profiles: [{
      id: 'profile-main',
      name: 'Main',
      createdAt: timestamp,
      updatedAt: timestamp,
      items,
    }],
  }
}

function instance(overrides: Partial<ArmoryDocument['profiles'][number]['items'][number]> = {}) {
  return {
    id: 'instance-1',
    definitionId: 'cs2:skin:n1ssan-skins:1',
    kind: 'skin' as const,
    quantity: 1,
    customization: null as ArmoryDocument['profiles'][number]['items'][number]['customization'],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

test('projects owned skin instances into the inventory document', () => {
  const result = projectArmoryInventory(
    armoryWith([instance({
      customization: { float: 0.2, seed: 7, statTrak: null, customName: 'Redline #1' },
    })]),
    catalogue,
    schema,
  )

  assert.equal(result.document.items.length, 1)
  assert.deepEqual(result.document.items[0], {
    instanceId: 'instance-1',
    definitionId: 'cs2:skin:n1ssan-skins:1',
    definitionIndex: 7,
    paintKit: 282,
    float: 0.2,
    seed: 7,
    statTrak: false,
    quality: 4,
    rarity: 5,
    customName: 'Redline #1',
    kind: 'skin',
  })
})

test('marks StatTrak instances with quality 9 and unusual knives with quality 3', () => {
  const result = projectArmoryInventory(
    armoryWith([
      instance({
        id: 'instance-st',
        customization: { float: 0.1, seed: 1, statTrak: { enabled: true, kills: 42 }, customName: null },
      }),
      instance({ id: 'instance-knife', definitionId: 'cs2:skin:n1ssan-knives:skin-abc' }),
    ]),
    catalogue,
    schema,
  )

  const statTrak = result.document.items.find(item => item.instanceId === 'instance-st')
  const knife = result.document.items.find(item => item.instanceId === 'instance-knife')

  assert.equal(statTrak?.quality, 9)
  assert.equal(statTrak?.statTrak, true)
  assert.equal(knife?.definitionIndex, 500)
  assert.equal(knife?.quality, 3)
})

test('skips non-skin entries and stacked items', () => {
  const result = projectArmoryInventory(
    armoryWith([
      instance({ id: 'sticker-1', kind: 'sticker', definitionId: 'cs2:sticker:bymykel-stickers:sticker-1' }),
      instance({ id: 'stack-1', quantity: 3 }),
    ]),
    catalogue,
    schema,
  )

  assert.equal(result.document.items.length, 0)
  assert.equal(result.skipped.length, 2)
})

test('skips paint kits the live schema marks incompatible', () => {
  const result = projectArmoryInventory(
    armoryWith([instance()]),
    catalogue,
    [{ definitionIndex: 7, compatiblePaintKitIds: [0] }],
  )

  assert.equal(result.document.items.length, 0)
  assert.match(result.skipped[0].reason, /not compatible/)
})

test('includes items when no live schema is available', () => {
  const result = projectArmoryInventory(armoryWith([instance()]), catalogue, null)

  assert.equal(result.document.items.length, 1)
})
