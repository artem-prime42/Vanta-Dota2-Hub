# Special patches: live Dota 2 E2E report

Date: 2026-10-03
Result: PASS — no game launch; clean rollback verified.

## Client and baseline

- Dota was found by VANTA's existing Steam resolver at the standard Linux Steam library: `~/.steam/steam/steamapps/common/dota 2 beta/game`.
- Steam appmanifest Build ID: `25664722`.
- VANTA's installed `dota.signatures` candidate was `game/bin/win64/dota.signatures`; no `linuxsteamrt64` copy was present. This is the file selected by VANTA's resolver for this install.
- Base `game/dota/pak01_dir.vpk` SHA-256: `74f59675f7dd85c003e5aa4921ab507d29e6d5c8b02cd8078596fa5062e19501`.
- Extracted `scripts/items/items_game.txt`: 51,861,815 bytes, SHA-256 `84751c6a565186300ec92a0bc92a336804dab645bc40f133143a44de12c2f2ac`. Required item IDs `555`, `677`, and `678` were present.
- Before the fresh-install pass, there was no special-patch record, no special-patch manifest, no managed override VPK, and the retained VANTA original gameinfo/signature backups matched the live files.

## Operations executed through SpecialPatchService

1. Installed Weather Harvest.
2. Installed Crownfall Towers while Weather Harvest was active.
3. Uninstalled Crownfall Towers and verified the Weather-only VPK and restored base Tower blocks.
4. Uninstalled Weather Harvest.

A preceding live pass found a pre-existing Weather Harvest installation. It was backed up, exercised through Update with Towers, and then removed as requested. Its exact pre-test state was retained in external snapshots. A broad text-search assertion in that pass falsely flagged Tower asset paths still present elsewhere in base `items_game.txt`; the service restored the verified baseline, all five client/VANTA hashes matched the snapshot, and the assertion was replaced by exact item-block comparison. The subsequent fresh-install pass passed.

The test definitions came from h6rd/Patcher revision `bab71ddfaff0033e1cffef1134764ecb4e39f24e`; each fetched file was checked against its pinned Git blob SHA-1 before use.

## Observed installed artifacts and hashes

The override VPK contained exactly one entry: `scripts/items/items_game.txt`. `vpk-tools` reported no verification issues.

- Weather-only VPK SHA-256: `1e7f33c230a7135361f10be27efbc50e453314e0a155ca45285399df3df0cdc4`.
- Combined Weather + Towers VPK SHA-256: `3dbc847a26dfcbff6d1351e1dba20a83a228340b1bf85889523024454b76cc2d`.
- Weather-only patched `items_game.txt` SHA-256: `bfbf8048c0b2cd2179948cb77d22363b02cd4e31d582f02d5ebca80840c0daf3`.
- Combined patched `items_game.txt` SHA-256: `076c14818306973844a40587ede66022cd08a3f1f568def403a66758e1e7755a`.
- Patched `gameinfo_branchspecific.gi` SHA-1: `0DDE8F7BF54077D7314F4C793C0419FA8937F62F`.
- Patcher signature line CRC32 (little-endian encoding): `1BD514DD`.
- The actual last line in `dota.signatures` was `...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:0DDE8F7BF54077D7314F4C793C0419FA8937F62F;CRC:1BD514DD`, and it matched the installed gameinfo bytes.

The combined override's item blocks for IDs 555, 677, and 678 were compared with the checksum-verified Weather/Tower definitions. After Tower removal, IDs 677/678 matched their original base-client blocks; this check avoids false positives from the same asset names elsewhere in `items_game.txt`.

## Rollback result

All final rollback assertions passed:

- `game/dota/pak01_dir.vpk` and extracted `items_game.txt` remained byte-identical to baseline.
- `game/dota/gameinfo_branchspecific.gi` restored to the retained VANTA original backup: 1,653 bytes, SHA-256 `291c2a83f470ee4c5220fdc338204dfdb3077fff4394653dceb59c819976848b`; it no longer contains the Patcher marker.
- `game/bin/win64/dota.signatures` restored to the retained original backup: 9,166 bytes, SHA-256 `1cbb67972952829e269635785a828211c80e06a9008dc70e238e30ea950bb0ba`; its original `DIGEST:` line was restored and the Patcher hash line is absent.
- The VANTA-managed `game/DotaModdingCommunityMods/pak01_dir.vpk` was removed.
- No special-patch records or special-patch manifest remain in VANTA state.
- VANTA's original backup files remain intact and their hashes match the pre-test backup inventory.
- Dota was not launched; it was not running at the end.

External phase snapshots and the machine-readable report are preserved under `/tmp/vanta-special-real-fresh-2026-10-03T08-49-25-569Z`.

## Difference from h6rd/Patcher and remaining limitation

VANTA reproduces the Tower/Weather item override VPK, `DotaModdingCommunityMods` search path and SHA-1/CRC32 signature-line mechanism. It additionally validates Steam Build ID, base item-data hash, source-definition Git blob hashes, generated VPK integrity, and owns rollback through a journal and verified backups. It does not kill or launch Dota.

Visual in-game behavior was **not verified**. Dota remained closed, as requested. Manual launch and visual confirmation are still required to establish that the Weather and Towers render in-game; no claim of visual functionality or VAC safety is made.
