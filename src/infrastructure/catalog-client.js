const fs = require('fs/promises');
const path = require('path');
const { flattenCatalog, normalizeAuthor, normalizeMod } = require('../core/models');

class CatalogClient {
  constructor({ rootDir } = {}) {
    this.rootDir = rootDir;
    this.cacheDir = path.join(rootDir, 'cache');
    this.cacheFile = path.join(this.cacheDir, 'catalog.json');
    this.metaFile = path.join(this.cacheDir, 'catalog-meta.json');
    this.mods = [];
    this.themes = [];
    this.authors = [];
    this.meta = { revision: null, updatedAt: null, offline: false };
    this.lastAttemptAt = null;
    this.lastError = null;
  }

  async load() {
    this.lastAttemptAt = new Date().toISOString();
    await fs.mkdir(this.cacheDir, { recursive: true });
    try { await this.loadCache(); }
    catch (error) {
      if (error.code !== 'ENOENT') console.warn(`[catalog] Cached catalog could not be loaded: ${error.message}`);
      this.mods = [];
      this.themes = [];
    }
    this.lastError = null;
    this.meta.offline = true;
    await this.loadAuthors();
    return { mods: this.mods, themes: this.themes, meta: { ...this.meta, offline: true, source: 'local-cache' } };
  }

  async loadCache() {
    const payload = JSON.parse(await fs.readFile(this.cacheFile, 'utf8'));
    this.mods = flattenCatalog(payload);
    this.themes = Array.isArray(payload?.themes) ? payload.themes.filter((theme) => theme && typeof theme === 'object' && !Array.isArray(theme)) : [];
    try { this.meta = { ...this.meta, ...JSON.parse(await fs.readFile(this.metaFile, 'utf8')) }; } catch {}
    return this.mods;
  }

  async loadAuthors() {
    const authorsFile = path.join(this.cacheDir, 'authors.json');
    try { this.authors = JSON.parse(await fs.readFile(authorsFile, 'utf8')).map(normalizeAuthor).filter(Boolean); }
    catch { this.authors = []; }
  }

  async exists(file) { try { await fs.access(file); return true; } catch { return false; } }
  getMod(id) {
    const mod = this.mods.find((item) => item.id === id);
    if (mod) return mod;
    const theme = this.themes.find((item) => item?.id === id);
    return theme ? normalizeMod({ ...theme, file: theme.downloadUrl || theme.file, preview: theme.previewUrl || theme.preview, categoryId: 'themes', modType: 'theme' }) : null;
  }
  getCategories() { return [...new Set(this.mods.map((mod) => mod.categoryId))].sort(); }
}

module.exports = { CatalogClient };