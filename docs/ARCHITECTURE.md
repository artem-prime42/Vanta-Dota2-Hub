# VANTA Dota architecture

## Runtime dependency boundary

```text
renderer UI
  -> preload IPC bridge
    -> AppService (use cases)
      -> core models/search
      -> Cosmetic builder -> installed game's items_game.txt
      -> DownloadManager -> explicitly selected package source
      -> ModManager -> Library VPK store and Dota 2 filesystem
      -> JsonStorage -> VANTA user data
      -> SteamDetector -> local Steam libraries
```

The reference repository is not imported, spawned, or read by this runtime. Online catalog refresh is disabled. Cosmetic options and generated schema overrides are derived from the installed Dota VPK; the app's state is stored independently under Electron's user data directory.

## Local cosmetic flow

At startup, the main process reads hero wearable definitions from `game/dota/pak01_dir.vpk`, pairs each wearable with its hero's `default_item`, and persists the resulting hero index by game-VPK signature. The renderer opens this prepared list as hero and skin cards; it does not rescan the schema on page navigation. A compressed, pre-generated index maps card names to images in `dota2-media`; only the requested card previews load from the repository. The selected item's visual, `image_inventory`, model and particle references remain in the generated schema VPK.

## Safety boundary

The cosmetic builder is local, but applying it requires the game's schema override path. The user must confirm this operation; VANTA backs up the original game metadata/signature files through the existing special-patch transaction before writing. Removing the generated cosmetics restores the prior patch state. No online mod catalog is part of this flow.

## Functional parity checklist

- [x] Offline hero cosmetic builder generated from the installed game schema
- [x] Favorites and persisted local state
- [x] Steam/Dota auto-detection and manual path selection
- [x] Download progress, cancel signal and retry through the action again
- [x] ZIP install/update/uninstall with ownership manifests
- [x] Online mod-catalog requests disabled
- [x] Unified pak02-pak99 Library allocator, VPK merge/build, Pack rebuild and import
- [x] Legacy installed VPK migration into the Library store
- [ ] Independent application updater