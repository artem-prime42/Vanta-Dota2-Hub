const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveVpkDeploymentTarget } = require('../infrastructure/dota-mod-paths');
const { isPakFilename } = require('../infrastructure/vpk-library');

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = require('node:fs').createReadStream(filePath);
  await new Promise((resolve, reject) => { stream.on('data', (chunk) => hash.update(chunk)); stream.on('error', reject); stream.on('end', resolve); });
  return hash.digest('hex');
}

class DotaDiagnosticsService {
  constructor({ getGamePath, storage, library, processRunning, getBuildId = async () => null }) {
    this.getGamePath = getGamePath;
    this.storage = storage;
    this.library = library;
    this.processRunning = processRunning;
    this.getBuildId = getBuildId;
    this.lastResult = null;
  }

  async check() {
    const result = { checkedAt: new Date().toISOString(), installation: { detected: false, readable: false, writable: false, path: this.getGamePath() || null }, game: { running: null, buildId: null }, mods: [], externalVpks: [], errors: [], actualGameLoad: 'unconfirmed' };
    const gamePath = this.getGamePath();
    if (!gamePath) {
      result.errors.push('Dota 2 installation is not configured.');
      this.lastResult = result;
      return result;
    }

    try {
      const stat = await fs.stat(gamePath);
      result.installation.detected = stat.isDirectory();
      await fs.access(gamePath, constants.R_OK);
      result.installation.readable = true;
      try { await fs.access(gamePath, constants.W_OK); result.installation.writable = true; }
      catch { result.installation.writable = false; }
      result.installation.basePak01Present = Boolean(await fs.stat(path.join(gamePath, 'dota', 'pak01_dir.vpk')).then((item) => item.isFile(), () => false));
    } catch (error) {
      result.errors.push(`Dota path cannot be accessed: ${error.message}`);
    }
    try { result.game.running = Boolean(await this.processRunning()); }
    catch (error) { result.game.running = null; result.errors.push(`Could not determine whether Dota 2 is running: ${error.message}`); }
    try { result.game.buildId = await this.getBuildId(gamePath); }
    catch (error) { result.errors.push(`Could not read the local Dota build ID: ${error.message}`); }

    for (const record of Object.values(this.storage.state.installedMods || {})) {
      if (!record || typeof record !== 'object' || record.modType === 'special_patch') continue;
      const entry = { id: record.id || record.modId || null, name: record.displayName || record.name || record.id || 'Mod', packagePresent: false, targetPresent: false, targetMatchesManifest: null, backupPresent: false, state: 'unknown', compatibility: 'unknown', loadInGame: 'unconfirmed', conflicts: Array.isArray(record.conflicts) ? record.conflicts : [] };
      try {
        const packagePath = path.join(this.library.packagesDirectory, path.basename(String(record.fileName || '')));
        const packageStat = await fs.stat(packagePath);
        entry.packagePresent = packageStat.isFile();
        entry.packageSize = packageStat.size;
        entry.packageHash = await sha256File(packagePath);
        const expected = record.contentHash || record.packageHash || null;
        const packageMatches = expected ? entry.packageHash === expected : null;
        const targetName = path.basename(String(record.gameFileName || record.deployedFileName || record.fileName || ''));
        const validTargetName = isPakFilename(targetName);
        if (validTargetName && gamePath) {
          const target = resolveVpkDeploymentTarget(gamePath, record.languageFolder || 'dota', targetName);
          const active = record.enabled === false ? `${target.path}.vanta-disabled` : target.path;
          try {
            const targetStat = await fs.stat(active);
            entry.targetPresent = targetStat.isFile();
            entry.targetPath = path.relative(gamePath, active).replace(/\\/g, '/');
            entry.targetHash = await sha256File(active);
            entry.targetMatchesManifest = expected ? entry.targetHash === expected : entry.targetHash === entry.packageHash;
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
          entry.deploymentMechanism = target.loader;
        }
        const manifestPath = path.join(this.library.manifestsDirectory, `${String(entry.id || '').replace(/[^a-z0-9._-]/gi, '_')}.json`);
        entry.backupPresent = Boolean(await fs.stat(manifestPath).then(() => true, () => false));
        if (!entry.packagePresent || packageMatches === false) entry.state = 'damaged';
        else if (!entry.targetPresent) entry.state = 'not_deployed';
        else if (entry.targetMatchesManifest === false) entry.state = 'modified';
        else entry.state = 'present_and_hash_verified';
      } catch (error) {
        entry.state = error.code === 'ENOENT' ? 'missing_package' : 'error';
        entry.error = error.message;
      }
      result.mods.push(entry);
    }

    const externalDirectories = new Set([path.join(gamePath, 'dota'), path.join(gamePath, `dota_${this.storage.state.settings.langSuffix || 'russian'}`)]);
    const owned = new Set(result.mods.map((item) => item.targetPath).filter(Boolean));
    for (const directory of externalDirectories) {
      let names = [];
      try { names = await fs.readdir(directory); } catch (error) { if (error.code !== 'ENOENT') result.errors.push(`Could not inspect ${path.basename(directory)}: ${error.message}`); }
      for (const name of names.filter((item) => /^pak\d+_dir\.vpk(?:\.off|\.moff|\.vanta-disabled)?$/i.test(item) && !/^pak01_dir\.vpk$/i.test(item))) {
        const relativePath = path.relative(gamePath, path.join(directory, name)).replace(/\\/g, '/');
        const normalized = relativePath.replace(/\.(?:off|moff|vanta-disabled)$/i, '');
        if (!owned.has(normalized)) result.externalVpks.push({ path: relativePath, ownership: 'unknown' });
      }
    }
    result.compatibility = { state: 'unknown', explanation: 'No trusted mod compatibility service is configured; local build ID alone does not prove mod compatibility.' };
    result.lastRunError = result.errors[0] || null;
    this.lastResult = result;
    return result;
  }
}

module.exports = { DotaDiagnosticsService, sha256File };
