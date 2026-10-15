const path = require('node:path');

function normalizeLanguageFolder(value = 'dota') {
  const folder = String(value || 'dota').trim();
  if (folder.toLowerCase() === 'dota' || /^dota_[a-z0-9_-]+$/i.test(folder)) return folder;
  if (!/^[a-z0-9_-]+$/i.test(folder)) throw new Error('Dota language folder is invalid.');
  return `dota_${folder}`;
}

function resolveVpkDeploymentTarget(gamePath, languageFolder, fileName) {
  if (!gamePath) throw new Error('Dota 2 installation is not configured.');
  const safeName = String(fileName || '');
  if (!/^pak(?:0[2-9]|[1-9]\d)_dir\.vpk$/i.test(safeName)) throw new Error('Only managed pak02_dir.vpk–pak99_dir.vpk files may be deployed.');
  const root = path.resolve(gamePath, normalizeLanguageFolder(languageFolder));
  return { root, path: path.join(root, safeName), loader: 'Source 2 Game_Language mount (dota_*LANGUAGE*)', confirmedBy: 'existing VANTA deployment contract; runtime resource visibility remains unconfirmed' };
}

module.exports = { normalizeLanguageFolder, resolveVpkDeploymentTarget };
