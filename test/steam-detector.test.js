const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseLibraryPaths, parseWindowsSteamRegistryPath } = require('../src/infrastructure/hero-grid-installer');
const { dotaGamePathCandidates, resolveDotaGamePath } = require('../src/infrastructure/steam-detector');

test('Windows Steam discovery accepts Patcher InstallPath registry values and parses extra libraries', () => {
  assert.equal(parseWindowsSteamRegistryPath('    InstallPath    REG_SZ    D:\\Games\\Steam\r\n'), 'D:\\Games\\Steam');
  assert.equal(parseWindowsSteamRegistryPath('    SteamPath    REG_EXPAND_SZ    %ProgramFiles(x86)%\\Steam\r\n'), '%ProgramFiles(x86)%\\Steam');
  assert.equal(parseWindowsSteamRegistryPath('ERROR: The system was unable to find the specified registry key or value.'), null);
  assert.deepEqual(parseLibraryPaths('"libraryfolders" { "1" { "path" "D:\\\\SteamLibrary" } }'), ['D:/SteamLibrary']);
});

test('Windows Dota folder selection normalizes game, Dota, app, and Steam library roots', async () => {
  const gamePath = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\dota 2 beta\\game';
  const expectedPak = path.win32.join(gamePath, 'dota', 'pak01_dir.vpk');
  const exists = async (filePath) => path.win32.normalize(filePath).toLowerCase() === expectedPak.toLowerCase();

  for (const selected of [
    gamePath,
    path.win32.join(gamePath, 'dota'),
    path.win32.dirname(gamePath),
    path.win32.dirname(path.win32.dirname(gamePath)),
    path.win32.dirname(path.win32.dirname(path.win32.dirname(gamePath))),
  ]) {
    assert.equal(await resolveDotaGamePath(selected, { platform: 'win32', existsImpl: exists }), gamePath);
  }
  assert.ok(dotaGamePathCandidates(path.win32.join(gamePath, 'dota'), 'win32').includes(gamePath));
});

test('invalid Windows Dota path is rejected instead of being trusted as a game folder', async () => {
  assert.equal(await resolveDotaGamePath('C:\\Program Files (x86)\\steamapps\\common\\dota 2 beta\\game', {
    platform: 'win32',
    existsImpl: async () => false,
  }), null);
});