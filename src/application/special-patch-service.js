const fs = require('fs/promises');
const path = require('path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { VpkReader, VpkWriter } = require('vpk-tools');

const execFileAsync = promisify(execFile);
const PATCH_MARKER = 'Patched by DotaModdingCommunity Patcher';
const SEARCH_PATH = 'DotaModdingCommunityMods';
const GAMEINFO_RELATIVE_PATH = path.join('dota', 'gameinfo_branchspecific.gi');
const SPECIAL_TYPES = new Set(['tower', 'weather']);

async function hashBuffer(data, algorithm = 'sha256') {
  return crypto.createHash(algorithm).update(data).digest('hex');
}

async function hashFile(filePath) {
  return hashBuffer(await fs.readFile(filePath));
}

function gitBlobHash(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const header = Buffer.from(`blob ${buffer.length}\0`);
  return crypto.createHash('sha1').update(header).update(buffer).digest('hex');
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let lineComment = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (character === '"') { quoted = true; continue; }
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findKeyBlock(text, key, start = 0, end = text.length) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|\\s|\\})"?${escaped}"?\\s*\\{`, 'g');
  pattern.lastIndex = start;
  let match;
  while ((match = pattern.exec(text)) && match.index < end) {
    const openIndex = text.indexOf('{', match.index);
    const closeIndex = findMatchingBrace(text, openIndex);
    if (closeIndex >= 0 && closeIndex < end) return { openIndex, closeIndex };
  }
  return null;
}

function extractItemBlock(text) {
  const match = String(text).match(/^\s*"(\d+)"\s*\{/);
  if (!match) throw new Error('A special-patch definition has no numeric item ID');
  const openIndex = String(text).indexOf('{', match.index);
  const closeIndex = findMatchingBrace(String(text), openIndex);
  if (closeIndex < 0 || String(text).slice(closeIndex + 1).trim()) throw new Error('A special-patch definition has an invalid item block');
  return { id: match[1], content: String(text).trim() };
}

function replaceItemEntries(itemsGameText, replacements) {
  const sectionMarker = '"store_currency_pricepoints"';
  const markerIndex = itemsGameText.indexOf(sectionMarker);
  if (markerIndex < 0) throw new Error('Dota items_game.txt has an unsupported structure (store_currency_pricepoints was not found)');
  const markerBlock = findKeyBlock(itemsGameText, 'store_currency_pricepoints', Math.max(0, markerIndex - 1));
  const searchStart = markerBlock ? markerBlock.closeIndex + 1 : markerIndex + sectionMarker.length;
  const ranges = [];
  for (const [id, replacement] of replacements) {
    const expression = new RegExp(`^\\s*"${id}"\\s*\\{`, 'gm');
    expression.lastIndex = searchStart;
    const match = expression.exec(itemsGameText);
    if (!match) throw new Error(`Dota items_game.txt does not contain required item ${id}; this Patcher definition is not compatible with the installed game`);
    const openIndex = itemsGameText.indexOf('{', match.index);
    const closeIndex = findMatchingBrace(itemsGameText, openIndex);
    if (closeIndex < 0) throw new Error(`Dota items_game.txt item ${id} has an invalid block`);
    ranges.push({ start: match.index, end: closeIndex + 1, content: replacement.content });
  }
  ranges.sort((left, right) => right.start - left.start);
  let output = itemsGameText;
  for (const range of ranges) output = `${output.slice(0, range.start)}${range.content}${output.slice(range.end)}`;
  for (const [id, replacement] of replacements) {
    if (!new RegExp(`^\\s*"${id}"\\s*\\{`, 'm').test(output)) throw new Error(`Special patch verification failed for item ${id}`);
    const block = extractItemBlock(replacement.content);
    if (block.id !== id) throw new Error(`Special patch item ID mismatch: expected ${id}, received ${block.id}`);
  }
  return output;
}

function ensurePatchSearchPath(gameinfoText) {
  const fileSystem = findKeyBlock(gameinfoText, 'FileSystem');
  if (!fileSystem) throw new Error('Dota gameinfo_branchspecific.gi does not contain a FileSystem block');
  const searchPaths = findKeyBlock(gameinfoText, 'SearchPaths', fileSystem.openIndex + 1, fileSystem.closeIndex);
  const requiredLines = [`\t\tGame\t\t${SEARCH_PATH}`, `\t\tMod\t\t${SEARCH_PATH}`];
  let output = gameinfoText;
  if (searchPaths) {
    const block = output.slice(searchPaths.openIndex + 1, searchPaths.closeIndex);
    const lineEnding = block.includes('\r\n') ? '\r\n' : '\n';
    const lines = block.split(/\r?\n/).filter((line) => {
      const trimmed = line.trim();
      if (trimmed === `// ${PATCH_MARKER}`) return false;
      return !new RegExp(`^(?:Game|Mod)\\s+"?${SEARCH_PATH}"?(?:\\s|$)`, 'i').test(trimmed);
    });
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    const priorityEntries = [`\t\t// ${PATCH_MARKER}`, ...requiredLines];
    const orderedBlock = `${lineEnding}${priorityEntries.join(lineEnding)}${lines.length ? `${lineEnding}${lineEnding}${lines.join(lineEnding)}` : ''}${lineEnding}`;
    output = `${output.slice(0, searchPaths.openIndex + 1)}${orderedBlock}${output.slice(searchPaths.closeIndex)}`;
  } else {
    const insert = `\n\tSearchPaths // ${PATCH_MARKER}\n\t{\n${requiredLines.join('\n')}\n\t}\n`;
    output = `${output.slice(0, fileSystem.closeIndex)}${insert}${output.slice(fileSystem.closeIndex)}`;
  }
  return output;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function signatureLine(gameinfoBuffer) {
  const sha1 = crypto.createHash('sha1').update(gameinfoBuffer).digest('hex').toUpperCase();
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32LE(crc32(gameinfoBuffer), 0);
  return `...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:${sha1};CRC:${crcBuffer.toString('hex').toUpperCase()}`;
}

function signaturesMatch(signaturesText, gameinfoBuffer) {
  const lines = String(signaturesText || '').trimEnd().split(/\r?\n/);
  return lines.at(-1) === signatureLine(gameinfoBuffer);
}

function appendSignature(signaturesText, gameinfoBuffer) {
  const expected = signatureLine(gameinfoBuffer);
  const lines = String(signaturesText || '').replace(/\r/g, '').split('\n').filter((line) => line && !line.startsWith('...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:'));
  lines.push(expected);
  return `${lines.join('\n')}\n`;
}

function readBuildId(text) {
  return String(text || '').match(/"buildid"\s+"(\d+)"/i)?.[1] || null;
}

async function isDotaRunning(platform = process.platform) {
  try {
    if (platform === 'win32') {
      const { stdout } = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq dota2.exe', '/NH'], { windowsHide: true });
      return /^dota2\.exe\s/im.test(stdout);
    }
    for (const name of ['dota2', 'dota2.exe']) {
      try {
        const { stdout } = await execFileAsync('pgrep', ['-x', name]);
        if (String(stdout || '').trim()) return true;
      } catch {}
    }
    return false;
  } catch { return false; }
}

class SpecialPatchService {
  constructor({ rootDir, storage, getGamePath, getMods, fetchImpl = fetch, onProgress = () => {}, processRunning = isDotaRunning, platform = process.platform }) {
    this.rootDir = rootDir;
    this.storage = storage;
    this.getGamePath = getGamePath;
    this.getMods = getMods;
    this.fetchImpl = fetchImpl;
    this.onProgress = onProgress;
    this.processRunning = processRunning;
    this.platform = platform;
    this.queue = Promise.resolve();
    this.runtimeStates = new Map();
    this.stateDirectory = path.join(rootDir, 'database', 'special-patches');
    this.manifestPath = path.join(this.stateDirectory, 'manifest.json');
    this.journalPath = path.join(this.stateDirectory, 'transaction.json');
  }

  isSpecialPatch(mod) {
    return Boolean(mod && mod.modType === 'special_patch' && SPECIAL_TYPES.has(mod.specialType));
  }

  getState(id, record = this.storage.state.installedMods?.[id]) {
    if (!record) return { status: 'not_installed', updateAvailable: false, requiresPatchUpdate: false };
    const runtime = this.runtimeStates.get(id);
    if (runtime?.status === 'updating') return runtime;
    const catalogMod = this.getMods().find((mod) => mod.id === id);
    const availableVersion = String(catalogMod?.availableVersion || catalogMod?.currentVersion || catalogMod?.version || '');
    return {
      status: record.specialPatchState || (record.requiresPatchUpdate ? 'update_required' : 'installed'),
      updateAvailable: Boolean(availableVersion && record.currentVersion !== availableVersion),
      requiresPatchUpdate: Boolean(record.requiresPatchUpdate),
      error: record.patchError || null,
    };
  }

  async init() {
    await fs.mkdir(this.stateDirectory, { recursive: true });
    await this.recoverTransaction();
  }

  progress(id, phase, percent, state = 'processing') {
    this.onProgress({ id, operation: 'special-patch', state, phase, percent });
  }

  serializeError(error) {
    const message = String(error?.message || error || 'Unknown special-patch error');
    if (/EACCES|EPERM|permission denied/i.test(message)) return new Error('VANTA cannot modify the Dota 2 files. Close Dota 2 and check folder permissions.');
    if (/items_game|definition|HTTP|checksum|VPK|FileSystem|gameinfo|signature/i.test(message)) return new Error(message);
    return new Error(`The special patch could not be applied safely: ${message}`);
  }

  async withLock(task) {
    const previous = this.queue;
    let release;
    this.queue = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await task(); } finally { release(); }
  }

  getDotaPaths() {
    const gamePath = this.getGamePath();
    if (!gamePath) throw new Error('Set the Dota 2 installation path in Settings before installing a special patch.');
    const root = path.resolve(gamePath);
    const binRoot = path.join(root, 'bin');
    return {
      root,
      pak01: path.join(root, 'dota', 'pak01_dir.vpk'),
      gameinfo: path.join(root, GAMEINFO_RELATIVE_PATH),
      binRoot,
      modDirectory: path.join(root, SEARCH_PATH),
      modVpk: path.join(root, SEARCH_PATH, 'pak01_dir.vpk'),
    };
  }

  async findSignaturesPath(paths) {
    const folders = this.platform === 'win32' ? ['win64', 'linuxsteamrt64'] : ['linuxsteamrt64', 'win64'];
    const candidates = folders.map((folder) => path.join(paths.binRoot, folder, 'dota.signatures'));
    for (const candidate of candidates) { try { await fs.access(candidate); return candidate; } catch {} }
    throw new Error('Dota dota.signatures was not found. Verify Dota 2 files in Steam and try again.');
  }

  async currentBuildId(gamePath) {
    let current = path.resolve(gamePath);
    for (let index = 0; index < 8; index += 1) {
      const manifest = path.join(current, 'steamapps', 'appmanifest_570.acf');
      try { return readBuildId(await fs.readFile(manifest, 'utf8')); } catch {}
      try { return readBuildId(await fs.readFile(path.join(current, 'appmanifest_570.acf'), 'utf8')); } catch {}
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  async getBaseItemsGame(pak01Path) {
    let reader;
    try {
      reader = VpkReader.open(pak01Path);
      const entry = 'scripts/items/items_game.txt';
      if (!reader.has(entry)) throw new Error('The installed pak01_dir.vpk does not contain scripts/items/items_game.txt. Verify Dota 2 files in Steam.');
      const data = reader.readFile(entry);
      return { text: data.toString('utf8'), hash: await hashBuffer(data) };
    } catch (error) {
      if (/pak01_dir|items_game|VPK/.test(error.message)) throw error;
      throw new Error(`Could not read the Dota 2 base VPK: ${error.message}`);
    } finally { reader?.close(); }
  }

  async loadDefinition(file) {
    if (!file?.url || !file?.gitBlobSha || !file?.itemId) throw new Error('A special patch is missing a pinned definition file, item ID, or integrity hash.');
    const response = await this.fetchImpl(file.url, { cache: 'no-store', headers: { accept: 'text/plain' } });
    if (!response.ok) throw new Error(`Could not download patch definition (${response.status}). Try again later.`);
    const text = await response.text();
    const data = Buffer.from(text, 'utf8');
    if (gitBlobHash(data) !== String(file.gitBlobSha).toLowerCase()) throw new Error(`Integrity check failed for ${file.fileName || file.url}. The upstream patch file has changed.`);
    const item = extractItemBlock(text);
    if (item.id !== String(file.itemId)) throw new Error(`Patch definition ${file.fileName || file.url} targets item ${item.id}, expected ${file.itemId}.`);
    return item;
  }

  async createPatchedVpk(pak01Path, definitions, tempPath) {
    const base = await this.getBaseItemsGame(pak01Path);
    const replacements = new Map();
    for (const { file, item } of definitions) {
      if (replacements.has(item.id)) throw new Error(`More than one selected special patch changes Dota item ${item.id}. Keep only one ${file.specialType || 'patch'} of this kind installed.`);
      replacements.set(item.id, item);
    }
    const patchedItemsGame = replaceItemEntries(base.text, replacements);
    const writer = new VpkWriter();
    writer.addFile('scripts/items/items_game.txt', Buffer.from(patchedItemsGame, 'utf8'));
    writer.write(tempPath);
    let reader;
    try {
      reader = VpkReader.open(tempPath);
      const files = reader.files();
      if (files.length !== 1 || files[0] !== 'scripts/items/items_game.txt') throw new Error('Generated patch VPK does not contain the expected items_game.txt override.');
      if (!reader.readFile(files[0]).equals(Buffer.from(patchedItemsGame, 'utf8'))) throw new Error('Generated patch VPK failed content verification.');
    } finally { reader?.close(); }
    return { baseItemsGameHash: base.hash, patchedItemsGameHash: await hashBuffer(Buffer.from(patchedItemsGame, 'utf8')) };
  }

  async readSpecialManifest() {
    try { return JSON.parse(await fs.readFile(this.manifestPath, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async getBackupDirectory(gamePath) {
    const key = await hashBuffer(Buffer.from(path.resolve(gamePath)));
    const directory = path.join(this.stateDirectory, 'backups', key);
    await fs.mkdir(directory, { recursive: true });
    return directory;
  }

  getSignatureBackupPath(backupDirectory, signaturesPath) {
    const platformFolder = path.basename(path.dirname(signaturesPath));
    return path.join(backupDirectory, `dota.signatures-${platformFolder}`);
  }

  async findSignatureBackup(backupDirectory, signaturesPath) {
    const platformBackup = this.getSignatureBackupPath(backupDirectory, signaturesPath);
    if (await this.exists(platformBackup)) return platformBackup;
    const legacyBackup = path.join(backupDirectory, 'dota.signatures');
    return await this.exists(legacyBackup) ? legacyBackup : platformBackup;
  }

  async exists(filePath) { try { await fs.access(filePath); return true; } catch { return false; } }

  async atomicWrite(filePath, data) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try { await fs.writeFile(temporary, data); await fs.rename(temporary, filePath); }
    catch (error) { await fs.rm(temporary, { force: true }); throw error; }
  }

  async installVpk(sourcePath, targetPath) {
    const temporary = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.copyFile(sourcePath, temporary);
      await fs.rename(temporary, targetPath);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  async writeJson(filePath, value) { await this.atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`); }

  assertTransactionPath(filePath) {
    const resolved = path.resolve(filePath);
    const statePrefix = `${path.resolve(this.stateDirectory)}${path.sep}`;
    const inState = resolved.startsWith(statePrefix);
    const portable = resolved.replace(/\\/g, '/');
    const managedDotaFile = [
      /\/game\/dota\/gameinfo_branchspecific\.gi$/i,
      /\/game\/bin\/(?:linuxsteamrt64|win64)\/dota\.signatures$/i,
      /\/game\/DotaModdingCommunityMods\/pak01_dir\.vpk$/i,
    ].some((pattern) => pattern.test(portable));
    if (!inState && !managedDotaFile) throw new Error('Refusing to journal a path outside VANTA data or the supported Dota patch files.');
    return resolved;
  }

  async recordTransaction(paths) {
    const files = [];
    for (const filePath of paths) {
      const safePath = this.assertTransactionPath(filePath);
      if (await this.exists(safePath)) files.push({ path: safePath, data: (await fs.readFile(safePath)).toString('base64') });
      else files.push({ path: safePath, missing: true });
    }
    await this.writeJson(this.journalPath, { files, startedAt: new Date().toISOString() });
  }

  async rollbackTransaction(journal) {
    for (const file of [...(journal?.files || [])].reverse()) {
      const safePath = this.assertTransactionPath(file.path);
      if (file.missing) await fs.rm(safePath, { force: true });
      else await this.atomicWrite(safePath, Buffer.from(file.data, 'base64'));
    }
  }

  async recoverTransaction() {
    try {
      const journal = JSON.parse(await fs.readFile(this.journalPath, 'utf8'));
      await this.rollbackTransaction(journal);
      await fs.rm(this.journalPath, { force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`An interrupted special-patch update could not be recovered: ${error.message}`);
    }
  }

  async persistInstalledRecords(activeMods, metadata, status = 'updated') {
    const previous = this.storage.state.installedMods || {};
    const next = { ...previous };
    for (const mod of activeMods) {
      next[mod.id] = {
        ...previous[mod.id],
        id: mod.id,
        modId: mod.id,
        type: 'special_patch',
        modType: 'special_patch',
        specialType: mod.specialType,
        displayName: mod.name,
        name: mod.name,
        author: mod.author,
        categoryId: mod.categoryId,
        previewUrl: mod.previewUrl,
        description: mod.description,
        version: mod.version,
        currentVersion: mod.currentVersion || mod.version,
        specialPatchState: status,
        requiresPatchUpdate: status !== 'updated',
        installedAt: previous[mod.id]?.installedAt || new Date().toISOString(),
        patchMetadata: metadata,
      };
    }
    const activeIds = new Set(activeMods.map((mod) => mod.id));
    for (const [id, record] of Object.entries(next)) if (record?.modType === 'special_patch' && !activeIds.has(id)) delete next[id];
    await this.storage.patch({ installedMods: next });
  }

  async markFailure(mod, error) {
    if (mod?.id) this.runtimeStates.set(mod.id, { status: 'error', updateAvailable: false, requiresPatchUpdate: true, error: error.message });
    this.progress(mod?.id || 'special-patch', error.message, 0, 'failed');
    const record = mod?.id && this.storage.state.installedMods?.[mod.id];
    if (!record || record.modType !== 'special_patch') return;
    const installedMods = { ...this.storage.state.installedMods, [mod.id]: { ...record, specialPatchState: 'error', requiresPatchUpdate: true, patchError: error.message } };
    try { await this.storage.patch({ installedMods }); } catch { this.storage.state.installedMods = installedMods; }
  }

  async apply(mod, options = {}) {
    return this.withLock(async () => {
      this.runtimeStates.set(mod.id, { status: 'updating', updateAvailable: false, requiresPatchUpdate: true, progress: 0 });
      try { return await this.applyLocked(mod, options); }
      catch (error) { const safeError = this.serializeError(error); await this.markFailure(mod, safeError); throw safeError; }
    });
  }

  async applyLocked(mod, { replacingId = null } = {}) {
      if (!this.isSpecialPatch(mod)) throw new Error('This catalog entry is not a supported special patch.');
      const paths = this.getDotaPaths();
      if (await this.processRunning()) throw new Error('Close Dota 2 before installing or updating Weather/Tower patches. VANTA will not terminate the game automatically.');
      for (const [label, filePath] of [['base VPK', paths.pak01], ['gameinfo file', paths.gameinfo]]) {
        if (!(await this.exists(filePath))) throw new Error(`The selected Dota 2 folder is missing its ${label}: ${filePath}. Re-detect the game path and verify Dota 2 files in Steam before installing Weather/Tower patches.`);
      }
      await this.findSignaturesPath(paths);
      const installed = Object.values(this.storage.state.installedMods || {}).filter((record) => record?.modType === 'special_patch');
      const catalogMods = this.getMods();
      const installedCatalogMods = installed.map((record) => catalogMods.find((candidate) => candidate.id === record.id));
      if (installedCatalogMods.some((entry) => !entry)) throw new Error('An installed special patch is no longer available in the catalog. Refresh the catalog or remove that patch before continuing.');
      const activeMods = installedCatalogMods
        .filter((candidate) => candidate.id !== replacingId && candidate.specialType !== mod.specialType && candidate.id !== mod.id);
      activeMods.push(mod);
      const definitionFiles = [];
      const fileCount = activeMods.reduce((total, entry) => total + (entry.requiredFiles || []).length, 0);
      if (!fileCount) throw new Error('This special patch has no required definition files.');
      let completedFiles = 0;
      for (const activeMod of activeMods) {
        if (!this.isSpecialPatch(activeMod)) throw new Error(`Catalog entry ${activeMod.id} has invalid special-patch metadata.`);
        for (const file of activeMod.requiredFiles) {
          this.progress(mod.id, `Downloading ${file.fileName || activeMod.name}…`, Math.round((completedFiles / fileCount) * 20));
          const item = await this.loadDefinition({ ...file, specialType: activeMod.specialType });
          definitionFiles.push({ file: { ...file, specialType: activeMod.specialType }, item });
          completedFiles += 1;
        }
      }
      const temporaryDirectory = path.join(this.stateDirectory, `.work-${process.pid}-${Date.now()}`);
      await fs.mkdir(temporaryDirectory, { recursive: true });
      const temporaryVpk = path.join(temporaryDirectory, 'pak01_dir.vpk');
      let transactionFiles = [];
      let previousInstalledMods = null;
      try {
        this.progress(mod.id, 'Reading current Dota item data…', 25);
        const outputMetadata = await this.createPatchedVpk(paths.pak01, definitionFiles, temporaryVpk);
        this.progress(mod.id, 'Preparing the client patch…', 60);
        const gameinfoBefore = await fs.readFile(paths.gameinfo);
        const signaturesPath = await this.findSignaturesPath(paths);
        const signaturesBefore = await fs.readFile(signaturesPath);
        const signaturesText = signaturesBefore.toString('utf8');
        const gameinfoAfter = Buffer.from(ensurePatchSearchPath(gameinfoBefore.toString('utf8')), 'utf8');
        const signaturesAfter = Buffer.from(appendSignature(signaturesText, gameinfoAfter), 'utf8');
        const previousManifest = await this.readSpecialManifest();
        const backupDirectory = await this.getBackupDirectory(paths.root);
        const backupGameinfo = path.join(backupDirectory, 'gameinfo_branchspecific.gi');
        const backupSignatures = this.getSignatureBackupPath(backupDirectory, signaturesPath);
        const gameinfoHasPatchPath = gameinfoBefore.toString('utf8').includes(PATCH_MARKER);
        const signaturesHavePatchLine = signaturesText.split(/\r?\n/).some((line) => line.startsWith('...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:'));
        const previousSignatureRelativePath = String(previousManifest?.signaturesRelativePath || '').replace(/\\/g, '/');
        const previousSignaturePath = previousManifest?.gamePath === paths.root
          && /^bin\/(?:linuxsteamrt64|win64)\/dota\.signatures$/i.test(previousSignatureRelativePath)
          ? path.resolve(paths.root, previousSignatureRelativePath)
          : null;
        const staleSignaturePath = previousSignaturePath
          && previousSignaturePath !== signaturesPath
          && await this.exists(previousSignaturePath)
          && await hashFile(previousSignaturePath) === previousManifest.signaturesHash
          ? previousSignaturePath
          : null;
        const staleSignatureBackup = staleSignaturePath
          ? await this.findSignatureBackup(backupDirectory, staleSignaturePath)
          : null;
        const vpkBeforeExists = await this.exists(paths.modVpk);
        const vpkBefore = vpkBeforeExists ? await fs.readFile(paths.modVpk) : null;
        const ownsExistingVpk = Boolean(previousManifest?.gamePath === paths.root && previousManifest?.modVpkHash && vpkBefore && await hashBuffer(vpkBefore) === previousManifest.modVpkHash);
        if (!gameinfoHasPatchPath || !(await this.exists(backupGameinfo))) await this.atomicWrite(backupGameinfo, gameinfoBefore);
        if (!(await this.exists(backupSignatures))) {
          if (!signaturesHavePatchLine) await this.atomicWrite(backupSignatures, signaturesBefore);
          else if (previousSignaturePath === signaturesPath) {
            const legacyBackup = path.join(backupDirectory, 'dota.signatures');
            if (await this.exists(legacyBackup)) await fs.copyFile(legacyBackup, backupSignatures);
          }
        }
        if (vpkBefore && !ownsExistingVpk) {
          const foreignBackup = path.join(backupDirectory, 'pre-existing-pak01_dir.vpk');
          if (!(await this.exists(foreignBackup))) await fs.copyFile(paths.modVpk, foreignBackup);
        }
        previousInstalledMods = { ...(this.storage.state.installedMods || {}) };
        transactionFiles = [paths.modVpk, paths.gameinfo, signaturesPath, this.manifestPath];
        if (staleSignaturePath && staleSignatureBackup && await this.exists(staleSignatureBackup)) transactionFiles.push(staleSignaturePath);
        await this.recordTransaction(transactionFiles);
        this.progress(mod.id, 'Writing the special-patch VPK…', 70);
        await fs.mkdir(paths.modDirectory, { recursive: true });
        await this.installVpk(temporaryVpk, paths.modVpk);
        if (staleSignaturePath && staleSignatureBackup && await this.exists(staleSignatureBackup)) {
          await this.atomicWrite(staleSignaturePath, await fs.readFile(staleSignatureBackup));
        }
        await this.atomicWrite(paths.gameinfo, gameinfoAfter);
        await this.atomicWrite(signaturesPath, signaturesAfter);
        const finalVpkHash = await hashFile(paths.modVpk);
        const finalGameinfoHash = await hashFile(paths.gameinfo);
        const finalSignaturesHash = await hashFile(signaturesPath);
        const installedReader = VpkReader.open(paths.modVpk);
        try {
          const verification = await installedReader.verify();
          if (verification.issues?.length || !verification.checkedFiles) throw new Error('The installed patch VPK did not pass VPK verification.');
        }
        finally { installedReader.close(); }
        const currentBuild = await this.currentBuildId(paths.root);
        const metadata = {
          gamePath: paths.root,
          gameBuildId: currentBuild,
          baseItemsGameHash: outputMetadata.baseItemsGameHash,
          patchedItemsGameHash: outputMetadata.patchedItemsGameHash,
          sourceRevision: String(mod.currentVersion || mod.version),
          sourceRevisions: Object.fromEntries(activeMods.map((entry) => [entry.id, String(entry.currentVersion || entry.version)])),
          modVpkHash: finalVpkHash,
          gameinfoHash: finalGameinfoHash,
          signaturesHash: finalSignaturesHash,
          signaturesRelativePath: path.relative(paths.root, signaturesPath),
          updatedAt: new Date().toISOString(),
        };
        await this.writeJson(this.manifestPath, metadata);
        await this.persistInstalledRecords(activeMods, metadata);
        await fs.rm(this.journalPath, { force: true });
        this.runtimeStates.set(mod.id, { status: 'updated', updateAvailable: false, requiresPatchUpdate: false });
        this.progress(mod.id, 'Special patch verified and installed', 100, 'completed');
        return { ...this.storage.state.installedMods[mod.id], specialPatchState: 'updated' };
      } catch (error) {
        if (transactionFiles.length) {
          try { const journal = JSON.parse(await fs.readFile(this.journalPath, 'utf8')); await this.rollbackTransaction(journal); await fs.rm(this.journalPath, { force: true }); }
          catch (rollbackError) { throw new Error(`Patch failed and automatic rollback needs attention: ${rollbackError.message}. Original error: ${error.message}`); }
          if (previousInstalledMods) this.storage.state.installedMods = previousInstalledMods;
        }
        throw this.serializeError(error);
      } finally {
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
      }
  }

  async install(mod) { return this.apply(mod); }
  async update(mod) { return this.apply(mod, { replacingId: mod.id }); }

  async remove(id) {
    return this.withLock(async () => {
      const record = this.storage.state.installedMods?.[id];
      if (!record || record.modType !== 'special_patch') throw new Error('Special patch was not found in the Library.');
      const activeRecords = Object.values(this.storage.state.installedMods || {}).filter((item) => item?.modType === 'special_patch' && item.id !== id);
      const catalogMods = this.getMods();
      const remaining = activeRecords.map((item) => catalogMods.find((candidate) => candidate.id === item.id)).filter(Boolean);
      if (remaining.length) {
        const first = remaining[0];
        const before = { ...this.storage.state.installedMods };
        const staged = { ...before };
        delete staged[id];
        this.storage.state.installedMods = staged;
        try { await this.applyLocked(first, { replacingId: first.id }); }
        catch (error) { this.storage.state.installedMods = before; throw error; }
        return true;
      }
      const paths = this.getDotaPaths();
      if (await this.processRunning()) throw new Error('Close Dota 2 before removing a Weather/Tower patch. VANTA will not terminate the game automatically.');
      const manifest = await this.readSpecialManifest();
      if (manifest?.gamePath === paths.root) {
        const fallbackSignaturesPath = this.platform === 'win32'
          ? path.join('bin', 'win64', 'dota.signatures')
          : path.join('bin', 'linuxsteamrt64', 'dota.signatures');
        const signaturesPath = path.resolve(paths.root, manifest.signaturesRelativePath || fallbackSignaturesPath);
        if (!signaturesPath.startsWith(`${paths.root}${path.sep}`)) throw new Error('The special-patch manifest contains an unsafe signature-file path. No game files were changed.');
        const matches = await this.exists(paths.modVpk) && await hashFile(paths.modVpk) === manifest.modVpkHash;
        const gameinfoMatches = await this.exists(paths.gameinfo) && await hashFile(paths.gameinfo) === manifest.gameinfoHash;
        const signaturesMatchOwned = await this.exists(signaturesPath) && await hashFile(signaturesPath) === manifest.signaturesHash;
        if (!matches) throw new Error('The special-patch VPK changed outside VANTA. It was left untouched; verify Dota files before removing the Library entry.');
        const backupDirectory = await this.getBackupDirectory(paths.root);
        const backupGameinfo = path.join(backupDirectory, 'gameinfo_branchspecific.gi');
        const backupSignatures = await this.findSignatureBackup(backupDirectory, signaturesPath);
        const foreignBackup = path.join(backupDirectory, 'pre-existing-pak01_dir.vpk');
        const gameinfoShouldRestore = await this.exists(backupGameinfo)
          && (!(await this.exists(paths.gameinfo)) || gameinfoMatches);
        const signaturesShouldRestore = await this.exists(backupSignatures)
          && (!(await this.exists(signaturesPath)) || signaturesMatchOwned);
        const transaction = [paths.modVpk, this.manifestPath];
        if (gameinfoShouldRestore) transaction.push(paths.gameinfo);
        if (signaturesShouldRestore) transaction.push(signaturesPath);
        await this.recordTransaction(transaction);
        try {
          await fs.rm(paths.modVpk, { force: true });
          if (await this.exists(foreignBackup)) await fs.copyFile(foreignBackup, paths.modVpk);
          if (gameinfoShouldRestore) await this.atomicWrite(paths.gameinfo, await fs.readFile(backupGameinfo));
          if (signaturesShouldRestore) await this.atomicWrite(signaturesPath, await fs.readFile(backupSignatures));
          const installedMods = { ...this.storage.state.installedMods };
          delete installedMods[id];
          await this.storage.patch({ installedMods });
          await fs.rm(this.manifestPath, { force: true });
          await fs.rm(this.journalPath, { force: true });
        } catch (error) {
          const journal = JSON.parse(await fs.readFile(this.journalPath, 'utf8'));
          await this.rollbackTransaction(journal);
          await fs.rm(this.journalPath, { force: true });
          throw error;
        }
      } else {
        const installedMods = { ...this.storage.state.installedMods };
        delete installedMods[id];
        await this.storage.patch({ installedMods });
      }
      return true;
    });
  }

  async inspect(mod, record) {
    if (!record) return { status: 'not_installed', updateAvailable: false, requiresPatchUpdate: false };
    if (this.runtimeStates.get(record.id)?.status === 'updating') return this.runtimeStates.get(record.id);
    if (record.specialPatchState === 'error' && record.patchError) return { status: 'error', updateAvailable: false, requiresPatchUpdate: true, error: record.patchError };
    const version = String(mod?.currentVersion || mod?.version || record.currentVersion || record.version || '');
    if (String(record.currentVersion || record.version || '') !== version) return { status: 'update_required', updateAvailable: true, requiresPatchUpdate: true };
    try {
      const paths = this.getDotaPaths();
      const manifest = await this.readSpecialManifest();
      const buildId = await this.currentBuildId(paths.root);
      const base = await this.getBaseItemsGame(paths.pak01);
      const signaturesPath = await this.findSignaturesPath(paths);
      const gameinfo = await fs.readFile(paths.gameinfo);
      const signatures = await fs.readFile(signaturesPath, 'utf8');
      const vpkHash = await hashFile(paths.modVpk);
      const valid = manifest?.gamePath === paths.root
        && manifest.modVpkHash === vpkHash
        && manifest.gameinfoHash === await hashBuffer(gameinfo)
        && manifest.signaturesHash === await hashBuffer(await fs.readFile(signaturesPath))
        && manifest.baseItemsGameHash === base.hash
        && (!manifest.gameBuildId || !buildId || manifest.gameBuildId === buildId)
        && gameinfo.toString('utf8').includes(PATCH_MARKER)
        && signaturesMatch(signatures, gameinfo);
      if (!valid) return { status: 'update_required', updateAvailable: false, requiresPatchUpdate: true };
      return { status: record.specialPatchState === 'updated' ? 'updated' : 'installed', updateAvailable: false, requiresPatchUpdate: false };
    } catch (error) {
      return { status: 'update_required', updateAvailable: false, requiresPatchUpdate: true, error: error.message };
    }
  }

  async refreshStates() {
    const installedMods = { ...(this.storage.state.installedMods || {}) };
    const catalog = this.getMods();
    let changed = false;
    for (const [id, record] of Object.entries(installedMods)) {
      if (record?.modType !== 'special_patch') continue;
      const mod = catalog.find((entry) => entry.id === id);
      const result = await this.inspect(mod, record);
      if (record.specialPatchState !== result.status || record.requiresPatchUpdate !== result.requiresPatchUpdate || Boolean(record.patchError) !== Boolean(result.error)) {
        installedMods[id] = { ...record, specialPatchState: result.status, requiresPatchUpdate: result.requiresPatchUpdate, patchError: result.error || null };
        changed = true;
      }
    }
    if (changed) await this.storage.patch({ installedMods });
    return this.storage.state.installedMods;
  }
}

module.exports = { GAMEINFO_RELATIVE_PATH, PATCH_MARKER, SEARCH_PATH, SpecialPatchService, appendSignature, ensurePatchSearchPath, extractItemBlock, findMatchingBrace, gitBlobHash, isDotaRunning, replaceItemEntries, signatureLine, signaturesMatch };
