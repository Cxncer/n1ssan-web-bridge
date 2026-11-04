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
- `GET /integration/snapshot` — includes canonical `equipment` state alongside Armory inventory and the legacy `/skins` selection.

A stale equipment document is reported as `state: "stale"` in the integration snapshot. Its assignments are withheld from the snapshot until a valid document is saved. The legacy `/skins` API remains available for compatibility; no automatic conversion is performed because its identifiers are not canonical Armory instance IDs.

The Bridge remains bound to loopback (`127.0.0.1`). This contract is a local data boundary and does not implement DLL loading or CS2 process modification.
