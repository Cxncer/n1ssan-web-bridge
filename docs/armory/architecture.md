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

1. **Catalogue definition** — what an item is. A canonical, source-aware definition ID,
   source metadata, display data, and separately verified CS2 definition / kit IDs.
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


## Catalogue identity and runtime resolution

Obsidian's normalized inventory `definitionId` now uses this canonical format:

```text
cs2:<kind>:<source>:<encoded-source-id>
```

Current source namespaces:

| Catalogue | Canonical source | Source ID example |
|---|---|---|
| Main `skins.json` | `n1ssan-skins` | `2718699708` |
| Expanded knife catalogue | `n1ssan-knives` | `skin-95831ce7c492` |
| ByMykel stickers | `bymykel-stickers` | `sticker-1` |
| ByMykel charms | `bymykel-keychains` | `keychain-1` |

The provider ID is retained as `sourceId`; it is never silently re-labelled as a
CS2 item definition index. Obsidian, the Armory adapter, and legacy migration all
use the same canonical ID helper. Existing raw numeric, generated knife, and
kind-prefixed sticker/charm references are normalized in Obsidian on read and
written back canonically on the next successful save.

### Verified mappings

- Main `skins.json` exposes a numeric `paintKit`; it maps to `paintKitId`.
- Expanded `knife-skins.json` exposes `paintIndex`; its numeric value maps to
  `paintKitId`, while phase and pattern metadata remain separate.
- The catalogue's human-readable weapon label is retained as
  `catalogueWeaponName` for later schema resolution.
- Current static catalogue data does **not** provide a verified
  `gameDefinitionId`. It remains `null` rather than being guessed from a weapon
  name or provider item ID.
- ByMykel IDs such as `sticker-1` and `keychain-1` are provider identifiers.
  They are not treated as `stickerKitId` or `keychainId` without an exact
  cross-reference to CS2's schema.

Lootline's `ItemSchema::BuildItemList` enumerates the live game's item
definitions and their `definitionIndex`; `BuildItemsGameLists` separately reads
the game's `sticker_kits` and `keychain_definitions`. This confirms that these
are distinct identity domains and that the final game IDs should be resolved
against a current CS2 schema snapshot, not inferred from display names.

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

## Implemented on operation-02-armory

- `src/armory/contracts.ts`: versioned domain types, API envelopes, and shared
  runtime validation, including source-aware catalogue definitions.
- `src/armory/catalogue-identity.ts`: canonical identity generation and
  normalization of existing catalogue records into Armory definitions.
- `src/armory/migrate-legacy.ts`: pure migration from Obsidian's current local
  profile shape, preserving supported values and normalizing string numbers.
- `bridge/armory-store.ts`: JSON-file persistence, atomic replacement, backup
  recovery, monotonic revisions, and optimistic concurrency checks.
- `GET /armory` and `PUT /armory`: Bridge endpoints for reading and replacing the
  complete multi-profile document. Stale revisions return HTTP 409; invalid
  documents return HTTP 400.
- Tests cover domain validation, legacy migration, full-document writes, stale
  revision rejection, and persistence across Bridge restart.

Obsidian now loads its inventory from `GET /armory` and persists full snapshots
through `PUT /armory`. `src/armory/obsidian-adapter.ts` translates between the
Armory domain document and Obsidian's view model, preserving per-item timestamps,
float, seed, StatTrak state/count, custom name, and independent sticker/charm stacks.

On first connection, if the Bridge still has its pristine revision-0 empty profile,
Obsidian migrates the existing `n1ssan-obsidian-preview-v1` localStorage profiles
once. The old localStorage key is retained as a recovery copy; it is no longer the
active persistence layer. Fresh installs start with an empty Main inventory rather
than demo items.

Writes are debounced and serialized. Each write uses the latest revision; a stale
write is rejected and the UI asks for a refresh instead of silently overwriting a
second session. If the Bridge is unavailable or saving fails, Obsidian shows a
blocking connection error rather than pretending the change was persisted.

The existing `/skins` loadout endpoint remains unchanged. Canonical catalogue
identity is now applied when items are added, looked up, migrated, read from Armory,
and written back. Current runtime IDs that are not present in static catalogue
sources remain explicitly unresolved. The next step is to expose a versioned CS2
schema snapshot from the game integration and resolve definition / sticker / charm
kit IDs against it, including compatibility checks for weapon paint kits.
