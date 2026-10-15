const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('library cards expose styled leftmost checkboxes and keep skin removal visible during bulk selection', async () => {
  const [ui, controlsCss, bulkCss, themeCss] = await Promise.all([
    fs.readFile(path.join(root, 'renderer/library-unified-ui.js'), 'utf8'),
    fs.readFile(path.join(root, 'renderer/library-controls.css'), 'utf8'),
    fs.readFile(path.join(root, 'renderer/library-bulk.css'), 'utf8'),
    fs.readFile(path.join(root, 'renderer/themes.css'), 'utf8'),
  ]);

  assert.match(ui, /data-library-select="\$\{libraryEscape\(id\)\}"/);
  assert.match(ui, /const checkbox = isPinnedPatch \? '' :/);
  assert.match(ui, /\$\{checkbox\}\$\{dragHandle\}/);
  assert.match(ui, /input\.onchange = \(\) => \{ input\.checked \? state\.librarySelection\.add\(input\.dataset\.librarySelect\) : state\.librarySelection\.delete\(input\.dataset\.librarySelect\); renderLibrary\(\); \}/);
  assert.match(controlsCss, /\.library-check/);
  assert.match(themeCss, /#content \.library-check span \{[^}]*var\(--theme-border/);
  assert.match(themeCss, /#content \.library-check input:checked \+ span \{[^}]*var\(--theme-accent/);
  assert.match(themeCss, /#content \.library-check input:focus-visible \+ span/);
  assert.match(bulkCss, /#content:has\(\.library-bulk\.has-selection\) \.library-generated-cosmetic-item \.library-mod-actions \{ display: flex !important; \}/);
  assert.match(ui, /id="library-reinstall"/);
  assert.match(ui, /id="library-save-skin-set"/);
  assert.match(ui, /data-skin-preset-apply=/);
  assert.match(ui, /call\('library:reinstall-mods'\)/);
  assert.match(ui, /call\('cosmetics:preset-save'/);
  assert.match(ui, /call\('cosmetics:preset-apply'/);
});

test('saved skin-set contents can be inspected and individual mods removed with an accessible control', async () => {
  const [ui, css] = await Promise.all([
    fs.readFile(path.join(root, 'renderer/library-unified-ui.js'), 'utf8'),
    fs.readFile(path.join(root, 'renderer/library-pack-ui.css'), 'utf8'),
  ]);
  assert.match(ui, /data-skin-preset-view=/);
  assert.match(ui, /skin-preset-contents-dialog/);
  assert.match(ui, /data-preset-remove-slot=/);
  assert.match(ui, /cosmetics:preset-remove-pick/);
  assert.match(css, /\.skin-preset-mod-card:hover \.skin-preset-mod-remove/);
  assert.match(css, /#ff777f|#bd3945/);
});

test('hero Library entries are grouped by alphabetical hero labels', async () => {
  const ui = await fs.readFile(path.join(root, 'renderer/library-unified-ui.js'), 'utf8');
  assert.match(ui, /function libraryHeroSections\(items, row\)/);
  assert.match(ui, /left\.name\.localeCompare\(right\.name, 'en', \{ sensitivity: 'base' \}\)/);
  assert.match(ui, /libraryFilterForItem\(item\) === 'heroes' \? 'heroes'/);
  assert.match(ui, /— \$\{libraryEscape\(hero\.name\)\} —/);
});

test('generated skin entries show one hero-slot line with an optional localized Unusual effect', async () => {
  const ui = await fs.readFile(path.join(root, 'renderer/library-unified-ui.js'), 'utf8');
  const context = vm.createContext({
    window: {},
    state: {
      data: {
        settings: { appLanguage: 'ru', cosmeticLoadout: {
          'item:anti_mage:armor': { itemId: '123', styleId: '1', effectId: 'fire' },
          'item:axe:weapon': { itemId: '456' },
        } },
        cosmetics: { heroes: [
          { key: 'anti_mage', name: 'Anti Mage', slots: [{ id: 'item:anti_mage:armor', name: 'Броня', options: [{ id: '123', styleId: '1', name: 'Armor of the Lost', previewUrl: null }] }] },
          { key: 'axe', name: 'Axe', slots: [{ id: 'item:axe:weapon', name: 'Оружие', options: [{ id: '456', name: 'Axe Weapon', previewUrl: null }] }] },
        ] },
      },
    },
    normalizeHeroId: (value) => String(value || '').toLowerCase(),
    slotLabel: (value) => value,
    cosmeticEffectLabel: (effectId) => effectId === 'fire' ? 'Огонь' : effectId,
  });
  vm.runInContext(ui, context, { filename: 'library-unified-ui.js' });
  const entries = context.libraryGeneratedCosmeticItems();

  assert.deepEqual(JSON.parse(JSON.stringify(entries.map(({ heroLabel, slot, unusualEffect }) => ({ heroLabel, slot, unusualEffect })))), [
    { heroLabel: 'Anti Mage', slot: 'Броня', unusualEffect: 'Огонь' },
    { heroLabel: 'Axe', slot: 'Оружие', unusualEffect: '' },
  ]);
  assert.match(ui, /\[item\.heroLabel, librarySlotLabel\(item\.slot\), item\.unusualEffect\]\.filter\(Boolean\)/);
  assert.match(ui, /const patchInfo = generatedCosmetic \? ''/);
  assert.match(ui, /\$\{metadata \? `<small>\$\{metadata\}<\/small>` : ''\}/);
});