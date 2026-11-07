# Armory sticker & charm persistence — design (no implementation yet)

Status: **implemented**. See §7 for what was built and where it differs from the
proposal below.

Scope: Armory mode only. Loadout mode must behave exactly as it does today.
Goal: CS2's own inventory screen keeps applying stickers and charms; n1ssan
observes the resulting state, persists it per Armory instance, restores it when
the inventory is rebuilt, and shows it in the bridge UI.

---

## 1. Architecture findings

### 1.1 Where items come from

```
armory-data.json        (bridge owns, canonical profile: instances + customization)
   │  projectArmoryInventory()            src/armory/armory-inventory.ts
   ▼
armory-inventory.json   (bridge writes, runtime projection, one flat item per instance)
   │  ArmoryInventory::StartWatcher / AdoptPending        src/inventory/armory_inventory.cpp
   ▼
CS2 local SOCache       (LootSOCache::Create -> attributes) src/inventory/loot_socache.cpp
   │
   ▼
in-match weapon view    (apply.cpp rewrites the view's attribute list)  src/skin/apply.cpp
```

* Projection is regenerated whenever the profile is written (`PUT /armory`
  → `bridge/server.ts:849`, `POST /armory/apply` → `:760`, mode switch → `:228`)
  through `writeArmoryInventory()` (`:150`).
* The DLL replaces the managed set on every reload: items whose id already
  exists are **retained**, others are created, unknown managed ids removed
  (`armory_inventory.cpp:~660-700`).
* Managed ids are derived, not random: `StableIdFor()` hashes
  `instanceId + definition + quality + rarity + paintKit + seed + wear +
  statTrak + stickerKit + keychain + keychainSeed` and tags the top nibble
  `0x9…` (`armory_inventory.cpp:~95-128`). **Any field added to that hash
  changes the item id**, which forces a remove+create on the next reload.
* `SameRenderable()` (`armory_inventory.cpp:~377-392`) decides whether two
  owned instances of one definition may be treated as interchangeable for the
  "no assignment" fallback.
* Item creation sets attributes by *name* through `LootSchema::SetAttributeFloatByName`
  (`loot_schema.cpp`), which resolves the name via `CEconItemSystem`,
  dispatches float vs `uint32`-bits by attribute type, and logs `attribute not
  found by name` on failure. Today only one sticker exists on that path:
  `"sticker slot 0 id"` for sticker *items*, and `"keychain slot 0 id"/"…
  seed"` for charm items (`loot_socache.cpp:~468-486`). No wear, rotation,
  offsets or schema — a sticker item is not a sticker *attachment*.

### 1.2 In-match rendering is a separate item

`ApplyWeaponSkin` calls `EconAttr_Remove(view)` then
`EconAttr_Create(view, paintKit, wear, seed, statTrak)` (`apply.cpp:563-571`),
and `EconAttr_Create` builds exactly 3 paint attributes (+2 StatTrak) and
refuses when the vector is non-empty (`sdk/item_view.cpp:76-…`).
So the weapon `C_EconItemView`'s attribute list **never contains sticker or
charm attributes**; whatever the inventory item carries is dropped in match.
`IsAlreadyApplied()` (`apply.cpp:~592-618`) compares only paint/seed/wear/
StatTrak/quality, so an attachment-only change would not trigger a re-apply.

### 1.3 Reading attributes is already possible

`sdk/item_view.h` already models `CAttributeList::m_Attributes` faithfully
(`EconItemAttribute_t` with `defIndex` + `value`/`initialValue`), exposes
`GetAttributeVector()` and `GetNetworkedVector()`, and `loot_schema.cpp` has
`GetCachedAttrDef(index)` (index -> definition) plus `GetAttrDefByName(name)`.
`LootSOCache` has `HasItem`/`GetIdsByPrefix` but **no way to get the item
pointer**, and no update path: a retained item is never re-synced.

### 1.4 The bridge's Obsidian round-trip is lossy

`toArmoryDocument()` (`src/armory/obsidian-adapter.ts:90-135`) rebuilds every
instance from the UI's flat fields and sets `customization = null` for any
`kind !== 'skin'`. Any instance field it does not know about is dropped on the
next UI save. This must be fixed *before* detected attachments are stored in
the profile, or a single UI save destroys them.

### 1.5 Sticker/charm *items* are not projected at all

`projectArmoryInventory()` skips any instance with `quantity !== 1`
(`src/armory/armory-inventory.ts:121-128`). None of the live profile's 8 non-skin
instances reach the game today: 6 are stacked (stickers 4/3/3/3/2, one charm 2),
and the 2 quantity-1 charms miss the catalogue lookup. The game therefore
currently has
**no sticker or charm items in the inventory**, so CS2's apply flow has nothing
to consume. This is a prerequisite, not a detail.

---

## 2. CS2 representation and Lootline references

Attribute indices on the econ item (Lootline constants, checked against the
2026-10 client):

| concept | attribute | index | type |
| --- | --- | --- | --- |
| sticker slot n id | `sticker slot N id` | `113 + 4n` | uint32 bits in a float |
| sticker slot n wear | `sticker slot N wear` | `114 + 4n` | float 0..1 |
| sticker slot n scale | `sticker slot N scale` | `115 + 4n` | float, CS2 keeps 1.0 |
| sticker slot n rotation | `sticker slot N rotation` | `116 + 4n` | float -180..180 |
| sticker slot n offsets | `sticker slot N offset x/y` | `278 + 2n`, `279 + 2n` | float |
| sticker slot n schema | `sticker slot N schema` | `290 + n` | int: the position offsets are relative to |
| charm id | `keychain slot 0 id` | `299` | uint32 bits |
| charm offsets | `keychain slot 0 offset x/y/z` | `300/301/302` | float |
| charm seed | `keychain slot 0 seed` | `306` | uint32 bits |
| charm highlight | `keychain slot 0 highlight` | `314` | uint32 bits |
| charm sealed sticker | `keychain slot 0 sticker` | `321` | uint32 bits |

References (`E:\CS2\Lootline_v1.5.2_source_[unknowncheats.me]_\Lootline\source`):

* `chadware2/features/unboxer/game_inventory.cpp:84-100` — every index above,
  with the "id / wear / scale / rotation at 113+4n, offsets at 278+2n, schema at
  290+n" comment.
* `chadware2/features/unboxer/game_inventory.cpp:668-694` — `WriteSticker`:
  one slot's *complete* attribute set is written every time ("so nothing of a
  sticker that was there before stays behind"), an empty slot writes `id 0`,
  and `schema` defaults to the slot itself because *"the gun's sticker position
  it's drawn at ... isn't the slot it's kept in"*.
* `chadware2/features/skinchanger/econ_item_attribute_manager.cpp:24-140` —
  attribute struct, `SetFloatAttribute` / `SetIntegerAttribute`
  (`std::bit_cast<float>(value)` for integer attributes), per-slot builders and
  `GetStickerAttributeCount` (offsets only when non-zero, schema only when set).
* `econ_item_attribute_manager.cpp:216-282` — `Create`: allocates a
  `CUtlVector` with `MemAlloc`, fills, sets `size`/`capacity`/`data`,
  `growSizeAndFlags = 0x40000000`. n1ssan's `EconAttr_Create` is the same shape.
* `econ_item_attribute_manager.cpp:284-389` — `SyncStickers`: **updates an
  existing list in place, preserving every unrelated attribute**; grows by
  reallocating and `MemFree`ing the old block. This is the primitive n1ssan
  needs for "retained item, new attachment state".
* `econ_item_attribute_manager.cpp:505-514` — `GetKeychainId`: reads
  `m_NetworkedDynamicAttributes` first, `m_AttributeList` only when asked.
* `econ_item_attribute_manager.h:10-73` — `StickerData`/`KeychainData` shapes,
  `STICKER_SLOT_COUNT = 6`, `GetKeychainId(item, includeMainList)`.
* `chadware2/features/unboxer/game_inventory.h:16-52` — the same data model
  (`GameInv::StickerSlot`, `NewItem::stickers[6]`, `keychain*`).
* `chadware2/features/unboxer/game_inventory.cpp:805-816` — the placement
  fallback: CS2's sticker/charm *popup* keeps the pending placement in globals
  (sticker slot `+0x28`, x `+0x3C`, y `+0x40`, rotation `+0x34`, wear `+0x30`;
  charm x/y/z `+0x3C/0x40/0x44`). This is how Lootline learns what the player
  picked. It matters for §5 risk R1.
* Lootline never *observes* a native apply result: it reads the popup globals,
  then writes the attributes itself. n1ssan wants the opposite (planet writes,
  n1ssan reads), which is exactly the part that needs a probe.

---

## 3. Data schema

### 3.1 Profile (canonical, `armory-data.json`, per instance)

Attachments are stored on the **instance**, keyed by that instance's id — never
by definition, so four AK-47s each keep their own stickers.

```jsonc
{
  "id": "legacy:profile-…:item-…-fpb9j",
  "definitionId": "cs2:skin:n1ssan-skins:3074130842",
  "kind": "skin",
  "quantity": 1,
  "customization": { "float": 0.03824, "seed": 1, "statTrak": null, "customName": null },
  "attachments": {
    "stickers": [
      {
        "slot": 0,
        "kitId": 1234,
        "wear": 0.12,
        "scale": 1.0,
        "rotation": 0.0,
        "offsetX": 0.0,
        "offsetY": 0.0,
        "schema": 3,
        "sourceInstanceId": "legacy:profile-…:item-…-kit0"
      }
    ],
    "charm": {
      "kitId": 5613, "seed": 7,
      "x": 0.0, "y": 0.0, "z": 0.0,
      "stickerKitId": null, "highlightId": null,
      "sourceInstanceId": null
    },
    "observedAt": "2026-11-07T16:02:11.004Z",
    "observedInventoryRevision": 57,
    "origin": "native"
  }
}
```

Rules:

* `attachments` is optional. Absent = "never observed", not "empty".
* `origin`: `native` (read from CS2) | `legacy` (imported) | `manual` (fixture).
  Only `native` records may be replaced by a later detection.
* `schema` may be `null` meaning "the attribute was absent" — restoring must
  then omit it rather than write 0.
* An empty `stickers` array with `origin: "native"` is a valid, meaningful
  state (all stickers removed).
* `sourceInstanceId` links the consumed Armory sticker/charm instance when the
  projected kit set lets us resolve it; it is nullable and never required.

`ARMORY_SCHEMA_VERSION` stays `1`; the field is additive and validated when
present. `armory_contract.h` (`Armory::Sticker`, `Armory::Charm`, `Item`) must
gain `scale`, `sourceInstanceId`, `origin`, `observedAt`,
`observedInventoryRevision` so both sides agree; the TS contract needs the
matching types (it currently has none).

### 3.2 Runtime projection (`armory-inventory.json`)

The DLL's JSON reader is a hand-rolled scanner that finds keys by name in one
flat object per item (`armory_inventory.cpp:~200-256`), so the projection stays
flat and fixed-width — no nested arrays:

```jsonc
{
  "version": 2,
  "attachmentsVersion": 1,
  "profileId": "profile-1793694856473-vrmr",
  "inventoryRevision": 57,
  "items": [
    {
      "instanceId": "…",
      "definitionIndex": 7, "paintKit": 180, "float": 0.03824, "seed": 1, "statTrak": true,
      "quality": 9, "rarity": 6,
      "sticker0Kit": 1234, "sticker0Wear": 0.12, "sticker0Scale": 1,
      "sticker0Rotation": 0, "sticker0OffsetX": 0, "sticker0OffsetY": 0, "sticker0Schema": 3,
      "sticker1Kit": 0,
      "charmKit": 5613, "charmSeed": 7, "charmX": 0, "charmY": 0, "charmZ": 0,
      "charmSticker": 0, "charmHighlight": 0
    }
  ]
}
```

`version: 2` + `attachmentsVersion` let the DLL recognise a bridge that predates
the feature and refuse to overwrite anything (see R6).

### 3.3 Detection channel (DLL -> bridge)

Nowhere in the DLL is there an HTTP client, and the bridge is the single writer
of `armory-data.json`. Keep it that way: the DLL writes a third file, the
bridge merges it.

`armory-detected-attachments.json` (written by the DLL, atomic rename):

```jsonc
{
  "dllVersion": "…",
  "sessionId": "2026-11-07T15:27:00Z-25484",
  "seq": 12,
  "profileId": "profile-1793694856473-vrmr",
  "inventoryRevision": 57,
  "records": [
    {
      "seq": 12,
      "instanceId": "…",
      "projectedItemId": "10375…",
      "complete": true,
      "stableForMs": 400,
      "consumedToolInstanceId": "…",
      "consumedToolKind": "sticker",
      "attachments": {
        "stickers": [
          { "slot": 0, "kitId": 1234, "sourceInstanceId": "…" }
        ],
        "charm": null
      },
      "observedAt": "2026-11-07T16:02:11.004Z"
    }
  ]
}
```

`armory-attachments-ack.json` (written by the bridge):
`{ "ackedSeq": 12, "profileId": "…", "inventoryRevision": 58 }`.
The DLL drops records `<= ackedSeq` on the next write; merging is idempotent by
`(instanceId, seq)`.

---

## 4. Proposed changes

### 4.1 DLL (`development/CS2-n1ssan`)

1. **`src/inventory/attachments.h/.cpp` (new)** — one `AttachmentSet` type
   (`std::array<StickerState,6>`, `CharmState`, flags), attribute indices, name
   table, and:
   * `ResolveIndices()` — startup validation: for every name, `GetAttrDefByName`
     must resolve and equal `GetCachedAttrDef(expectedIndex)`; log
     `[attachments] sticker slot 0 id=113 ok`; any mismatch disables detection
     (R2).
   * `bool Read(void* item, AttachmentSet& out)` — full 6-slot + charm scan over
     `m_AttributeList` (and `m_NetworkedDynamicAttributes` as a fallback for
     real items), `__try`-guarded, `complete=false` on any failure.
   * `Compare(a,b)`, `WriteDetectedFile()`, `ReadAck()`.
2. **`src/inventory/loot_socache.{h,cpp}`** — `NewItem` gains
   `std::array<StickerSlot,6> stickers` and `CharmSlot charm`; `Create` writes
   every slot's attributes (id/wear/scale/rotation always; offsets and schema
   only when meaningful) plus the charm's five/six attributes, all by name;
   new `void* Find(uint64_t id)` (wraps the existing `FindItemInCache`) and
   `bool SyncAttachments(uint64_t id, const AttachmentSet&)` (Lootline's
   `SyncStickers` shape: match by defIndex, patch values, append missing,
   realloc+`MemFree` when capacity is short, never touch paint/seed/wear).
3. **`src/inventory/armory_inventory.cpp`**
   * parse the flat `stickerN*` / `charm*` keys into `ArmoryItem`;
   * **exclude attachments from `StableIdFor`** (identity must not move when a
     sticker is applied), and **include them in `SameRenderable`** (a stickered
     AK no longer renders like a bare one — this is what keeps the definition
     fallback honest);
   * retained branch: after `retained item`, compare projection attachments to
     the item's current attributes and `SyncAttachments` when they differ;
   * keep an `id -> instanceId` map for detection records.
4. **`src/skin/apply.cpp` + `dispatch.cpp`** — the in-match view gets
   attachments: `EconAttr_Create` (or a new `EconAttr_AddAttachments`) writes
   stickers/charm right after paint; `IsAlreadyApplied` gains an attachment
   fingerprint so a sticker change re-applies. Attachments are passed **only
   when `RuntimeModeState::Current() == Armory`** (R7); `ApplyDefault` keeps
   clearing the list, as today.
   *Plumbing:* `ResolveTargetForWeapon`/`GetTargetForItemId` gain an out
   `const AttachmentSet*` (null in Loadout), so `TargetSkin` stays untouched.
5. **`src/hooks/frame_stage.cpp`** — next to `ArmoryInventory::AdoptPending()`
   (already gated on `!inMatch && Armory`, i.e. the game thread while the
   inventory screen is open), call `Attachments::Observe()` at most every
   500 ms; it reads all owned instances, and when a snapshot is **identical for
   two consecutive polls** and differs from what the DLL last wrote for that
   instance, it queues a record.
6. **`n1ssan-dll.vcxproj`** — add the new sources (project lists files
   explicitly).

### 4.2 Bridge (`development/n1ssan-web-bridge`)

1. `src/armory/contracts.ts` — attachment types + validation (slot range,
   unique slots, finite numbers, safe ids, optional `schema`, `origin` enum).
2. `src/armory/armory-inventory.ts` — emit `version: 2`, `attachmentsVersion`,
   the flat keys; also project stacked sticker/charm instances as `quantity`
   separate instances (prerequisite §1.5), each with its own id.
3. `src/armory/obsidian-adapter.ts` — carry `attachments` through both
   directions (fixes the lossy round-trip, R4).
4. `bridge/attachments-store.ts` (new) + `server.ts` — poll
   `armory-detected-attachments.json` every 2 s (same interval family as the
   existing session sweep); accept a record only if `profileId` and
   `inventoryRevision` match the live document, `complete === true`, the
   instance exists **and** its `projectedItemId` matches the id the projection
   would derive; merge via `ArmoryStore.replace` with revision-conflict retry;
   re-project; write the ack; log one line per merged record.
5. `src/armory/equipment.ts` / UI — **display only**: sticker chips (kit image
   from the catalogue via `stickerKitId`) and a charm chip on the instance tile
   plus a read-only detail list (slot, wear, rotation, offsets, schema,
   `observedAt`). No apply/edit path in the UI.
6. `docs/`, `schemas/armory-inventory-v1.schema.json` (or a v2 file) and the
   existing tests (`bridge/armory-inventory.test.ts`, `armory.test.ts`) follow.

### 4.3 What does *not* change

Equipment resolution (`ResolveTargetForWeapon` priority: in-game loadout ->
equipment document -> definition equivalence), glove/knife/agent application,
projection of skins, Loadout mode, `StableIdFor` inputs other than attachments.

---

## 5. Risks

* **R1 — native apply may not persist on synthetic items.** CS2's sticker tool
  is a GC operation; for a client-created item the GC may reject it and the
  client may roll back. Lootline sidesteps this by reading the popup globals
  and writing attributes itself. If the probe (§6, I2) shows the attributes
  never change, the constraint "CS2 native inventory must remain responsible"
  cannot be met as literally stated, and we need a decision: accept
  popup-driven write (n1ssan becomes the applier), or drop persistence for
  charms/stickers that the game refuses. **This is the one thing to learn
  first.**

  **Answered by the in-game symptom.** The pending indicator never finished,
  which is the unanswered-request case, not a rollback. Lootline's answer for
  its own items is therefore the one to port, and it keeps the native UI in
  charge: hook `InventoryAPI.UseTool`, read what the popup placed, write the
  attributes when it asks, announce the item as updated, consume the sticker /
  charm item and dispatch CS2's item-customization event on panorama's main
  thread. n1ssan never opens an apply flow of its own - see
  `development/CS2-n1ssan/src/inventory/native_apply.cpp`.
* **R2 — attribute index drift.** Mitigated by name-based validation at startup
  and by refusing to persist when a name does not resolve; indices are never
  written blind.
* **R3 — reading the wrong item.** Only the owned SOCache object is read; the
  in-match weapon view holds n1ssan's own rewrite, and a real equipped item
  carries the *player's* stickers in `m_NetworkedDynamicAttributes`. Reading the
  wrong one would persist the player's real account cosmetics into the profile.
  Guard: read `m_AttributeList` of the managed item only, and require the id to
  be in the managed set.
* **R4 — profile data loss through the UI.** Fixed in §4.2.3 before detection
  is enabled; the API must reject a write that drops `attachments` on an
  instance whose `origin` is `native` (or the UI must be upgraded in the same
  increment).
* **R5 — write storms / loops.** Detection -> merge -> re-project -> reload ->
  `SyncAttachments` -> new snapshot. Loop is broken by updating the DLL's
  "last written for this instance" immediately after a successful sync, and by
  the `seq`/ack idempotency.
* **R6 — incomplete detection.** Never persist when: item not found, vector
  unreadable, scan incomplete, profileId/revision mismatch, snapshot not stable
  across two polls, or the bridge projection is `version < 2`. "Incomplete"
  never removes data; it only skips.
* **R7 — Loadout bleed.** Attachments are read only in Armory mode, and written
  to the in-match view only when `RuntimeModeState::Current() == Armory`. A
  Loadout-mode assertion test is part of I5.
* **R8 — consumption semantics.** A successful native apply reports the exact
  source tool instance. The Bridge decrements its quantity or removes it from
  the active profile in the same revision-safe write that saves the attachment.
  Replayed records are idempotent because the saved attachment retains the
  source instance id. We still do not model scraped sticker state.
* **R9 — profile switching.** Detection is tagged with profileId+revision, so a
  switch mid-flight discards stale observations instead of cross-writing.

## 6. Validation strategy (incremental)

* **I0 (bridge, no game).** Schema + validation + projection tests; adapter
  round-trip test proving a UI save preserves `attachments`; `npm test`.
* **I1 (DLL, create/restore only).** Fixture projection with one stickered and
  one charmed item; verify in the inventory screen and via a `[attach-read]`
  startup log that CS2 sees the attributes; no detection, no persistence.
* **I2 (probe, read-only).** Enable observation logging only. In the game,
  apply a sticker to one projected weapon and a charm to another, then reopen
  the loadout screen. Expect `[attach-observe]` to show the slot id/wear/
  rotation/offsets changing, and to still be there after closing/reopening the
  inventory. **Decision gate for R1.**
* **I3 (persist).** Enable the detection file + bridge merge for that one
  instance; confirm `armory-data.json` gains `attachments` with the right slot
  data and that `armory-inventory.json` round-trips it; then restart CS2,
  re-inject, and confirm the attachment is restored (item id unchanged).
* **I4 (in-match render).** Extend the weapon view write; confirm the sticker
  and charm render in a match, and that a sticker change re-applies without an
  item recreation (`retained` + sync in the log).
* **I5 (isolation).** Two profiles with different stickers on the same weapon
  definition; switch and confirm no bleed. Loadout mode: confirm no attachment
  read/write appears in the log for the whole session.
* **I6 (duplicates).** Four AK instances, different stickers each; equip each in
  turn via the in-game loadout; each keeps its own attachment set, and the
  equivalence fallback stops treating them as identical.

Nothing in I1-I6 requires changing equipment resolution, and each phase leaves
the currently working weapon/knife/agent/gloves paths untouched.

---

## 7. What was built

### Native runtime (`development/CS2-n1ssan`)

| file | change |
| --- | --- |
| `src/inventory/attachments.{h,cpp}` (new) | `StickerSlot` / `Charm` / `Set`, attribute index table, name-resolved writes, raw-vector reads, detection queue and file writer |
| `src/inventory/loot_socache.{h,cpp}` | `NewItem::attachments`, `Find(id)`, `ReadAttachments`, `SyncAttachments`; `Create` writes the attachment set |
| `src/inventory/armory_inventory.{h,cpp}` | flat key parsing, `ManagedItem` snapshot, `SessionInfo`, `BridgeDirectory`, attachment sync on retained items, attachments in `SameRenderable`, `ResolveTargetForWeapon` out-parameter |
| `src/sdk/item_view.{h,cpp}` | `EconAttr_Create` takes the attachment set and appends it to a fresh list |
| `src/skin/apply.{h,cpp}` | `ApplyWeaponSkin` carries the Armory instance's attachments; an attachment-only change rewrites the weapon view and drops its model cache entry |
| `src/skin/dispatch.cpp` | passes the resolved attachments through the Armory weapon path |
| `src/hooks/frame_stage.cpp` | `Attachments::ObserveAndPersist()` in the existing `!inMatch && Armory` window |

Behaviour notes:

* Writes go through `LootSchema::SetAttributeFloatByName`, so a shifted attribute
  index can only make a read miss, never corrupt an item. `Initialize()` latches
  per-name availability: the five charm names and six sticker fields per slot are
  required, `schema` / `charm sticker` / `charm highlight` are optional.
* `Create` writes only present slots. `SyncAttachments` also clears a slot or
  charm the set no longer uses (id 0), which is exactly how CS2 makes an empty
  sticker slot (see Lootline's `WriteSticker`).
* Attachments are **not** part of `StableIdFor`: applying a sticker never
  recreates the item, so CS2's own Loadout keeps pointing at it. They **are**
  part of `SameRenderable`: two AKs with different stickers are no longer
  treated as interchangeable.
* Passive inventory-screen changes are emitted only after a complete read and
  two identical snapshots 400 ms apart. A successful `UseTool` apply is
  recorded immediately after its SOCache write, so it cannot be missed when
  the observer has not yet captured a pre-apply baseline. A stale profile or
  inventory revision is dropped by the Bridge instead of written.
* Loadout mode never reads, writes or observes attachments: the call site is
  gated on `RuntimeMode::Armory` and the dispatch path passes `nullptr`.

### Bridge (`development/n1ssan-web-bridge`)

| file | change |
| --- | --- |
| `src/armory/contracts.ts` | `StickerAttachment`, `CharmAttachment`, `ItemAttachments`, `validateAttachments`, instance field |
| `src/armory/armory-inventory.ts` | `version: 2`, `attachmentsVersion`, `inventoryRevision`, flat attachment keys, kit resolution from canonical ids, stacked sticker/charm projection |
| `src/armory/obsidian-adapter.ts` | carries `attachments` through both directions so a UI save cannot drop them |
| `bridge/attachments-sync.ts` (new) | 2 s merge of the detection file with revision-safe `ArmoryStore.replace`, ack file, provenance stamping, exact source-tool consumption |
| `bridge/server.ts` | sweep + `armory-detected-attachments.json` / `armory-attachments-ack.json` paths, re-projection after a merge |
| `src/obsidian/ObsidianApp.tsx`, `obsidian.css` | chips on the card and a detail list (slot, kit, wear, rotation, offsets, schema, observed time). |

Deviations from the proposal above:

* Writes are name-based instead of hand-built attribute arrays (except the fresh
  in-match weapon list, which is still built directly).
* Sticker and charm catalogues are fetched in the browser and never reach the
  Bridge, so the projection derives the kit id from the canonical instance id
  (`cs2:sticker:bymykel-stickers:sticker-123`) instead of a catalogue entry.
  This also un-skips the 8 non-skin instances the profile used to drop.
* `SyncAttachments` clears with id 0 rather than deleting attribute entries,
  matching how the game itself empties a slot.

Tests: `bridge/attachments-sync.test.ts` (7 cases: merge, profile mismatch,
revision mismatch, manual data, incomplete record, unknown instance, invalid
values) and two projection cases in `bridge/armory-inventory.test.ts`.

