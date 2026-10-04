const fs = require('fs/promises');
const { createReadStream } = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const { VpkReader, VpkWriter } = require('vpk-tools');
const { VpkLibrary, isPakFilename, pakFilename, FIRST_PAK_NUMBER } = require('../infrastructure/vpk-library');

async function hashFile(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function hashFileStream(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

function safeRelative(value) {
  const normalized = String(value).replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.includes('\0') || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) throw new Error('Archive contains an unsafe path');
  return normalized;
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function safeModRecordId(value) {
  const id = String(value || '');
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(id) || id.includes('..')) throw new Error('Library manifest contains an unsafe mod ID');
  return id;
}

function safeVpkLeaf(value) {
  const name = String(value || '');
  if (!name || name !== path.basename(name) || /[\\/\0]/.test(name) || !/\.vpk$/i.test(name) || name === '.' || name === '..') {
    throw new Error('Library record contains an unsafe VPK filename');
  }
  return name;
}

function isSafeVpkEntry(fileName) {
  const value = String(fileName || '');
  if (!value || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[a-z]:/i.test(value)) return false;
  return !value.split('/').some((part) => !part || part === '.' || part === '..');
}

async function safeRename(source, target) {
  if (!source || !target) return;
  if (path.resolve(source) === path.resolve(target)) return;
  await fs.rename(source, target);
}

class ModManager {
  constructor({ rootDir, storage, downloads, getGamePath, getLanguageFolder = () => 'dota', onProgress = () => {} }) {
    this.rootDir = rootDir;
    this.storage = storage;
    this.downloads = downloads;
    this.getGamePath = getGamePath;
    this.getLanguageFolder = getLanguageFolder;
    this.onProgress = onProgress;
    this.library = new VpkLibrary({ rootDir, storage });
    this.fileHashCache = new Map();
  }

  async init() { await this.library.init(); await this.migrateLegacyRecords(); }

  async migrateLegacyRecords() {
    const installedMods = { ...this.storage.state.installedMods };
    let changed = false;
    for (const [id, record] of Object.entries(installedMods)) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        delete installedMods[id];
        changed = true;
        continue;
      }
      if (record.fileName && isPakFilename(record.fileName)) continue;
      const legacyFile = (record.installedFiles || []).find((file) => /\.vpk(?:\.off|\.moff)?$/i.test(String(file)));
      if (!legacyFile) continue;
      const sourceBase = path.resolve(record.targetRoot || '', legacyFile);
      const source = await this.firstExisting([sourceBase, sourceBase.replace(/\.(?:off|moff)$/i, ''), `${sourceBase}.off`, `${sourceBase}.moff`]);
      if (!await this.exists(source)) continue;
      let reservation;
      try {
        reservation = await this.library.reserveFileName();
      } catch (error) {
        if (error.code !== 'VPK_SLOTS_FULL') throw error;
        console.warn(`[mod:migrate] VPK library is full; leaving ${legacyFile} managed in the Dota folder and continuing startup.`);
        break;
      }
      try {
        await fs.copyFile(source, reservation.path);
        installedMods[id] = { ...record, id: record.id || id, modId: record.modId || id, displayName: record.displayName || record.name || id, fileName: reservation.fileName, deployedFileName: record.deployedFileName || legacyFile.replace(/\.(?:off|moff)$/i, ''), gameFileName: record.gameFileName || legacyFile.replace(/\.(?:off|moff)$/i, ''), installedFiles: [reservation.fileName], type: record.type || 'mod' };
        changed = true;
      } finally { await reservation.release(); }
    }
    if (changed) await this.storage.patch({ installedMods });
  }

  recordId(record) { return record.id || record.modId; }

  getPriorityValue(record) {
    const match = String(record?.gameFileName || record?.deployedFileName || record?.fileName || '').match(/pak(\d{2})_dir\.vpk/i);
    if (match) return Number.parseInt(match[1], 10);
    if (record?.priority !== undefined && record.priority !== null && Number.isFinite(Number(record.priority))) return Number(record.priority);
    return FIRST_PAK_NUMBER;
  }

  async reserveFileName(preferredFileName = null) {
    const targetRoot = this.getLanguageRoot();
    let existingFiles = [];
    if (targetRoot) {
      try { existingFiles = await fs.readdir(targetRoot); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const occupied = existingFiles
      .map((file) => file.replace(/\.(?:vanta-disabled|off|moff)$/i, ''))
      .filter(isPakFilename);
    return this.library.reserveFileName(preferredFileName, occupied);
  }

  async reorder(ids) {
    if (!Array.isArray(ids) || !ids.length) return [];
    const installedMods = this.storage.state.installedMods || {};
    const orderedIds = ids.filter(Boolean);
    const records = Object.values(installedMods).filter((record) => record && (record.type === 'mod' || record.type === 'pack') && record.fileName);
    const seen = new Set();
    const targetRecords = [];
    for (const id of orderedIds) {
      const record = installedMods[id];
      if (record && record.fileName && !seen.has(this.recordId(record))) {
        seen.add(this.recordId(record));
        targetRecords.push(record);
      }
    }
    for (const record of records) {
      const recordId = this.recordId(record);
      if (!seen.has(recordId)) targetRecords.push(record);
    }
    if (!targetRecords.length) return [];

    const renameMoves = [];
    const staleTargetBackups = [];
    const expectedHashes = new Map();
    const tempPaths = new Map();
    const tempGamePaths = new Map();

    const moveStaleTargetAside = async (targetPath) => {
      if (!targetPath || !(await this.exists(targetPath))) return false;
      const backupPath = path.join(path.dirname(targetPath), `._vanta_reorder_stale_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${path.basename(targetPath)}`);
      await fs.rename(targetPath, backupPath);
      renameMoves.push({ from: targetPath, to: backupPath });
      staleTargetBackups.push(backupPath);
      return true;
    };

    const finalPlan = targetRecords.map((record, index) => {
      const targetFileName = pakFilename(index + FIRST_PAK_NUMBER);
      return { record, targetFileName, index };
    });

    const validateNoConflicts = () => {
      const seenTargets = new Set();
      for (const item of finalPlan) {
        if (seenTargets.has(item.targetFileName)) throw new Error(`Duplicate reorder target: ${item.targetFileName}`);
        seenTargets.add(item.targetFileName);
      }
    };

    const rollback = async () => {
      for (const move of [...renameMoves].reverse()) {
        try {
          if (move.to && await this.exists(move.to)) {
            await fs.rename(move.to, move.from);
          }
        } catch (error) {
          console.error('[mod:reorder:rollback]', error);
        }
      }
    };

    try {
      validateNoConflicts();
      for (const { record, targetFileName, index } of finalPlan) {
        const librarySource = path.join(this.library.directory, record.fileName);
        const targetRoot = record.targetRoot || (this.getGamePath() && path.join(this.getGamePath(), record.languageFolder || this.getLanguageFolder() || 'dota'));
        const currentGameFile = record.gameFileName || record.fileName;
        const gameSource = targetRoot ? path.join(targetRoot, currentGameFile) : '';

        let snapshot = await this.fileSnapshot(librarySource);
        if (!snapshot.exists && gameSource && await this.exists(gameSource)) {
          await fs.copyFile(gameSource, librarySource);
          snapshot = await this.fileSnapshot(librarySource);
        }
        if (!snapshot.exists) throw new Error(`Missing library VPK before reorder: ${record.fileName}`);
        expectedHashes.set(this.recordId(record), snapshot.hash);
        const tempLibraryPath = path.join(this.library.directory, `._vanta_reorder_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}.tmp`);
        if (await this.exists(librarySource)) {
          await fs.rename(librarySource, tempLibraryPath);
          renameMoves.push({ from: librarySource, to: tempLibraryPath });
        }
        tempPaths.set(this.recordId(record), tempLibraryPath);

        if (targetRoot) {
          if (await this.exists(gameSource)) {
            const tempGamePath = path.join(targetRoot, `._vanta_reorder_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}.tmp`);
            await fs.rename(gameSource, tempGamePath);
            renameMoves.push({ from: gameSource, to: tempGamePath });
            tempGamePaths.set(this.recordId(record), { from: gameSource, to: tempGamePath, final: path.join(targetRoot, targetFileName) });
          }
        }
      }

      for (const { record, targetFileName } of finalPlan) {
        const libraryTarget = path.join(this.library.directory, targetFileName);
        await moveStaleTargetAside(libraryTarget);
        const targetRoot = record.targetRoot || (this.getGamePath() && path.join(this.getGamePath(), record.languageFolder || this.getLanguageFolder() || 'dota'));
        if (targetRoot) {
          const gameTarget = path.join(targetRoot, targetFileName);
          await moveStaleTargetAside(gameTarget);
        }
      }

      for (const { record, targetFileName } of finalPlan) {
        const id = this.recordId(record);
        const libraryTemp = tempPaths.get(id);
        const libraryTarget = path.join(this.library.directory, targetFileName);
        if (!libraryTemp || !(await this.exists(libraryTemp))) throw new Error(`Missing temporary library VPK for reorder: ${id}`);
        await fs.rename(libraryTemp, libraryTarget);
        renameMoves.push({ from: libraryTemp, to: libraryTarget });

        const targetRoot = record.targetRoot || (this.getGamePath() && path.join(this.getGamePath(), record.languageFolder || this.getLanguageFolder() || 'dota'));
        const gameTempInfo = tempGamePaths.get(id);
        if (targetRoot && gameTempInfo) {
          const gameTarget = path.join(targetRoot, targetFileName);
          await fs.rename(gameTempInfo.to, gameTarget);
          renameMoves.push({ from: gameTempInfo.to, to: gameTarget });
        }

        const actualHash = await hashFile(libraryTarget);
        if (expectedHashes.get(id) !== actualHash) {
          throw new Error(`VPK payload changed during reorder for ${record.fileName}`);
        }
      }

      const updates = {};
      for (const [index, { record, targetFileName }] of finalPlan.entries()) {
        const nextRecord = { ...record, fileName: targetFileName, gameFileName: targetFileName, installedFiles: [targetFileName], priority: index + FIRST_PAK_NUMBER };
        updates[this.recordId(record)] = nextRecord;
        await this.writeManifest(nextRecord);
      }

      for (const backupPath of staleTargetBackups) {
        await fs.rm(backupPath, { force: true });
      }

      await this.storage.patch({ installedMods: { ...installedMods, ...updates } });
      return Object.values(this.storage.state.installedMods).sort((left, right) => this.getPriorityValue(left) - this.getPriorityValue(right));
    } catch (error) {
      await rollback();
      throw error;
    }
  }

  async install(mod) {
    await this.library.init();
    await this.migrateLegacyRecords();
    this.onProgress({ id: mod.id, name: mod.name, operation: 'mod-install', state: 'processing', phase: 'Preparing download', percent: 0 });
    const archive = await this.downloads.download(mod.id, mod.downloadUrl, { name: mod.name, operation: 'mod-install' });
    this.onProgress({ id: mod.id, name: mod.name, operation: 'mod-install', state: 'processing', phase: 'Preparing mod files', percent: null });
    const downloaded = await fs.readFile(archive);
    const directVpk = downloaded.length >= 4 && downloaded.readUInt32LE(0) === 0x55aa1234;
    let vpkData = downloaded;
    if (!directVpk) {
      let zip;
      try { zip = new AdmZip(downloaded); } catch (error) { throw new Error(`Downloaded mod is not a valid ZIP or VPK: ${error.message}`); }
      const vpkEntry = zip.getEntries().find((entry) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.vpk'));
      if (!vpkEntry) throw new Error('Download archive contained no VPK file');
      vpkData = vpkEntry.getData();
    }
    const previous = this.storage.state.installedMods[mod.id];
    const previousInstalledMods = JSON.parse(JSON.stringify(this.storage.state.installedMods || {}));
    const recordId = safeModRecordId(mod.id);
    const reservation = await this.reserveFileName(previous?.fileName || null);
    const temporary = `${reservation.path}.part`;
    const backup = `${reservation.path}.backup`;
    const previousManifestPath = path.join(this.rootDir, 'database', 'manifests', `${recordId}.json`);
    const previousManifest = await this.readOptionalFile(previousManifestPath);
    let deployment = null;
    try {
      this.onProgress({ id: mod.id, name: mod.name, operation: 'mod-install', state: 'processing', phase: 'Installing into Dota 2', percent: null });
      await fs.writeFile(temporary, vpkData);
      await this.validateVpk(temporary);
      if (await this.exists(reservation.path)) await fs.rename(reservation.path, backup);
      await fs.rename(temporary, reservation.path);
      const record = this.createModRecord(mod, previous, reservation.fileName);
      record.contentHash = await hashFile(reservation.path);
      deployment = await this.deploy(record, { retainBackup: true });
      record.targetRoot = deployment.targetRoot;
      record.gameFileName = record.gameFileName || path.basename(deployment.targetPath).replace(/\.vanta-disabled$/i, '');
      await this.writeManifest(record);
      await this.storage.patch({ installedMods: { ...this.storage.state.installedMods, [mod.id]: record } });
      await deployment.commit();
      await fs.rm(backup, { force: true }).catch(() => {});
      this.onProgress({ id: mod.id, name: mod.name, operation: 'mod-install', state: 'completed', phase: 'Installed', percent: 100 });
      return record;
    } catch (error) {
      try { await deployment?.rollback(); } catch (rollbackError) { throw new Error(`VPK update failed and game-file rollback needs attention: ${rollbackError.message}. Original error: ${error.message}`); }
      await fs.rm(temporary, { force: true });
      await fs.rm(reservation.path, { force: true });
      if (await this.exists(backup)) await fs.rename(backup, reservation.path);
      if (previousManifest) await this.atomicWrite(previousManifestPath, previousManifest);
      else await fs.rm(previousManifestPath, { force: true });
      this.storage.state.installedMods = previousInstalledMods;
      await this.storage.save();
      this.onProgress({ id: mod.id, name: mod.name, operation: 'mod-install', state: 'failed', phase: 'Installation failed', error: error.message });
      throw error;
    }
    finally { await reservation.release(); }
  }

  createModRecord(mod, previous, fileName) {
    const languageFolder = this.getLanguageFolder() || 'dota';
    return { ...previous, id: mod.id, modId: mod.id, type: 'mod', displayName: mod.name, name: mod.name, fileName, author: mod.author, categoryId: mod.categoryId, hero: mod.hero, heroLabel: mod.heroLabel, slot: mod.slot, previewUrl: mod.previewUrl, languageFolder, version: mod.version, installedAt: previous?.installedAt || new Date().toISOString(), installedFiles: [fileName], enabled: previous?.enabled !== false, priority: previous?.priority || this.getPriorityValue({ fileName }) };
  }

  async update(mod) { return this.install(mod); }

  async importVpk(filePath, displayName = path.basename(filePath, path.extname(filePath))) {
    const reservation = await this.reserveFileName();
    const temporary = `${reservation.path}.part`;
    try {
      await fs.copyFile(filePath, temporary);
      await this.validateVpk(temporary);
      await fs.rename(temporary, reservation.path);
      const id = `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const name = String(displayName).trim() || 'Imported VPK';
      const record = { id, modId: id, type: 'mod', displayName: name, name, fileName: reservation.fileName, installedFiles: [reservation.fileName], categoryId: 'other', languageFolder: this.getLanguageFolder() || 'dota', version: 'imported', installedAt: new Date().toISOString(), enabled: false, priority: this.getPriorityValue({ fileName: reservation.fileName }) };
      await this.writeManifest(record);
      await this.storage.patch({ installedMods: { ...this.storage.state.installedMods, [id]: record } });
      return record;
    } catch (error) { await fs.rm(temporary, { force: true }); throw error; }
    finally { await reservation.release(); }
  }

  async deploy(record, { retainBackup = false } = {}) {
    const gamePath = this.getGamePath();
    if (!gamePath) throw new Error('Dota 2 installation is not configured');
    const targetRoot = this.getLanguageRoot(record.languageFolder);
    await fs.mkdir(targetRoot, { recursive: true });
    const fileName = safeVpkLeaf(record.gameFileName || record.fileName);
    const activeTarget = path.join(targetRoot, fileName);
    const targetPath = record.enabled === false ? `${activeTarget}.vanta-disabled` : activeTarget;
    if (!isInside(targetRoot, targetPath)) throw new Error('Refusing to deploy a VPK outside the selected Dota language folder');
    const temporary = path.join(targetRoot, `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    const backup = path.join(targetRoot, `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.backup`);
    let hadTarget = false;
    try {
      await fs.copyFile(path.join(this.library.directory, safeVpkLeaf(record.fileName)), temporary);
      if (record.contentHash && await hashFile(temporary) !== record.contentHash) throw new Error('Staged game VPK failed its content hash check');
      if (await this.exists(targetPath)) {
        await fs.rename(targetPath, backup);
        hadTarget = true;
      }
      await fs.rename(temporary, targetPath);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      if (hadTarget && await this.exists(backup)) await fs.rename(backup, targetPath).catch(() => {});
      throw error;
    }
    let finalized = false;
    return {
      ...record,
      targetRoot,
      targetPath,
      installedFiles: [record.fileName],
      commit: async () => { finalized = true; if (hadTarget) await fs.rm(backup, { force: true }).catch(() => {}); },
      rollback: async () => {
        if (finalized) return;
        await fs.rm(targetPath, { force: true });
        if (hadTarget && await this.exists(backup)) await fs.rename(backup, targetPath);
        finalized = true;
      },
    };
  }

  getLanguageRoot(languageFolder = this.getLanguageFolder()) {
    const gamePath = this.getGamePath();
    if (!gamePath) return null;
    const folder = String(languageFolder || 'dota');
    return path.join(gamePath, /^dota_/i.test(folder) || folder.toLowerCase() === 'dota' ? folder : `dota_${folder}`);
  }

  async moveInstalledMods(languageFolder) {
    const gamePath = this.getGamePath();
    const installedMods = this.storage.state.installedMods || {};
    if (!gamePath) return installedMods;
    const targetRoot = this.getLanguageRoot(languageFolder);
    const moves = [];
    const copies = [];
    for (const record of Object.values(installedMods)) {
      if (!record?.fileName) continue;
      const sourceRoot = record.targetRoot || this.getLanguageRoot(record.languageFolder);
      const fileName = path.basename(record.gameFileName || record.deployedFileName || record.fileName);
      if (!sourceRoot || !fileName) continue;
      const source = await this.firstExisting([fileName, `${fileName}.vanta-disabled`, `${fileName}.off`, `${fileName}.moff`].map((name) => path.join(sourceRoot, name)));
      if (source) {
        const target = path.join(targetRoot, path.basename(source));
        if (path.resolve(source) !== path.resolve(target)) moves.push({ record, source, target });
      } else {
        const librarySource = path.join(this.library.directory, record.fileName);
        if (await this.exists(librarySource)) {
          const targetName = record.enabled === false ? `${fileName}.vanta-disabled` : fileName;
          copies.push({ record, source: librarySource, target: path.join(targetRoot, targetName) });
        }
      }
    }
    const targets = new Set();
    for (const item of [...moves, ...copies]) {
      const targetKey = path.resolve(item.target).toLowerCase();
      if (targets.has(targetKey)) throw new Error(`Multiple installed mods use the same target file: ${path.basename(item.target)}`);
      targets.add(targetKey);
      if (moves.includes(item) && await this.exists(item.target)) {
        throw new Error(`Cannot move mod because the target file already exists: ${path.basename(item.target)}`);
      }
    }
    await fs.mkdir(targetRoot, { recursive: true });
    const completed = [];
    try {
      for (const move of moves) { await this.moveFile(move.source, move.target); completed.push({ ...move, moved: true }); }
      for (const copy of copies) {
        if (await this.exists(copy.target)) {
          if (await hashFile(copy.source) !== await hashFile(copy.target)) {
            throw new Error(`Cannot restore mod because the target file already exists: ${path.basename(copy.target)}`);
          }
          continue;
        }
        await fs.copyFile(copy.source, copy.target);
        completed.push({ ...copy, moved: false });
      }
    } catch (error) {
      for (const item of completed.reverse()) {
        try { if (item.moved) await this.moveFile(item.target, item.source); else await fs.rm(item.target, { force: true }); } catch {}
      }
      throw error;
    }
    const updatedMods = { ...installedMods };
    for (const record of Object.values(installedMods)) {
      if (!record?.fileName) continue;
      const next = { ...record, languageFolder, targetRoot };
      updatedMods[this.recordId(record)] = next;
      await this.writeManifest(next);
    }
    await this.storage.patch({ installedMods: updatedMods });
    return updatedMods;
  }

  async syncInstalled() {
    await this.library.init();
    await this.migrateLegacyRecords();
    await this.reconcileGameFilenames();
    return this.storage.state.installedMods;
  }

  async reconcileGameFilenames() {
    const gamePath = this.getGamePath();
    if (!gamePath) return;
    const installedMods = { ...this.storage.state.installedMods };
    let changed = false;
    const directoryCache = new Map();
    for (const [id, record] of Object.entries(installedMods)) {
      if (!record?.fileName || (!record.targetRoot && record.enabled === false)) continue;
      const targetRoot = record.targetRoot || this.getLanguageRoot(record.languageFolder);
      const storedName = path.basename(record.gameFileName || record.deployedFileName || record.fileName);
      const possibleNames = [storedName, `${storedName}.vanta-disabled`, `${storedName}.off`, `${storedName}.moff`];
      let recordedFileExists = false;
      for (const name of possibleNames) {
        if (await this.exists(path.join(targetRoot, name))) { recordedFileExists = true; break; }
      }
      if (recordedFileExists) continue;

      let gameFiles = directoryCache.get(targetRoot);
      if (!gameFiles) {
        let entries = [];
        try { entries = await fs.readdir(targetRoot); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        gameFiles = await Promise.all(entries
          .filter((name) => /^pak\d{2}_dir\.vpk(?:\.vanta-disabled|\.off|\.moff)?$/i.test(name))
          .map(async (name) => {
            const filePath = path.join(targetRoot, name);
            try { return { name, filePath, size: (await fs.stat(filePath)).size }; } catch { return null; }
          }));
        gameFiles = gameFiles.filter(Boolean);
        directoryCache.set(targetRoot, gameFiles);
      }
      const libraryPath = path.join(this.library.directory, record.fileName);
      let libraryStat;
      try { libraryStat = await fs.stat(libraryPath); } catch { continue; }
      const sameSizedCandidates = gameFiles.filter((candidate) => candidate.size === libraryStat.size);
      if (!sameSizedCandidates.length) continue;
      const libraryHash = await this.cachedHash(libraryPath);
      let match = null;
      for (const candidate of sameSizedCandidates) {
        if (await this.cachedHash(candidate.filePath) === libraryHash) { match = candidate; break; }
      }
      if (!match) continue;

      const gameFileName = match.name.replace(/\.(?:vanta-disabled|off|moff)$/i, '');
      const next = {
        ...record,
        gameFileName,
        deployedFileName: gameFileName,
        targetRoot,
        enabled: !/\.(?:vanta-disabled|off|moff)$/i.test(match.name),
      };
      installedMods[id] = next;
      await this.writeManifest(next);
      changed = true;
    }
    if (changed) await this.storage.patch({ installedMods });
  }

  async cachedHash(filePath) {
    const stat = await fs.stat(filePath);
    const signature = `${stat.size}:${stat.mtimeMs}`;
    const cached = this.fileHashCache.get(filePath);
    if (cached?.signature === signature) return cached.hash;
    const hash = await hashFile(filePath);
    this.fileHashCache.set(filePath, { signature, hash });
    if (this.fileHashCache.size > 500) this.fileHashCache.delete(this.fileHashCache.keys().next().value);
    return hash;
  }

  async uninstall(id) {
    const record = this.storage.state.installedMods[id];
    if (!record) throw new Error('Library item not found');
    const targetRoot = record.targetRoot || this.getLanguageRoot(record.languageFolder);
    const gameFileName = safeVpkLeaf(record.gameFileName || record.fileName);
    const libraryFileName = safeVpkLeaf(record.fileName);
    safeModRecordId(id);
    const gamePath = this.getGamePath();
    const previousManifestPath = path.join(this.rootDir, 'database', 'manifests', `${id}.json`);
    if (targetRoot) {
      if (!gamePath || !isInside(gamePath, targetRoot)) throw new Error('Library record points outside the configured Dota folder; refusing to uninstall it. Re-select the correct Dota path first.');
      const rootReal = await fs.realpath(gamePath);
      const targetRootReal = await fs.realpath(targetRoot).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (targetRootReal && !isInside(rootReal, targetRootReal)) throw new Error('Library target folder resolves outside the configured Dota folder; refusing to uninstall it.');
    }
    const libraryPath = path.join(this.library.directory, libraryFileName);
    const gameNames = [gameFileName, `${gameFileName}.vanta-disabled`, `${gameFileName}.off`, `${gameFileName}.moff`];
    const gamePaths = targetRoot ? gameNames.map((name) => path.join(targetRoot, name)) : [];
    for (const gameFile of gamePaths) {
      if (!isInside(targetRoot, gameFile)) throw new Error('Library record contains an unsafe deployed VPK path');
      if (!(await this.exists(gameFile))) continue;
      const realFile = await fs.realpath(gameFile);
      if (!isInside(await fs.realpath(gamePath), realFile)) throw new Error('Deployed VPK resolves outside the Dota folder; refusing to delete it.');
        const libraryCopyExists = await this.exists(libraryPath);
        const expectedHash = libraryCopyExists ? await hashFile(libraryPath) : record.contentHash;
        if (!expectedHash) throw new Error(`The Library copy for ${path.basename(gameFile)} is missing; refusing to delete an unverifiable game file.`);
        if (await hashFile(gameFile) !== expectedHash) {
        throw new Error(`Deployed VPK ${path.basename(gameFile)} no longer matches the VANTA Library copy; it was left untouched.`);
      }
    }
    const previousManifest = await this.readOptionalFile(previousManifestPath);
    const previousInstalledMods = JSON.parse(JSON.stringify(this.storage.state.installedMods || {}));
    const movedAside = [];
    try {
      const filesToRemove = [...new Set([...gamePaths, libraryPath, previousManifestPath])];
      for (const filePath of filesToRemove) {
        if (!(await this.exists(filePath))) continue;
        const quarantine = `${filePath}.vanta-uninstall-${crypto.randomUUID()}`;
        await fs.rename(filePath, quarantine);
        movedAside.push({ filePath, quarantine });
      }
      const installedMods = { ...this.storage.state.installedMods }; delete installedMods[id];
      await this.storage.patch({ installedMods });
    } catch (error) {
      for (const move of [...movedAside].reverse()) {
        await fs.rename(move.quarantine, move.filePath).catch(() => {});
      }
      if (previousManifest && !(await this.exists(previousManifestPath))) await this.atomicWrite(previousManifestPath, previousManifest);
      this.storage.state.installedMods = previousInstalledMods;
      await this.storage.save();
      throw error;
    }
    for (const move of movedAside) await fs.rm(move.quarantine, { force: true }).catch(() => {});
    return true;
  }

  async setEnabled(id, enabled) {
    const record = this.storage.state.installedMods[id];
    if (!record || !record.fileName) throw new Error('Library item not found');
    const gamePath = this.getGamePath();
    if (!gamePath) throw new Error('Dota 2 installation is not configured');
    const targetRoot = this.getLanguageRoot(record.languageFolder);
    await fs.mkdir(targetRoot, { recursive: true });
    const gameFileName = record.gameFileName || record.fileName;
    const active = path.join(targetRoot, gameFileName); const disabled = `${active}.vanta-disabled`;
    const legacyDisabled = [`${active}.off`, `${active}.moff`];
    if (enabled) { let legacy = ''; for (const file of legacyDisabled) if (await this.exists(file)) { legacy = file; break; } if (await this.exists(disabled)) await safeRename(disabled, active); else if (legacy) await safeRename(legacy, active); else if (!await this.exists(active)) await this.deploy(record); }
    else if (await this.exists(active)) await safeRename(active, disabled);
    const next = { ...record, enabled }; await this.writeManifest(next);
    await this.storage.patch({ installedMods: { ...this.storage.state.installedMods, [id]: next } });
    return next;
  }

  async merge(ids, name) {
    const validIds = Array.isArray(ids) ? [...new Set(ids.filter(Boolean).filter((id) => this.storage.state.installedMods[id]))] : [];
    if (validIds.length < 2) throw new Error('Select at least two valid mods to merge');
    await this.library.init(); await this.migrateLegacyRecords(); return this.buildPack(validIds, name);
  }

  async rebuildPack(id) {
    const pack = this.storage.state.installedMods[id];
    if (!pack || pack.type !== 'pack') throw new Error('Pack not found');
    const ids = pack.sourceModIds || (pack.packMods || []).map((mod) => mod.id || mod.modId).filter(Boolean);
    if (ids.length < 2) throw new Error('Pack has no rebuildable source mods');
    const missing = ids.filter((sourceId) => !this.storage.state.installedMods[sourceId]);
    if (missing.length) throw new Error(`Cannot rebuild Pack: source mods are no longer in Library. Download them again first: ${missing.join(', ')}`);
    return this.buildPack(ids, pack.displayName || pack.name, pack);
  }

  async buildPack(ids, name, previousPack = null) {
    const records = ids.map((id) => this.storage.state.installedMods[id]).filter(Boolean);
    if (records.length !== ids.length || records.length < 2) throw new Error('Selected Library mods were not found');
    const displayName = String(name || '').trim(); if (!displayName) throw new Error('Pack name is required');
    const reservation = await this.reserveFileName(previousPack?.fileName || null); const temporary = `${reservation.path}.part`;
    try {
      const progressId = previousPack?.id || 'library';
      this.onProgress({ id: progressId, operation: 'pack', state: 'processing', phase: 'Reading mods...', percent: 5 });
      const writer = new VpkWriter(); const mergedFiles = new Map();
      for (const [index, record] of records.entries()) {
        this.onProgress({ id: progressId, operation: 'pack', state: 'processing', phase: `Reading mod ${index + 1} of ${records.length}...`, percent: 10 + Math.round((index / records.length) * 55) });
        const source = path.join(this.library.directory, record.fileName);
        if (!await this.exists(source)) throw new Error(`Source VPK is missing: ${record.fileName}`);
        const reader = VpkReader.open(source);
        try { for (const file of reader.files()) mergedFiles.set(file, reader.readFile(file)); } finally { reader.close(); }
        this.onProgress({ id: progressId, operation: 'pack', state: 'processing', phase: `Read mod ${index + 1} of ${records.length}`, percent: 10 + Math.round(((index + 1) / records.length) * 55) });
      }
      this.onProgress({ id: progressId, operation: 'pack', state: 'processing', phase: 'Resolving conflicts...', percent: 70 });
      for (const [file, data] of mergedFiles) writer.addFile(file, data);
      this.onProgress({ id: progressId, operation: 'pack', state: 'processing', phase: 'Building VPK...', percent: 82 });
      writer.write(temporary); await this.validateVpk(temporary); await fs.rename(temporary, reservation.path);
      const packId = previousPack?.id || `pack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sourceMods = records.flatMap((record) => record.type === 'pack' ? (record.sourceMods || record.packMods || []) : [{ id: this.recordId(record), name: record.displayName || record.name, displayName: record.displayName || record.name, fileName: record.fileName, author: record.author, previewUrl: record.previewUrl, hero: record.hero, heroLabel: record.heroLabel, slot: record.slot }]);
      const sourceModIds = sourceMods.map((source) => source.id || source.modId).filter(Boolean);
      const pack = { ...previousPack, id: packId, modId: packId, type: 'pack', category: 'Pack', displayName, name: displayName, fileName: reservation.fileName, categoryId: 'packs', languageFolder: records[0].languageFolder || this.getLanguageFolder() || 'dota', version: 'merged', updatedAt: new Date().toISOString(), installedFiles: [reservation.fileName], enabled: previousPack ? previousPack.enabled !== false : true, sourceModIds, sourceMods, modIds: sourceModIds, packMods: sourceMods };
      await this.writeManifest(pack);
      if (pack.enabled) await this.deploy(pack);
      const installedMods = { ...this.storage.state.installedMods, [packId]: pack };
      for (const record of records) {
        const targetRoot = record.targetRoot || (this.getGamePath() && path.join(this.getGamePath(), record.languageFolder || this.getLanguageFolder() || 'dota'));
        if (targetRoot && record.fileName) {
          await fs.rm(path.join(targetRoot, record.fileName), { force: true });
          await fs.rm(path.join(targetRoot, `${record.fileName}.vanta-disabled`), { force: true });
        }
        await fs.rm(path.join(this.library.directory, record.fileName), { force: true });
        await fs.rm(path.join(this.rootDir, 'database', 'manifests', `${this.recordId(record)}.json`), { force: true });
        delete installedMods[this.recordId(record)];
      }
      await this.storage.patch({ installedMods });
      this.onProgress({ id: packId, operation: 'pack', state: 'processing', phase: 'Finalizing Pack...', percent: 96 });
      this.onProgress({ id: packId, operation: 'pack', state: 'completed', phase: 'Pack created', percent: 100 });
      return pack;
    } catch (error) {
      await fs.rm(temporary, { force: true });
      this.onProgress({ id: previousPack?.id || 'library', operation: 'pack', state: 'failed', phase: error.message });
      throw error;
    }
    finally { await reservation.release(); }
  }

  async rename(id, name) {
    const nextName = String(name || '').trim(); if (!nextName) throw new Error('Library name is required');
    const record = this.storage.state.installedMods[id]; if (!record) throw new Error('Library item not found');
    const next = { ...record, displayName: nextName, name: nextName }; await this.writeManifest(next);
    await this.storage.patch({ installedMods: { ...this.storage.state.installedMods, [id]: next } }); return next;
  }

  async renamePack(id, name) { return this.rename(id, name); }

  async writeManifest(record) { const manifests = path.join(this.rootDir, 'database', 'manifests'); await fs.mkdir(manifests, { recursive: true }); await this.atomicWrite(path.join(manifests, `${safeModRecordId(this.recordId(record))}.json`), `${JSON.stringify(record, null, 2)}\n`); }

  async validateVpk(file) {
    const reader = VpkReader.open(file);
    try {
      const files = reader.files();
      if (!files.length) throw new Error('VPK contains no files');
      if (files.some((entry) => !isSafeVpkEntry(entry))) throw new Error('VPK contains an unsafe internal path');
      const result = await reader.verify();
      if (result.issues?.length || !result.checkedFiles) throw new Error('VPK payload verification failed');
    } finally { reader.close(); }
  }

  async atomicWrite(filePath, data) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, data); await fs.rename(temporary, filePath); }
    catch (error) { await fs.rm(temporary, { force: true }); throw error; }
  }

  async readOptionalFile(filePath) {
    try { return await fs.readFile(filePath); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async exists(file) { try { await fs.access(file); return true; } catch { return false; } }
  async moveFile(source, target, { renameImpl = fs.rename } = {}) {
    try { await renameImpl(source, target); return; }
    catch (error) { if (error.code !== 'EXDEV') throw error; }
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.copying`);
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, temporary);
      if (await hashFileStream(source) !== await hashFileStream(temporary)) throw new Error(`Cross-volume copy verification failed for ${path.basename(source)}`);
      await renameImpl(temporary, target);
      await fs.rm(source);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      if (await this.exists(target) && await this.exists(source)) await fs.rm(target, { force: true }).catch(() => {});
      throw error;
    }
  }
  async fileSnapshot(filePath) {
    if (!filePath) return { exists: false, size: 0, hash: null };
    const exists = await this.exists(filePath);
    if (!exists) return { exists: false, size: 0, hash: null };
    const stats = await fs.stat(filePath);
    return { exists: true, size: stats.size, hash: await hashFile(filePath) };
  }
  async firstExisting(files) { for (const file of files) if (await this.exists(file)) return file; return ''; }
}

module.exports = { ModManager, hashFileStream, safeRelative };