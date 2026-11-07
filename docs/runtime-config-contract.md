# Runtime config contract (Loadout → native DLL)

Status: implemented 2026-11-06. This is the cross-repository boundary between
`n1ssan-web-bridge` and `CS2-n1ssan`; change both sides deliberately.

## Purpose

Loadout is an equipment configuration over the shared skin catalogue. The Bridge
writes the active Loadout profile as numeric CS2 identifiers, and the native DLL
applies them in-game. The DLL is injected once per CS2 process; configuration
changes are runtime operations.

Editing a loadout does **not** write the runtime file. The user presses
**Apply to game** when they are done; that is the only action that sends a
profile to the game. The DLL adopts the last sent profile only while the player
is outside an active match.

Loadout is independent of Armory. Armory is a separate fake-inventory manager;
its items are not required for Loadout and are never consulted while building
this file.

```
Shared skin catalogue (skins.json + knife-skins.json)
        ↓  Loadout profile selections (catalogue IDs + float/seed)
loadout-profiles.json   (active Loadout profile, Bridge-owned)
        ↓  catalogue resolution (Bridge)
n1ssan-data.json        (this contract)
        ↓  file watcher, staged, adopted on the game thread
n1ssan-dll.dll runtime  (g_targets)
```

## File format

`n1ssan-data.json` in the Bridge working directory (or `N1SSAN_DATA_FILE`).
Written atomically (`.tmp` + rename). The native parser accepts the same legacy
shape as before:

```json
{
  "version": 1,
  "generatedAt": "2026-11-06T00:00:00.000Z",
  "source": "loadout",
  "activeLoadoutProfileId": "loadout-main",
  "skins": [
    {
      "weapon": "AK-47",
      "name": "Redline",
      "paintKit": 282,
      "float": 0.15,
      "seed": 123,
      "team": "T",
      "slot": "weapon",
      "definitionId": "cs2:skin:n1ssan-skins:1134884231"
    }
  ]
}
```

The DLL uses `weapon`, `name`, `paintKit`, `float`, `seed`, `team` and `slot`;
the other fields are diagnostic metadata.

## Resolution rules (Bridge side)

1. The active profile is the last one saved through `POST /loadout/apply`.
2. Each selection is a **catalogue ID**, not an inventory instance. Any skin in
   the shared catalogue can be selected; there is no ownership check.
3. The selection resolves to a weapon label, paint kit and CS2 definition index
   via `skins.json` / `knife-skins.json`.
4. Float and seed come from the Loadout profile's per-selection settings
   (`skinSettings[team]["<weapon>:<id>"]`); without settings the catalogue
   minimum wear and seed `0` are used.
5. Targets are validated against `src/armory/n1ssan-cs2-schema.json` (live
   snapshot): unknown definitions and paint kits outside
   `compatiblePaintKitIds` are skipped and reported in `runtime.skipped`.
6. Slots `agent` and `zeus` are not in the native weapon table yet; they are
   reported as skipped.
7. If the projection has **zero** targets, the previous `n1ssan-data.json` is
   left untouched. Writing an empty file would make the DLL fail its loadout
   preflight (`loadout_empty`).

## Runtime mode (Loadout XOR Armory)

Loadout and Armory are mutually exclusive runtime sources. The Bridge writes
`runtime-mode.json` (`{"mode":"loadout"}` or `{"mode":"armory"}`) when a
destination page opens, through `POST /runtime-mode`.

- **Loadout mode:** the DLL applies `n1ssan-data.json` and never creates Armory
  inventory items. `armory-inventory.json` is ignored.
- **Armory mode:** the DLL creates `armory-inventory.json` items and completely
  skips Loadout application — the `FrameStageNotify` apply pass and PlanA's
  SOCache injection are disabled, so `n1ssan-data.json` cannot override the
  skins equipped in game. `n1ssan-data.json` is ignored.
- No mode file yet means Loadout (backward compatible).

Switching mode takes effect within about a second. Items created by the previous
mode are not deleted automatically yet; restart CS2 (or the injection) in the
new mode for a fully clean inventory.

## Native adoption rules (DLL side)

- A worker thread watches the loaded file (mtime + size, 2 s poll) and stages a
  parsed target map. The file is only parsed when it changes and is non-empty.
- `FrameStageNotify` (stage 6, game thread) adopts a staged map only while the
  match state is `IDLE`. During `IN_MATCH` the change is deferred and logged;
  it is adopted after the match ends.
- Adoption replaces `g_targets` on the game thread, then
  `PlanA::ReconcileAllItems()` creates SOCache entries for newly selected
  definitions. Existing entries report `AlreadyExists`, so repeated switches are
  safe.
- No reinjection, no CS2 restart. One DLL instance serves both destinations.

## Bridge API

`GET /loadout/profiles`

Returns the persisted Loadout profile document:
`{ schemaVersion: 1, activeProfileId, profiles: [...] }`.

`POST /loadout/apply`

```json
{
  "profileId": "loadout-main",
  "name": "Main Loadout",
  "loadouts": {
    "T":  { "AK-47": 1134884231 },
    "CT": { "AWP": 3906884235 }
  },
  "equipment": {
    "T":  { "agent": null, "knife": "skin-85646e9ca45c", "gloves": null, "zeus": null },
    "CT": { "agent": null, "knife": null, "gloves": null, "zeus": null }
  },
  "skinSettings": {
    "T":  { "AK-47:1134884231": { "float": 0.15, "seed": 123 } },
    "CT": { "AWP:3906884235":  { "float": 0.42, "seed": 9 } }
  }
}
```

- Stores or replaces that Loadout profile, makes it active and rewrites
  `n1ssan-data.json`. The Loadout **Apply to game** button is the only caller.
- Response: `{ data: <saved profile>, runtime: { written, targetCount, skipped, reason, path, activeLoadoutProfileId } }`.
- Validation failures return HTTP 400 with details.

`PUT /armory` and `PUT /armory/equipment` do **not** touch the runtime config;
Armory is a separate feature.

## Match-state behaviour

The Bridge writes the file immediately when the user sends a profile. The native
DLL stages the changed file and adopts it only while its match state is `IDLE`.
Match state combines two engine signals:

- `engine2`'s network client: a full sign-on (`SIGNONSTATE_FULL`) to a real map
  is an active match; the main menu's background map is not.
- `CCSPlayerController::m_iConnected` (`0x6F4`): only `Connected` (`0`) counts as
  being in a server, so a controller that survives a match cannot keep the
  runtime latched.

If neither can be read, the DLL falls back to the previous pawn/health
heuristic. If a profile is sent during an active match, the file is the latest
one on disk and the DLL adopts it when the match ends, logging
`runtime change deferred: active match` in `n1ssalogs.md`. Each new send is
staged and adopted independently; the file is not read only once.

## Known limits

- The Loadout UI keeps its profile list in `localStorage`; the Bridge records
  only profiles explicitly sent with **Apply to game**. Loading the profile list
  back from the Bridge on first paint is the next step.
- The Loadout picker uses the shared catalogue: non-knife skins from
  `skins.json` plus the expanded knife catalogue. Legacy numeric knife rows are
  excluded because they duplicate expanded identities.
- Agents and Zeus are not applied by the native loadout yet.
- The legacy `POST /skins` endpoint still writes `n1ssan-data.json` directly and
  is not part of this contract.
- Showing the Armory collection in CS2's in-game inventory is separate work; see
  `docs/armory/game-inventory-plan.md`.
