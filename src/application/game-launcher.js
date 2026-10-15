const STEAM_DOTA_URL = 'steam://rungameid/570';

async function launchDota({ platform = process.platform, shell } = {}) {
  if (!['linux', 'win32'].includes(platform)) throw new Error('Play is supported only on Windows and Linux.');
  if (!shell?.openExternal) throw new Error('Could not open Steam.');
  await shell.openExternal(STEAM_DOTA_URL);
  return { launched: true, platform };
}

module.exports = { STEAM_DOTA_URL, launchDota };
