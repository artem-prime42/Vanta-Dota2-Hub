const fs = require('fs/promises');
const path = require('path');
const util = require('node:util');
const os = require('node:os');

class DiagnosticLogger {
  constructor(rootDir) {
    this.logDir = path.join(rootDir, 'logs');
    this.logFile = path.join(this.logDir, 'vanta.log');
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.logDir, { recursive: true });
    this.info('Diagnostics logging started.');
  }

  attachConsole() {
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
      const original = console[level].bind(console);
      console[level] = (...args) => {
        original(...args);
        this.write(level, args.map((value) => value instanceof Error ? value.stack || value.message : util.format('%O', value)).join(' '));
      };
    }
  }

  write(level, message) {
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${String(message)}\n`;
    this.writeQueue = this.writeQueue.then(() => fs.appendFile(this.logFile, line, 'utf8')).catch(() => {});
    return this.writeQueue;
  }

  info(message) { return this.write('info', message); }
  error(message) { return this.write('error', message); }

  async getRecentLogs() {
    try {
      await this.writeQueue;
      return await fs.readFile(this.logFile, 'utf8');
    } catch (error) {
      return `Log file unavailable: ${error.message}`;
    }
  }
}

async function fileStatus(filePath, directory = false) {
  try {
    const stat = await fs.stat(filePath);
    return { exists: true, type: stat.isDirectory() ? 'directory' : 'file', sizeBytes: stat.isFile() ? stat.size : undefined };
  } catch (error) {
    return { exists: false, error: error.code || error.message, expectedType: directory ? 'directory' : 'file' };
  }
}

async function collectDiagnostics({ service, app, logger }) {
  const catalog = service.catalog;
  const state = service.storage.state;
  const cacheStatus = await fileStatus(catalog.cacheFile);
  const stateStatus = await fileStatus(service.storage.file);
  const gamePathStatus = service.gamePath ? await fileStatus(service.gamePath, true) : { exists: false, reason: 'No game path is configured' };
  const languageFolderPath = service.gamePath ? path.join(service.gamePath, `dota_${state.settings.langSuffix || 'russian'}`) : null;
  const languageFolderStatus = languageFolderPath ? await fileStatus(languageFolderPath, true) : { exists: false, reason: 'No game path is configured' };
  let cacheModCount = null;
  let cacheError = null;
  try {
    const payload = JSON.parse(await fs.readFile(catalog.cacheFile, 'utf8'));
    cacheModCount = require('../core/models').flattenCatalog(payload).length;
  } catch (error) {
    cacheError = error.code === 'ENOENT' ? 'Cache file not found' : error.message;
  }

  return {
    generatedAt: new Date().toISOString(),
    app: { name: app.getName(), version: app.getVersion(), isPackaged: app.isPackaged },
    runtime: { platform: process.platform, release: require('node:os').release(), architecture: process.arch, electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    paths: { userData: service.rootDir, logFile: logger.logFile, catalogCache: catalog.cacheFile, stateFile: service.storage.file, gamePath: service.gamePath || null, languageFolder: languageFolderPath },
    migration: service.userDataMigration ? { ...service.userDataMigration, legacyRootsChecked: (service.userDataMigration.legacyRootsChecked || []).map((root) => path.basename(root)) } : null,
    catalog: { url: catalog.url, loadedModCount: catalog.mods.length, cachedModCount: cacheModCount, cacheError, offline: Boolean(catalog.meta.offline), revision: catalog.meta.revision, updatedAt: catalog.meta.updatedAt, lastAttemptAt: catalog.lastAttemptAt || null, lastError: catalog.lastError || null, cacheFile: cacheStatus },
    library: { installedModCount: Object.keys(state.installedMods || {}).length, favoriteCount: (state.favorites || []).length, language: state.settings.langSuffix || 'russian', stateFile: stateStatus },
    game: { configured: Boolean(service.gamePath), gamePath: gamePathStatus, languageFolder: languageFolderStatus },
    recentLogs: await logger.getRecentLogs(),
  };
}

function formatDiagnosticReport(diagnostics) {
  const { recentLogs, ...summary } = diagnostics;
  return [
    'VANTA DOTA2 HUB — Diagnostic report',
    `Generated: ${diagnostics.generatedAt}`,
    '',
    'DIAGNOSTICS',
    JSON.stringify(summary, null, 2),
    '',
    'RECENT APPLICATION LOGS',
    recentLogs || '(No logs recorded.)',
  ].join('\n');
}

function tailText(text, maxBytes = 1024 * 1024) {
  const buffer = Buffer.from(String(text || ''), 'utf8');
  if (buffer.length <= maxBytes) return buffer.toString('utf8');
  return `... earlier log content omitted; last ${maxBytes} bytes follow ...\n${buffer.subarray(-maxBytes).toString('utf8')}`;
}

function safeEntryName(value) {
  return path.basename(String(value || 'entry')).replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function listFolder(folderPath, { filter = null, maxEntries = 2000, maxDepth = 6, redactHome = true } = {}) {
  if (!folderPath) return '(Not configured)\n';
  const home = os.homedir();
  const displayPath = (value) => {
    if (!redactHome || !home) return value;
    const resolved = path.resolve(value);
    const resolvedHome = path.resolve(home);
    const isInsideHome = process.platform === 'win32' ? resolved.toLowerCase().startsWith(`${resolvedHome.toLowerCase()}\\`) : resolved.startsWith(`${resolvedHome}${path.sep}`);
    if (!isInsideHome && resolved !== resolvedHome) return value;
    const suffix = resolved.slice(resolvedHome.length);
    return process.platform === 'win32' ? `%USERPROFILE%${suffix}` : `~${suffix}`;
  };
  const lines = [`Folder: ${displayPath(folderPath)}`];
  let count = 0;
  const visit = async (current, depth) => {
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch (error) { lines.push(`  [unavailable: ${error.code || error.message}]`); return; }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (count >= maxEntries) return;
      const fullPath = path.join(current, entry.name);
      let stat;
      try { stat = await fs.lstat(fullPath); } catch (error) { lines.push(`  ${entry.name} [stat failed: ${error.code || error.message}]`); continue; }
      if (filter && !filter(entry, stat, fullPath)) continue;
      count += 1;
      const kind = entry.isDirectory() ? '/' : entry.isSymbolicLink() ? ' -> symlink' : '';
      lines.push(`${'  '.repeat(Math.min(depth, 5))}${entry.name}${kind} | ${stat.size} bytes | modified ${stat.mtime.toISOString()}`);
      if (entry.isDirectory() && !entry.isSymbolicLink() && depth < maxDepth) await visit(fullPath, depth + 1);
    }
  };
  await visit(folderPath, 0);
  if (count >= maxEntries) lines.push(`... listing capped at ${maxEntries} entries ...`);
  return `${lines.join('\n')}\n`;
}

function diagnosticSettings(settings = {}) {
  const allowed = ['appLanguage', 'langSuffix', 'interfaceScale', 'autoUpdateEnabled', 'discordActivityEnabled', 'gamePath', 'heroGridSelection'];
  return Object.fromEntries(allowed.filter((key) => settings[key] !== undefined).map((key) => [key, settings[key]]));
}

function diagnosticMod(record) {
  const allowed = ['id', 'modId', 'name', 'displayName', 'type', 'source', 'author', 'category', 'categoryId', 'hero', 'heroLabel', 'slot', 'languageFolder', 'version', 'installedAt', 'updatedAt', 'enabled', 'fileName', 'deployedFileName', 'gameFileName', 'installedFiles', 'targetRoot', 'priority', 'savedPackId', 'sourceModIds', 'modIds'];
  return Object.fromEntries(allowed.filter((key) => record?.[key] !== undefined).map((key) => [key, record[key]]));
}

async function buildDiagnosticArchiveFiles({ service, app, logger }) {
  const diagnostics = await collectDiagnostics({ service, app, logger });
  const report = { ...diagnostics };
  delete report.recentLogs;
  const files = {
    'SUMMARY.txt': [
      'VANTA DOTA2 HUB — Diagnostic summary',
      `Generated: ${diagnostics.generatedAt}`,
      `App: ${diagnostics.app.name} ${diagnostics.app.version} (${diagnostics.runtime.platform} ${diagnostics.runtime.architecture})`,
      `Catalog mods loaded: ${diagnostics.catalog.loadedModCount}; cached: ${diagnostics.catalog.cachedModCount ?? 'unknown'}; offline: ${diagnostics.catalog.offline}`,
      `Catalog error: ${diagnostics.catalog.lastError || 'none'}`,
      `Installed library entries: ${diagnostics.library.installedModCount}`,
      `Dota path configured: ${diagnostics.game.configured}; exists: ${diagnostics.game.gamePath.exists}`,
      `Migration from legacy profile: ${diagnostics.migration?.migratedStateFrom || 'none'}`,
      '',
      'The ZIP contains REPORT.md, report.json, logs, settings and file/folder listings.',
      'Nothing is uploaded automatically. Review the files before sharing; paths and mod names may be present.',
      '',
    ].join('\n'),
    'REPORT.md': formatDiagnosticReport({ ...diagnostics, recentLogs: '(See app.log in this archive.)' }),
    'report.json': JSON.stringify(report, null, 2),
    'settings.json': JSON.stringify(diagnosticSettings(service.storage.state.settings), null, 2),
    'installed-mods.json': JSON.stringify(Object.values(service.storage.state.installedMods || {}).map(diagnosticMod), null, 2),
    'app.log': tailText(diagnostics.recentLogs),
    'userdata-listing.txt': await listFolder(service.rootDir, { maxEntries: 3000 }),
    'downloads-listing.txt': await listFolder(path.join(service.rootDir, 'downloads'), { maxEntries: 1500 }),
    'library-listing.txt': await listFolder(path.join(service.rootDir, 'database', 'library'), { maxEntries: 1500 }),
    'mod-folder-listing.txt': service.gamePath ? await listFolder(path.join(service.gamePath, `dota_${service.storage.state.settings.langSuffix || 'russian'}`), { maxEntries: 3000 }) : '(Dota path is not configured)\n',
    'dota-pak-listing.txt': service.gamePath ? await listFolder(path.join(service.gamePath, 'dota'), { filter: (entry) => /^pak\d+_/i.test(entry.name) || /^gameinfo(?:_branchspecific)?\.gi$/i.test(entry.name), maxEntries: 500 }) : '(Dota path is not configured)\n',
  };

  try {
    const catalogStat = await fs.stat(service.catalog.cacheFile);
    if (catalogStat.size <= 20 * 1024 * 1024) files['catalog-cache.json'] = await fs.readFile(service.catalog.cacheFile);
    else files['catalog-cache-note.txt'] = `Catalog cache was ${catalogStat.size} bytes; omitted because it exceeds the 20 MiB diagnostic archive limit.\n`;
  } catch (error) {
    files['catalog-cache-note.txt'] = `Catalog cache could not be included: ${error.code || error.message}\n`;
  }

  try {
    const manifestDir = path.join(service.rootDir, 'database', 'manifests');
    const entries = (await fs.readdir(manifestDir, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).slice(0, 250);
    for (const entry of entries) files[`manifests/${safeEntryName(entry.name)}`] = await fs.readFile(path.join(manifestDir, entry.name));
  } catch (error) {
    if (error.code !== 'ENOENT') files['manifests/manifest-listing-error.txt'] = `${error.code || error.message}\n`;
  }
  return files;
}

module.exports = { DiagnosticLogger, buildDiagnosticArchiveFiles, collectDiagnostics, formatDiagnosticReport, listFolder };