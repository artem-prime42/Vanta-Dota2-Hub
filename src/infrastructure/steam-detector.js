const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { discoverSteamRoots } = require('./hero-grid-installer');

function libraryPaths(text) {
  return [...String(text || '').matchAll(/"path"\s+"([^"]+)"/g)].map((match) => match[1].replace(/\\\\/g, path.sep));
}

async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }

function dotaGamePathCandidates(selectedPath, platform = process.platform) {
  if (!selectedPath) return [];
  const pathApi = platform === 'win32' ? path.win32 : path;
  const selected = pathApi.resolve(String(selectedPath).replace(/[\\/]+$/, ''));
  const candidates = [selected];
  const basename = pathApi.basename(selected).toLowerCase();
  if (basename === 'dota') candidates.push(pathApi.dirname(selected));
  if (basename === 'dota 2 beta') candidates.push(pathApi.join(selected, 'game'));
  if (basename === 'common') candidates.push(pathApi.join(selected, 'dota 2 beta', 'game'));
  if (basename === 'steamapps') candidates.push(pathApi.join(selected, 'common', 'dota 2 beta', 'game'));
  candidates.push(pathApi.join(selected, 'game'));
  candidates.push(pathApi.join(selected, 'steamapps', 'common', 'dota 2 beta', 'game'));
  candidates.push(pathApi.join(selected, 'common', 'dota 2 beta', 'game'));
  return [...new Set(candidates.map((candidate) => pathApi.normalize(candidate)))];
}

async function resolveDotaGamePath(selectedPath, { platform = process.platform, existsImpl = exists } = {}) {
  const pathApi = platform === 'win32' ? path.win32 : path;
  for (const candidate of dotaGamePathCandidates(selectedPath, platform)) {
    if (await existsImpl(pathApi.join(candidate, 'dota', 'pak01_dir.vpk'))) return candidate;
  }
  return null;
}

async function detectDotaInstallation({ libraries: librariesOverride = null, platform = process.platform, home = os.homedir(), env = process.env, existsImpl = exists } = {}) {
  const libraries = librariesOverride || await discoverSteamRoots({ platform, home, env });
  const seen = new Set();
  for (const library of libraries) {
    const game = path.join(library, 'steamapps/common/dota 2 beta/game');
    const direct = path.join(library, 'dota');
    for (const candidate of [game, library]) {
      const normalized = path.resolve(candidate);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const dotaPath = path.join(candidate, 'dota');
      const pak01Path = path.join(dotaPath, 'pak01_dir.vpk');
      if (await existsImpl(pak01Path)) {
        const vpkFiles = [];
        try {
          const entries = await fs.readdir(dotaPath);
          for (const entry of entries) {
            if (/\.vpk$/i.test(entry) && /_dir\.vpk$/i.test(entry)) vpkFiles.push(path.join(dotaPath, entry));
          }
        } catch {}
        return { detected: true, gamePath: candidate, dotaPath, pak01Path, vpkFiles };
      }
      if (await existsImpl(dotaPath) && candidate === direct) {
        return { detected: true, gamePath: candidate, dotaPath, pak01Path: path.join(dotaPath, 'pak01_dir.vpk'), vpkFiles: [] };
      }
    }
  }
  return { detected: false, gamePath: null, dotaPath: null, pak01Path: null, vpkFiles: [] };
}

async function detectDota() {
  const result = await detectDotaInstallation();
  if (!result.detected) return null;
  return { gamePath: result.gamePath, dotaPath: result.dotaPath };
}

async function validateDota(gamePath) {
  return Boolean(await resolveDotaGamePath(gamePath));
}

module.exports = { detectDota, detectDotaInstallation, dotaGamePathCandidates, resolveDotaGamePath, validateDota };