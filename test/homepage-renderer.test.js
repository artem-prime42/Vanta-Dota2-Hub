const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
const cardLinksRenderer = fs.readFileSync(path.join(__dirname, '../renderer/card-links.js'), 'utf8');
const heroDirectoryRenderer = fs.readFileSync(path.join(__dirname, '../renderer/hero-directory-fixes.js'), 'utf8');
const cosmeticsRenderer = fs.readFileSync(path.join(__dirname, '../renderer/cosmetics-ui.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../renderer/index.html'), 'utf8');
const polishCss = fs.readFileSync(path.join(__dirname, '../renderer/polish.css'), 'utf8');

test('home route renders the featured slider instead of the Dota and mod health check', () => {
  assert.match(renderer, /if \(state\.view === 'discover'\) return renderHome\(\);/);
  assert.match(renderer, /function renderHome\(\)\s*\{[\s\S]*?renderFeatured\(mods\)[\s\S]*?bindFeatured\(\);/);
  const featured = renderer.match(/function renderFeatured\(mods\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(featured, /featured-patch-notes/);
  assert.doesNotMatch(featured, /featured\.map|FEATURED MOD|data-action=/);
  assert.doesNotMatch(featured, /featured-arrow|featured-dots/);
  assert.doesNotMatch(renderer, /renderDotaStatus|library:diagnose/);
});

test('2.0.15 patch note and hero preview UI are present', () => {
  assert.match(renderer, /VANTA UPDATE · 2\.0\.15/);
  assert.match(renderer, /Патчноут 2\.0\.15/);
  assert.match(renderer, /Новые категории модов/);
  assert.match(renderer, /Ландшафты, Курьеры, Крипы, Башни, Варды, Погода/);
  assert.match(renderer, /Новые темы/);
  assert.match(renderer, /Спасибо всем, кто пользуется VANTA и помогает развивать проект! ❤️/);
  assert.match(renderer, /Исправления и улучшения/);
  assert.match(renderer, /новые категории модов, темы оформления и улучшения производительности/i);
  assert.match(renderer, /hero-preview-placeholder/);
  assert.match(renderer, /hero-preview-coming-soon.*Скоро.*Coming soon/);
  assert.match(renderer, /hero-preview-actions/);
  assert.match(renderer, /hero-slot-list/);
  assert.match(renderer, /previousItemsScrollTop = document\.querySelector\('\.hero-items-content'\)\?\.scrollTop/);
  assert.match(renderer, /itemsContent\.scrollTop = previousItemsScrollTop/);
  assert.match(renderer, /heading\.innerHTML = .*catalog\.heroLoadout/);
  assert.match(renderer, /categoryOptions = state\.view === 'mods' && state\.section === 'world'/);
  assert.match(renderer, /normalizedCatalogCategory\(mod\.categoryId\)/);
  const heroActions = cosmeticsRenderer.match(/function inlineHeroCosmeticsActionsMarkup[\s\S]*?(?=\nfunction bindInlineHeroCosmetics)/)?.[0] || '';
  assert.match(heroActions, /cosmeticsText\('Сбросить', 'Reset'\)/);
  assert.match(heroActions, /cosmeticsText\('Установить', 'Apply'\)/);
  assert.doesNotMatch(heroActions, /cosmeticsLoaderNotice/);
});

test('hero directory includes every hero from the actual local cosmetics listing', () => {
  assert.match(heroDirectoryRenderer, /for \(const cosmeticHero of state\.data\.cosmetics\?\.heroes \|\| \[\]\)/);
  assert.match(heroDirectoryRenderer, /const id = normalizeHeroId\(cosmeticHero\?\.key\)/);
  assert.match(heroDirectoryRenderer.match(/const CANONICAL_HEROES = '([^']+)'/)?.[1] || '', /\bbroodmother\b/);
});

test('hero directory renders Broodmother and her cosmetic count when only present in schema data', () => {
  const content = { innerHTML: '' };
  const context = vm.createContext({
    window: { restoreHeroDirectoryScroll() {} },
    state: {
      view: 'mods', section: 'heroes', hero: '', heroDirectoryAttributes: [],
      data: { mods: [], settings: { appLanguage: 'en' }, cosmetics: { heroes: [
        { key: 'broodmother', name: 'Broodmother', slots: [{ id: 'item:broodmother:head', options: [{ id: '20' }] }] },
      ] } },
    },
    HERO_PORTRAIT_BASE: '/heroes/',
    normalizeHeroId: (value) => String(value || '').toLowerCase().replace(/^npc_dota_hero_/, ''),
    t: (_key, fallback) => fallback,
    formatTranslation: (message, values) => message.replace('{count}', values.count),
    $: (selector) => selector === '#content' ? content : null,
    document: {
      querySelector: (selector) => selector === '.hero-directory-head' ? { setAttribute() {} } : null,
      querySelectorAll: () => [],
    },
  });
  vm.runInContext(heroDirectoryRenderer, context, { filename: 'hero-directory-fixes.js' });

  context.renderHeroDirectory();

  assert.match(content.innerHTML, /data-hero="broodmother"/);
  assert.match(content.innerHTML, /Broodmother/);
  assert.match(content.innerHTML, /1 skins/);
});

test('World and Interface category chips route to sections that display their category', () => {
  const worldCategories = ['weather', 'terrains', 'maps', 'towers', 'creep-deny', 'kill-effects'];
  const interfaceCategories = ['backgrounds', 'huds', 'versus-screens', 'loading-screens', 'emblems', 'music'];
  for (const category of worldCategories) {
    assert.match(renderer, new RegExp(`world: new Set\\([^\\n]*'${category}'`));
    assert.match(cardLinksRenderer, new RegExp(`['"]?${category}['"]?: 'world'`));
  }
  for (const category of interfaceCategories) {
    assert.match(renderer, new RegExp(`interface: new Set\\([^\\n]*'${category}'`));
    assert.match(cardLinksRenderer, new RegExp(`['"]?${category}['"]?: 'interface'`));
  }
});

test('hero directory scroll is saved before navigation and restored after returning', () => {
  assert.match(renderer, /heroDirectoryScrollTop: 0/);
  assert.match(renderer, /state\.heroDirectoryScrollTop = window\.scrollY \|\| document\.documentElement\.scrollTop \|\| 0/);
  assert.match(renderer, /window\.restoreHeroDirectoryScroll = \(\) =>/);
  assert.match(heroDirectoryRenderer, /window\.restoreHeroDirectoryScroll\?\.\(\)/);
});

test('title bar shows the BETA badge beside VANTA branding', () => {
  assert.match(html, /titlebar-brand"><strong>VANTA DOTA2 HUB<\/strong><span class="titlebar-beta">BETA<\/span>/);
  assert.match(polishCss, /\.titlebar-beta/);
});
