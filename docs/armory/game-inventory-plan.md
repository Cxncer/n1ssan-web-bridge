# Game inventory plan (Armory → CS2 in-game inventory)

Status: **phase 1 implemented 2026-11-06**, in-game visibility not yet fully verified.

Runtime selection: Loadout and Armory are mutually exclusive. Opening the
Armory destination writes `runtime-mode.json` with `mode:"armory"`; the DLL then
creates the inventory and disables Loadout application entirely. Opening
Loadout switches back. PlanA's loadout SOCache injection is skipped at startup
in Armory mode.

Phase 1:

- The Bridge projects the active Armory profile into `armory-inventory.json`
  (`src/armory/armory-inventory.ts`) on startup and after every `/armory` save.
  Each item carries its resolved CS2 definition index, paint kit, float, seed,
  StatTrak flag, quality and rarity. Stickers/charms and stacked entries are
  reported as skipped.
- The DLL (`src/inventory/armory_inventory.cpp`) watches that file, stages the
  items and, while the player is outside an active match, creates them in the
  local inventory through the existing `LootSOCache::Create` path on the game
  thread. Item IDs are stable FNV-1a hashes of the Armory instance ID.
- Logs: `[armory-inventory] watching …`, `staged N items`,
  `created=… existed=… failed=… notReady=…`.

Not yet covered by phase 1:

- CS2's "new item" pickup/acknowledge state, origin/quality metadata beyond
  quality/rarity, custom names, stickers and charms.
- Removal of items deleted from Armory.
- Re-creation after a map change or a cache wipe.
- Runtime verification that the created items are listed by the inventory UI;
  if they are not, the next step is porting Lootline's `GameInv` main-thread
  create/acknowledge path.

## What the user sees today

- Loadout targets are applied to the local player's weapon item views at
  `FrameStageNotify` stage 6, so equipped skins render.
- `PlanA` also creates SOCache entries for equipped targets (fake item IDs,
  definition + paint attributes), but **those items do not appear in CS2's
  inventory screen**, and Armory items that are not equipped are never sent to
  the DLL at all.

## Why (verified against the current code)

1. `n1ssan-dll` creates items from the injector worker thread
   (`PlanA::Start` → `LootSOCache::Create`). Lootline explicitly documents that
   its inventory writer must run **on the game's main thread** because the game
   reads and fills the same cache there. Creating from a background thread is
   not enough to make the UI pick the items up.
2. Only `g_targets` (equipped loadout) is iterated. Armory owns the full
   collection; nothing writes it to the game.
3. Lootline's `GameInv::CreateItem` sets fields n1ssan does not: origin,
   pickup/acknowledged state, rarity, StatTrak score type, stickers, charm,
   custom name, casket/terminal fields, and calls `Acknowledge` so CS2 gives the
   item a place in the inventory and drops the "new item" count.
4. Lootline also resolves `InventoryAPI` functions and the inventory manager's
   notification path, so the inventory tab redraws. n1ssan has no equivalent.

Reference: `source/chadware2/features/unboxer/game_inventory.h` /
`game_inventory.cpp` in
[Cxncer/Lootline-for-reference-only](https://github.com/Cxncer/Lootline-for-reference-only).

## Proposed implementation

### 1. Bridge: emit the full Armory inventory for the runtime

New file `armory-inventory.json` (atomic write, same triggers as
`n1ssan-data.json`):

```json
{
  "version": 1,
  "activeProfileId": "profile-main",
  "items": [
    { "instanceId": "…", "definitionIndex": 7, "paintKit": 1425, "float": 0.23, "seed": 19,
      "quality": 4, "rarity": 6, "statTrak": false, "customName": null,
      "stickers": [], "charm": null }
  ],
  "equipped": [ { "team": "T", "slot": "weapon", "target": "AK-47", "instanceId": "…" } ]
}
```

Stickers/charms are included once their native application exists; unresolved
identities are skipped and reported, exactly like `runtime-config.json`.

### 2. DLL: main-thread inventory writer

- New `inventory/game_inventory.{h,cpp}` modeled on Lootline's `GameInv`:
  resolve the create/add/acknowledge functions once, then expose
  `CreateItem`, `Acknowledge`, `HasItem`, `InventoryReady`.
- Call it from `FrameStageNotify` stage 6 (or a Panorama `RunFrame` hook, as
  Lootline does) after `LootSchema` is ready — never from the injector worker.
- Feed it from `armory-inventory.json` via the same watcher/staging pattern as
  the loadout: parse off-thread, create/acknowledge on the main thread outside a
  match.
- Keep `PlanA` for equipped weapon item views; inventory creation is additive.

### 3. Verification matrix

- Open CS2 inventory at the main menu with one Armory skin: item appears with the
  right paint/float/seed.
- Add a second item in Armory while CS2 is at the menu: it appears without
  restarting the game.
- Equip it in Loadout: weapon view updates.
- During an active match: inventory changes are deferred, then applied after the
  match (same rule as profile switching).
- Restart CS2: items are recreated from the file.

## Risks

- These functions are offset/pattern dependent and were verified by Lootline
  against a specific client build (2026-09-29 per its header). The current CS2
  build must be validated in-game; stale offsets can crash the client.
- Creating/acknowledging items is inherently unsafe if called at the wrong time
  or on the wrong thread. Guard with `InventoryReady()` and the match-state
  machine, and keep the creation path opt-in until verified.
- Ownership is local-only; nothing is sent to Valve's servers (same as Lootline).
