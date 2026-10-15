const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { DownloadManager } = require('../src/infrastructure/download-manager');

test('download manager emits named percentage progress and an explicit downloaded state', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-download-progress-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const progress = [];
  const manager = new DownloadManager(root, (event) => progress.push(event), [], async () => new Response('12345678', {
    headers: { 'content-length': '8' },
  }));

  await manager.download('test-mod', 'https://example.test/test-mod.zip', { name: 'Test Mod', operation: 'mod-install' });

  const downloadEvents = progress.filter((event) => event.state === 'downloading');
  assert.ok(downloadEvents.length > 0);
  assert.ok(downloadEvents.every((event) => event.id === 'test-mod' && event.name === 'Test Mod' && event.operation === 'mod-install'));
  assert.equal(downloadEvents.at(-1).percent, 100);
  assert.equal(downloadEvents.at(-1).loaded, 8);
  assert.equal(progress.at(-1).state, 'downloaded', 'download completion must not imply installation completion');
  assert.equal(progress.at(-1).percent, 100);
});

test('download manager reports unknown content length without inventing a percentage', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-download-unknown-size-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const progress = [];
  const manager = new DownloadManager(root, (event) => progress.push(event), [], async () => new Response('data'));

  await manager.download('unknown-size', 'https://example.test/unknown.zip', { name: 'Unknown Size Mod', operation: 'mod-install' });

  assert.equal(progress.find((event) => event.state === 'downloading')?.percent, null);
  assert.equal(progress.at(-1).state, 'downloaded');
});

test('download manager coalesces concurrent requests for the same mod and URL', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-download-coalesce-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let requests = 0;
  const manager = new DownloadManager(root, undefined, [], async () => {
    requests += 1;
    await new Promise((resolve) => setImmediate(resolve));
    return new Response('same package');
  });

  const [first, second] = await Promise.all([
    manager.download('shared-mod', 'https://example.test/shared.zip'),
    manager.download('shared-mod', 'https://example.test/shared.zip'),
  ]);

  assert.equal(first, second);
  assert.equal(requests, 1);
  assert.equal(await fs.readFile(first, 'utf8'), 'same package');
});

test('download manager serializes different URLs that share one mod ID', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-download-serialize-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requests = [];
  const manager = new DownloadManager(root, undefined, [], async (url) => {
    requests.push(url);
    await new Promise((resolve) => setImmediate(resolve));
    return new Response(url.endsWith('second.zip') ? 'second package' : 'first package');
  });

  const first = manager.download('shared-mod', 'https://example.test/first.zip');
  const second = manager.download('shared-mod', 'https://example.test/second.zip');
  const [firstPath, secondPath] = await Promise.all([first, second]);

  assert.equal(firstPath, secondPath);
  assert.deepEqual(requests, ['https://example.test/first.zip', 'https://example.test/second.zip']);
  assert.equal(await fs.readFile(secondPath, 'utf8'), 'second package');
  assert.equal(await fs.readFile(`${secondPath}.url`, 'utf8'), 'https://example.test/second.zip');
});

test('download manager discards failed-verification cache only for the matching source URL', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-download-discard-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manager = new DownloadManager(root);
  const archive = path.join(root, 'downloads', 'verified-mod.zip');
  await fs.mkdir(path.dirname(archive), { recursive: true });
  await fs.writeFile(archive, 'bad bytes');
  await fs.writeFile(`${archive}.url`, 'https://example.test/current.zip');

  assert.equal(await manager.discardCachedArchive('verified-mod', 'https://example.test/old.zip'), false);
  assert.equal(await fs.readFile(archive, 'utf8'), 'bad bytes');
  assert.equal(await manager.discardCachedArchive('verified-mod', 'https://example.test/current.zip'), true);
  await assert.rejects(fs.access(archive));
  await assert.rejects(fs.access(`${archive}.url`));
});

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

test('download manager waits for active transfers to stop before clearing archives', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-download-clear-active-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manager = new DownloadManager(root, undefined, [], (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
  }));
  const pending = manager.download('active-mod', 'https://example.test/active.zip').catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));

  await manager.clear();
  await pending;

  assert.deepEqual(await fs.readdir(path.join(root, 'downloads')), []);
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