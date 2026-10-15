const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { JsonStorage, safeRename } = require('../src/infrastructure/storage');

test('local state survives a new storage instance', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-'));
  const first = new JsonStorage(root);
  await first.init();
  await first.patch({ favorites: ['mod-one'] });
  const second = new JsonStorage(root);
  await second.init();
  assert.deepEqual(second.state.favorites, ['mod-one']);
});

test('concurrent state updates are serialized and preserve the full Library snapshot', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-state-concurrent-'));
  const storage = new JsonStorage(root);
  await storage.init();
  await Promise.all([
    storage.patch({ favorites: ['mod-one'] }),
    storage.patch({ installedMods: { 'hero-mod': { id: 'hero-mod', fileName: 'pak02_dir.vpk' } } }),
    storage.patch({ settings: { ...storage.state.settings, gamePath: '/steamapps/common/dota 2 beta/game' } }),
  ]);

  const restored = new JsonStorage(root);
  await restored.init();
  assert.deepEqual(restored.state.favorites, ['mod-one']);
  assert.equal(restored.state.installedMods['hero-mod'].fileName, 'pak02_dir.vpk');
  assert.equal(restored.state.settings.gamePath, '/steamapps/common/dota 2 beta/game');
});

test('invalid primary state recovers the previous valid Library snapshot from backup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-state-recovery-'));
  const storage = new JsonStorage(root);
  await storage.init();
  await storage.patch({ installedMods: { first: { id: 'first', fileName: 'pak02_dir.vpk' } } });
  await storage.patch({ installedMods: { first: { id: 'first', fileName: 'pak02_dir.vpk' }, second: { id: 'second', fileName: 'pak03_dir.vpk' } } });
  await fs.writeFile(storage.file, '{ interrupted write');

  const restored = new JsonStorage(root);
  await restored.init();
  assert.deepEqual(Object.keys(restored.state.installedMods), ['first']);
  assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(storage.file, 'utf8')).installedMods), ['first']);
});

test('same-path rename is ignored instead of throwing', async () => {
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-same-path-')), 'state.json');
  await fs.writeFile(file, 'ok');
  await safeRename(file, file);
  assert.equal(await fs.readFile(file, 'utf8'), 'ok');
});