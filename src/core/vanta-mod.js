const crypto = require('node:crypto');

const MANIFEST_VERSION = 1;
const SOURCES = new Set(['import', 'generated', 'r2', 'legacy']);
const INSTALL_STATES = new Set(['library', 'installed', 'missing', 'modified', 'error', 'update_required']);
const COMPATIBILITY_STATES = new Set(['confirmed', 'unknown', 'incompatible']);

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function stableImportedId(contentHash) {
  if (!/^[a-f0-9]{64}$/i.test(String(contentHash || ''))) throw new Error('A SHA-256 hash is required to create a stable imported mod ID.');
  return `import-${String(contentHash).toLowerCase().slice(0, 24)}`;
}

function normalizeModManifest(raw = {}) {
  const id = String(raw.id || raw.modId || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(id) || id.includes('..')) throw new Error('Mod manifest contains an invalid ID.');
  const source = SOURCES.has(raw.source) ? raw.source : 'legacy';
  const files = (Array.isArray(raw.files) ? raw.files : []).filter((file) => file && typeof file === 'object').map((file) => ({
    path: String(file.path || file.name || ''),
    size: Number.isSafeInteger(Number(file.size)) && Number(file.size) >= 0 ? Number(file.size) : null,
    sha256: /^[a-f0-9]{64}$/i.test(String(file.sha256 || '')) ? String(file.sha256).toLowerCase() : null,
  }));
  return {
    ...raw,
    schemaVersion: MANIFEST_VERSION,
    id,
    name: String(raw.name || raw.displayName || id),
    description: String(raw.description || ''),
    categoryId: String(raw.categoryId || raw.category || 'other'),
    modType: String(raw.modType || (raw.type === 'pack' ? 'pack' : 'local_vpk')),
    image: raw.image || raw.previewUrl || null,
    author: raw.author || null,
    version: String(raw.version || 'unknown'),
    installedAt: raw.installedAt || null,
    updatedAt: raw.updatedAt || null,
    source,
    sourcePackage: raw.sourcePackage && typeof raw.sourcePackage === 'object' ? Object.fromEntries(['kind', 'url', 'version', 'fileName', 'archiveEntryName', 'releaseSha256', 'packageSize', 'sourceModIds', 'importedAt'].filter((key) => raw.sourcePackage[key] !== undefined).map((key) => [key, raw.sourcePackage[key]])) : null,
    files,
    contentHash: /^[a-f0-9]{64}$/i.test(String(raw.contentHash || '')) ? String(raw.contentHash).toLowerCase() : null,
    installState: INSTALL_STATES.has(raw.installState) ? raw.installState : (raw.targetRoot ? 'installed' : 'library'),
    enabled: raw.enabled === true,
    fileName: raw.fileName || null,
    gameFileName: raw.gameFileName || raw.deployedFileName || null,
    targetRoot: raw.targetRoot || null,
    compatibility: {
      state: COMPATIBILITY_STATES.has(raw.compatibility?.state) ? raw.compatibility.state : 'unknown',
      gameBuildId: raw.compatibility?.gameBuildId || null,
      note: raw.compatibility?.note || 'Compatibility with the current Dota 2 build has not been confirmed.',
    },
    conflicts: Array.isArray(raw.conflicts) ? [...raw.conflicts] : [],
    actions: Array.isArray(raw.actions) ? [...raw.actions] : [],
    lastOperationError: raw.lastOperationError || null,
    type: raw.type === 'pack' ? 'pack' : 'mod',
    priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : null,
    languageFolder: raw.languageFolder || null,
    deployedFileName: raw.deployedFileName || raw.gameFileName || null,
    installedFiles: Array.isArray(raw.installedFiles) ? raw.installedFiles.map(String) : [],
    sourceModIds: Array.isArray(raw.sourceModIds) ? raw.sourceModIds.map(String) : [],
    sourceMods: Array.isArray(raw.sourceMods) ? raw.sourceMods : [],
    packMods: Array.isArray(raw.packMods) ? raw.packMods : [],
  };
}

module.exports = { COMPATIBILITY_STATES, INSTALL_STATES, MANIFEST_VERSION, SOURCES, normalizeModManifest, sha256, stableImportedId };
