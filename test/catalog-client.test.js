const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { CatalogClient } = require('../src/infrastructure/catalog-client');

test('catalog falls back to the last valid cache when network fails', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-catalog-'));
  const payload = { mods: { modsData: { heroes: [{ name: 'Cached Mod', file: 'cached.zip' }] } } };
  const online = new CatalogClient({ rootDir: root, fetchImpl: async () => ({ ok: true, headers: { get: () => 'revision-1' }, json: async () => payload }) });
  await online.load();
  const offline = new CatalogClient({ rootDir: root, fetchImpl: async () => { throw new Error('offline'); } });
  const result = await offline.load();
  assert.equal(result.mods[0].name, 'Cached Mod');
  assert.equal(result.meta.offline, true);
});

test('catalog client reads author profiles from the external source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-authors-'));
  const payload = { mods: { modsData: { heroes: [{ name: 'Creator Mod', author: 'pudgek', file: 'x.zip' }] } } };
  const client = new CatalogClient({ rootDir: root, fetchImpl: async (url) => ({ ok: true, headers: { get: () => 'revision-1' }, json: async () => url.endsWith('authors.json') ? { authors: [{ nick: 'pudgek', photo: 'avatar.jpg' }] } : payload }) });
  await client.load();
  assert.equal(client.authors[0].nick, 'pudgek');
});

test('catalog themes are exposed separately and never flattened into mod results', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-catalog-themes-'));
  const theme = { id: 'community-night', name: 'Community Night', author: 'Theme Maker', version: '1.0.0', description: 'A violet custom palette', colors: {} };
  const payload = {
    mods: { modsData: { heroes: [{ name: 'Catalog Mod', file: 'mod.zip' }] } },
    themes: [theme],
  };
  const client = new CatalogClient({ rootDir: root, fetchImpl: async (url) => ({ ok: true, headers: { get: () => 'rev-theme' }, json: async () => url.endsWith('authors.json') ? [] : payload }) });
  const result = await client.load();
  assert.deepEqual(result.mods.map((mod) => mod.name), ['Catalog Mod']);
  assert.deepEqual(result.themes, [theme]);
  assert.deepEqual(client.mods.map((mod) => mod.name), ['Catalog Mod']);
});
