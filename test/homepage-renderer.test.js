const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
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

test('2.0.14 patch note, landscape category, and hero preview UI are present', () => {
  assert.match(renderer, /VANTA UPDATE · 2\.0\.14/);
  assert.match(renderer, /Патчноут 2\.0\.14/);
  assert.match(renderer, /Полностью переработана система скинов/);
  assert.match(renderer, /10 500\+ скинов/);
  assert.match(renderer, /Unusual-эффекты/);
  assert.match(renderer, /Обновлённый интерфейс/);
  assert.match(renderer, /Исправления и улучшения/);
  assert.match(renderer, /10 500\+ скинов, Unusual-эффекты и обновлённое управление модификациями/);
  assert.match(renderer, /hero-preview-placeholder/);
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

test('title bar shows the BETA badge beside VANTA branding', () => {
  assert.match(html, /titlebar-brand"><strong>VANTA DOTA2 HUB<\/strong><span class="titlebar-beta">BETA<\/span>/);
  assert.match(polishCss, /\.titlebar-beta/);
});
