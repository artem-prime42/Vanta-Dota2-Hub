const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const root = path.join(__dirname, '..');

test('World and Interface tabs open the localized coming-soon dialog', async () => {
  const app = await fs.readFile(path.join(root, 'renderer/app.js'), 'utf8');
  const html = await fs.readFile(path.join(root, 'renderer/index.html'), 'utf8');
  const styles = await fs.readFile(path.join(root, 'renderer/styles.css'), 'utf8');

  assert.match(html, /class="top-tab" type="button" data-top="world"/);
  assert.match(html, /class="top-tab" type="button" data-top="interface"/);
  assert.match(app, /\.top-tab\[data-top="world"\], \.top-tab\[data-top="interface"\]/);
  assert.match(app, /node\.onclick = \(\) => showComingSoonDialog\(node\.dataset\.top\)/);
  assert.match(app, /isRussian \? 'В разработке' : 'Under development'/);
  assert.match(app, /isRussian \? 'Ок' : 'OK'/);
  assert.match(app, /aria-describedby', 'coming-soon-message'/);
  assert.match(app, /dialog\.addEventListener\('cancel'/);
  assert.match(styles, /\.coming-soon-dialog/);
  assert.match(styles, /@keyframes coming-soon-glow/);
  assert.match(styles, /prefers-reduced-motion: reduce\) \{ \.coming-soon-icon/);
});