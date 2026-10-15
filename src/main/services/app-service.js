const fs = require('fs/promises');
const path = require('path');
const crypto = require('node:crypto');
const { VpkReader, VpkWriter } = require('vpk-tools');
const { DownloadManager } = require('../../infrastructure/download-manager');
const { ModManager } = require('../../application/mod-manager');
const { SpecialPatchService, isDotaRunning } = require('../../application/special-patch-service');
const { VantaModLibrary } = require('../../application/vanta-mod-library');
const { VantaInstaller } = require('../../application/vanta-installer');
const { JsonStorage } = require('../../infrastructure/storage');
const { DotaDiagnosticsService } = require('../../application/dota-diagnostics-service');
const { SPECIAL_PATCH_CATALOG } = require('../../application/special-patch-catalog');
const { SavedPackStore } = require('../../infrastructure/saved-pack-store');
const { detectDota, resolveDotaGamePath } = require('../../infrastructure/steam-detector');
const { searchMods } = require('../../core/models');
const { detectExternalFiles } = require('../../infrastructure/external-files');
const { HeroGridService } = require('../../infrastructure/hero-grid-service');
const { ThemeManager, SEMANTIC_THEME_TOKENS } = require('../../infrastructure/theme-manager');
const { R2Provider } = require('../../infrastructure/r2-provider');
const { migrateLegacyUserData } = require('../../infrastructure/user-data-migration');
const { sanitizeCosmeticSelections } = require('../../application/cosmetic-builder');
const { normalizeHeroKey } = require('../../core/models');

const DISCORD_APP_ID = '1551207182744166511';

function languageFolderMatches(recordFolder, selectedFolder) {
  if (!recordFolder || !selectedFolder) return true;
  const record = String(recordFolder).toLowerCase();
  const selected = String(selectedFolder).toLowerCase();
  if (record === 'dota') return true;
  return record.replace(/^dota_/, '') === selected.replace(/^dota_/, '');
}

function normalizeLanguageSuffix(value, fallback = 'russian') {
  const normalized = String(value || '').trim().replace(/^dota_/i, '');
  return /^[a-z0-9_-]+$/i.test(normalized) ? normalized : fallback;
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

async function resolveGameRelativePath(gamePath, relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('External file path is invalid');
  }
  const root = path.resolve(gamePath);
  const candidate = path.resolve(root, ...normalized.split('/'));
  if (!pathIsWithin(root, candidate)) throw new Error('External file path is outside the selected Dota folder');
  const realRoot = await fs.realpath(root);
  let existing = candidate;
  while (!(await fs.lstat(existing).then(() => true, (error) => error.code === 'ENOENT' ? false : Promise.reject(error)))) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error('External file path has no existing parent');
    existing = parent;
  }
  const resolvedExisting = await fs.realpath(existing);
  if (!pathIsWithin(realRoot, resolvedExisting)) throw new Error('External file path resolves outside the selected Dota folder');
  return candidate;
}

class AppService {
  constructor({ rootDir, onProgress = () => {}, processRunning = isDotaRunning }) {
    this.rootDir = rootDir;
    this.onProgress = onProgress;
    this.processRunning = processRunning;
    this.userDataMigration = null;
    this.storage = new JsonStorage(rootDir);
    this.savedPacks = new SavedPackStore({ rootDir });
    this.buildCosmeticListing = require('../../application/cosmetic-builder').buildCosmeticListing;
    this.cosmeticListingCache = null;
    this.cosmeticListingCacheFile = path.join(rootDir, 'cache', 'hero-cosmetics.json');
    this.fileHashCache = new Map();
    const dataParentDir = path.dirname(rootDir);
    const legacyRootDirs = ['VANTA', 'VANTA DOTA2 HUB', 'VANTA Dota'].map((name) => path.join(dataParentDir, name)).filter((directory) => directory !== rootDir);
    this.downloads = new DownloadManager(rootDir, onProgress, legacyRootDirs);
    this.activeVpkHashCache = null;
    this.reinstallPromise = null;
    this.gamePath = null;
    this.mods = new ModManager({ rootDir, storage: this.storage, downloads: this.downloads, getGamePath: () => this.gamePath, getLanguageFolder: () => this.storage.state.settings.langSuffix || 'dota', onProgress, processRunning });
    this.specialPatches = new SpecialPatchService({ rootDir, storage: this.storage, getGamePath: () => this.gamePath, getMods: () => this.getAvailableMods(), onProgress });
    this.library = new VantaModLibrary({ rootDir, storage: this.storage, installer: null });
    this.installer = new VantaInstaller({ modManager: this.mods });
    this.library.installer = this.installer;
    this.r2 = new R2Provider({ indexUrl: '' });
    this.heroGrids = new HeroGridService({ rootDir, storage: this.storage, getGamePath: () => this.gamePath, getLanguageFolder: () => this.storage.state.settings.langSuffix || 'russian' });
    this.themeManager = new ThemeManager({ rootDir });
    this.dotaDiagnostics = new DotaDiagnosticsService({ getGamePath: () => this.gamePath, storage: this.storage, library: this.mods.library, processRunning, getBuildId: (gamePath) => this.specialPatches.currentBuildId(gamePath) });
  }

  async init() {
    this.userDataMigration = await migrateLegacyUserData(this.rootDir);
    await this.storage.init();
    await this.themeManager.init();
    const langSuffix = normalizeLanguageSuffix(this.storage.state.settings.langSuffix);
    if (langSuffix !== this.storage.state.settings.langSuffix) {
      await this.storage.patch({ settings: { ...this.storage.state.settings, langSuffix } });
    }
    await this.savedPacks.init();
    await this.mods.init();
    await this.library.init();
    await this.specialPatches.init();
    const savedGamePath = this.storage.state.settings.gamePath || null;
    this.gamePath = await resolveDotaGamePath(savedGamePath);
    if (!this.gamePath) {
      const found = await detectDota();
      if (found) this.gamePath = await resolveDotaGamePath(found.gamePath);
    }
    if (this.gamePath && this.gamePath !== savedGamePath) {
      await this.storage.patch({ settings: { ...this.storage.state.settings, gamePath: this.gamePath } });
    }
    if (this.gamePath && !(await this.processRunning())) await this.mods.moveInstalledMods(langSuffix);
    this.r2.indexUrl = String(this.storage.state.settings.r2IndexUrl || '').trim();
    const activeThemeId = this.storage.state.settings.activeThemeId || this.themeManager.getActiveThemeId();
    await this.themeManager.setActiveTheme(activeThemeId, { persist: true });
    if (this.storage.state.settings.activeThemeId !== this.themeManager.getActiveThemeId()) {
      await this.storage.patch({ settings: { ...this.storage.state.settings, activeThemeId: this.themeManager.getActiveThemeId() } });
    }
    await this.specialPatches.refreshStates();
    await this.getCosmeticListing();
    return this.snapshot();
  }

  getPackMembership() {
    const membership = {};
    for (const pack of Object.values(this.storage.state.installedMods || {})) {
      if (!pack || typeof pack !== 'object' || pack.type !== 'pack') continue;
      const packName = pack.displayName || pack.name || pack.id;
      const sourceIds = pack.sourceModIds || pack.modIds || (pack.packMods || []).map((mod) => mod.id || mod.modId).filter(Boolean);
      sourceIds.forEach((modId) => { membership[modId] = packName; });
    }
    return membership;
  }

  getAvailableMods() {
    const builtInIds = new Set(SPECIAL_PATCH_CATALOG.map((mod) => mod.id));
    const local = this.library.list().filter((mod) => mod.type !== 'theme' && mod.modType !== 'special_patch' && !builtInIds.has(mod.id));
    return [...SPECIAL_PATCH_CATALOG, ...local];
  }

  getAvailableMod(id) {
    return SPECIAL_PATCH_CATALOG.find((mod) => mod.id === id) || this.library.get(id);
  }

  snapshot() {
    const installed = { ...this.storage.state.installedMods };
    for (const [id, record] of Object.entries(installed)) {
      if (record?.modType === 'special_patch') {
        const runtime = this.specialPatches.getState(id, record);
        if (runtime.status === 'updating') installed[id] = { ...record, specialPatchState: runtime.status, requiresPatchUpdate: true };
      }
    }
    return { mods: this.getAvailableMods(), installed, packMembership: this.getPackMembership(), favorites: this.storage.state.favorites, settings: { ...this.storage.state.settings, activeThemeId: this.themeManager.getActiveThemeId(), discordAppId: DISCORD_APP_ID }, themes: this.themeManager.getThemes(), themeTokens: [...SEMANTIC_THEME_TOKENS], themeTemplate: this.themeManager.getThemeTemplate(), gamePath: this.gamePath, authors: this.getAuthors(), r2: this.r2.getStatus(), appVersion: this.appVersion || null };
  }

  getAuthors() {
    const authors = new Map();
    const authorEntries = this.getAvailableMods();
    for (const mod of authorEntries) {
      const rawName = mod.author || 'Unknown author';
      if (!rawName || /^anonymous$/i.test(rawName) || /^unknown(?: author)?$/i.test(String(rawName).trim())) continue;
      const name = rawName;
      const authorKey = name.toLowerCase().trim();
      const entry = authors.get(authorKey) || { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, count: 0, mods: [], avatarUrl: null, links: {}, bio: '' };
      entry.count += 1;
      entry.mods.push(mod.id);
      authors.set(authorKey, entry);
    }
    return [...authors.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  }

  async toggleFavorite(id) { const set = new Set(this.storage.state.favorites); set.has(id) ? set.delete(id) : set.add(id); await this.storage.patch({ favorites: [...set] }); return this.snapshot(); }
  async setGamePath(gamePath) {
    const resolvedGamePath = await resolveDotaGamePath(gamePath);
    if (!resolvedGamePath) throw new Error('Could not find dota/pak01_dir.vpk in the selected folder or its standard Steam Dota subfolders. Select Dota 2\\game or use Auto detect.');
    const previousPath = this.gamePath;
    this.gamePath = resolvedGamePath;
    try { await this.mods.moveInstalledMods(this.storage.state.settings.langSuffix || 'russian'); }
    catch (error) { this.gamePath = previousPath; throw error; }
    await this.storage.patch({ settings: { ...this.storage.state.settings, gamePath: resolvedGamePath } });
    await this.specialPatches.refreshStates();
    await this.getCosmeticListing();
    return this.snapshot();
  }
  async detectGame() { const found = await detectDota(); if (found) await this.setGamePath(found.gamePath); return this.snapshot(); }
  async install(id) {
    const mod = this.getAvailableMod(id);
    if (!mod) throw new Error('This ID is not a bundled patch or local VantaMods entry. Import a VPK or configure a package source first.');
    if (this.specialPatches.isSpecialPatch(mod)) await this.specialPatches.install(mod);
    else if (this.storage.state.installedMods[id]) await this.installer.setEnabled(id, true);
    else throw new Error('Only locally imported or verified packages can be installed.');
    return this.getLibrary();
  }
  async update(id) {
    const mod = this.getAvailableMod(id);
    if (this.specialPatches.isSpecialPatch(mod)) await this.specialPatches.update(mod);
    else await this.installer.update(id);
    return this.getLibrary();
  }
  async uninstall(id) {
    const record = this.storage.state.installedMods[id];
    if (record?.modType === 'theme' || record?.type === 'theme') await this.removeTheme(id);
    else if (record?.modType === 'special_patch') await this.specialPatches.remove(id);
    else await this.installer.uninstall(id);
    return this.getLibrary();
  }
  async setModEnabled(id, enabled) { if (this.storage.state.installedMods[id]?.modType === 'special_patch') throw new Error('Special patches cannot be toggled like VPK mods. Remove the patch from the Library instead.'); await this.mods.setEnabled(id, enabled); return this.snapshot(); }
  async mergeMods(ids, name) { await this.mods.merge(ids, name); return this.getLibrary(); }
  async reorderLibrary(ids) { await this.mods.reorder(ids); return this.snapshot(); }
  async renamePack(id, name) { await this.mods.renamePack(id, name); return this.getLibrary(); }
  async renameLibraryItem(id, name) { await this.mods.rename(id, name); return this.getLibrary(); }
  async rebuildPack(id) { await this.mods.rebuildPack(id); return this.getLibrary(); }
  async getHeroGrids() { return this.heroGrids.list(); }
  async diagnoseHeroGrid() { return this.heroGrids.diagnose(); }
  async getHeroGridUserGrids() { return this.heroGrids.userGrids(); }
  async applyHeroGrid(payload) { return this.heroGrids.apply(payload); }
  async disableHeroGrid() { return this.heroGrids.disable(); }
  async removeHeroGridUserGrids() { return this.heroGrids.removeUserGrids(); }
  async removeHeroGridUserGrid(index) { return this.heroGrids.removeUserGrid(index); }
  async getCosmeticListing({ forceRefresh = false } = {}) {
    if (!this.gamePath) return { heroes: [], error: 'Configure the Dota 2 path first.' };
    const pakPath = path.join(this.gamePath, 'dota', 'pak01_dir.vpk');
    let stat;
    try { stat = await fs.stat(pakPath); }
    catch (error) { return { heroes: [], error: `Could not read the local Dota VPK: ${error.message}` }; }
    const language = normalizeLanguageSuffix(this.storage.state.settings.langSuffix || 'english', 'english');
    const signature = `${path.resolve(this.gamePath)}|${stat.size}|${stat.mtimeMs}|cosmetics-v9|${language}|${this.appVersion || 'dev'}`;
    if (!forceRefresh && this.cosmeticListingCache?.signature === signature) return this.cosmeticListingCache.listing;
    if (!forceRefresh) {
      try {
        const cached = JSON.parse(await fs.readFile(this.cosmeticListingCacheFile, 'utf8'));
        if (cached.signature === signature && Array.isArray(cached.listing?.heroes)) {
          this.cosmeticListingCache = { signature, listing: cached.listing };
          return cached.listing;
        }
      } catch {}
    }
    const listing = this.buildCosmeticListing(this.gamePath, {}, language);
    this.cosmeticListingCache = { signature, listing };
    try {
      await fs.mkdir(path.dirname(this.cosmeticListingCacheFile), { recursive: true });
      const temporary = `${this.cosmeticListingCacheFile}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify({ signature, listing }));
      await fs.rename(temporary, this.cosmeticListingCacheFile);
    } catch (error) { console.warn(`[cosmetics] Could not persist generated hero list: ${error.message}`); }
    return listing;
  }

  async getCosmetics() {
    const listing = await this.getCosmeticListing();
    const { selections: picks, discarded } = sanitizeCosmeticSelections(listing.heroes, this.storage.state.settings.cosmeticLoadout || {});
    const manifest = await this.specialPatches.readSpecialManifest().catch(() => null);
    return {
      ...listing,
      picks,
      discardedPicks: discarded,
      loaderInstalled: Boolean(manifest && this.gamePath && path.resolve(manifest.gamePath) === path.resolve(this.gamePath)),
      generatedModInstalled: Boolean(this.storage.state.installedMods?.['vanta-generated-cosmetics']),
    };
  }
  async applyCosmetics(picks) {
    const listing = await this.getCosmeticListing({ forceRefresh: true });
    if (listing.error && Object.keys(picks || {}).length) throw new Error(listing.error);
    const sanitized = sanitizeCosmeticSelections(listing.heroes, picks);
    const stored = sanitizeCosmeticSelections(listing.heroes, this.storage.state.settings.cosmeticLoadout || {});
    const discardedPicks = Object.keys(picks || {}).length
      ? [...stored.discarded, ...sanitized.discarded]
      : sanitized.discarded;
    const operation = await this.specialPatches.applyCosmetics(sanitized.selections);
    return { ...(await this.getCosmetics()), operation, discardedPicks };
  }
  getCosmeticPresets() {
    const presets = this.storage.state.settings.skinLoadoutPresets;
    return Array.isArray(presets) ? presets.filter((preset) => preset && typeof preset === 'object' && preset.id && preset.name && preset.picks && typeof preset.picks === 'object') : [];
  }
  async saveCosmeticPreset(name) {
    const safeName = String(name || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, 60);
    if (!safeName) throw new Error('Skin set name is required.');
    const presets = this.getCosmeticPresets();
    if (presets.some((preset) => preset.name.toLocaleLowerCase() === safeName.toLocaleLowerCase())) throw new Error('A skin set with this name already exists.');
    const listing = await this.getCosmeticListing();
    if (listing.error) throw new Error(listing.error);
    const { selections, discarded } = sanitizeCosmeticSelections(listing.heroes, this.storage.state.settings.cosmeticLoadout || {});
    if (!Object.keys(selections).length) throw new Error('Choose and apply at least one skin before saving a set.');
    const preset = { id: crypto.randomUUID(), name: safeName, picks: selections, skinCount: Object.keys(selections).length, createdAt: new Date().toISOString() };
    await this.storage.patch({ settings: { ...this.storage.state.settings, skinLoadoutPresets: [...presets, preset] } });
    return { presets: this.getCosmeticPresets(), discardedPicks: discarded };
  }
  async applyCosmeticPreset(id) {
    const preset = this.getCosmeticPresets().find((item) => item.id === id);
    if (!preset) throw new Error('Saved skin set was not found.');
    return this.applyCosmetics(preset.picks);
  }
  async deleteCosmeticPreset(id) {
    const presets = this.getCosmeticPresets();
    if (!presets.some((preset) => preset.id === id)) throw new Error('Saved skin set was not found.');
    const next = presets.filter((preset) => preset.id !== id);
    await this.storage.patch({ settings: { ...this.storage.state.settings, skinLoadoutPresets: next } });
    return { presets: next };
  }
  async removeCosmeticPresetPick(id, slotId) {
    const presets = this.getCosmeticPresets();
    const preset = presets.find((item) => item.id === id);
    if (!preset) throw new Error('Saved skin set was not found.');
    const safeSlotId = String(slotId || '');
    if (!safeSlotId.startsWith('item:') || !Object.hasOwn(preset.picks, safeSlotId)) throw new Error('The selected skin is not in this saved set.');
    const nextPicks = { ...preset.picks };
    delete nextPicks[safeSlotId];
    const updatedPresets = presets.map((item) => item.id === id
      ? { ...item, picks: nextPicks, skinCount: Object.keys(nextPicks).length, updatedAt: new Date().toISOString() }
      : item);
    await this.storage.patch({ settings: { ...this.storage.state.settings, skinLoadoutPresets: updatedPresets } });
    return { presets: this.getCosmeticPresets(), preset: this.getCosmeticPresets().find((item) => item.id === id) };
  }
  async reinstallLibraryMods() {
    if (this.reinstallPromise) throw new Error('A library reinstall is already running.');
    this.reinstallPromise = this.performLibraryReinstall();
    try { return await this.reinstallPromise; }
    finally { this.reinstallPromise = null; }
  }
  async performLibraryReinstall() {
    if (!this.gamePath) throw new Error('Dota 2 installation is not configured.');
    await this.mods.assertGameClosed();
    const installed = Object.entries(this.storage.state.installedMods || {}).map(([key, record]) => ({ ...record, id: record?.id || record?.modId || key }));
    const records = installed.filter((record) => record?.fileName
      && record.modType !== 'special_patch' && record.modType !== 'theme' && record.type !== 'theme'
      && record.id !== 'vanta-generated-cosmetics' && record.modId !== 'vanta-generated-cosmetics');
    const specialPatches = installed.filter((record) => record?.modType === 'special_patch' || record.id === 'vanta-generated-cosmetics');
    const heroKey = (record) => normalizeHeroKey(record.hero || record.heroLabel || '') || 'other';
    records.sort((left, right) => heroKey(left).localeCompare(heroKey(right))
      || String(left.displayName || left.name || left.id).localeCompare(String(right.displayName || right.name || right.id)));
    const tasks = [
      ...records.map((record) => ({ record, kind: 'vpk' })),
    ];
    const hasSavedCosmetics = Object.keys(this.storage.state.settings.cosmeticLoadout || {}).length > 0;
    if (specialPatches.length || hasSavedCosmetics) {
      tasks.push({
        kind: 'special-refresh',
        record: { id: 'special-patches', name: 'Generated hero cosmetics and Dota patches' },
        members: specialPatches.length ? specialPatches : [{ id: 'vanta-generated-cosmetics', name: 'Generated Hero Cosmetics' }],
      });
    }
    const currentBuildId = await this.specialPatches.currentBuildId(this.gamePath).catch(() => null);
    const results = [];
    const operationTotal = tasks.length;
    const emit = (record, index, state, error = null) => this.onProgress({
      id: 'library-reinstall', name: 'Reinstall mods', operation: 'library-reinstall', state,
      phase: record ? `${heroKey(record)} · ${record.displayName || record.name || record.id} (${index + 1}/${operationTotal})` : 'Reinstall complete',
      percent: operationTotal ? Math.round((index / operationTotal) * 100) : 100,
      error: error?.message || null,
    });
    if (!operationTotal) {
      emit(null, 0, 'completed');
      return { ...(await this.getLibrary()), reinstall: { total: 0, succeeded: 0, failed: 0, results } };
    }
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      const { record, kind } = task;
      emit(record, index, 'processing');
      try {
        await new Promise((resolve) => setImmediate(resolve));
        let status;
        if (kind === 'vpk') {
          const packagePath = path.join(this.mods.library.directory, path.basename(record.fileName));
          const installedRecord = await this.mods.installFromPackage(
            { ...record, id: this.recordId(record), name: record.displayName || record.name || record.id },
            packagePath,
            { source: record.source || 'library-reinstall', sourcePackage: record.sourcePackage || null },
          );
          status = installedRecord.installState || 'reinstalled';
        } else if (kind === 'special-refresh') {
          const unavailable = task.members.filter((member) => member.id !== 'vanta-generated-cosmetics'
            && !this.specialPatches.isSpecialPatch(this.getAvailableMod(member.id)));
          if (unavailable.length) throw new Error(`Installed Dota patch is no longer available in the current VANTA catalog: ${unavailable.map((member) => member.displayName || member.name || member.id).join(', ')}`);
          const picks = this.storage.state.settings.cosmeticLoadout || {};
          const cosmetics = await this.applyCosmetics(picks);
          const hasPicks = Object.keys(cosmetics.picks || {}).length > 0;
          const hasGeneratedRecord = task.members.some((member) => member.id === 'vanta-generated-cosmetics');
          const members = [...task.members];
          if (hasPicks && !hasGeneratedRecord) members.push({ id: 'vanta-generated-cosmetics', name: 'Generated Hero Cosmetics' });
          for (const member of members) {
            const memberStatus = member.id === 'vanta-generated-cosmetics' && !hasPicks ? 'cleared-empty-cosmetics' : 'reinstalled';
            results.push({ id: this.recordId(member), name: member.displayName || member.name || member.id, hero: heroKey(member), status: memberStatus, gameBuildId: currentBuildId });
          }
          status = 'reinstalled';
        }
        if (kind !== 'special-refresh') results.push({ id: this.recordId(record), name: record.displayName || record.name || record.id, hero: heroKey(record), status, gameBuildId: currentBuildId });
      } catch (error) {
        const failedRecords = kind === 'special-refresh' ? task.members : [record];
        for (const failedRecord of failedRecords) results.push({ id: this.recordId(failedRecord), name: failedRecord.displayName || failedRecord.name || failedRecord.id, hero: heroKey(failedRecord), status: 'failed', gameBuildId: currentBuildId, error: error.message });
      }
      emit(record, index + 1, 'processing');
    }
    const total = results.length;
    const succeeded = results.filter((result) => result.status !== 'failed').length;
    const failed = results.length - succeeded;
    this.onProgress({ id: 'library-reinstall', name: 'Reinstall mods', operation: 'library-reinstall', state: failed ? 'failed' : 'completed', phase: 'Reinstall complete', percent: 100, error: failed ? `${failed} mod(s) could not be reinstalled.` : null });
    return { ...(await this.getLibrary()), reinstall: { total, succeeded, failed, results } };
  }
  async importVpk(filePath, displayName, metadata = {}) { await this.library.importVpk(filePath, { ...metadata, name: displayName || metadata.name || path.basename(filePath, path.extname(filePath)) }); return this.getLibrary(); }
  async getLegacyOwnedFiles(languageFolder) {
    if (!this.gamePath) return [];
    const fs = require('fs/promises');
    const parentDir = path.dirname(this.rootDir);
    const manifestPaths = [
      path.join(this.rootDir, 'manifest.json'),
      path.join(this.rootDir, 'database', 'manifest.json'),
      path.join(parentDir, 'vanta-dota2-hub', 'manifest.json'),
      path.join(parentDir, 'VANTA DOTA2 HUB', 'manifest.json'),
    ];
    const owned = [];
    for (const manifestPath of manifestPaths) {
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        for (const record of manifest.installed || []) {
          for (const file of record.files || []) {
            if (file.root !== 'lang' || !file.relPath) continue;
            owned.push(path.join(this.gamePath, /^dota_/i.test(languageFolder) ? languageFolder : `dota_${languageFolder}`, file.relPath));
          }
        }
      } catch {}
    }
    return owned;
  }
  async importLegacyLibrary(languageFolder) {
    if (!this.gamePath) return;
    const fs = require('fs/promises');
    const targetRoot = path.join(this.gamePath, /^dota_/i.test(languageFolder) ? languageFolder : `dota_${languageFolder}`);
    const manifestPaths = [path.join(this.rootDir, 'manifest.json'), path.join(this.rootDir, 'database', 'manifest.json'), path.join(path.dirname(this.rootDir), 'vanta-dota2-hub', 'manifest.json'), path.join(path.dirname(this.rootDir), 'VANTA DOTA2 HUB', 'manifest.json')];
    const candidates = [];
    for (const manifestPath of manifestPaths) {
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        for (const record of manifest.installed || []) {
          const file = (record.files || []).find((entry) => entry.root === 'lang' && /\.vpk(?:\.off|\.moff)?$/i.test(entry.relPath || ''));
          if (!file) continue;
          const base = path.join(targetRoot, file.relPath);
          const exists = await Promise.all([base, base.replace(/\.(?:off|moff)$/i, ''), `${base}.off`, `${base}.moff`].map(async (candidate) => { try { await fs.access(candidate); return true; } catch { return false; } }));
          if (exists.some(Boolean)) candidates.push({ record, file: file.relPath });
        }
      } catch {}
    }
    try {
      for (const name of await fs.readdir(targetRoot)) if (/^pak(?:0[2-9]|[1-9]\d)_dir\.vpk(?:\.off|\.moff)?$/i.test(name)) candidates.push({ record: null, file: name });
    } catch {}
    const savedPacks = await this.savedPacks.list();
    const savedPackHashes = new Map();
    const savedPackSizes = new Set();
    for (const pack of savedPacks) {
      const savedPath = path.join(this.savedPacks.directory, pack.id, pack.fileName || 'pack.vpk');
      try {
        const stat = await fs.stat(savedPath);
        const hash = pack.contentHash || await this.hashFileCached(savedPath);
        savedPackHashes.set(hash, pack);
        savedPackSizes.add(stat.size);
      } catch {}
    }
    const installedMods = { ...this.storage.state.installedMods };
    let changed = false;
    const installedByFile = new Map();
    for (const [id, mod] of Object.entries(installedMods)) {
      if (!mod || typeof mod !== 'object' || Array.isArray(mod)) continue;
      for (const name of [mod.deployedFileName, mod.gameFileName, mod.fileName]) {
        if (name) installedByFile.set(String(name).toLowerCase(), { ...mod, id });
      }
    }
    for (const [id, record] of Object.entries(installedMods)) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
      if (record.source !== 'legacy' && record.source !== 'saved-pack' || !record.targetRoot) continue;
      const base = path.join(record.targetRoot, record.gameFileName || record.deployedFileName || record.installedFiles?.[0] || '');
      const candidates = [base, base.replace(/\.(?:off|moff)$/i, ''), `${base}.off`, `${base}.moff`];
      let present = false;
      for (const candidate of candidates) { try { await fs.access(candidate); present = true; break; } catch {} }
      if (!present && (record.source === 'legacy' || record.source === 'saved-pack')) {
        const librarySource = path.join(this.mods.library.directory, path.basename(String(record.fileName || '')));
        if (!await this.exists(librarySource)) { delete installedMods[id]; changed = true; }
      }
    }
    for (const candidate of candidates) {
      const deployedFileName = candidate.file.replace(/\.(?:off|moff)$/i, '');
      const key = deployedFileName.toLowerCase();
      let savedPack = null;
      if (savedPackHashes.size && savedPackSizes.size && !/\.(?:off|moff)$/i.test(candidate.file)) {
        try {
          const candidatePath = path.join(targetRoot, candidate.file);
          const stat = await fs.stat(candidatePath);
          if (savedPackSizes.has(stat.size)) savedPack = savedPackHashes.get(await this.hashFileCached(candidatePath)) || null;
        } catch {}
      }
      const existing = installedByFile.get(key);
      if (savedPack) {
        const id = existing?.id || `saved-library-${savedPack.id}`;
        installedMods[id] = { ...existing, id, modId: id, type: 'pack', source: 'saved-pack', savedPackId: savedPack.id, contentHash: savedPack.contentHash, displayName: savedPack.name, name: savedPack.name, category: 'Pack', categoryId: 'packs', languageFolder, targetRoot, deployedFileName, gameFileName: deployedFileName, fileName: candidate.file, installedFiles: [candidate.file], enabled: true, sourceMods: savedPack.sourceMods || [], packMods: savedPack.sourceMods || [], modIds: savedPack.modIds || [] };
        if (existing?.id !== id || existing?.type !== 'pack' || existing?.savedPackId !== savedPack.id || existing?.fileName !== candidate.file) changed = true;
        installedByFile.set(key, installedMods[id]);
        continue;
      }
      if (existing) continue;
      const id = `legacy-${Buffer.from(key).toString('hex').slice(0, 24)}`;
      installedMods[id] = { id, modId: id, type: 'mod', source: 'legacy', displayName: candidate.record?.name || deployedFileName.replace(/_dir\.vpk$/i, ''), name: candidate.record?.name || deployedFileName.replace(/_dir\.vpk$/i, ''), categoryId: candidate.record?.categoryId || 'other', previewUrl: candidate.record?.preview || null, languageFolder, targetRoot, deployedFileName, gameFileName: deployedFileName, installedFiles: [candidate.file], enabled: !/\.(?:off|moff)$/i.test(candidate.file), version: 'legacy', installedAt: candidate.record?.installedAt || new Date().toISOString() };
        installedByFile.set(key, installedMods[id]);
      changed = true;
    }
    if (changed) await this.storage.patch({ installedMods });
  }
  async getLibrary() {
    const languageFolder = this.storage.state.settings.langSuffix || 'russian';
    if (!this.gamePath) { const found = await detectDota(); if (found) this.gamePath = found.gamePath; }
    await this.importLegacyLibrary(languageFolder);
    await this.mods.syncInstalled();
    await this.specialPatches.refreshStates();
    const allInstalled = Object.values(this.storage.state.installedMods || {}).filter((record) => record && typeof record === 'object' && !Array.isArray(record));
    const installed = allInstalled.filter((mod) => languageFolderMatches(mod.languageFolder, languageFolder));
    const ownedFiles = installed.flatMap((mod) => {
      const recordedNames = [mod.deployedFileName, mod.gameFileName, ...(mod.installedFiles || [])].filter(Boolean).map((file) => path.basename(file));
      const targetRoot = mod.targetRoot || (this.gamePath && path.join(this.gamePath, /^dota_/i.test(mod.languageFolder || languageFolder) ? (mod.languageFolder || languageFolder) : `dota_${mod.languageFolder || languageFolder}`));
      return targetRoot ? recordedNames.map((file) => path.join(targetRoot, file)) : [];
    });
    const legacyFiles = await this.getLegacyOwnedFiles(languageFolder);
    const mods = this.getAvailableMods();
    const cosmetics = await this.getCosmetics();
    return { ...this.snapshot(), installed, external: await detectExternalFiles(this.gamePath, mods, languageFolder, ownedFiles, legacyFiles), diagnostics: this.dotaDiagnostics.lastResult, cosmetics };
  }
  async listMods({ query = '', category = 'all', hero = null, installedOnly = false, favoriteOnly = false } = {}) {
    const library = await this.getLibrary();
    const installedIds = new Set((Array.isArray(library.installed)
      ? library.installed
      : Object.entries(library.installed || {}).map(([id, record]) => ({ ...record, id: record?.id || record?.modId || id })))
      .map((record) => record?.id || record?.modId)
      .filter(Boolean)
      .map(String));
    const mods = searchMods(this.getAvailableMods(), query, { category, hero }).filter((mod) => {
      if (installedOnly && !installedIds.has(String(mod.id))) return false;
      if (favoriteOnly && !this.storage.state.favorites.includes(mod.id)) return false;
      return true;
    });
    return { ...library, mods, categories: [...new Set(mods.map((mod) => mod.categoryId))].sort() };
  }
  async diagnoseDota() {
    const diagnostics = await this.dotaDiagnostics.check();
    return { ...this.snapshot(), diagnostics };
  }
  async getR2Catalog() {
    this.r2.indexUrl = String(this.storage.state.settings.r2IndexUrl || '').trim();
    const result = await this.r2.list();
    return { ...this.snapshot(), remotePackages: result.mods, r2: { ...this.r2.getStatus(), available: true } };
  }
  async installR2Mod(id, version = null) {
    this.r2.indexUrl = String(this.storage.state.settings.r2IndexUrl || '').trim();
    const { mod, release } = await this.r2.getRelease(id, version);
    const archive = await this.downloads.download(id, release.url, { name: mod.name, operation: 'mod-install' });
    let verified;
    try {
      verified = await this.r2.verifyPackage(archive, release);
    } catch (error) {
      await this.downloads.discardCachedArchive(id, release.url).catch(() => {});
      throw error;
    }
    await this.installer.installPackage({ ...mod, version: release.version }, archive, {
      source: 'r2',
      sourcePackage: { kind: 'r2', url: release.url, version: release.version, releaseSha256: verified.sha256, packageSize: verified.size },
    });
    return this.getLibrary();
  }
  async getLanguageFolders() { if (!this.gamePath) return []; const entries = await fs.readdir(this.gamePath, { withFileTypes: true }); const folders = entries.filter((entry) => entry.isDirectory() && /^dota_/i.test(entry.name)).map((entry) => normalizeLanguageSuffix(entry.name, '')).filter(Boolean); const selected = normalizeLanguageSuffix(this.storage.state.settings.langSuffix); return [...new Set([...folders, selected])].sort(); }
  async openModsFolder() { const folder = this.library.directory; await fs.mkdir(folder, { recursive: true }); const electronApi = (() => { try { return require('electron'); } catch { return null; } })(); if (electronApi?.shell?.openPath) { await electronApi.shell.openPath(path.dirname(folder)); return folder; } const { spawn } = require('child_process'); const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'; const child = spawn(command, [folder], { detached: true, stdio: 'ignore' }); child.unref(); return folder; }
  async setExternalEnabled(relativePath, enabled) {
    if (!this.gamePath) throw new Error('Dota 2 installation is not configured');
    const active = await resolveGameRelativePath(this.gamePath, relativePath);
    const disabled = `${active}.vanta-disabled`;
    const candidates = enabled ? [disabled, `${active}.off`, `${active}.moff`] : [active];
    const target = enabled ? active : disabled;
    let existing = '';
    for (const candidate of candidates) {
      const relative = path.relative(this.gamePath, candidate);
      const safeCandidate = await resolveGameRelativePath(this.gamePath, relative);
      if (await this.exists(safeCandidate)) { existing = safeCandidate; break; }
    }
    if (existing && path.resolve(existing) !== path.resolve(target)) await fs.rename(existing, target);
    return this.getLibrary();
  }

  async removeExternal(relativePath) {
    if (!this.gamePath) throw new Error('Dota 2 installation is not configured');
    const active = await resolveGameRelativePath(this.gamePath, relativePath);
    const disabled = `${active}.vanta-disabled`;
    for (const candidate of [active, disabled]) {
      const safeCandidate = await resolveGameRelativePath(this.gamePath, path.relative(this.gamePath, candidate));
      await fs.rm(safeCandidate, { force: true });
    }
    return this.getLibrary();
  }
  recordId(record) { return record?.id || record?.modId || null; }
  async savePack(name, modIds) {
    const ids = Array.isArray(modIds) ? [...new Set(modIds.filter(Boolean).filter((id) => this.storage.state.installedMods[id]))] : [];
    if (!ids.length) throw new Error('Select at least one valid mod to save');
    await this.mods.merge(ids, name); return this.getLibrary();
  }
  async getSavedPacks() {
    const packs = await this.savedPacks.list();
    const items = [];
    for (const pack of packs) {
      const activeFile = await this.findActiveSavedPackFile(pack);
      const active = Boolean(activeFile);
      items.push({
        ...pack,
        modCount: pack.modCount || (Array.isArray(pack.modIds) ? pack.modIds.length : 0),
        active,
        activeFileName: activeFile?.fileName || null,
        activeContentHash: activeFile?.contentHash || null,
        status: active ? 'active' : 'inactive',
      });
    }
    return items;
  }
  async listSavedPacks() { return { ...this.snapshot(), savedPacks: await this.getSavedPacks() }; }
  async activateSavedPack(id) {
    const pack = await this.savedPacks.get(id);
    if (!pack) throw new Error('Saved pack not found');
    if (!this.gamePath) throw new Error('Dota 2 installation is not configured');
    const targetRoot = this.getLanguageRoot();
    await fs.mkdir(targetRoot, { recursive: true });
    const sourcePath = path.join(this.savedPacks.directory, id, 'pack.vpk');
    if (!await this.savedPacks.exists(sourcePath)) throw new Error('Saved pack VPK file is missing');
    const sourceHash = await this.hashFile(sourcePath);
    const activeFile = await this.findActiveSavedPackFile({ ...pack, contentHash: sourceHash });
    if (activeFile) {
      await this.savedPacks.update(id, { installedFileName: activeFile.fileName, contentHash: sourceHash });
      return this.listSavedPacks();
    }
    const occupiedFiles = (await fs.readdir(targetRoot)).map((file) => file.replace(/\.(?:vanta-disabled|off|moff)$/i, ''));
    const candidate = await this.mods.library.getNextAvailablePakFilename(pack.installedFileName || null, occupiedFiles);
    const finalPath = path.join(targetRoot, candidate);
    if (await this.exists(finalPath)) {
      const targetHash = await this.hashFile(finalPath);
      if (sourceHash !== targetHash) {
        throw new Error('A different VPK already occupies the target slot');
      }
    } else {
      await fs.copyFile(sourcePath, finalPath);
    }
    await this.savedPacks.update(id, { installedFileName: candidate, contentHash: sourceHash, updatedAt: new Date().toISOString() });
    await this.getLibrary();
    return this.listSavedPacks();
  }
  async saveSavedPack({ name, packId, modIds }) {
    const sourcePack = packId ? this.storage.state.installedMods[packId] : null;
    if (packId && (!sourcePack || sourcePack.type !== 'pack')) throw new Error('Library pack not found');
    const ids = sourcePack ? (sourcePack.sourceModIds || sourcePack.modIds || []).filter(Boolean) : Array.isArray(modIds) ? [...new Set(modIds.filter(Boolean).filter((id) => this.storage.state.installedMods[id]))] : [];
    if (!sourcePack && !ids.length) throw new Error('Selected mods are no longer available in the library');
    const chosen = sourcePack ? [] : ids.map((id) => this.storage.state.installedMods[id]).filter(Boolean);
    const safeName = String(name || '').trim();
    if (!safeName) throw new Error('Saved pack name is required');
    const existing = (await this.savedPacks.list()).find((pack) => pack.name.toLowerCase() === safeName.toLowerCase());
    if (existing) throw new Error('A saved pack with this name already exists');
    let archivePath;
    let sourceMods = chosen.map((record) => ({ id: this.recordId(record), displayName: record.displayName || record.name, name: record.displayName || record.name, hero: record.hero, heroLabel: record.heroLabel, slot: record.slot }));
    if (sourcePack) {
      const fileName = sourcePack.fileName || (sourcePack.installedFiles || []).find((file) => /\.vpk$/i.test(file));
      archivePath = fileName ? path.join(this.mods.library.directory, fileName) : null;
      if (!archivePath) throw new Error('Pack VPK file is missing from the library');
      const stat = await fs.stat(archivePath).catch(() => null);
      if (!stat || !stat.isFile() || stat.size <= 0) throw new Error('Pack VPK file is missing from the library');
      sourceMods = sourcePack.sourceMods || sourcePack.packMods || [];
    } else {
      archivePath = path.join(this.rootDir, 'database', '.tmp-saved-pack.vpk');
      await this.writeSavedPackArchive(archivePath, chosen);
    }
    try {
      const contentHash = await this.hashFile(archivePath);
      const savedCopies = await this.savedPacks.list();
      for (const savedCopy of savedCopies) {
        const savedCopyPath = path.join(this.savedPacks.directory, savedCopy.id, savedCopy.fileName || 'pack.vpk');
        try {
          if ((savedCopy.contentHash || await this.hashFile(savedCopyPath)) === contentHash) return this.listSavedPacks();
        } catch {}
      }
      await this.savedPacks.save({ name: safeName, modIds: ids, sourceMods, sourcePackId: sourcePack?.id || null, sourceFileName: sourcePack?.fileName || null, contentHash, archivePath });
    } finally {
      if (!sourcePack) await fs.rm(archivePath, { force: true });
    }
    return this.listSavedPacks();
  }
  async renameSavedPack(id, name) {
    const safeName = String(name || '').trim();
    if (!safeName) throw new Error('Saved pack name is required');
    const existing = (await this.savedPacks.list()).find((pack) => String(pack.id) !== String(id) && pack.name.toLowerCase() === safeName.toLowerCase());
    if (existing) throw new Error('A saved pack with this name already exists');
    await this.savedPacks.rename(id, safeName);
    return this.listSavedPacks();
  }
  async deleteSavedPack(id) {
    const pack = await this.savedPacks.get(id);
    if (!pack) throw new Error('Saved pack not found');
    if (this.gamePath) {
      await this.getLibrary();
      const installed = Object.values(this.storage.state.installedMods).find((record) => record.savedPackId === id);
      if (installed) await this.mods.uninstall(this.recordId(installed));
      else {
        const activeFile = await this.findActiveSavedPackFile(pack);
        if (activeFile) await fs.rm(activeFile.path, { force: true });
      }
      this.activeVpkHashCache = null;
    }
    await this.savedPacks.remove(id);
    return this.listSavedPacks();
  }
  async deletePack(id) { await this.mods.uninstall(id); return this.getLibrary(); }
  async hashFile(filePath) {
    if (!filePath) return null;
    const data = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  }
  async hashFileCached(filePath) {
    const stat = await fs.stat(filePath);
    const signature = `${stat.size}:${stat.mtimeMs}`;
    const cached = this.fileHashCache.get(filePath);
    if (cached?.signature === signature) return cached.hash;
    const hash = await this.hashFile(filePath);
    this.fileHashCache.set(filePath, { signature, hash });
    if (this.fileHashCache.size > 1000) this.fileHashCache.delete(this.fileHashCache.keys().next().value);
    return hash;
  }
  async exists(filePath) {
    try { await fs.access(filePath); return true; } catch { return false; }
  }
  getLanguageRoot() {
    const languageFolder = this.storage.state.settings.langSuffix || 'dota';
    return path.join(this.gamePath, /^dota_/i.test(languageFolder) ? languageFolder : `dota_${languageFolder}`);
  }
  async findActiveSavedPackFile(pack) {
    const savedPath = pack && path.join(this.savedPacks.directory, pack.id, pack.fileName || 'pack.vpk');
    if (!pack || !this.gamePath || !savedPath || !(await this.exists(savedPath))) return null;
    const sourceHash = pack.contentHash || await this.hashFile(savedPath);
    const preferredName = pack.installedFileName;
    if (preferredName && /^pak\d{2}_dir\.vpk$/i.test(preferredName)) {
      const preferredPath = path.join(this.getLanguageRoot(), preferredName);
      if (await this.exists(preferredPath) && await this.hashFile(preferredPath) === sourceHash) return { fileName: preferredName, contentHash: sourceHash, path: preferredPath };
    }
    const activeFiles = await this.getActiveVpkHashes();
    const match = activeFiles.get(sourceHash);
    if (match) return { fileName: match.fileName, contentHash: sourceHash, path: match.path };
    return null;
  }
  async getActiveVpkHashes() {
    const root = this.getLanguageRoot();
    let entries;
    try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return new Map(); }
    const candidates = entries.filter((entry) => entry.isFile() && /^pak\d{2}_dir\.vpk$/i.test(entry.name));
    const signature = JSON.stringify(await Promise.all(candidates.map(async (entry) => { const stat = await fs.stat(path.join(root, entry.name)); return [entry.name, stat.size, stat.mtimeMs]; })));
    if (this.activeVpkHashCache?.root === root && this.activeVpkHashCache.signature === signature) return this.activeVpkHashCache.hashes;
    const hashes = new Map();
    for (const entry of candidates) {
      const candidatePath = path.join(root, entry.name);
      hashes.set(await this.hashFile(candidatePath), { fileName: entry.name, path: candidatePath });
    }
    this.activeVpkHashCache = { root, signature, hashes };
    return hashes;
  }
  async getSavedPackContents(id) {
    const pack = await this.savedPacks.get(id);
    if (!pack) throw new Error('Saved pack not found');
    return this.readPackContents(path.join(this.savedPacks.directory, id, pack.fileName || 'pack.vpk'), { ...pack, source: 'saved', name: pack.name });
  }
  async getLibraryPackContents(id) {
    const pack = this.storage.state.installedMods[id];
    if (!pack || pack.type !== 'pack') throw new Error('Library pack not found');
    const sourcePath = pack.targetRoot ? path.join(pack.targetRoot, pack.deployedFileName || pack.gameFileName || pack.fileName) : path.join(this.mods.library.directory, pack.fileName);
    return this.readPackContents(sourcePath, { ...pack, source: 'library', name: pack.displayName || pack.name });
  }
  async readPackContents(sourcePath, pack) {
    const stat = await fs.stat(sourcePath).catch(() => null);
    if (!stat || !stat.isFile() || stat.size <= 0) throw new Error('Pack VPK file is missing');
    const reader = VpkReader.open(sourcePath);
    try {
      return { ...pack, filePath: sourcePath, contentHash: await this.hashFile(sourcePath), files: reader.files(), sourceMods: pack.sourceMods || pack.packMods || [] };
    } catch (error) {
      throw new Error(`Pack VPK file is invalid: ${error.message}`);
    } finally { reader.close(); }
  }
  async writeSavedPackArchive(archivePath, chosenRecords) {
    const writer = new VpkWriter();
    const mergedFiles = new Map();
    for (const record of chosenRecords) {
      const source = path.join(this.mods.library.directory, record.fileName);
      if (!await this.exists(source)) throw new Error(`Saved pack source VPK is missing: ${record.fileName}`);
      const reader = VpkReader.open(source);
      try {
        for (const file of reader.files()) mergedFiles.set(file, reader.readFile(file));
      } finally { reader.close(); }
    }
    for (const [file, data] of mergedFiles) writer.addFile(file, data);
    await fs.mkdir(path.dirname(archivePath), { recursive: true });
    writer.write(archivePath);
  }
  async cancelDownload(id) { return this.downloads.cancel(id); }
  async clearDownloadArchives() { await this.downloads.clear(); return this.snapshot(); }
  async getDownloadArchiveStats() { return this.downloads.getStats(); }
  async getDownloadArchives() {
    const archives = await this.downloads.listArchives();
    return { ...this.snapshot(), archives: archives.map((archive) => {
      const mod = this.getAvailableMod(archive.id);
      return { ...archive, name: mod?.name || archive.id, categoryId: mod?.categoryId || 'other', heroLabel: mod?.heroLabel || null, slot: mod?.slot || null, author: mod?.author || null, previewUrl: mod?.previewUrl || null, available: Boolean(mod), installed: Boolean(this.storage.state.installedMods[archive.id]) };
    }) };
  }
  async deleteDownloadArchive(key) { await this.downloads.deleteArchive(key); return this.getDownloadArchives(); }
  async deleteDownloadArchives(keys) { await this.downloads.deleteArchives(keys); return this.getDownloadArchives(); }
  async installDownloadArchives(ids) {
    const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string'))];
    if (!uniqueIds.length) throw new Error('Select at least one archive');
    const results = [];
    for (const id of uniqueIds) {
      const mod = this.getAvailableMod(id);
      let archive = null;
      for (const directory of this.downloads.archiveRoots) {
        const candidate = path.join(directory, `${id}.zip`);
        if (await this.exists(candidate)) { archive = candidate; break; }
      }
      if (!archive) { results.push({ id, ok: false, error: 'The downloaded package is not available locally.' }); continue; }
      try {
        await this.installer.importVpk(archive, { id: mod?.id, name: mod?.name || id, author: mod?.author || null, categoryId: mod?.categoryId || 'other', version: mod?.version || 'imported' });
        results.push({ id, ok: true });
      }
      catch (error) { results.push({ id, ok: false, error: error.message }); }
    }
    return { ...this.snapshot(), results };
  }
  getSettings() { return this.snapshot().settings; }
  async getThemes() { return { ...this.snapshot(), themes: this.themeManager.getThemes(), activeThemeId: this.themeManager.getActiveThemeId() }; }
  searchThemes(query, themes = this.themeManager.getThemes()) { return this.themeManager.searchThemes(query, themes); }
  async setTheme(themeId) {
    const theme = this.themeManager.getTheme(themeId);
    await this.themeManager.setActiveTheme(theme.id, { persist: true });
    await this.storage.patch({ settings: { ...this.storage.state.settings, activeThemeId: this.themeManager.getActiveThemeId() } });
    return { ...this.snapshot(), theme: theme || this.themeManager.getActiveTheme() };
  }
  async importTheme(filePath) {
    await this.themeManager.importTheme(filePath);
    return this.snapshot();
  }
  async removeTheme(themeId) {
    const activeId = this.themeManager.getActiveThemeId();
    const removedTheme = this.themeManager.getTheme(themeId);
    await this.themeManager.removeTheme(themeId);
    const installedMods = { ...this.storage.state.installedMods };
    delete installedMods[themeId];
    await this.storage.patch({ settings: { ...this.storage.state.settings, activeThemeId: this.themeManager.getActiveThemeId() }, installedMods });
    return { ...this.snapshot(), removedThemeId: removedTheme?.id || themeId, activeThemeId: this.themeManager.getActiveThemeId(), resetToDefault: activeId === themeId };
  }
  async openThemesFolder() {
    const electronApi = (() => { try { return require('electron'); } catch { return null; } })();
    if (electronApi?.shell?.openPath) {
      await electronApi.shell.openPath(this.themeManager.themesDir);
    }
    return { themesDir: this.themeManager.themesDir, themes: this.themeManager.getThemes() };
  }
  async getDiagnostics(logger, app) { return require('../../infrastructure/diagnostics').collectDiagnostics({ service: this, app, logger }); }
  async setSetting(key, value) {
    if (key === 'langSuffix') value = normalizeLanguageSuffix(value);
    if (key === 'langSuffix' && value !== this.storage.state.settings.langSuffix) await this.mods.moveInstalledMods(value);
    if (key === 'r2IndexUrl') {
      value = String(value || '').trim();
      if (value) {
        let parsed;
        try { parsed = new URL(value); } catch { throw new Error('R2 index URL is invalid.'); }
        if (parsed.protocol !== 'https:') throw new Error('R2 index URL must use HTTPS.');
      }
      this.r2.indexUrl = value;
    }
    if (key === 'activeThemeId') {
      await this.themeManager.setActiveTheme(value, { persist: true });
      await this.storage.patch({ settings: { ...this.storage.state.settings, activeThemeId: this.themeManager.getActiveThemeId() } });
      return this.snapshot();
    }
    await this.storage.patch({ settings: { ...this.storage.state.settings, [key]: value } });
    return this.snapshot();
  }
}

module.exports = { AppService, normalizeLanguageSuffix };