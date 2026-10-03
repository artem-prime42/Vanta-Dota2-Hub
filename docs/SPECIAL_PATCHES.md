# Special client patches (Weather and Towers)

VANTA keeps these entries separate from ZIP/VPK cosmetic installs. Catalog items use `modType: "special_patch"`, `specialType: "weather" | "tower"`, a source revision, and `requiredFiles` descriptors containing the upstream item-definition URL, numeric Dota item ID, and Git blob SHA-1. New variants can be added in catalog data without adding per-mod application logic.

## Upstream behavior reviewed

At the pinned h6rd/Patcher revision `bab71ddfaff0033e1cffef1134764ecb4e39f24e`, `Patcher.py`:

1. Reads `scripts/items/items_game.txt` from `game/dota/pak01_dir.vpk`.
2. Replaces item records by numeric ID: Weather uses ID `555`; Towers use Radiant `677` and Dire `678`.
3. Builds a VPK containing the override at `scripts/items/items_game.txt` and places it at `game/DotaModdingCommunityMods/pak01_dir.vpk`.
4. Adds `Game`/`Mod` search paths for `DotaModdingCommunityMods` to `game/dota/gameinfo_branchspecific.gi`.
5. Backs up and appends a `dota.signatures` line containing the SHA-1 and little-endian CRC32 of the resulting `gameinfo_branchspecific.gi`.
6. Validates an existing patch by checking the Patcher marker and comparing those recorded hashes with the current gameinfo file. It does not compare a Dota build number with a mod version; a game update generally replaces one or more patched files and Install must run again.

VANTA follows the same item-game override and search-path/signature-hash contract. It additionally pins and verifies every fetched upstream definition, checks the Steam `appmanifest_570.acf` build ID when present, hashes the current base `items_game.txt`, and verifies the managed patch VPK and patched client files before reporting the patch current. This avoids relying on a mod version comparison alone.

## VANTA ownership and safety

- The unmodified `pak01_dir.vpk` is read only; VANTA writes its one-file override to `game/DotaModdingCommunityMods/pak01_dir.vpk`.
- Original `gameinfo_branchspecific.gi` and runtime-specific `dota.signatures` snapshots are kept under VANTA user data. Windows uses `bin/win64/dota.signatures`; Linux prefers `bin/linuxsteamrt64/dota.signatures`. Existing installs are migrated if the selected runtime signature file changes. A pre-existing Patcher VPK is retained and restored on removal.
- Weather entries replace the same item ID, so one Weather can be active at a time. Towers replace both team IDs as one selection. One Weather and one Towers selection can coexist in the combined override VPK.
- Install, Update, and Remove are refused while Dota 2 is running; VANTA does not kill or launch the game.
- File writes are journaled and rolled back on an error. If a game file or managed VPK no longer matches VANTA's recorded hash, removal does not overwrite the changed file.
- This modifies game client files and the signature map. It is not represented as VAC-safe; users should understand the risk before installing.

## State and update detection

Installed special records persist `specialPatchState`, `currentVersion`, source revisions, build ID, base item-data hash, generated patch hash, patched gameinfo/signature hashes, and the signature path. At startup and Library refresh, the special-patch service checks these values. A changed upstream source revision, Steam build ID, base item-game data, VPK, gameinfo marker/hash, or signature hash yields `update_required`. Successful rebuilds persist the new metadata and clear the requirement. Runtime `updating` and `error` states are owned by the same service.
