# Armory Inventory Contract v1.0

## Purpose

This is the canonical, application-owned representation of an inventory. It is data-only and independent of CS2 process state, runtime caches, Steam inventory, and game-specific object layouts.

## Document

- `schemaVersion`: contract version; currently `1`.
- `catalogueVersion`: identifier for the definition/paint-kit catalogue used to interpret numeric IDs.
- `profiles`: saved inventory snapshots.

The Bridge's existing `version: 1` save format is a separate legacy format. It must not be reinterpreted as `schemaVersion: 1`.

## Identity

- `profileId`: stable profile identifier.
- `instanceId`: stable identity for one particular inventory item.
- `definitionId`: numeric base-item definition identifier.
- `paintKitId`: numeric finish identifier, independent of the base definition.

Never use a display name as an identifier. Duplicate item copies must have distinct `instanceId` values.

## Item fields

| Field | Meaning |
|---|---|
| `type` | Broad item category |
| `name` | Display name |
| `finish` | Paint kit, wear and seed, or null |
| `statTrak` | Enabled state and optional kill count |
| `customName` | Name-tag text or null |
| `stickers` | Up to six sticker slot records |
| `charm` | Charm attachment data or null |
| `metadata` | Extensible JSON primitive values |

Wear values must be finite and between 0 and 1. Sticker slot numbers are 0–5 and cannot repeat. Empty sticker positions may be omitted from the array; a kit ID of zero is also accepted as an empty slot.

## Equipment

Equipment assignments are references to inventory instances, not properties that define the item itself. Each assignment contains a team, a CS2 loadout slot name, and an `instanceId`.

The initial compatibility rules map `melee` to knives, `clothing_hands` to gloves, `agent` to agents, `zeus` to Zeus items, and other weapon loadout slots to weapons. Additional slot families require an explicit mapping before being accepted.

## Validation boundaries

The TypeScript validator and C++ structural validator check shape, value ranges, duplicate IDs, sticker slots, equipment references, and known slot/type compatibility.

They do not claim that a definition or paint kit exists in the current CS2 catalogue, or that a finish is compatible with a particular definition. Those checks require a separately verified catalogue resolver.

## Compatibility

The existing `/skins` endpoint and legacy loadout parser remain unchanged. An adapter/migration layer will be introduced only after this contract and its fixtures are validated. Do not silently drop fields when converting between formats.

## Shared fixture

- Bridge: `fixtures/armory-inventory-v1.json`
- DLL reference copy: `tests/fixtures/armory-inventory-v1.json`

The copies must remain byte-for-byte identical.
