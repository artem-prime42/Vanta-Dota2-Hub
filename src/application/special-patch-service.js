const fs = require('fs/promises');
const fsSync = require('node:fs');
const path = require('path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { VpkReader, VpkWriter } = require('vpk-tools');

const execFileAsync = promisify(execFile);
const PATCH_MARKER = 'Patched by DotaModdingCommunity Patcher';
const SEARCH_PATH = 'DotaModdingCommunityMods';
const BRANCH_SIGNATURE_PREFIX = '...\\..\\..\\dota\\gameinfo_branchspecific.gi~';
const GAMEINFO_RELATIVE_PATH = path.join('dota', 'gameinfo_branchspecific.gi');
const SPECIAL_TYPES = new Set(['tower', 'weather']);
const SOURCE2_BASE_SEARCH_PATHS = [
  ['Game_Language', 'dota_*LANGUAGE*'],
  ['Game_LowViolence', 'dota_lv'],
  ['Game', 'dota'],
  ['Game', 'core'],
  ['Mod', 'dota'],
  ['Write', 'dota'],
  ['AddonRoot_Language', 'dota_*LANGUAGE*_addons'],
  ['AddonRoot', 'dota_addons'],
  ['PublicContent', 'dota_core'],
  ['PublicContent', 'core'],
];

function canonicalGamePath(value) {
  const resolved = path.resolve(String(value || ''));
  try { return fsSync.realpathSync.native(resolved); }
  catch { return resolved; }
}

function sameGamePath(left, right) {
  if (!left || !right) return false;
  return canonicalGamePath(left) === canonicalGamePath(right);
}

async function hashBuffer(data, algorithm = 'sha256') {
  return crypto.createHash(algorithm).update(data).digest('hex');
}

function decodeUtf8IgnoringInvalidBytes(input) {
  const source = Buffer.from(input);
  const valid = [];
  let runStart = 0;
  for (let index = 0; index < source.length;) {
    const first = source[index];
    let width = first <= 0x7f ? 1
      : first >= 0xc2 && first <= 0xdf ? 2
        : first >= 0xe0 && first <= 0xef ? 3
          : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
    let validSequence = width > 0 && index + width <= source.length;
    if (validSequence && width > 1) {
      for (let offset = 1; offset < width; offset += 1) {
        if ((source[index + offset] & 0xc0) !== 0x80) validSequence = false;
      }
      if (width === 3 && first === 0xe0 && source[index + 1] < 0xa0) validSequence = false;
      if (width === 3 && first === 0xed && source[index + 1] >= 0xa0) validSequence = false;
      if (width === 4 && first === 0xf0 && source[index + 1] < 0x90) validSequence = false;
      if (width === 4 && first === 0xf4 && source[index + 1] >= 0x90) validSequence = false;
    }
    if (validSequence) { index += width; continue; }
    if (index > runStart) valid.push(source.subarray(runStart, index));
    index += 1;
    runStart = index;
  }
  if (runStart < source.length) valid.push(source.subarray(runStart));
  return Buffer.concat(valid).toString('utf8');
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

function normalizePatcherIndent(text) {
  return String(text).split('\n').map((line) => {
    const stripped = line.replace(/^ +/, '');
    const leadingSpaces = line.length - stripped.length;
    return `${'\t'.repeat(Math.floor(leadingSpaces / 4))}${stripped}`;
  }).join('\n');
}

function extractItemBlock(text) {
  const match = String(text).match(/^\s*"(\d+)"\s*\{/);
  if (!match) throw new Error('A special-patch definition has no numeric item ID');
  const openIndex = String(text).indexOf('{', match.index);
  const closeIndex = findMatchingBrace(String(text), openIndex);
  if (closeIndex < 0 || String(text).slice(closeIndex + 1).trim()) throw new Error('A special-patch definition has an invalid item block');
  return { id: match[1], content: normalizePatcherIndent(String(text).trim()) };
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

function buildPlatformSearchPaths(platform, patchPath = SEARCH_PATH) {
  if (!['win32', 'linux'].includes(platform)) throw new Error(`Unsupported Dota platform: ${platform}`);
  // Source 2 resolves these mount names relative to the game executable's parent.
  // The upstream Patcher uses the same logical mount names on Windows and Linux;
  // OS-specific absolute paths here would break the other client layout.
  const entries = [
    ...SOURCE2_BASE_SEARCH_PATHS.slice(0, 2),
    ['Game', patchPath],
    ...SOURCE2_BASE_SEARCH_PATHS.slice(2, 4),
    ['Mod', patchPath],
    ...SOURCE2_BASE_SEARCH_PATHS.slice(4),
  ];
  return [
    ...entries.slice(0, 2).map(([kind, value]) => `\t\t\t${kind}\t${value}`),
    `\t\t// ${PATCH_MARKER}`,
    ...entries.slice(2).map(([kind, value]) => `\t\t\t${kind}\t${value}`),
  ];
}

function ensurePatchSearchPath(gameinfoText, platform = process.platform) {
  const fileSystem = findKeyBlock(gameinfoText, 'FileSystem');
  if (!fileSystem) throw new Error('Dota gameinfo_branchspecific.gi does not contain a FileSystem block');
  const searchPaths = findKeyBlock(gameinfoText, 'SearchPaths', fileSystem.openIndex + 1, fileSystem.closeIndex);
  const patchEntries = buildPlatformSearchPaths(platform);
  let output = gameinfoText;
  if (searchPaths) {
    const block = gameinfoText.slice(searchPaths.openIndex + 1, searchPaths.closeIndex);
    const lineEnding = block.includes('\r\n') ? '\r\n' : '\n';
    const closeIndent = block.match(/(?:^|\r?\n)([ \t]*)$/)?.[1] || '';
    const lines = block.split(/\r?\n/).filter((line) => {
      const trimmed = line.trim();
      if (trimmed === `// ${PATCH_MARKER}`) return false;
      return !new RegExp(`^(?:Game|Mod)\\s+"?${SEARCH_PATH}"?(?:\\s|$)`, 'i').test(trimmed);
    });
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    const gameInsert = lines.findIndex((line) => /^\s*Game\s+/i.test(line));
    const modInsert = lines.findIndex((line) => /^\s*Mod\s+/i.test(line));
    const gameIndex = gameInsert < 0 ? Math.min(2, lines.length) : gameInsert;
    const modIndex = modInsert < 0 ? lines.length : modInsert;
    const merged = [...lines];
    merged.splice(gameIndex, 0, patchEntries[2], patchEntries[3]);
    const adjustedModIndex = modIndex >= gameIndex ? modIndex + 2 : modIndex;
    merged.splice(adjustedModIndex, 0, patchEntries[6]);
    const orderedBlock = `${lineEnding}${merged.join(lineEnding)}${lineEnding}${closeIndent}`;
    output = `${output.slice(0, searchPaths.openIndex + 1)}${orderedBlock}${output.slice(searchPaths.closeIndex)}`;
  } else {
    const lineEnding = gameinfoText.includes('\r\n') ? '\r\n' : '\n';
    const searchPathLines = buildPlatformSearchPaths(platform).join(lineEnding);
    const insert = `${lineEnding}\t\tSearchPaths${lineEnding}\t\t{${lineEnding}${searchPathLines}${lineEnding}\t\t}${lineEnding}`;
    output = `${output.slice(0, fileSystem.closeIndex)}${insert}${output.slice(fileSystem.closeIndex)}`;
  }
  return output;
}

function removePatchSearchPath(gameinfoText) {
  const text = String(gameinfoText || '');
  const searchPaths = findKeyBlock(text, 'SearchPaths');
  if (searchPaths) {
    const keyIndex = text.lastIndexOf('SearchPaths', searchPaths.openIndex);
    const lineStart = text.lastIndexOf('\n', keyIndex) + 1;
    const block = text.slice(searchPaths.openIndex + 1, searchPaths.closeIndex);
    const onlyPatchEntries = block.split(/\r?\n/).every((line) => {
      const trimmed = line.trim();
      return !trimmed || trimmed === `// ${PATCH_MARKER}`
        || new RegExp(`^(?:Game|Mod)\\s+"?${SEARCH_PATH}"?(?:\\s|$)`, 'i').test(trimmed);
    });
    if (text.slice(keyIndex, searchPaths.openIndex).includes(PATCH_MARKER) || (block.includes(PATCH_MARKER) && onlyPatchEntries)) {
      let end = searchPaths.closeIndex + 1;
      if (text.startsWith('\r\n', end)) end += 2;
      else if (text[end] === '\n' || text[end] === '\r') end += 1;
      return `${text.slice(0, lineStart)}${text.slice(end)}`;
    }
  }
  const lineEnding = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    if (trimmed === `// ${PATCH_MARKER}`) return false;
    return !new RegExp(`^(?:Game|Mod)\\s+"?${SEARCH_PATH}"?(?:\\s|$)`, 'i').test(trimmed);
  });
  return lines.join(lineEnding);
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

function appendSignature(signaturesText, gameinfoBuffer, platform = process.platform) {
  const expected = signatureLine(gameinfoBuffer);
  const original = String(signaturesText || '');
  const lineEnding = /\r\n/.test(original) || (!original.includes('\n') && platform === 'win32') ? '\r\n' : '\n';
  let lines = original.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const digestIndex = lines.findIndex((line) => line.startsWith('DIGEST:'));
  if (digestIndex >= 0) {
    lines = lines.filter((line, index) => index <= digestIndex || !line.startsWith(BRANCH_SIGNATURE_PREFIX));
  }
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  return `${lines.join(lineEnding)}${lines.length ? lineEnding : ''}${expected}${lineEnding}`;
}

function isSignaturePathSupported(platform, relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').toLowerCase();
  if (platform === 'win32') return normalized === 'bin/win64/dota.signatures';
  return ['bin/linuxsteamrt64/dota.signatures', 'bin/win64/dota.signatures'].includes(normalized);
}

function hasPatchSignature(signaturesText, gameinfoText = '') {
  const gameinfo = String(gameinfoText || '');
  if (!hasPatchSearchPath(gameinfo)) return false;
  const lines = String(signaturesText || '').split(/\r?\n/);
  const digestIndex = lines.findIndex((line) => line.startsWith('DIGEST:'));
  return digestIndex >= 0 && lines.slice(digestIndex + 1).some((line) => line.startsWith(BRANCH_SIGNATURE_PREFIX));
}

function removePatchSignature(signaturesText, gameinfoText) {
  const text = String(signaturesText || '');
  if (!hasPatchSearchPath(String(gameinfoText || ''))) return text;
  const lines = text.split(/\r?\n/);
  const digestIndex = lines.findIndex((line) => line.startsWith('DIGEST:'));
  if (digestIndex < 0) return text;
  const lineEnding = text.includes('\r\n') ? '\r\n' : '\n';
  const kept = lines.filter((line, index) => index <= digestIndex || !line.startsWith(BRANCH_SIGNATURE_PREFIX));
  while (kept.length && !kept.at(-1).trim()) kept.pop();
  return `${kept.join(lineEnding)}${lineEnding}`;
}

function countPatchSignatureLines(signaturesText) {
  const lines = String(signaturesText || '').split(/\r?\n/);
  const digestIndex = lines.findIndex((line) => line.startsWith('DIGEST:'));
  return digestIndex < 0 ? 0 : lines.slice(digestIndex + 1).filter((line) => line.startsWith(BRANCH_SIGNATURE_PREFIX)).length;
}

function hasPatchSearchPath(gameinfoText) {
  return String(gameinfoText || '').includes(PATCH_MARKER)
    || /^\s*(?:Game|Mod)\s+"?DotaModdingCommunityMods"?(?:\s|$)/im.test(String(gameinfoText || ''));
}

function readBuildId(text) {
  return String(text || '').match(/"buildid"\s+"(\d+)"/i)?.[1] || null;
}

async function isDotaRunning(platform = process.platform) {
  if (platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq dota2.exe', '/NH', '/FO', 'CSV'], { windowsHide: true });
      return /^"dota2\.exe"[,\s]/im.test(String(stdout || ''));
    } catch (error) {
      throw new Error(`Could not safely check whether Dota 2 is running: ${error.message}`);
    }
  }
  for (const name of ['dota2', 'dota2.exe']) {
    try {
      const { stdout } = await execFileAsync('pgrep', ['-x', name]);
      if (String(stdout || '').trim()) return true;
    } catch (error) {
      if (error.code === 1) continue;
      throw new Error(`Could not safely check whether Dota 2 is running: ${error.message}`);
    }
  }
  return false;
}

class SpecialPatchService {
  constructor({ rootDir, storage, getGamePath, getMods, fetchImpl = fetch, onProgress = () => {}, onDiagnostics = (entry) => console.info(`[special-patch:windows-diagnostics] ${JSON.stringify(entry)}`), processRunning = isDotaRunning, platform = process.platform }) {
    this.rootDir = rootDir;
    this.storage = storage;
    this.getGamePath = getGamePath;
    this.getMods = getMods;
    this.fetchImpl = fetchImpl;
    this.onProgress = onProgress;
    this.onDiagnostics = onDiagnostics;
    this.processRunning = processRunning;
    this.platform = platform;
    this.queue = Promise.resolve();
    this.runtimeStates = new Map();
    this.stateRefreshUntil = 0;
    this.stateRefreshWindowMs = 3000;
    this.stateDirectory = path.join(rootDir, 'database', 'special-patches');
    this.manifestPath = path.join(this.stateDirectory, 'manifest.json');
    this.journalPath = path.join(this.stateDirectory, 'transaction.json');
    this.lockPath = path.join(this.stateDirectory, 'operation.lock');
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
    await this.withLock(() => this.recoverTransaction());
  }

  progress(id, phase, percent, state = 'processing') {
    this.onProgress({ id, operation: 'special-patch', state, phase, percent });
  }

  logWindowsDiagnostics(stage, details) {
    if (this.platform !== 'win32') return;
    this.onDiagnostics({
      stage,
      platform: 'Windows',
      ...details,
    });
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
    let releaseOperationLock;
    try {
      releaseOperationLock = await this.acquireOperationLock();
      return await task();
    } finally {
      try { await releaseOperationLock?.(); } finally { release(); }
    }
  }

  async acquireOperationLock() {
    const token = crypto.randomUUID();
    let handle;
    try {
      handle = await fs.open(this.lockPath, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }));
      await handle.sync();
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(await fs.readFile(this.lockPath, 'utf8')); }
      catch (readError) {
        const stat = await fs.stat(this.lockPath).catch(() => null);
        if (readError.code === 'ENOENT') return this.acquireOperationLock();
        if (stat && Date.now() - stat.mtimeMs > 60_000) {
          await fs.rm(this.lockPath, { force: true });
          return this.acquireOperationLock();
        }
        throw new Error('Another VANTA instance is initializing a Weather/Tower patch operation. Retry in a moment.');
      }
      let ownerRunning = true;
      try { process.kill(Number(owner.pid), 0); }
      catch (processError) { ownerRunning = processError.code === 'EPERM'; }
      if (!Number.isInteger(Number(owner.pid)) || !ownerRunning) {
        await fs.rm(this.lockPath, { force: true });
        return this.acquireOperationLock();
      }
      throw new Error('Another VANTA instance is installing, updating, or removing a Weather/Tower patch. Wait for it to finish and retry.');
    }

    await handle.close();
    return async () => {
      try {
        const owner = JSON.parse(await fs.readFile(this.lockPath, 'utf8'));
        if (owner.token === token) await fs.rm(this.lockPath, { force: true });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    };
  }

  getDotaPaths() {
    const gamePath = this.getGamePath();
    if (!gamePath) throw new Error('Set the Dota 2 installation path in Settings before installing a special patch.');
    const root = canonicalGamePath(gamePath);
    const binRoot = path.join(root, 'bin');
    const modVpk = path.join(root, SEARCH_PATH, 'pak01_dir.vpk');
    const modVpkRuntimeAlias = path.join(root, SEARCH_PATH, 'pak01.vpk');
    return {
      root,
      pak01: path.join(root, 'dota', 'pak01_dir.vpk'),
      gameinfo: path.join(root, GAMEINFO_RELATIVE_PATH),
      binRoot,
      modDirectory: path.join(root, SEARCH_PATH),
      modVpk,
      modVpkRuntimeAlias,
      modVpkCandidates: [modVpk, modVpkRuntimeAlias],
      modVpkWriteTargets: this.platform === 'win32' ? [modVpk] : [modVpk, modVpkRuntimeAlias],
    };
  }

  async findSignaturesPath(paths) {
    const folders = this.platform === 'win32' ? ['win64'] : ['linuxsteamrt64', 'win64'];
    for (const folder of folders) {
      const candidate = path.join(paths.binRoot, folder, 'dota.signatures');
      try { await fs.access(candidate); return candidate; } catch {}
    }
    throw new Error('Dota dota.signatures was not found in either supported platform folder. Verify Dota 2 files in Steam and try again.');
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
      // h6rd/Patcher decodes the packed file as UTF-8 with errors='ignore'.
      // Replacement characters from malformed bytes change the Source 2 override.
      return { text: decodeUtf8IgnoringInvalidBytes(data), hash: await hashBuffer(data) };
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

  async getBackupDirectory(gamePath, legacyGamePaths = []) {
    const backupRoot = path.join(this.stateDirectory, 'backups');
    const canonicalPath = canonicalGamePath(gamePath);
    const candidates = [...new Set([canonicalPath, gamePath, ...legacyGamePaths]
      .filter(Boolean)
      .map((candidate) => path.resolve(candidate)))];
    const directories = await Promise.all(candidates.map(async (candidate) => ({
      candidate,
      directory: path.join(backupRoot, await hashBuffer(Buffer.from(candidate))),
    })));
    const hasBackupFiles = async (directory) => {
      try {
        const entries = await fs.readdir(directory);
        return entries.some((entry) => /^(?:gameinfo_branchspecific\.gi|dota\.signatures(?:-|$)|pre-existing-pak01_dir\.vpk)$/i.test(entry));
      } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    };
    const canonicalDirectory = directories[0].directory;
    if (await hasBackupFiles(canonicalDirectory)) return canonicalDirectory;
    for (const { directory } of directories.slice(1)) {
      if (!(await hasBackupFiles(directory))) continue;
      await fs.mkdir(canonicalDirectory, { recursive: true });
      for (const entry of await fs.readdir(directory)) {
        if (!/^(?:gameinfo_branchspecific\.gi|dota\.signatures(?:-|$)|pre-existing-pak01_dir\.vpk)$/i.test(entry)) continue;
        const target = path.join(canonicalDirectory, entry);
        try { await fs.access(target); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await fs.copyFile(path.join(directory, entry), target, fsSync.constants.COPYFILE_EXCL);
        }
      }
      return canonicalDirectory;
    }
    await fs.mkdir(canonicalDirectory, { recursive: true });
    return canonicalDirectory;
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
      /\/game\/DotaModdingCommunityMods\/pak01(?:_dir)?\.vpk$/i,
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
    await this.writeJson(this.journalPath, {
      schemaVersion: 1,
      files,
      installedModsBefore: JSON.parse(JSON.stringify(this.storage.state.installedMods || {})),
      startedAt: new Date().toISOString(),
    });
  }

  async rollbackTransaction(journal) {
    for (const file of [...(journal?.files || [])].reverse()) {
      const safePath = this.assertTransactionPath(file.path);
      if (file.missing) await fs.rm(safePath, { force: true });
      else await this.atomicWrite(safePath, Buffer.from(file.data, 'base64'));
    }
    if (journal && Object.hasOwn(journal, 'installedModsBefore')) {
      const restored = JSON.parse(JSON.stringify(journal.installedModsBefore || {}));
      await this.storage.patch({ installedMods: restored });
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
      catch (error) {
        const safeError = this.serializeError(error);
        this.logWindowsDiagnostics('failed', { patch: { id: mod?.id, type: mod?.specialType, name: mod?.name }, error: safeError.message });
        await this.markFailure(mod, safeError);
        throw safeError;
      }
    });
  }

  async applyLocked(mod, { replacingId = null } = {}) {
      if (!this.isSpecialPatch(mod)) throw new Error('This catalog entry is not a supported special patch.');
      const paths = this.getDotaPaths();
      if (await this.processRunning()) throw new Error('Close Dota 2 before installing or updating Weather/Tower patches. VANTA will not terminate the game automatically.');
      for (const [label, filePath] of [['base VPK', paths.pak01], ['gameinfo file', paths.gameinfo]]) {
        if (!(await this.exists(filePath))) throw new Error(`The selected Dota 2 folder is missing its ${label}: ${filePath}. Re-detect the game path and verify Dota 2 files in Steam before installing Weather/Tower patches.`);
      }
      const signaturesPath = await this.findSignaturesPath(paths);
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
        const signaturesBefore = await fs.readFile(signaturesPath);
        const signaturesText = signaturesBefore.toString('utf8');
        const gameinfoAfter = Buffer.from(ensurePatchSearchPath(gameinfoBefore.toString('utf8'), this.platform), 'utf8');
        const signaturesAfter = Buffer.from(appendSignature(signaturesText, gameinfoAfter, this.platform), 'utf8');
        const previousManifest = await this.readSpecialManifest();
        const backupDirectory = await this.getBackupDirectory(paths.root, [previousManifest?.gamePath]);
        const backupGameinfo = path.join(backupDirectory, 'gameinfo_branchspecific.gi');
        const backupSignatures = this.getSignatureBackupPath(backupDirectory, signaturesPath);
        const gameinfoHasPatchPath = hasPatchSearchPath(gameinfoBefore.toString('utf8'));
        const signaturesHavePatchLine = hasPatchSignature(signaturesText, gameinfoBefore.toString('utf8'));
        const previousSignatureRelativePath = String(previousManifest?.signaturesRelativePath || '').replace(/\\/g, '/');
        const previousSignaturePath = sameGamePath(previousManifest?.gamePath, paths.root)
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
        const existingModVpk = [];
        for (const candidate of paths.modVpkWriteTargets) {
          if (await this.exists(candidate)) existingModVpk.push(candidate);
        }
        const vpkBeforeExists = existingModVpk.length > 0;
        const vpkBeforePath = vpkBeforeExists ? existingModVpk[0] : null;
        const vpkBefore = vpkBeforePath ? await fs.readFile(vpkBeforePath) : null;
        const ownsExistingVpk = Boolean(sameGamePath(previousManifest?.gamePath, paths.root) && previousManifest?.modVpkHash && vpkBefore && await hashBuffer(vpkBefore) === previousManifest.modVpkHash);
        const staleWindowsRuntimeAlias = this.platform === 'win32'
          && sameGamePath(previousManifest?.gamePath, paths.root)
          && previousManifest?.modVpkHash
          && await this.exists(paths.modVpkRuntimeAlias)
          && await hashFile(paths.modVpkRuntimeAlias) === previousManifest.modVpkHash;
        if (!(await this.exists(backupGameinfo))) {
          if (!gameinfoHasPatchPath) await this.atomicWrite(backupGameinfo, gameinfoBefore);
          else {
            const upstreamBackup = `${paths.gameinfo}_backup`;
            if (!(await this.exists(upstreamBackup))) throw new Error('Dota gameinfo is already patched, but its original backup is missing. Restore Dota 2 files in Steam before changing this patch.');
            await this.atomicWrite(backupGameinfo, await fs.readFile(upstreamBackup));
          }
        }
        if (!(await this.exists(backupSignatures))) {
          if (!signaturesHavePatchLine) await this.atomicWrite(backupSignatures, signaturesBefore);
          else if (previousSignaturePath === signaturesPath) {
            const legacyBackup = path.join(backupDirectory, 'dota.signatures');
            if (await this.exists(legacyBackup)) await this.atomicWrite(backupSignatures, await fs.readFile(legacyBackup));
            else {
              const upstreamBackup = signaturesPath.replace(/\.signatures$/i, '.signatures_backup');
              if (await this.exists(upstreamBackup)) await this.atomicWrite(backupSignatures, await fs.readFile(upstreamBackup));
              else throw new Error('Dota signatures are already patched, but their original backup is missing. Restore Dota 2 files in Steam before changing this patch.');
            }
          } else if (signaturesHavePatchLine) {
            const upstreamBackup = signaturesPath.replace(/\.signatures$/i, '.signatures_backup');
            if (await this.exists(upstreamBackup)) await this.atomicWrite(backupSignatures, await fs.readFile(upstreamBackup));
            else throw new Error('Dota signatures are already patched, but their original backup is missing. Restore Dota 2 files in Steam before changing this patch.');
          }
        }
        let originalGameinfo = await fs.readFile(backupGameinfo);
        let originalSignatures = await fs.readFile(backupSignatures);
        const originalGameinfoText = originalGameinfo.toString('utf8');
        const originalSignaturesText = originalSignatures.toString('utf8');
        if (hasPatchSearchPath(originalGameinfoText) || hasPatchSignature(originalSignaturesText, originalGameinfoText)) {
          const liveGameinfo = await fs.readFile(paths.gameinfo);
          const liveSignatures = await fs.readFile(signaturesPath);
          const liveGameinfoText = liveGameinfo.toString('utf8');
          const liveGameinfoClean = !hasPatchSearchPath(liveGameinfoText);
          const liveSignaturesClean = !hasPatchSignature(liveSignatures.toString('utf8'), liveGameinfoText);
          if (liveGameinfoClean && liveSignaturesClean) {
            await this.atomicWrite(backupGameinfo, liveGameinfo);
            await this.atomicWrite(backupSignatures, liveSignatures);
            originalGameinfo = liveGameinfo;
            originalSignatures = liveSignatures;
          } else {
            throw new Error('The saved Dota patch backup is itself patched or invalid. Verify Dota 2 files in Steam before continuing.');
          }
        }
        this.logWindowsDiagnostics('pre-write', {
          dotaPath: paths.root,
          gameinfo: paths.gameinfo,
          signatures: signaturesPath,
          selectedPatches: activeMods.map((entry) => ({ id: entry.id, type: entry.specialType, name: entry.name })),
          vpkFiles: existingModVpk.map((filePath) => path.basename(filePath)),
          gameinfoSha256Before: await hashBuffer(gameinfoBefore),
          signatureStateBefore: {
            patchSignatureMatchesGameinfo: signaturesMatch(signaturesText, gameinfoBefore),
            existingPatchSignatureCount: countPatchSignatureLines(signaturesText),
          },
          backupState: {
            gameinfoExists: await this.exists(backupGameinfo),
            gameinfoSha256: await hashFile(backupGameinfo),
            signaturesExists: await this.exists(backupSignatures),
            signaturesSha256: await hashFile(backupSignatures),
          },
        });
        ensurePatchSearchPath(originalGameinfo.toString('utf8'), this.platform);
        if (vpkBefore && !ownsExistingVpk) {
          const foreignBackup = path.join(backupDirectory, 'pre-existing-pak01_dir.vpk');
          if (!(await this.exists(foreignBackup))) await fs.copyFile(vpkBeforePath, foreignBackup);
        }
        previousInstalledMods = { ...(this.storage.state.installedMods || {}) };
        transactionFiles = [...paths.modVpkCandidates, paths.gameinfo, signaturesPath, this.manifestPath];
        if (staleSignaturePath && staleSignatureBackup && await this.exists(staleSignatureBackup)) transactionFiles.push(staleSignaturePath);
        await this.recordTransaction(transactionFiles);
        this.progress(mod.id, 'Writing the special-patch VPK…', 70);
        await fs.mkdir(paths.modDirectory, { recursive: true });
        if (staleWindowsRuntimeAlias) await fs.rm(paths.modVpkRuntimeAlias, { force: true });
        for (const targetPath of paths.modVpkWriteTargets) {
          await this.installVpk(temporaryVpk, targetPath);
        }
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
          platform: this.platform,
          gameBuildId: currentBuild,
          originalGameinfoHash: await hashBuffer(originalGameinfo),
          originalSignaturesHash: await hashBuffer(originalSignatures),
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
        const outputVpkFiles = (await fs.readdir(paths.modDirectory)).filter((name) => /^pak01(?:_dir)?\.vpk$/i.test(name)).sort();
        this.logWindowsDiagnostics('installed', {
          dotaPath: paths.root,
          gameinfo: paths.gameinfo,
          signatures: signaturesPath,
          selectedPatches: activeMods.map((entry) => ({ id: entry.id, type: entry.specialType, name: entry.name })),
          vpkFiles: outputVpkFiles,
          gameinfoSha256: finalGameinfoHash,
          signatureState: {
            matchesCurrentGameinfo: signaturesMatch(signaturesAfter.toString('utf8'), gameinfoAfter),
            signaturesSha256: finalSignaturesHash,
            patchSignatureCount: signaturesAfter.toString('utf8').split(/\r?\n/).filter((line) => line.startsWith('...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:')).length,
          },
          backupState: {
            gameinfoExists: true,
            gameinfoSha256: metadata.originalGameinfoHash,
            signaturesExists: true,
            signaturesSha256: metadata.originalSignaturesHash,
          },
        });
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
      let removeAllSpecialPatches = false;
      if (remaining.length) {
        try { await this.findSignaturesPath(this.getDotaPaths()); }
        catch (error) { if (!/not found in either supported platform folder/i.test(error.message)) throw error; removeAllSpecialPatches = true; }
        if (!removeAllSpecialPatches) {
          const first = remaining[0];
          const before = { ...this.storage.state.installedMods };
          const staged = { ...before };
          delete staged[id];
          this.storage.state.installedMods = staged;
          try { await this.applyLocked(first, { replacingId: first.id }); }
          catch (error) { this.storage.state.installedMods = before; throw error; }
          return true;
        }
      }
      const paths = this.getDotaPaths();
      if (await this.processRunning()) throw new Error('Close Dota 2 before removing a Weather/Tower patch. VANTA will not terminate the game automatically.');
      const diskManifest = await this.readSpecialManifest();
      const manifest = diskManifest || record.patchMetadata;
      if (!manifest || !sameGamePath(manifest.gamePath, paths.root)) {
        throw new Error('The patch installation path cannot be verified. Select the original Dota 2 folder before removing this patch; no files were changed.');
      }
      const signaturesRelativePath = String(manifest.signaturesRelativePath || '').replace(/\\/g, '/');
      if (!isSignaturePathSupported(this.platform, signaturesRelativePath)) {
        throw new Error(`The special-patch metadata does not match the current ${this.platform} Dota client signature path. Remove it on the platform where it was installed or verify Dota 2 files in Steam; no files were changed.`);
      }
      const signaturesPath = path.resolve(paths.root, signaturesRelativePath);
      const signaturesRelativeToRoot = path.relative(paths.root, signaturesPath);
      if (!signaturesRelativeToRoot || signaturesRelativeToRoot.startsWith('..') || path.isAbsolute(signaturesRelativeToRoot)) {
        throw new Error('The special-patch metadata contains an unsafe signature-file path. No game files were changed.');
      }

      const modVpkMatches = await Promise.all(paths.modVpkCandidates.map(async (candidate) => {
        if (!(await this.exists(candidate))) return false;
        return manifest.modVpkHash && await hashFile(candidate) === manifest.modVpkHash;
      }));
      const modVpkExists = modVpkMatches.some(Boolean) || (await Promise.all(paths.modVpkCandidates.map((candidate) => this.exists(candidate)))).some(Boolean);
      if (modVpkExists && !modVpkMatches.some(Boolean)) throw new Error('The special-patch VPK changed outside VANTA. It was left untouched; verify Dota files before removing the Library entry.');

      const backupDirectory = await this.getBackupDirectory(paths.root, [manifest.gamePath]);
      const backupGameinfo = path.join(backupDirectory, 'gameinfo_branchspecific.gi');
      const backupSignatures = await this.findSignatureBackup(backupDirectory, signaturesPath);
      const foreignBackup = path.join(backupDirectory, 'pre-existing-pak01_dir.vpk');
      const gameinfoExists = await this.exists(paths.gameinfo);
      const gameinfoCurrent = gameinfoExists ? await fs.readFile(paths.gameinfo) : null;
      const signaturesExist = await this.exists(signaturesPath);
      const signaturesCurrent = signaturesExist ? await fs.readFile(signaturesPath) : null;
      const gameinfoCurrentText = gameinfoCurrent?.toString('utf8') || '';
      const signaturesCurrentText = signaturesCurrent?.toString('utf8') || '';
      const gameinfoFallback = gameinfoCurrent
        ? Buffer.from(hasPatchSearchPath(gameinfoCurrentText) ? removePatchSearchPath(gameinfoCurrentText) : gameinfoCurrentText, 'utf8')
        : null;
      const signaturesFallback = signaturesCurrent
        ? Buffer.from(hasPatchSignature(signaturesCurrentText, gameinfoCurrentText)
          ? removePatchSignature(signaturesCurrentText, gameinfoCurrentText)
          : signaturesCurrentText, 'utf8')
        : null;
      const backupExists = async (filePath, label, expectedHash, validate, currentFallback = null) => {
        if (!(await this.exists(filePath))) return currentFallback;
        const data = await fs.readFile(filePath);
        if (expectedHash && await hashBuffer(data) !== expectedHash) {
          if (currentFallback && validate(currentFallback)) {
            await this.atomicWrite(filePath, currentFallback);
            return currentFallback;
          }
          throw new Error(`The original ${label} backup is corrupted. No files were changed; verify Dota 2 files in Steam.`);
        }
        if (!validate(data)) {
          if (currentFallback && validate(currentFallback)) {
            await this.atomicWrite(filePath, currentFallback);
            return currentFallback;
          }
          throw new Error(`The original ${label} backup is not an unpatched valid file. No files were changed; verify Dota 2 files in Steam.`);
        }
        return data;
      };
      const originalGameinfo = await backupExists(
        backupGameinfo,
        'gameinfo',
        manifest.originalGameinfoHash,
        (data) => !hasPatchSearchPath(data.toString('utf8')) && Boolean(findKeyBlock(data.toString('utf8'), 'FileSystem')),
        gameinfoFallback && !hasPatchSearchPath(gameinfoFallback.toString('utf8')) ? gameinfoFallback : null,
      );
      const originalSignatures = await backupExists(
        backupSignatures,
        'dota.signatures',
        manifest.originalSignaturesHash,
        (data) => data.length > 0 && !hasPatchSignature(data.toString('utf8'), originalGameinfo?.toString('utf8')),
        signaturesFallback && signaturesFallback.length > 0 && !hasPatchSignature(signaturesFallback.toString('utf8'), originalGameinfo?.toString('utf8')) ? signaturesFallback : null,
      );
      const gameinfoMatches = Boolean(gameinfoCurrent && manifest.gameinfoHash && await hashBuffer(gameinfoCurrent) === manifest.gameinfoHash);
      const gameinfoStillPatched = Boolean(gameinfoCurrent && hasPatchSearchPath(gameinfoCurrentText));
      const signaturesMatchOwned = Boolean(signaturesCurrent && manifest.signaturesHash && await hashBuffer(signaturesCurrent) === manifest.signaturesHash);
      const signaturesStillPatched = Boolean(signaturesCurrent && hasPatchSignature(signaturesCurrentText, gameinfoCurrentText));

      const gameinfoShouldRestore = Boolean(originalGameinfo && (!gameinfoExists || gameinfoMatches));
      const signaturesShouldRestore = Boolean(originalSignatures && (!signaturesExist || signaturesMatchOwned));
      const gameinfoShouldStrip = Boolean(gameinfoStillPatched && gameinfoCurrent && !gameinfoMatches && gameinfoFallback && findKeyBlock(gameinfoFallback.toString('utf8'), 'FileSystem'));
      const signaturesShouldStrip = Boolean(signaturesStillPatched && signaturesCurrent && !signaturesMatchOwned && signaturesFallback?.length);
      if ((gameinfoStillPatched && !gameinfoShouldRestore && !gameinfoShouldStrip) || (signaturesStillPatched && !signaturesShouldRestore && !signaturesShouldStrip)) {
        throw new Error('A Dota patch file is still modified, but its original backup is unavailable or no longer matches. No files were changed; verify Dota 2 files in Steam before retrying.');
      }

      const transaction = [...paths.modVpkCandidates, this.manifestPath];
      if (gameinfoShouldRestore || gameinfoShouldStrip) transaction.push(paths.gameinfo);
      if (signaturesShouldRestore || signaturesShouldStrip) transaction.push(signaturesPath);
      await this.recordTransaction(transaction);
      try {
        for (const candidate of paths.modVpkCandidates) {
          if (await this.exists(candidate)) await fs.rm(candidate, { force: true });
        }
        if (await this.exists(foreignBackup)) await this.installVpk(foreignBackup, paths.modVpk);
        if (gameinfoShouldRestore) await this.atomicWrite(paths.gameinfo, originalGameinfo);
        else if (gameinfoShouldStrip) await this.atomicWrite(paths.gameinfo, gameinfoFallback);
        if (signaturesShouldRestore) await this.atomicWrite(signaturesPath, originalSignatures);
        else if (signaturesShouldStrip) await this.atomicWrite(signaturesPath, signaturesFallback);
        const installedMods = { ...this.storage.state.installedMods };
        if (removeAllSpecialPatches) {
          for (const [installedId, installedRecord] of Object.entries(installedMods)) {
            if (installedRecord?.modType === 'special_patch') delete installedMods[installedId];
          }
        } else delete installedMods[id];
        await this.storage.patch({ installedMods });
        await fs.rm(this.manifestPath, { force: true });
        await fs.rm(this.journalPath, { force: true });
      } catch (error) {
        const journal = JSON.parse(await fs.readFile(this.journalPath, 'utf8'));
        await this.rollbackTransaction(journal);
        await fs.rm(this.journalPath, { force: true });
        throw error;
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
      const vpkHash = await Promise.all(paths.modVpkCandidates.map(async (candidate) => {
        try { return await hashFile(candidate); } catch { return null; }
      })).then((hashes) => hashes.find((hash) => hash !== null) ?? null);
      const valid = sameGamePath(manifest?.gamePath, paths.root)
        && isSignaturePathSupported(this.platform, manifest.signaturesRelativePath)
        && path.resolve(paths.root, manifest.signaturesRelativePath) === signaturesPath
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

  async refreshStates(force = false) {
    if (!force && Date.now() < this.stateRefreshUntil) return this.storage.state.installedMods || {};
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
    this.stateRefreshUntil = Date.now() + this.stateRefreshWindowMs;
    return this.storage.state.installedMods || {};
  }
}

module.exports = {
  GAMEINFO_RELATIVE_PATH,
  PATCH_MARKER,
  SEARCH_PATH,
  SpecialPatchService,
  appendSignature,
  buildPlatformSearchPaths,
  ensurePatchSearchPath,
  extractItemBlock,
  findKeyBlock,
  findMatchingBrace,
  gitBlobHash,
  hasPatchSearchPath,
  hasPatchSignature,
  isDotaRunning,
  isSignaturePathSupported,
  replaceItemEntries,
  signatureLine,
  signaturesMatch,
};
