const fs = require('fs/promises');
const path = require('path');
const crypto = require('node:crypto');

async function safeRename(source, target) {
  if (!source || !target) return;
  if (path.resolve(source) === path.resolve(target)) return;
  await fs.rename(source, target);
}

class JsonStorage {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.file = path.join(rootDir, 'database', 'state.json');
    this.backupFile = `${this.file}.bak`;
    this.writeQueue = Promise.resolve();
    this.state = { settings: { langSuffix: 'russian', discordActivityEnabled: true, autoUpdateEnabled: true }, favorites: [], installedMods: {}, downloads: {}, customLoadouts: {}, savedPacks: [] };
  }

  async init() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    let primaryError = null;
    try {
      this.state = this.mergeState(await this.readStateFile(this.file));
    } catch (error) {
      if (error.code === 'ENOENT') {
        try {
          this.state = this.mergeState(await this.readStateFile(this.backupFile));
          await this.writeAtomically(this.file, `${JSON.stringify(this.state, null, 2)}\n`);
          return this.state;
        } catch (backupError) {
          if (backupError.code !== 'ENOENT') throw new Error(`VANTA state and its backup could not be read: ${backupError.message}`);
          await this.save();
          return this.state;
        }
      }
      primaryError = error;
    }
    if (primaryError) {
      try {
        this.state = this.mergeState(await this.readStateFile(this.backupFile));
        await this.writeAtomically(this.file, `${JSON.stringify(this.state, null, 2)}\n`);
      } catch (backupError) {
        throw new Error(`VANTA state is invalid (${primaryError.message}) and no valid backup could be recovered (${backupError.message}). The original files were left untouched.`);
      }
    }
    return this.state;
  }

  mergeState(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('State file must contain a JSON object.');
    return { ...this.state, ...parsed, settings: { ...this.state.settings, ...(parsed.settings || {}) } };
  }

  async readStateFile(filePath) {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('State file must contain a JSON object.');
    return parsed;
  }

  enqueueWrite(task) {
    const pending = this.writeQueue.then(task);
    this.writeQueue = pending.catch(() => {});
    return pending;
  }

  async writeAtomically(filePath, contents) {
    const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, contents);
      await safeRename(temp, filePath);
    } catch (error) {
      await fs.rm(temp, { force: true });
      throw error;
    }
  }

  async save() {
    return this.enqueueWrite(() => this.persistState());
  }

  async patch(changes) {
    return this.enqueueWrite(async () => {
      const previous = this.state;
      this.state = { ...previous, ...changes };
      try {
        await this.persistState();
        return this.state;
      } catch (error) {
        this.state = previous;
        throw error;
      }
    });
  }

  async persistState() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const serialized = `${JSON.stringify(this.state, null, 2)}\n`;
    try {
      const previous = await fs.readFile(this.file);
      await this.writeAtomically(this.backupFile, previous);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await this.writeAtomically(this.file, serialized);
    return this.state;
  }
}

module.exports = { JsonStorage, safeRename };