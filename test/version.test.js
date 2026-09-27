const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const root = path.join(__dirname, '..');

test('app version is set to 2.0.6 and displayed in settings', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.6');

  const settingsMarkup = await fs.readFile(path.join(root, 'renderer', 'settings-page.js'), 'utf8');
  const appService = await fs.readFile(path.join(root, 'src', 'main', 'services', 'app-service.js'), 'utf8');
  const mainProcess = await fs.readFile(path.join(root, 'src', 'main', 'index.js'), 'utf8');
  assert.match(settingsMarkup, /Version|Версия/);
  assert.match(settingsMarkup, /state\.data\.appVersion/);
  assert.match(appService, /appVersion: this\.appVersion \|\| null/);
  assert.match(mainProcess, /service\.appVersion = app\.getVersion\(\)/);
});
