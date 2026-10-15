const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { CatalogClient } = require('../src/infrastructure/catalog-client');
const { AppService } = require('../src/main/services/app-service');

test('catalog loads its local cache and never requests a remote refresh', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-catalog-'));
  const payload = { mods: { modsData: { heroes: [{ name: 'Cached Mod', file: 'cached.zip' }] } } };
  const cache = path.join(root, 'cache');
  await fs.mkdir(cache, { recursive: true });
  await fs.writeFile(path.join(cache, 'catalog.json'), JSON.stringify(payload));
  let fetchCount = 0;
  const offline = new CatalogClient({ rootDir: root, fetchImpl: async () => { fetchCount += 1; throw new Error('network should not be used'); } });
  const result = await offline.load();
  assert.equal(result.mods[0].name, 'Cached Mod');
  assert.equal(result.meta.offline, true);
  assert.equal(fetchCount, 0);
});

test('catalog client starts in offline mode when neither network nor cache is available', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-bundled-special-patches-'));
  let fetchCount = 0;
  const client = new CatalogClient({ rootDir: root, fetchImpl: async () => { fetchCount += 1; throw new Error('network should not be used'); } });

  const result = await client.load();

  assert.equal(result.meta.offline, true);
  assert.deepEqual(result.mods, []);
  assert.equal(fetchCount, 0);
});

test('AppService exposes bundled Weather and Tower patches without catalog entries', () => {
  const service = new AppService({ rootDir: path.join(os.tmpdir(), 'vanta-app-service-bundled-patches') });

  const mods = service.getAvailableMods();
  const weather = mods.filter((mod) => mod.modType === 'special_patch' && mod.specialType === 'weather');
  const towers = mods.filter((mod) => mod.modType === 'special_patch' && mod.specialType === 'tower');

  assert.equal(weather.length, 9);
  assert.equal(towers.length, 4);
  assert.equal(service.getAvailableMod('special-weather-snow').requiredFiles[0].itemId, '555');
  assert.equal(service.getAvailableMod('special-weather-snow').createdAt, '2026-09-30T00:00:00.000Z');
  assert.deepEqual(service.getAvailableMod('special-tower-crownfall').requiredFiles.map((file) => file.itemId), ['677', '678']);
  assert.deepEqual(service.specialPatches.getMods().map((mod) => mod.id), mods.map((mod) => mod.id));
});

test('catalog client reads cached author profiles without contacting a remote source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-authors-'));
  const cache = path.join(root, 'cache');
  await fs.mkdir(cache, { recursive: true });
  await fs.writeFile(path.join(cache, 'authors.json'), JSON.stringify([{ nick: 'pudgek', photo: 'avatar.jpg' }]));
  let fetchCount = 0;
  const client = new CatalogClient({ rootDir: root, fetchImpl: async () => { fetchCount += 1; throw new Error('network should not be used'); } });
  await client.load();
  assert.equal(client.authors[0].nick, 'pudgek');
  assert.equal(fetchCount, 0);
});

test('cached themes stay separate from cached mod results', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-catalog-themes-'));
  const theme = { id: 'community-night', name: 'Community Night', author: 'Theme Maker', version: '1.0.0', description: 'A violet custom palette', colors: {} };
  const payload = {
    mods: { modsData: { heroes: [{ name: 'Catalog Mod', file: 'mod.zip' }] } },
    themes: [theme],
  };
  const cache = path.join(root, 'cache');
  await fs.mkdir(cache, { recursive: true });
  await fs.writeFile(path.join(cache, 'catalog.json'), JSON.stringify(payload));
  const client = new CatalogClient({ rootDir: root, fetchImpl: async () => { throw new Error('network should not be used'); } });
  const result = await client.load();
  assert.deepEqual(result.mods.map((mod) => mod.name), ['Catalog Mod']);
  assert.deepEqual(result.themes, [theme]);
  assert.deepEqual(client.mods.map((mod) => mod.name), ['Catalog Mod']);
});
