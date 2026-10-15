const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const BUNDLED_FIX_MATCHMAKING_PATH = path.join(__dirname, '..', 'data', 'FixMatchMaking.bat');

const FIX_MATCHMAKING_SHA256 = '9a3479a3df0933fc0f5c8a31510bebebd34edd6b74158dcd75fb6e5fbbd70c28';
const STEAM_DOTA_URL = 'steam://rungameid/570';
const MAX_SCRIPT_BYTES = 1024 * 1024;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function launchDota({ platform = process.platform, shell, spawnImpl = spawn, tempDirectory = require('node:os').tmpdir(), scriptSourcePath = BUNDLED_FIX_MATCHMAKING_PATH } = {}) {
  if (platform === 'linux') {
    if (!shell?.openExternal) throw new Error('Could not open Steam.');
    await shell.openExternal(STEAM_DOTA_URL);
    return { launched: true, platform };
  }
  if (platform !== 'win32') throw new Error('Play is supported only on Windows and Linux.');
  const bytes = await fs.readFile(scriptSourcePath);
  if (!bytes.length || bytes.length > MAX_SCRIPT_BYTES || sha256(bytes) !== FIX_MATCHMAKING_SHA256) {
    throw new Error('FixMatchMaking.bat failed its integrity check; it was not run.');
  }

  const scriptDirectory = path.join(tempDirectory, 'VANTA');
  const scriptPath = path.join(scriptDirectory, 'FixMatchMaking.bat');
  await fs.mkdir(scriptDirectory, { recursive: true });
  await fs.writeFile(scriptPath, bytes, { mode: 0o600 });
  if (sha256(await fs.readFile(scriptPath)) !== FIX_MATCHMAKING_SHA256) {
    await fs.rm(scriptPath, { force: true });
    throw new Error('FixMatchMaking.bat failed its integrity check; it was not run.');
  }

  const command = `""${scriptPath}""`;
  const child = spawnImpl('cmd.exe', ['/d', '/s', '/c', command], {
    cwd: scriptDirectory,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.once?.('error', (error) => { console.error('[game:play] Could not start FixMatchMaking.bat:', error); });
  child.unref?.();
  return { launched: true, platform, scriptPath };
}

module.exports = { BUNDLED_FIX_MATCHMAKING_PATH, FIX_MATCHMAKING_SHA256, STEAM_DOTA_URL, launchDota };
