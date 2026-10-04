const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function evaluateTheme(theme) {
  const properties = new Map();
  const document = { documentElement: { dataset: {}, style: { setProperty: (key, value) => properties.set(key, value) } } };
  const window = {};
  const context = vm.createContext({ document, window, URL });
  return fs.readFile(path.join(root, 'renderer/settings-page.js'), 'utf8').then((source) => {
    vm.runInContext(source, context, { filename: 'settings-page.js' });
    window.applyVantaTheme(theme);
    return { properties, document };
  });
}

test('Glass theme applies rgba, wallpaper, overlay, blur, shadows, and radii to renderer variables', async () => {
  const theme = JSON.parse(await fs.readFile(path.join(root, 'docs/examples/glass-theme.json'), 'utf8'));
  theme.background.imageUrl = 'file:///userdata/themes/vanta-glass/background.jpg';
  const { properties, document } = await evaluateTheme(theme);
  assert.equal(properties.get('--theme-card'), 'rgba(18, 25, 43, 0.68)');
  assert.equal(properties.get('--panel'), 'rgba(14, 20, 34, 0.72)');
  assert.equal(properties.get('--theme-wallpaper-opacity'), '0.78');
  assert.equal(properties.get('--theme-background-overlay'), 'rgba(5, 8, 18, 0.4)');
  assert.match(properties.get('--theme-wallpaper-image'), /^url\("file:/);
  assert.equal(properties.get('--theme-blur-surface'), '8px');
  assert.equal(properties.get('--theme-blur-sidebar'), '10px');
  assert.equal(properties.get('--theme-blur-modal'), '6px');
  assert.equal(properties.get('--theme-radius-large'), '22px');
  assert.equal(properties.get('--theme-shadow-medium'), 'rgba(0, 0, 0, 0.38)');
  assert.equal(document.documentElement.dataset.themeId, 'vanta-glass');
});

test('theme descriptions select custom translations and localized VANTA copy by app language', async () => {
  const source = await fs.readFile(path.join(root, 'renderer/settings-page.js'), 'utf8');
  const context = vm.createContext({
    state: { data: { settings: { appLanguage: 'ru' } } },
    document: { documentElement: { dataset: {}, style: { setProperty() {} } } },
    window: {},
    URL,
  });
  vm.runInContext(source, context, { filename: 'settings-page.js' });
  const customTheme = { id: 'localized', name: 'Base name', description: 'Base description', translations: { ru: { name: 'Русское имя', description: 'Русское описание' }, en: { name: 'English name', description: 'English description' } } };
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext(`localizedTheme(${JSON.stringify(customTheme)})`, context))), { name: 'Русское имя', description: 'Русское описание' });
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext(`localizedTheme({ ...${JSON.stringify(customTheme)}, translations: undefined })`, context))), { name: 'Base name', description: 'Base description' });
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("localizedTheme({ id: 'vanta-glass', name: 'Glass', description: 'Glass original' })", context))), { name: 'Стекло', description: 'Полупрозрачные поверхности, локальные обои и мягкое размытие.' });
  vm.runInContext("state.data.settings.appLanguage = 'en'", context);
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext(`localizedTheme(${JSON.stringify(customTheme)})`, context))), { name: 'English name', description: 'English description' });
});

test('theme details expose the author avatar and a link to the author profile', async () => {
  const settingsPage = await fs.readFile(path.join(root, 'renderer/settings-page.js'), 'utf8');
  assert.match(settingsPage, /class="author-link theme-details-author" data-theme-author=/);
  assert.match(settingsPage, /getAuthorCardProfile\(authorName\)/);
  assert.match(settingsPage, /state\.view = 'authors'/);
});

test('renderer refuses non-local wallpaper URLs and clamps presentation values defensively', async () => {
  const theme = {
    id: 'malformed-renderer-input',
    colors: { background: '#000', surface: 'rgba(1, 2, 3, 0.5)', surfaceElevated: '#111', surfaceHover: '#222', surfaceActive: '#333', text: '#fff', textMuted: '#aaa', textDisabled: '#555', border: '#444', accent: '#f00', accentHover: '#f66', accentActive: '#d00', success: '#0f0', warning: '#ff0', danger: '#f00', overlay: 'rgba(0, 0, 0, 0.5)', shadow: '#000', input: '#111', button: '#f00', card: 'rgba(1, 2, 3, 0.5)', sidebar: '#111', modal: '#111', tooltip: '#111', scrollbar: '#555', focus: '#fff' },
    background: { imageUrl: 'https://example.com/wallpaper.jpg', opacity: 5 },
    effects: { blurSurface: 100 },
    shape: { radiusLarge: 100 },
  };
  const { properties } = await evaluateTheme(theme);
  assert.equal(properties.get('--theme-wallpaper-image'), 'none');
  assert.equal(properties.get('--theme-wallpaper-opacity'), '1');
  assert.equal(properties.get('--theme-blur-surface'), '24px');
  assert.equal(properties.get('--theme-radius-large'), '32px');
});

test('theme stylesheet uses alpha colors and semantic background effects instead of forcing solid surfaces', async () => {
  const css = await fs.readFile(path.join(root, 'renderer/themes.css'), 'utf8');
  const html = await fs.readFile(path.join(root, 'renderer/index.html'), 'utf8');
  const authorUi = await fs.readFile(path.join(root, 'renderer/author-profile-ui.js'), 'utf8');
  assert.match(css, /\.mod-card, \.settings-category[^{]*\{[^}]*background: var\(--theme-card, var\(--panel\)\)/);
  assert.match(css, /\.sidebar \{[^}]*backdrop-filter: blur\(var\(--theme-blur-sidebar/);
  assert.match(css, /\.app-modal-dialog \{[^}]*backdrop-filter: blur\(var\(--theme-blur-modal/);
  assert.match(css, /\.settings-category, \.library-section, \.theme-store-card \{[^}]*backdrop-filter: blur\(var\(--theme-blur-surface/);
  assert.doesNotMatch(css, /\.mod-card[^}]*backdrop-filter/);
  assert.doesNotMatch(css, /::backdrop[^}]*backdrop-filter/);
  assert.doesNotMatch(css, /\.video-preview-dialog[^}]*backdrop-filter/);
    assert.match(css, /\.library-mod \{[^}]*background: var\(--theme-card/);
    assert.match(css, /\.library-filter \{[^}]*background: var\(--theme-surface/);
    assert.match(css, /\.library-bulk \{[^}]*background: var\(--theme-modal/);
    assert.match(css, /\.pack-content-dialog \{[^}]*background: var\(--theme-modal/);
    assert.match(css, /\.toggle-button\.on \{[^}]*background: var\(--theme-accent/);
    assert.match(css, /input\[type="range"\] \{[^}]*accent-color: var\(--theme-accent/);
    assert.match(css, /select option, select optgroup \{[^}]*background: var\(--theme-input/);
    assert.match(css, /\.update-progress \{ background: var\(--theme-surface-elevated/);
    assert.match(css, /\.update-progress span \{ background: var\(--theme-accent/);
    assert.match(css, /\.patch-notes-dialog \{[^}]*background: var\(--theme-modal/);
    assert.match(css, /\.featured-arrow \{[^}]*color: var\(--theme-text/);
    assert.match(css, /\.featured-dot\.active \{ background: var\(--theme-accent/);
    assert.match(css, /\.recent-more \{[^}]*background: var\(--theme-surface-elevated/);
    assert.match(css, /\.hero-detail-head \{[^}]*background: var\(--theme-card/);
    assert.match(css, /\.hero-category-grid \{[^}]*background: var\(--theme-card/);
    assert.match(css, /\.hero-stats-dialog \{[^}]*background: var\(--theme-modal/);
    assert.match(css, /\.hero-stats-dialog\[open\] \{ animation: hero-stats-enter/);
    assert.match(css, /\.hero-stats-dialog\.is-closing \{ animation: hero-stats-exit/);
    assert.match(css, /\.card-footer \.download-count[^}]*var\(--theme-surface-elevated/);
    assert.match(css, /\.rarity-arcana \{[^}]*var\(--theme-success/);
    assert.match(css, /\.rarity-immortal \{[^}]*var\(--theme-warning/);
    assert.match(css, /\.author-profile-head \{[^}]*background: var\(--theme-card/);
    assert.match(css, /\.author-directory-search \{[^}]*background: var\(--theme-input/);
    assert.match(css, /\.empty, \.error \{[^}]*background-color: var\(--theme-card/);
    assert.match(css, /\.author-mods-heading \{ color: var\(--theme-muted/);
    assert.match(css, /\.author-social-links a \{[^}]*var\(--theme-surface-elevated/);
    assert.match(authorUi, /AUTHOR_SOCIAL_ICONS/);
    assert.match(authorUi, /data-author-category/);
    assert.match(authorUi, /author-mod-sort/);
  assert.match(css, /body \{[^}]*background-image: var\(--theme-background-gradient/);
  assert.match(html, /id="theme-wallpaper"/);
  assert.match(css, /\.mod-card \{[^}]*transition: translate \.24s cubic-bezier/);
  assert.match(css, /\.mod-card:hover, \.mod-card:focus-within \{ translate: 0 -4px;/);
  assert.match(css, /\.mod-card:hover \.open-card \.preview[^}]*transform: scale\(1\.025\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.mod-card:hover, \.mod-card:focus-within \{ translate: none;/);
});
