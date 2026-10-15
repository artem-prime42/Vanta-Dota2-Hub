const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createRendererContext(call) {
  const content = { innerHTML: 'Mods page' };
  const state = { view: 'cosmetics', hero: '', data: { cosmetics: { loaderInstalled: true, picks: {} } } };
  const window = {};
  const context = vm.createContext({
    window,
    state,
    call,
    $: () => content,
    escapeHtml: (value) => String(value ?? ''),
    t: (_key, fallback) => fallback,
    toast: () => {},
    formatTranslation: (message) => message,
    showAppConfirmDialog: async () => ({ confirmed: true }),
  });
  const source = fs.readFileSync(path.join(__dirname, '../renderer/cosmetics-ui.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'cosmetics-ui.js' });
  return { context, content, state, window };
}

test('late cosmetics list response cannot replace the Mods page', async () => {
  let resolveList;
  let calls = 0;
  const { content, state, window } = createRendererContext(() => {
    calls += 1;
    return new Promise((resolve) => { resolveList = resolve; });
  });

  const loading = window.loadCosmeticsView();
  state.view = 'mods';
  resolveList({ heroes: [], picks: {} });
  await loading;

  assert.equal(calls, 1);
  assert.equal(content.innerHTML, 'Mods page');
});

test('late cosmetics apply response cannot replace the Mods page with the old cosmetics screen', async () => {
  let resolveApply;
  const { context, content, state } = createRendererContext(() => new Promise((resolve) => { resolveApply = resolve; }));

  const applying = context.applyCosmeticsLoadout({});
  state.view = 'mods';
  resolveApply({ picks: {}, heroes: [], discardedPicks: [] });
  await applying;

  assert.equal(content.innerHTML, 'Mods page');
});

test('cosmetic cards preserve style IDs and render Infused quality as a distinct badge', () => {
  const source = fs.readFileSync(path.join(__dirname, '../renderer/cosmetics-ui.js'), 'utf8');
  assert.match(source, /data-cosmetic-style="\$\{cosmeticsHtml\(option\.styleId \?\? ''\)\}"/);
  assert.match(source, /data-inline-cosmetic-style="\$\{cosmeticsHtml\(option\.styleId \?\? ''\)\}"/);
  assert.match(source, /infused: 'Infused'/);
  assert.match(source, /cosmeticPickStyleId\(draft\[option\.slotId\]\) === String\(option\.styleId \?\? ''\)/);
  assert.match(source, /if \(id === '0' && \(!label \|\| \/\^style\\s\*0\$\/i\.test\(label\)\)\) return ''/);
  assert.match(source, /data-preview-fallback="\$\{cosmeticsHtml\(fallback\)\}"/);
  assert.match(source, /function bindCosmeticImageFallbacks\(selector\)/);
  assert.match(source, /const canApply = changed \|\| selectedCount > 0/);
  assert.match(source, /function cosmeticSelectionForVariant\(previous, itemId, styleId\)/);
  assert.match(source, /data-cosmetic-effect-slot="\$\{cosmeticsHtml\(option\.slotId\)\}"/);
  assert.match(source, /data-inline-effect-slot="\$\{cosmeticsHtml\(option\.slotId\)\}"/);
  assert.doesNotMatch(source, /skin-card-native-effects/);
  assert.match(source, /data-effect-cancel>\$\{cosmeticsText\('Отмена', 'Cancel'\)\}/);
  assert.doesNotMatch(source, /data-effect-cancel">/);
  assert.doesNotMatch(source, /\$\{selected \? `<button type="button" class="skin-card-effect-button"/);
});

test('choosing another style of the same item keeps its unusual effect selection', () => {
  const source = fs.readFileSync(path.join(__dirname, '../renderer/cosmetics-ui.js'), 'utf8');
  const context = vm.createContext({ window: {}, escapeHtml: (value) => String(value ?? '') });
  vm.runInContext(source, context, { filename: 'cosmetics-ui.js' });
  const previous = { itemId: 'arcana', styleId: '1', effectId: 'fire' };
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.cosmeticSelectionForVariant(previous, 'arcana', '2'))),
    { itemId: 'arcana', styleId: '2', effectId: 'fire' },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.cosmeticSelectionForVariant(previous, 'new-head-item', ''))),
    'new-head-item',
  );
});

test('the plus button on a selected skin opens the effect dialog', () => {
  let openedDialogs = 0;
  const content = { innerHTML: '' };
  const plusButton = {
    dataset: { cosmeticEffectSlot: 'item:axe:weapon', cosmeticEffectItem: '20', cosmeticEffectStyle: '2' },
  };
  const dialog = {
    classList: { contains: () => false, add() {} },
    querySelector: () => ({}),
    querySelectorAll: () => [],
    addEventListener() {},
    showModal() { openedDialogs += 1; },
  };
  const document = {
    body: { appendChild() {} },
    createElement: () => dialog,
    querySelectorAll(selector) { return selector === '[data-cosmetic-effect-slot]' ? [plusButton] : []; },
  };
  const context = vm.createContext({
    window: {},
    document,
    state: {
      cosmeticsDraft: { 'item:axe:weapon': { itemId: '20', styleId: '2', effectId: 'fire' } },
      data: { settings: { appLanguage: 'en' } },
      cosmeticsSlotFilter: 'all',
    },
    $: (selector) => selector === '#content' ? content : ({}),
    escapeHtml: (value) => String(value ?? ''),
    slotLabel: (value) => value,
    normalizeHeroId: (value) => value,
    normalizedHeroSlot: (value) => value,
    t: (_key, fallback) => fallback,
    formatTranslation: (message) => message,
    call: async () => ({}),
    toast() {},
    showAppConfirmDialog: async () => ({ confirmed: true }),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/cosmetics-ui.js'), 'utf8'), context, { filename: 'cosmetics-ui.js' });
  const hero = { key: 'axe', name: 'Axe', slots: [{ id: 'item:axe:weapon', name: 'Weapon', options: [{ id: '20', styleId: '2', name: 'Arcana Style', styleName: 'Style 2', effects: [] }, { id: '21', name: 'Other skin', effects: [] }] }] };
  const data = { heroes: [hero], picks: { 'item:axe:weapon': { itemId: '20', styleId: '2', effectId: 'fire' } }, loaderInstalled: true };

  context.renderHeroCosmetics(data, hero);
  assert.equal((content.innerHTML.match(/class="skin-card-effect-button/g) || []).length, 1);
  plusButton.onclick({ preventDefault() {}, stopPropagation() {} });

  assert.equal(openedDialogs, 1);
});
