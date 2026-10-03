const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { dotaGamePathCandidates, resolveDotaGamePath } = require('../src/infrastructure/steam-detector');

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