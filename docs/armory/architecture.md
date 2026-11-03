# Operation 02 — Armory

## Purpose

Armory is the canonical inventory domain for n1ssan. It owns catalogue definitions,
owned item instances, inventory profiles, persistence, and the API contract consumed
by Obsidian and the Bridge.

Obsidian is a client of Armory. It must not be the source of truth for inventory data.

## Audit baseline (2026-11-03)

### n1ssan Web / Bridge

The current preview branch contains:

- `bridge/server.ts`: a JSON-file-backed Bridge with atomic temporary-file writes,
  backup recovery, validation, and a single latest-loadout state.
- `src/obsidian/ObsidianApp.tsx`: browser-local inventory profiles and item state.
- `src/skins.json` and `src/obsidian/knife-skins.json`: static catalogue data.
- The current Obsidian item shape uses `instanceId`, `definitionId`, `kind`,
  `quantity`, string-valued `float` / `seed`, `stattrak`, and `customName`.
- Profile data is currently stored in `localStorage`; it is not yet backed by
  Bridge persistence.
- The existing Bridge `/skins` endpoint represents one latest loadout and is not
  a multi-profile inventory API.

### Lootline cross-reference

Reference repository:
[Cxncer/Lootline-for-reference-only](https://github.com/Cxncer/Lootline-for-reference-only)

Relevant implementation files:

- `source/chadware2/features/skinchanger/item_schema.h`
  - Separates item definitions, paint kits, sticker kits, music kits, and keychains.
  - Item definitions carry the CS2 definition index and classification flags.
  - Paint kits and sticker/keychain definitions have their own IDs and display data.
- `source/chadware2/config/config.h`
  - Separates the base item definition from per-item paint customization.
  - Captures paint kit, seed, wear, StatTrak state/count, custom name,
    six sticker slots, and keychain configuration.
  - Separates T and CT configurations.
- `source/chadware2/config/configmanager.h`
  - Serializes and deserializes configuration data.
  - Supports multiple named config snapshots and legacy single-loadout migration.
- `source/chadware2/features/unboxer/game_inventory.h`
  - Models an owned game item with a unique 64-bit item ID, definition index,
    quality, rarity, origin, paint attributes, stickers, keychain, and other
    game-specific attributes.
  - Explicitly distinguishes inventory item instances from catalogue definitions.

Lootline is a reference for CS2 item semantics and proven customization fields.
Its game-facing SharedObject representation, runtime offsets, and injection details
are not Armory's persistence schema and must not be copied into the web domain.

## Domain boundaries

1. **Catalogue definition** — what an item is. Stable definition ID, kind,
   display metadata, category, rarity, image, and applicable CS2 definition/paint IDs.
2. **Inventory instance** — what the user owns. Unique n1ssan instance ID,
   catalogue definition reference, quantity, timestamps, and supported customization.
3. **Inventory profile** — a named, complete snapshot of inventory instances.
4. **Armory document** — versioned collection of profiles plus the active profile
   and a monotonic revision for conflict detection.

### Item behavior

- Skins are individual instances; each has quantity 1 and its own float, seed,
  StatTrak, and custom name.
- Stickers and charms are independent inventory entries. The current Obsidian
  experience may aggregate identical definitions as a quantity stack.
- Armory does not model sticker placement on a weapon or charm attachment to a
  weapon. Those are game-side application concerns, outside this operation's
  inventory ownership model.
- Agents and other non-wearable skin catalogue entries use the skin item kind
  but may have null customization.
- Catalogue IDs are strings in the domain so numeric CS2 IDs and namespaced
  external IDs can coexist without lossy coercion.

## Profile semantics

- Profiles are complete snapshots, not deltas.
- Switching the active profile replaces the visible inventory with that profile's
  items; it never merges.
- Saving a new profile clones the current snapshot and assigns fresh instance IDs.
- At least one profile must remain.
- Deleting the active profile selects another existing profile atomically.

## API direction

The first Bridge-backed API is a document resource:

- `GET /armory` returns `{ data: ArmoryDocument }`.
- `PUT /armory` accepts `{ expectedRevision, data }`.
- A successful write validates the full document, increments revision, and persists
  it atomically.
- A stale `expectedRevision` returns `REVISION_CONFLICT`; it must not overwrite
  newer data.
- The existing `/skins` endpoint remains untouched during the initial migration.

The exact storage implementation can evolve independently from the contract.
The current JSON-file persistence is a safe starting point; database adoption is
not assumed until deployment and multi-user requirements are defined.

## Initial implementation boundary

This operation begins by introducing the domain contract and shared runtime
validation. The next implementation slice will add Bridge persistence and tests,
then migrate Obsidian through an adapter while preserving its current preview data.
