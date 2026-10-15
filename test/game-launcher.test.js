const test = require('node:test');
const assert = require('node:assert/strict');
const { launchDota, STEAM_DOTA_URL } = require('../src/application/game-launcher');

for (const platform of ['win32', 'linux']) {
  test(`${platform} Play opens Dota 2 through Steam without modifying game files`, async () => {
    const opened = [];
    const result = await launchDota({ platform, shell: { openExternal: async (url) => opened.push(url) } });

    assert.deepEqual(opened, [STEAM_DOTA_URL]);
    assert.equal(result.launched, true);
    assert.equal(result.platform, platform);
  });
}

test('Play reports a useful error when Steam protocol cannot be opened', async () => {
  await assert.rejects(launchDota({ platform: 'win32' }), /Could not open Steam/i);
});

test('Play rejects unsupported platforms', async () => {
  await assert.rejects(launchDota({ platform: 'darwin', shell: { openExternal: async () => {} } }), /only on Windows and Linux/i);
});
