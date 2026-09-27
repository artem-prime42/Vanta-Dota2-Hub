const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { migrateLegacyUserData } = require('../src/infrastructure/user-data-migration');
const { JsonStorage } = require('../src/infrastructure/storage');

test('migrates populated state and missing library/cache files from legacy app data', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-profile-migration-'));
  const oldRoot = path.join(parent, 'VANTA DOTA2 HUB');
  const newRoot = path.join(parent, 'VANTA');
  await fs.mkdir(path.join(oldRoot, 'database'), { recursive: true });
  await fs.writeFile(path.join(oldRoot, 'database', 'state.json'), JSON.stringify({ settings: { langSuffix: 'english', gamePath: '/games/dota' }, favorites: ['legacy-mod'], installedMods: { 'legacy-mod': { id: 'legacy-mod' } }, savedPacks: [] }));
  await fs.mkdir(path.join(oldRoot, 'database', 'library'), { recursive: true });
  await fs.writeFile(path.join(oldRoot, 'database', 'library', 'pak02_dir.vpk'), 'legacy VPK');
  await fs.mkdir(path.join(oldRoot, 'cache'), { recursive: true });
  await fs.writeFile(path.join(oldRoot, 'cache', 'catalog.json'), '{"mods":[]}');

  const migration = await migrateLegacyUserData(newRoot);
  const storage = new JsonStorage(newRoot);
  await storage.init();

  assert.equal(migration.migratedStateFrom, path.basename(oldRoot));
  assert.deepEqual(storage.state.favorites, ['legacy-mod']);
  assert.equal(storage.state.settings.gamePath, '/games/dota');
  assert.equal(await fs.readFile(path.join(newRoot, 'database', 'library', 'pak02_dir.vpk'), 'utf8'), 'legacy VPK');
  assert.equal(await fs.readFile(path.join(newRoot, 'cache', 'catalog.json'), 'utf8'), '{"mods":[]}');
});

test('does not replace populated current state or overwrite existing library files', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-profile-preserve-'));
  const oldRoot = path.join(parent, 'VANTA DOTA2 HUB');
  const newRoot = path.join(parent, 'VANTA');
  await fs.mkdir(path.join(oldRoot, 'database'), { recursive: true });
  await fs.writeFile(path.join(oldRoot, 'database', 'state.json'), JSON.stringify({ favorites: ['old-favorite'], installedMods: {} }));
  await fs.mkdir(path.join(oldRoot, 'database', 'library'), { recursive: true });
  await fs.writeFile(path.join(oldRoot, 'database', 'library', 'pak02_dir.vpk'), 'old VPK');
  await fs.mkdir(path.join(newRoot, 'database'), { recursive: true });
  await fs.writeFile(path.join(newRoot, 'database', 'state.json'), JSON.stringify({ favorites: ['current-favorite'], installedMods: {} }));
  await fs.mkdir(path.join(newRoot, 'database', 'library'), { recursive: true });
  await fs.writeFile(path.join(newRoot, 'database', 'library', 'pak02_dir.vpk'), 'current VPK');

  const migration = await migrateLegacyUserData(newRoot);
  const state = JSON.parse(await fs.readFile(path.join(newRoot, 'database', 'state.json'), 'utf8'));

  assert.equal(migration.migratedStateFrom, null);
  assert.deepEqual(state.favorites, ['current-favorite']);
  assert.equal(await fs.readFile(path.join(newRoot, 'database', 'library', 'pak02_dir.vpk'), 'utf8'), 'current VPK');
});
