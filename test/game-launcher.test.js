const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { BUNDLED_FIX_MATCHMAKING_PATH, FIX_MATCHMAKING_SHA256, launchDota, STEAM_DOTA_URL } = require('../src/application/game-launcher');

test('Linux Play opens Dota 2 through the Steam protocol without downloading a Windows script', async () => {
  const opened = [];
  const result = await launchDota({ platform: 'linux', shell: { openExternal: async (url) => opened.push(url) } });

  assert.deepEqual(opened, [STEAM_DOTA_URL]);
  assert.equal(result.launched, true);
  assert.equal(result.platform, 'linux');
});

test('Windows Play launches the bundled, verified batch script with safe cmd.exe quoting', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta launcher test-'));
  const started = [];
  const result = await launchDota({
    platform: 'win32',
    tempDirectory: root,
    spawnImpl: (...args) => { started.push(args); return { unref() {} }; },
  });
  const scriptPath = path.join(root, 'VANTA', 'FixMatchMaking.bat');
  assert.equal(result.scriptPath, scriptPath);
  const copiedBytes = await fs.readFile(scriptPath);
  assert.equal(crypto.createHash('sha256').update(copiedBytes).digest('hex'), FIX_MATCHMAKING_SHA256);
  assert.equal(started.length, 1);
  assert.equal(started[0][0], 'cmd.exe');
  assert.deepEqual(started[0][1], ['/d', '/s', '/c', `""${scriptPath}""`]);
  assert.equal(started[0][2].cwd, path.dirname(scriptPath));
  await fs.rm(root, { recursive: true, force: true });
});

test('Windows Play refuses a modified bundled script without starting a process', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-launcher-integrity-'));
  const modifiedScript = path.join(root, 'modified.bat');
  const started = [];
  await fs.copyFile(BUNDLED_FIX_MATCHMAKING_PATH, modifiedScript);
  await fs.appendFile(modifiedScript, '\necho changed\n');
  await assert.rejects(launchDota({
    platform: 'win32',
    tempDirectory: root,
    scriptSourcePath: modifiedScript,
    spawnImpl: (...args) => { started.push(args); return { unref() {} }; },
  }), /integrity check/i);
  assert.deepEqual(started, []);
  await fs.rm(root, { recursive: true, force: true });
});

test('bundled matchmaking script contains no browser advertising or insecure TLS bypass', async () => {
  const script = await fs.readFile(BUNDLED_FIX_MATCHMAKING_PATH, 'utf8');
  assert.doesNotMatch(script, /start\s+""\s+"https?:\/\//i);
  assert.doesNotMatch(script, /echo .*dota2changer\.com/i);
  assert.doesNotMatch(script, /curl .*\s-k\s/i);
  assert.match(script, /download_hash.*expected_hash/i);
});

test('Play rejects unsupported platforms', async () => {
  await assert.rejects(launchDota({ platform: 'darwin', shell: { openExternal: async () => {} } }), /only on Windows and Linux/i);
});
