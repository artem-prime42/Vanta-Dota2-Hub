const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { DownloadManager } = require('../src/infrastructure/download-manager');

test('download manager reuses and clears saved archives', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-downloads-'));
  const manager = new DownloadManager(root);
  const destination = path.join(root, 'downloads', 'mod.zip');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, 'cached');
  let requests = 0;
  assert.equal(await manager.download('mod', 'https://example.test/mod.zip'), destination);
  assert.equal(requests, 0);
  await fs.writeFile(`${destination}.url`, 'https://example.test/old.zip');
  await assert.rejects(manager.download('mod', 'https://example.test/new.zip'));
  await fs.writeFile(path.join(root, 'downloads', 'broken.part'), 'partial');
  await fs.writeFile(path.join(root, 'downloads', 'legacy.ZIP'), 'legacy');
  await fs.mkdir(path.join(root, 'downloads', 'stale'), { recursive: true });
  await fs.writeFile(path.join(root, 'downloads', 'stale', 'archive.bin'), 'stale');
  await manager.clear();
  await assert.rejects(fs.access(destination));
  await assert.rejects(fs.access(path.join(root, 'downloads', 'broken.part')));
  await assert.rejects(fs.access(path.join(root, 'downloads', 'legacy.ZIP')));
  await assert.rejects(fs.access(path.join(root, 'downloads', 'stale')));
});

test('download manager clears archives from legacy roots', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-downloads-'));
  const legacyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-legacy-'));
  const secondLegacyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-legacy-'));
  const manager = new DownloadManager(root, undefined, [legacyRoot, secondLegacyRoot]);
  await fs.mkdir(path.join(legacyRoot, 'downloads'), { recursive: true });
  await fs.writeFile(path.join(legacyRoot, 'downloads', 'legacy.zip'), 'cached');
  await fs.mkdir(path.join(secondLegacyRoot, 'downloads'), { recursive: true });
  await fs.writeFile(path.join(secondLegacyRoot, 'downloads', 'second-legacy.zip'), 'cached');
  const stats = await manager.getStats();
  assert.deepEqual({ count: stats.count, bytes: stats.bytes }, { count: 2, bytes: 12 });
  assert.deepEqual(stats.directories, [path.join(root, 'downloads')]);
  await manager.clear();
  await assert.rejects(fs.access(path.join(legacyRoot, 'downloads', 'legacy.zip')));
  await assert.rejects(fs.access(path.join(secondLegacyRoot, 'downloads', 'second-legacy.zip')));
  const clearedStats = await manager.getStats();
  assert.deepEqual({ count: clearedStats.count, bytes: clearedStats.bytes }, { count: 0, bytes: 0 });
});

test('download manager lists archives and deletes only the selected archive and source URL', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-download-list-'));
  const manager = new DownloadManager(root);
  const archivePath = path.join(root, 'downloads', 'hero-mod.zip');
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await fs.writeFile(archivePath, 'cached archive');
  await fs.writeFile(`${archivePath}.url`, 'https://example.test/hero-mod.zip');
  await fs.writeFile(path.join(root, 'downloads', 'other.zip'), 'keep me');

  const archive = (await manager.listArchives()).find((item) => item.id === 'hero-mod');
  assert.equal(archive.id, 'hero-mod');
  assert.equal(archive.key, '0:hero-mod');
  assert.equal(archive.size, 14);
  await manager.deleteArchive(archive.key);
  await assert.rejects(fs.access(archivePath));
  await assert.rejects(fs.access(`${archivePath}.url`));
  assert.equal(await fs.readFile(path.join(root, 'downloads', 'other.zip'), 'utf8'), 'keep me');
  await assert.rejects(manager.deleteArchive('../manifest'));
});

test('download manager deletes multiple selected archives in one safe operation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-download-delete-many-'));
  const manager = new DownloadManager(root);
  const directory = path.join(root, 'downloads');
  await fs.mkdir(directory, { recursive: true });
  for (const id of ['first-mod', 'second-mod', 'keep-mod']) await fs.writeFile(path.join(directory, `${id}.zip`), id);

  await assert.rejects(manager.deleteArchives(['0:first-mod', 'invalid']), /invalid/i);
  assert.equal((await manager.listArchives()).length, 3, 'validate all keys before deleting any archive');
  await manager.deleteArchives(['0:first-mod', '0:second-mod']);
  assert.deepEqual((await manager.listArchives()).map((archive) => archive.id), ['keep-mod']);
});