const crypto = require('node:crypto');
const { URL } = require('node:url');

function validateIndex(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.schemaVersion !== 1 || !Array.isArray(payload.mods)) {
    throw new Error('R2 index must use schemaVersion 1 and contain a mods array.');
  }
  const ids = new Set();
  return payload.mods.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('R2 index contains an invalid mod record.');
    const id = String(entry.id || '');
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(id) || id.includes('..') || ids.has(id)) throw new Error(`R2 index contains an invalid or duplicate ID: ${id}`);
    ids.add(id);
    const releases = Array.isArray(entry.releases) ? entry.releases.map((release) => {
      const version = String(release?.version || '');
      const url = String(release?.url || '');
      const sha256 = String(release?.sha256 || '').toLowerCase();
      const size = Number(release?.size);
      let parsed;
      try { parsed = new URL(url); } catch { throw new Error(`R2 release ${id}@${version} has an invalid URL.`); }
      if (!version || parsed.protocol !== 'https:' || !/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(size) || size <= 0) {
        throw new Error(`R2 release ${id}@${version || '?'} must include HTTPS URL, positive size, and SHA-256.`);
      }
      return { version, url: parsed.href, sha256, size, gameBuildIds: Array.isArray(release.gameBuildIds) ? release.gameBuildIds.map(String) : [] };
    }) : [];
    return {
      id,
      name: String(entry.name || id),
      description: String(entry.description || ''),
      categoryId: String(entry.categoryId || 'other'),
      modType: 'local_vpk',
      author: entry.author ? String(entry.author) : null,
      image: entry.image || null,
      releases,
    };
  });
}

class R2Provider {
  constructor({ indexUrl = '', fetchImpl = globalThis.fetch } = {}) {
    this.indexUrl = String(indexUrl || '').trim();
    this.fetchImpl = fetchImpl;
    this.lastError = null;
  }

  getStatus() {
    return { configured: Boolean(this.indexUrl), indexUrl: this.indexUrl || null, available: false, error: this.lastError };
  }

  async list() {
    if (!this.indexUrl) return { configured: false, mods: [], error: 'R2 public index URL is not configured.' };
    let index;
    try { index = new URL(this.indexUrl); } catch { throw new Error('R2 index URL is invalid.'); }
    if (index.protocol !== 'https:') throw new Error('R2 public index URL must use HTTPS.');
    try {
      const response = await this.fetchImpl(index.href, { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error(`R2 index request failed with HTTP ${response.status}.`);
      const mods = validateIndex(await response.json());
      this.lastError = null;
      return { configured: true, mods };
    } catch (error) {
      this.lastError = error.message;
      throw error;
    }
  }

  async getRelease(mod, version) {
    const result = await this.list();
    const remoteMod = result.mods.find((item) => item.id === mod);
    if (!remoteMod) throw new Error(`Mod ${mod} is not present in the configured R2 index.`);
    const release = version
      ? remoteMod.releases.find((item) => item.version === String(version))
      : remoteMod.releases.at(-1);
    if (!release) throw new Error(`No requested release is available for ${mod}.`);
    return { mod: remoteMod, release };
  }

  async verifyPackage(filePath, release) {
    const fs = require('node:fs/promises');
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size !== release.size) throw new Error('Downloaded R2 package size does not match its index metadata.');
    const hashState = crypto.createHash('sha256');
    const stream = require('node:fs').createReadStream(filePath);
    await new Promise((resolve, reject) => { stream.on('data', (chunk) => hashState.update(chunk)); stream.on('error', reject); stream.on('end', resolve); });
    const hash = hashState.digest('hex');
    if (hash !== release.sha256) throw new Error('Downloaded R2 package SHA-256 does not match its index metadata.');
    return { size: stat.size, sha256: hash };
  }
}

module.exports = { R2Provider, validateIndex };
