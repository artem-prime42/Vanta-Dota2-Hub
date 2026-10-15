const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AppService } = require('../src/main/services/app-service');

test('skin loadout presets persist, reapply hero and global cosmetics, and can be deleted', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-skin-presets-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = new AppService({ rootDir: root });
  await service.storage.init();
  const heroes = [{ key: 'axe', name: 'Axe', slots: [{ id: 'item:axe:weapon', options: [{ id: '20' }] }] }];
  const globalSlots = [{ id: 'weather', options: [{ itemId: '10704' }] }];
  service.getCosmeticListing = async () => ({ heroes, globalSlots, error: null });
  await service.storage.patch({ settings: { ...service.storage.state.settings, cosmeticLoadout: { 'item:axe:weapon': '20' }, schemaCosmeticLoadout: { weather: '10704' } } });
  let applied;
  service.specialPatches.applyCosmeticLoadout = async (picks, globalPicks) => {
    applied = { picks, globalPicks };
    await service.storage.patch({ settings: { ...service.storage.state.settings, cosmeticLoadout: picks, schemaCosmeticLoadout: globalPicks } });
    return { applied: Object.keys(picks).length + Object.keys(globalPicks).length };
  };
  service.specialPatches.readSpecialManifest = async () => null;

  const saved = await service.saveCosmeticPreset('Axe classic');
  assert.equal(saved.presets.length, 1);
  assert.deepEqual(saved.presets[0].picks, { 'item:axe:weapon': '20' });
  assert.deepEqual(saved.presets[0].globalPicks, { weather: '10704' });
  assert.equal(saved.presets[0].skinCount, 2);
  await assert.rejects(service.saveCosmeticPreset('Axe classic'), /already exists/i);
  await service.storage.patch({ settings: { ...service.storage.state.settings, cosmeticLoadout: {}, schemaCosmeticLoadout: {} } });
  const appliedPreset = await service.applyCosmeticPreset(saved.presets[0].id);
  assert.deepEqual(applied, { picks: { 'item:axe:weapon': '20' }, globalPicks: { weather: '10704' } });
  assert.deepEqual(appliedPreset.picks, { 'item:axe:weapon': '20' });
  assert.deepEqual(appliedPreset.globalPicks, { weather: '10704' });
  const deleted = await service.deleteCosmeticPreset(saved.presets[0].id);
  assert.deepEqual(deleted.presets, []);
  await assert.rejects(service.applyCosmeticPreset(saved.presets[0].id), /not found/i);
});

test('removing one skin from a saved preset persists the remaining picks', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-skin-preset-remove-item-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = new AppService({ rootDir: root });
  await service.storage.init();
  const preset = { id: 'preset-one', name: 'Axe set', picks: { 'item:axe:weapon': '20', 'item:axe:head': '30' }, skinCount: 2 };
  await service.storage.patch({ settings: { ...service.storage.state.settings, skinLoadoutPresets: [preset] } });

  const result = await service.removeCosmeticPresetPick(preset.id, 'item:axe:weapon');

  assert.deepEqual(result.preset.picks, { 'item:axe:head': '30' });
  assert.equal(result.preset.skinCount, 1);
  await assert.rejects(service.removeCosmeticPresetPick(preset.id, 'item:axe:weapon'), /not in this saved set/i);
  const restored = new AppService({ rootDir: root });
  await restored.storage.init();
  assert.deepEqual(restored.getCosmeticPresets()[0].picks, { 'item:axe:head': '30' });
});

test('applying a legacy hero-only preset preserves existing World/Interface selections', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-legacy-skin-preset-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = new AppService({ rootDir: root });
  await service.storage.init();
  service.getCosmeticListing = async () => ({
    heroes: [{ key: 'axe', slots: [{ id: 'item:axe:weapon', options: [{ id: '20' }] }] }],
    globalSlots: [{ id: 'music', options: [{ itemId: '100' }] }],
  });
  await service.storage.patch({ settings: {
    ...service.storage.state.settings,
    cosmeticLoadout: {},
    schemaCosmeticLoadout: { music: '100' },
    skinLoadoutPresets: [{ id: 'legacy-preset', name: 'Hero only', picks: { 'item:axe:weapon': '20' } }],
  } });
  let applied;
  service.specialPatches.applyCosmeticLoadout = async (heroPicks, globalPicks) => {
    applied = { heroPicks, globalPicks };
    await service.storage.patch({ settings: { ...service.storage.state.settings, cosmeticLoadout: heroPicks, schemaCosmeticLoadout: globalPicks } });
  };

  await service.applyCosmeticPreset('legacy-preset');

  assert.deepEqual(applied, { heroPicks: { 'item:axe:weapon': '20' }, globalPicks: { music: '100' } });
  assert.deepEqual(service.storage.state.settings.schemaCosmeticLoadout, { music: '100' });
});

test('removing a global World/Interface cosmetic from a saved preset preserves hero picks', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-skin-preset-remove-global-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = new AppService({ rootDir: root });
  await service.storage.init();
  const preset = { id: 'preset-global', name: 'Combined', picks: { 'item:axe:weapon': '20' }, globalPicks: { weather: '10704' }, skinCount: 2 };
  await service.storage.patch({ settings: { ...service.storage.state.settings, skinLoadoutPresets: [preset] } });

  const result = await service.removeCosmeticPresetPick(preset.id, 'global:weather');

  assert.deepEqual(result.preset.picks, { 'item:axe:weapon': '20' });
  assert.deepEqual(result.preset.globalPicks, {});
  assert.equal(result.preset.skinCount, 1);
});

test('library reinstall processes hero groups and rebuilds generated patches while continuing after failures', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-library-reinstall-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const progress = [];
  const service = new AppService({ rootDir: root, onProgress: (event) => progress.push(event), processRunning: async () => false });
  await service.storage.init();
  service.gamePath = path.join(root, 'game');
  service.mods.assertGameClosed = async () => {};
  service.mods.installFromPackage = async (mod, packagePath) => {
    assert.equal(Boolean(service.modsReinstallActive), false);
    service.modsReinstallActive = true;
    await new Promise((resolve) => setImmediate(resolve));
    service.modsReinstallActive = false;
    assert.equal(path.basename(packagePath), mod.fileName);
    if (mod.id === 'axe-bad') throw new Error('local VPK missing');
    return { installState: 'installed' };
  };
  service.applyCosmetics = async (picks) => {
    assert.deepEqual(picks, { 'item:axe:weapon': '20' });
    return { picks, operation: { installed: true } };
  };
  service.getAvailableMod = (id) => id === 'special' ? { id, name: 'Weather', modType: 'special_patch', specialType: 'weather' } : null;
  service.specialPatches.update = async (mod) => ({ specialPatchState: 'updated', id: mod.id });
  service.specialPatches.currentBuildId = async () => '123456';
  service.getLibrary = async () => ({ installed: service.storage.state.installedMods, settings: service.storage.state.settings });
  await service.storage.patch({ settings: { ...service.storage.state.settings, cosmeticLoadout: { 'item:axe:weapon': '20' } } });
  await service.storage.patch({ installedMods: {
    'zeus-good': { id: 'zeus-good', name: 'Zeus set', hero: 'zeus', fileName: 'pak04_dir.vpk' },
    'axe-bad': { id: 'axe-bad', name: 'Axe set', hero: 'axe', fileName: 'pak03_dir.vpk' },
    'axe-good': { id: 'axe-good', name: 'Axe weapon', hero: 'axe', fileName: 'pak02_dir.vpk' },
    special: { id: 'special', modType: 'special_patch', fileName: 'special' },
    'vanta-generated-cosmetics': { id: 'vanta-generated-cosmetics', fileName: 'cosmetics.vpk' },
  } });

  const result = await service.reinstallLibraryMods();

  assert.deepEqual(result.reinstall.results.map((item) => item.id), ['axe-bad', 'axe-good', 'zeus-good', 'special', 'vanta-generated-cosmetics']);
  assert.equal(result.reinstall.succeeded, 4);
  assert.equal(result.reinstall.failed, 1);
  assert.equal(result.reinstall.results[0].status, 'failed');
  assert.equal(result.reinstall.results[3].status, 'reinstalled');
  assert.equal(result.reinstall.results[4].status, 'reinstalled');
  assert.equal(result.reinstall.results[4].gameBuildId, '123456');
  assert.equal(progress.at(-1).operation, 'library-reinstall');
  assert.equal(progress.at(-1).state, 'failed');
  assert.equal(progress.at(-1).percent, 100);
});

test('library reinstall regenerates saved hero cosmetics even when their installed marker is missing', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-reinstall-saved-cosmetics-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = new AppService({ rootDir: root, processRunning: async () => false });
  await service.storage.init();
  service.gamePath = path.join(root, 'game');
  service.mods.assertGameClosed = async () => {};
  service.specialPatches.currentBuildId = async () => '789012';
  await service.storage.patch({ settings: { ...service.storage.state.settings, cosmeticLoadout: { 'item:axe:weapon': '20' } } });
  let regenerated = false;
  service.applyCosmetics = async (picks) => {
    regenerated = true;
    return { picks, operation: { installed: true } };
  };
  service.getLibrary = async () => ({ installed: service.storage.state.installedMods, settings: service.storage.state.settings });

  const result = await service.reinstallLibraryMods();

  assert.equal(regenerated, true);
  assert.equal(result.reinstall.total, 1);
  assert.equal(result.reinstall.results[0].id, 'vanta-generated-cosmetics');
  assert.equal(result.reinstall.results[0].status, 'reinstalled');
  assert.equal(result.reinstall.results[0].gameBuildId, '789012');
});

test('library reinstall regenerates a saved global-only World/Interface loadout without its marker', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-reinstall-global-cosmetics-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = new AppService({ rootDir: root, processRunning: async () => false });
  await service.storage.init();
  service.gamePath = path.join(root, 'game');
  service.mods.assertGameClosed = async () => {};
  service.specialPatches.currentBuildId = async () => '789013';
  await service.storage.patch({ settings: { ...service.storage.state.settings, schemaCosmeticLoadout: { music: '100' } } });
  service.applyCosmetics = async (picks) => ({ picks, globalPicks: service.storage.state.settings.schemaCosmeticLoadout, operation: { installed: true } });
  service.getLibrary = async () => ({ installed: service.storage.state.installedMods, settings: service.storage.state.settings });

  const result = await service.reinstallLibraryMods();

  assert.equal(result.reinstall.total, 1);
  assert.equal(result.reinstall.results[0].id, 'vanta-generated-cosmetics');
  assert.equal(result.reinstall.results[0].status, 'reinstalled');
  assert.deepEqual(service.storage.state.settings.schemaCosmeticLoadout, { music: '100' });
});