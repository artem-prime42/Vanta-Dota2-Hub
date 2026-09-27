const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { DiagnosticLogger, buildDiagnosticArchiveFiles, collectDiagnostics, formatDiagnosticReport } = require('../src/infrastructure/diagnostics');
const { JsonStorage } = require('../src/infrastructure/storage');

test('diagnostic logger persists messages and report includes full diagnostics and logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-diagnostics-'));
  const logger = new DiagnosticLogger(root);
  await logger.init();
  await logger.error('catalog request failed');

  const storage = new JsonStorage(root);
  await storage.init();
  const service = {
    rootDir: root,
    storage,
    gamePath: null,
    catalog: {
      url: 'https://catalog.invalid/catalog.json',
      cacheFile: path.join(root, 'cache', 'catalog.json'),
      mods: [],
      meta: { offline: true, revision: null, updatedAt: null },
      lastAttemptAt: '2026-09-27T00:00:00.000Z',
      lastError: 'network unavailable',
    },
  };
  const app = { getName: () => 'VANTA DOTA2 HUB', getVersion: () => '2.0.4', isPackaged: true };
  const diagnostics = await collectDiagnostics({ service, app, logger });
  const report = formatDiagnosticReport(diagnostics);

  assert.equal(diagnostics.catalog.loadedModCount, 0);
  assert.equal(diagnostics.catalog.lastError, 'network unavailable');
  assert.match(report, /DIAGNOSTICS/);
  assert.match(report, /RECENT APPLICATION LOGS/);
  assert.match(report, /catalog request failed/);
  assert.match(report, /Log file|vanta\.log/);
});

test('diagnostic archive has readable, structured and filesystem report files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-diagnostics-zip-'));
  const logger = new DiagnosticLogger(root);
  await logger.init();
  await logger.error('catalog parse failed');
  const storage = new JsonStorage(root);
  await storage.init();
  await storage.patch({ settings: { ...storage.state.settings, langSuffix: 'english', accountToken: 'must-not-export' }, installedMods: { sample: { id: 'sample', name: 'Sample Mod', categoryId: 'heroes', fileName: 'pak02_dir.vpk', enabled: true, privateField: 'must-not-export' } } });
  await fs.mkdir(path.join(root, 'cache'), { recursive: true });
  await fs.writeFile(path.join(root, 'cache', 'catalog.json'), JSON.stringify({ mods: { modsData: { heroes: [{ name: 'Catalog Mod', file: 'catalog.zip' }] } } }));
  await fs.mkdir(path.join(root, 'database', 'manifests'), { recursive: true });
  await fs.writeFile(path.join(root, 'database', 'manifests', 'sample.json'), JSON.stringify({ id: 'sample', fileName: 'pak02_dir.vpk' }));
  const service = {
    rootDir: root,
    storage,
    gamePath: null,
    catalog: { url: 'https://catalog.invalid/catalog.json', cacheFile: path.join(root, 'cache', 'catalog.json'), mods: [], meta: { offline: true, revision: null, updatedAt: null }, lastAttemptAt: null, lastError: 'network unavailable' },
  };
  const app = { getName: () => 'VANTA DOTA2 HUB', getVersion: () => '2.0.4', isPackaged: true };
  const files = await buildDiagnosticArchiveFiles({ service, app, logger });
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
  const extracted = new AdmZip(zip.toBuffer());
  const names = extracted.getEntries().map((entry) => entry.entryName);

  for (const expected of ['SUMMARY.txt', 'REPORT.md', 'report.json', 'settings.json', 'installed-mods.json', 'app.log', 'userdata-listing.txt', 'downloads-listing.txt', 'library-listing.txt', 'mod-folder-listing.txt', 'dota-pak-listing.txt', 'catalog-cache.json', 'manifests/sample.json']) assert.ok(names.includes(expected), `archive missing ${expected}`);
  assert.match(extracted.readAsText('app.log'), /catalog parse failed/);
  assert.match(extracted.readAsText('catalog-cache.json'), /Catalog Mod/);
  assert.doesNotMatch(extracted.readAsText('settings.json'), /must-not-export/);
  assert.doesNotMatch(extracted.readAsText('installed-mods.json'), /must-not-export/);
});
