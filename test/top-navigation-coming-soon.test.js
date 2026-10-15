const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const root = path.join(__dirname, '..');

test('World and Interface tabs use the normal section navigation without a Coming Soon dialog', async () => {
  const app = await fs.readFile(path.join(root, 'renderer/app.js'), 'utf8');
  const html = await fs.readFile(path.join(root, 'renderer/index.html'), 'utf8');

  assert.match(html, /class="top-tab" type="button" data-top="world"/);
  assert.match(html, /class="top-tab" type="button" data-top="interface"/);
  assert.match(app, /document\.querySelectorAll\('\.top-tab'\)\.forEach\(\(node\) => node\.onclick = \(\) => \{ state\.section = node\.dataset\.top;/);
  assert.match(app, /includeGeneratedCosmetics: requestedView === 'mods' && \['world', 'interface'\]\.includes\(requestedSection\)/);
  assert.match(app, /world: new Set\(\[[^\]]*'towers', 'weather'/);
  assert.doesNotMatch(app, /showComingSoonDialog/);
});