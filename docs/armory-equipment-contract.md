# Armory Equipment Contract v1

The canonical equipment document is separate from the Armory inventory document. Inventory records ownership; equipment records which owned instance is assigned to a team slot.

## Identity and freshness

Every assignment references an `InventoryItemInstance.id` through `itemInstanceId`. Do not substitute catalogue definition IDs, paint-kit IDs, legacy `/skins` IDs, or array positions.

The equipment document is bound to both `profileId` and `inventoryRevision`. Any Armory write increments the inventory revision, so previously saved equipment becomes stale and must be reloaded/revalidated before it can be saved or consumed.

## Document shape

```json
{
  "schemaVersion": 1,
  "inventoryRevision": 12,
  "profileId": "profile-main",
  "assignments": [
    {
      "team": "T",
      "slot": "weapon",
      "target": "AK-47",
      "itemInstanceId": "armory-instance-uuid"
    },
    {
      "team": "CT",
      "slot": "knife",
      "target": "knife",
      "itemInstanceId": "knife-instance-uuid"
    }
  ]
}
```

Allowed teams: `T`, `CT`. Allowed slots: `weapon`, `agent`, `knife`, `gloves`, `zeus`. Weapon targets identify the weapon (for example `AK-47`); non-weapon targets must equal their slot name.

Each assignment must reference an individual `skin` instance in the active profile. A team cannot assign the same instance more than once or duplicate the same team/slot/target tuple. The same owned instance may be selected for both teams.

## Local Bridge API

The integration snapshot contract is version 2 and adds canonical equipment state; older version-1 consumers should ignore this endpoint until upgraded.

- `GET /armory/equipment` — returns the stored document and `validationErrors` against the current Armory revision.
- `PUT /armory/equipment` — body: `{ "expectedInventoryRevision": number, "data": ArmoryEquipmentDocument }`.
- `GET /integration/snapshot` — includes canonical `equipment` state and each resolved owned item (including customization) alongside Armory inventory and the legacy `/skins` selection. The snapshot contract is version 2.
- `GET /integration/simulator` — runs a read-only contract simulation and reports `ready`, `empty`, `stale`, or `unsupported`; it never attaches to CS2.

A stale equipment document is reported as `state: "stale"` in the integration snapshot. Its assignments are withheld from the snapshot until a valid document is saved. The legacy `/skins` API remains available for compatibility; no automatic conversion is performed because its identifiers are not canonical Armory instance IDs.

The Bridge remains bound to loopback (`127.0.0.1`). This contract is a local data boundary and does not implement DLL loading or CS2 process modification.

## Writers

Two actions produce assignments:

- **Loadout Builder save** (`POST /loadout/apply`) derives assignments from the saved catalogue selection. Selections not owned in the active Armory inventory are reported and skipped, so one unowned weapon cannot clear the slots that are owned. Team+slot targets the Loadout resolves replace the stored ones; every other assignment is carried over.
- **Armory “Equip slots”** (`PUT /armory/equipment`) assigns one owned instance per team `knife`/`gloves`/`agent` slot and preserves weapon assignments.

`POST /armory/apply` refreshes assignments against the current inventory before projecting it, so an inventory edit cannot leave the native runtime resolving removed instances.

## Native consumption

The inventory document is what makes the items selectable: every owned instance
is projected, so a profile with four AK-47s has four AK-47s in CS2's inventory
and loadout screen. Which one is worn is the player's decision in game.

The DLL resolves a live weapon in this order:

1. **CS2's own loadout** — `LoadoutAPI.GetSlotEquippedWithDefIndex(team, def)`
   names the slot and `GetItemID(team, slot)` the equipped item. When that item
   is a projected instance, it is what gets rendered.
2. **This document** — for slots the player never equipped in game.
3. **Definition equivalence** — only when every owned instance for the
   definition renders identically.
What the resolved instance drives:

- `weapon` — the paint kit, seed, wear and StatTrak on the live weapon;
- `knife` — the knife model as well as its paint, because the live default knife definition is not the owned one;
- `gloves` — the paint written to `m_EconGloves`;
- `agent` — the local player model, taken from the definition's schema `modelName`.

A slot that resolves to nothing applies nothing rather than choosing an arbitrary duplicate.
