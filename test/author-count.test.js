const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('retired Authors page stays closed and mod cards do not link to author profiles', () => {
  const content = { innerHTML: '', classList: { toggle() {}, add() {}, remove() {} } };
  const document = {
    body: { classList: { toggle() {}, add() {}, remove() {} } },
    querySelector(selector) {
      if (selector === '#content') return content;
      if (selector === '#toast') return null;
      if (selector === '#page-title') return { textContent: '' };
      if (selector === '.topbar .search') return null;
      if (selector === '#details') return { showModal() {}, close() {} };
      if (selector === '#search') return { oninput: null, classList: { add() {}, remove() {} } };
      if (selector === '#refresh') return { classList: { add() {}, remove() {} }, onclick: null };
      if (selector === '#close-details') return { onclick: null };
      return null;
    },
    querySelectorAll() { return []; },
    createElement() {
      return { classList: { add() {}, remove() {}, toggle() {} }, append() {}, appendChild() {}, replaceChildren() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
    },
  };

  const context = {
    console,
    document,
    window: {
      vanta: {
        call: async () => ({
          ok: true,
          data: {
            gamePath: '',
            settings: { appLanguage: 'ru' },
            mods: [],
            categories: [],
            authors: [],
            installed: {},
            favorites: [],
            packs: [],
          },
        }),
        onDownloadProgress: () => {},
      },
    },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (fn) => fn(),
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../renderer/i18n.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../renderer/app.js'), 'utf8'), context);
  const html = fs.readFileSync(require('node:path').join(__dirname, '../renderer/index.html'), 'utf8');
  vm.runInContext(`window.testCardMarkup = card({ id: 'render-test-mod', name: 'Render Test Mod', author: 'Alice', categoryId: 'other', createdAt: '2026-10-04', downloads: 0 });`, context);

  assert.doesNotMatch(html, /data-view="authors"/);
  assert.doesNotMatch(html, /data-view="saved-packs"/);
  assert.match(context.window.testCardMarkup, /data-id="render-test-mod"/);
  assert.doesNotMatch(context.window.testCardMarkup, /data-card-author/);
  assert.match(context.window.testCardMarkup, /Alice/);
});
