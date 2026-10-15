const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeModManifest } = require('../core/vanta-mod');

class VantaModLibrary {
  constructor({ rootDir, storage, installer }) {
    this.rootDir = rootDir;
    this.storage = storage;
    this.installer = installer;
    this.directory = path.join(rootDir, 'VantaMods');
    this.packagesDirectory = path.join(this.directory, 'packages');
    this.stagingDirectory = path.join(this.directory, 'staging');
    this.backupsDirectory = path.join(this.directory, 'backups');
  }

  async init() {
    await Promise.all([this.packagesDirectory, this.stagingDirectory, this.backupsDirectory].map((directory) => fs.mkdir(directory, { recursive: true })));
    return this.list();
  }

  list() {
    return Object.values(this.storage.state.installedMods || {})
      .filter((record) => record && typeof record === 'object' && !Array.isArray(record))
      .map((record) => normalizeModManifest(record));
  }

  get(id) {
    const record = this.storage.state.installedMods?.[id];
    return record && typeof record === 'object' ? normalizeModManifest(record) : null;
  }

  async importVpk(filePath, metadata = {}) {
    if (!this.installer) throw new Error('VANTA installer is not available.');
    return this.installer.importVpk(filePath, metadata);
  }
}

module.exports = { VantaModLibrary };
