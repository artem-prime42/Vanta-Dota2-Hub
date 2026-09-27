const fs = require('fs/promises');
const { constants } = require('node:fs');
const path = require('path');

const LEGACY_APP_DATA_NAMES = ['VANTA', 'VANTA DOTA2 HUB', 'VANTA Dota', 'vanta-dota2-hub', 'vanta-dota'];
const COPY_DIRECTORIES = ['cache', 'database/library', 'database/saved-packs', 'downloads'];

async function readState(filePath) {
  try {
    return { state: JSON.parse(await fs.readFile(filePath, 'utf8')), exists: true };
  } catch (error) {
    if (error.code === 'ENOENT') return { state: null, exists: false };
    return { state: null, exists: true, error: error.message };
  }
}

function stateHasUserData(state) {
  if (!state || typeof state !== 'object') return false;
  const settings = state.settings || {};
  return Boolean(
    Object.keys(state.installedMods || {}).length ||
    (state.favorites || []).length ||
    (state.savedPacks || []).length ||
    (state.downloads && Object.keys(state.downloads).length) ||
    settings.gamePath ||
    settings.langSuffix && settings.langSuffix !== 'russian' ||
    settings.appLanguage ||
    settings.interfaceScale ||
    settings.heroGridSelection,
  );
}

function normalizeForCompare(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function copyMissingTree(source, destination) {
  let entries;
  try { entries = await fs.readdir(source, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  await fs.mkdir(destination, { recursive: true });
  let copied = false;
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copied = await copyMissingTree(from, to) || copied;
    } else if (entry.isFile()) {
      try { await fs.access(to); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await fs.copyFile(from, to, constants.COPYFILE_EXCL);
        copied = true;
      }
    }
  }
  return copied;
}

async function migrateLegacyUserData(rootDir) {
  const root = path.resolve(rootDir);
  const parent = path.dirname(root);
  const seen = new Set([normalizeForCompare(root)]);
  const legacyRoots = LEGACY_APP_DATA_NAMES.map((name) => path.join(parent, name)).filter((candidate) => {
    const normalized = normalizeForCompare(candidate);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
  const destinationStatePath = path.join(root, 'database', 'state.json');
  const destinationState = await readState(destinationStatePath);
  const candidates = [];
  for (const legacyRoot of legacyRoots) {
    const result = await readState(path.join(legacyRoot, 'database', 'state.json'));
    if (result.state && stateHasUserData(result.state)) {
      const state = result.state;
      const score = Object.keys(state.installedMods || {}).length * 100 + (state.savedPacks || []).length * 20 + (state.favorites || []).length * 5 + (state.settings?.gamePath ? 1 : 0);
      candidates.push({ root: legacyRoot, state, score });
    }
  }
  candidates.sort((left, right) => right.score - left.score);

  let migratedStateFrom = null;
  if ((!destinationState.exists || destinationState.state && !stateHasUserData(destinationState.state)) && candidates.length) {
    const selected = candidates[0];
    await fs.mkdir(path.dirname(destinationStatePath), { recursive: true });
    if (destinationState.exists) {
      const backupPath = `${destinationStatePath}.before-legacy-migration`;
      try { await fs.copyFile(destinationStatePath, backupPath, constants.COPYFILE_EXCL); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    await fs.copyFile(path.join(selected.root, 'database', 'state.json'), destinationStatePath);
    migratedStateFrom = selected.root;
  }

  const copiedFrom = [];
  for (const legacyRoot of legacyRoots) {
    let copied = false;
    for (const directory of COPY_DIRECTORIES) {
      copied = await copyMissingTree(path.join(legacyRoot, directory), path.join(root, directory)) || copied;
    }
    const legacyManifest = path.join(legacyRoot, 'manifest.json');
    const destinationManifest = path.join(root, 'manifest.json');
    try {
      await fs.access(destinationManifest);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { await fs.copyFile(legacyManifest, destinationManifest, constants.COPYFILE_EXCL); copied = true; } catch (copyError) { if (copyError.code !== 'ENOENT') throw copyError; }
    }
    if (copied || migratedStateFrom === legacyRoot) copiedFrom.push(legacyRoot);
  }

  const result = { migratedStateFrom: migratedStateFrom ? path.basename(migratedStateFrom) : null, copiedFrom: copiedFrom.map((legacyRoot) => path.basename(legacyRoot)), legacyRootsChecked: legacyRoots.map((legacyRoot) => path.basename(legacyRoot)) };
  if (copiedFrom.length) console.info(`[migration] Imported missing user data from: ${copiedFrom.join(', ')}`);
  return result;
}

module.exports = { LEGACY_APP_DATA_NAMES, migrateLegacyUserData, stateHasUserData };
