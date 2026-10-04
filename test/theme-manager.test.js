const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { ThemeManager, DEFAULT_THEME, BUNDLED_THEMES, SEMANTIC_THEME_TOKENS, createThemeTemplate } = require('../src/infrastructure/theme-manager');
const { AppService } = require('../src/main/services/app-service');

async function createManager(t, overrides = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-theme-manager-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const manager = new ThemeManager({ rootDir, activeThemeId: 'vanta-default', ...overrides });
  await manager.init();
  return { rootDir, manager };
}

test('ThemeManager loads the default VANTA theme and exposes the semantic token set', async (t) => {
  const { manager } = await createManager(t);
  const themes = manager.getThemes();
  assert.ok(themes.some((theme) => theme.id === 'vanta-default'));
  assert.equal(themes.filter((theme) => theme.source === 'builtin').length, BUNDLED_THEMES.length + 1);
  assert.ok(BUNDLED_THEMES.length >= 3, 'the theme catalog should ship with several color palettes');
  assert.ok(themes.every((theme) => theme.preview.startsWith('data:image/svg+xml;')));
  assert.ok(SEMANTIC_THEME_TOKENS.includes('background'));
  assert.ok(SEMANTIC_THEME_TOKENS.includes('surfaceElevated'));
  const defaultTheme = manager.getTheme('vanta-default');
  assert.equal(defaultTheme.name, DEFAULT_THEME.name);
  assert.equal(defaultTheme.colors.accent, DEFAULT_THEME.colors.accent);
});

test('ThemeManager validates a custom theme and persists it to the user themes directory', async (t) => {
  const { rootDir, manager } = await createManager(t);
  const customTheme = {
    id: 'midnight-red',
    name: 'Midnight Red',
    author: 'Artem',
    version: '1.0.0',
    description: 'Dark red theme',
    colors: {
      ...DEFAULT_THEME.colors,
      background: '#090909',
      surface: '#121212',
      accent: '#ff3b3b',
      accentHover: '#ff6666',
      success: '#4ade80',
    },
  };

  const validation = manager.validateTheme(customTheme);
  assert.equal(validation.valid, true, validation.errors.join(', '));

  await manager.importThemeFromObject(customTheme, { persist: true });

  const loaded = manager.getTheme('midnight-red');
  assert.equal(loaded.name, 'Midnight Red');
  assert.equal(loaded.source, 'local');
  const pathOnDisk = path.join(rootDir, 'themes', 'midnight-red', 'theme.json');
  const savedTheme = JSON.parse(await fs.readFile(pathOnDisk, 'utf8'));
  assert.equal(savedTheme.id, 'midnight-red');
  assert.equal(savedTheme.colors.accent, '#ff3b3b');
  assert.equal(Object.hasOwn(savedTheme, '_existingIds'), false);

  await manager.init();
  assert.equal(manager.getTheme('midnight-red').name, 'Midnight Red', 'persisted custom themes remain loadable after app restart');
});

test('the built-in creation guide template matches the documented example and validates', async (t) => {
  const { manager } = await createManager(t);
  const template = manager.getThemeTemplate();
  const example = JSON.parse(await fs.readFile(path.join(__dirname, '../docs/examples/theme.template.json'), 'utf8'));

  assert.deepEqual(template, createThemeTemplate());
  assert.deepEqual(example, template, 'offline docs example must remain identical to the in-app generated template');
  assert.deepEqual(Object.keys(template.colors), SEMANTIC_THEME_TOKENS);
  const validation = manager.validateTheme(template);
  assert.equal(validation.valid, true, validation.errors.join('; '));
});

test('ThemeManager imports preview.png beside theme.json inside a .vanta-theme archive', async (t) => {
  const { rootDir, manager } = await createManager(t);
  const archivePath = path.join(rootDir, 'archive.vanta-theme');
  const archive = new AdmZip();
  const theme = { ...manager.getThemeTemplate(), id: 'theme-with-preview', name: 'Theme With Preview' };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
  archive.addFile('Theme With Preview/theme.json', Buffer.from(JSON.stringify(theme), 'utf8'));
  archive.addFile('Theme With Preview/preview.png', png);
  archive.writeZip(archivePath);

  const imported = await manager.importTheme(archivePath);

  assert.equal(imported.preview, `data:image/png;base64,${png.toString('base64')}`);
  assert.equal(manager.getTheme('theme-with-preview').preview, imported.preview);
});

test('AppService imports and applies a custom theme, restores it after restart, and falls back after removal', async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-theme-app-restart-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const service = new AppService({ rootDir });
  await service.storage.init();
  await service.themeManager.init();
  const custom = {
    ...service.themeManager.getThemeTemplate(),
    id: 'midnight-red-restart',
    name: 'Midnight Red Restart Test',
    author: 'VANTA Test',
    colors: { ...service.themeManager.getThemeTemplate().colors, background: '#13070b', accent: '#ff3158' },
  };
  const themePath = path.join(rootDir, 'theme.json');
  await fs.writeFile(themePath, JSON.stringify(custom), 'utf8');

  await service.importTheme(themePath);
  const applied = await service.setTheme(custom.id);
  assert.equal(applied.settings.activeThemeId, custom.id);

  const restarted = new AppService({ rootDir });
  await restarted.storage.init();
  await restarted.themeManager.init();
  const restoredId = restarted.storage.state.settings.activeThemeId || restarted.themeManager.getActiveThemeId();
  await restarted.themeManager.setActiveTheme(restoredId, { persist: false });
  assert.equal(restarted.snapshot().settings.activeThemeId, custom.id);
  assert.equal(restarted.themeManager.getActiveTheme().colors.background, '#13070b');

  const removed = await restarted.removeTheme(custom.id);
  assert.equal(removed.settings.activeThemeId, 'vanta-default');
  assert.equal(restarted.themeManager.getActiveTheme().colors.background, DEFAULT_THEME.colors.background);
});

test('AppService installs and removes catalog theme archives through the theme store', async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-catalog-theme-install-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const progress = [];
  const service = new AppService({ rootDir, onProgress: (event) => progress.push(event) });
  await service.storage.init();
  await service.themeManager.init();
  const archivePath = path.join(rootDir, 'crimson-ronin-theme.zip');
  const archive = new AdmZip();
  const packageTheme = {
    ...service.themeManager.getThemeTemplate(),
    id: 'crimson-ronin',
    name: 'Crimson Ronin Theme',
    author: 'Papapodzaborniy',
  };
  const theme = {
    ...packageTheme,
    previewUrl: 'https://raw.githubusercontent.com/artem-prime42/dota2-media/main/images/Crimson%20Ronin%20Theme.png',
    downloadUrl: 'https://github.com/artem-prime42/dota2-mods/releases/download/Themes/crimson-ronin-theme.zip',
  };
  archive.addFile('Crimson Ronin/theme.json', Buffer.from(JSON.stringify(packageTheme), 'utf8'));
  archive.writeZip(archivePath);
  service.downloads.download = async () => archivePath;
  service.catalog.mods = [];
  service.catalog.themes = [theme];
  await service.themeManager.setCatalogThemes([theme]);
  const catalogSnapshot = service.snapshot();
  assert.equal(catalogSnapshot.mods.length, 0);
  assert.equal(catalogSnapshot.authorThemes[0].id, 'crimson-ronin');
  assert.ok(catalogSnapshot.authors.some((author) => author.name === 'Papapodzaborniy' && author.avatarUrl));

  const installed = await service.install('crimson-ronin');
  assert.equal(installed.settings.activeThemeId, 'crimson-ronin');
  assert.equal(installed.installed['crimson-ronin'].modType, 'theme');
  assert.ok(installed.themes.some((item) => item.id === 'crimson-ronin' && item.source === 'local'));
  assert.equal(installed.themes.find((item) => item.id === 'crimson-ronin').preview, theme.previewUrl);
  assert.ok(progress.some((event) => event.id === 'crimson-ronin' && event.name === 'Crimson Ronin Theme' && event.operation === 'theme-install' && event.phase === 'Importing theme'));
  assert.ok(progress.some((event) => event.id === 'crimson-ronin' && event.operation === 'theme-install' && event.state === 'completed'));

  const restartedManager = new ThemeManager({ rootDir });
  await restartedManager.init();
  await restartedManager.setCatalogThemes([theme]);
  assert.equal(restartedManager.getThemes().find((item) => item.id === 'crimson-ronin').preview, theme.previewUrl);

  const removed = await service.uninstall('crimson-ronin');
  assert.equal(removed.settings.activeThemeId, 'vanta-default');
  assert.equal(removed.installed['crimson-ronin'], undefined);
  assert.equal(removed.themes.some((item) => item.id === 'crimson-ronin' && item.source === 'catalog'), true);
  assert.equal(removed.themes.find((item) => item.id === 'crimson-ronin').preview, theme.previewUrl);
});

test('ThemeManager search is case-insensitive across name, author, and description and accepts remote results', async (t) => {
  const { manager } = await createManager(t);
  const remoteThemes = [
    { id: 'remote-cyber', name: 'Cyberpunk', author: 'Nova', description: 'Neon city lights', source: 'remote' },
    { id: 'remote-forest', name: 'Forest', author: 'Artem', description: 'Soft green surfaces', source: 'remote' },
  ];

  assert.deepEqual(manager.searchThemes('CYBER', remoteThemes).map((theme) => theme.id), ['remote-cyber']);
  assert.deepEqual(manager.searchThemes('artem', remoteThemes).map((theme) => theme.id), ['remote-forest']);
  assert.deepEqual(manager.searchThemes('green', remoteThemes).map((theme) => theme.id), ['remote-forest']);
});

test('ThemeManager rejects malformed or duplicate themes and falls back safely', async (t) => {
  const { manager } = await createManager(t);
  const invalid = { id: 'broken', name: 'Broken', author: 'Artem', version: '1.0.0', colors: { background: 'banana', accent: '#ff0000' } };
  const validation = manager.validateTheme(invalid);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((message) => message.includes('background')));

  const duplicate = { ...DEFAULT_THEME, id: 'vanta-default', name: 'Clone' };
  const duplicateValidation = manager.validateTheme(duplicate);
  assert.equal(duplicateValidation.valid, false);
  assert.ok(duplicateValidation.errors.some((message) => /duplicate/i.test(message)));

  const fallbackTheme = manager.resolveThemeId('missing-theme');
  assert.equal(fallbackTheme, 'vanta-default');
});

test('ThemeManager protects bundled themes from deletion while imported themes remain removable', async (t) => {
  const { manager } = await createManager(t);
  await assert.rejects(manager.removeTheme('vanta-midnight-red'), /Built-in themes cannot be removed/);
  const customTheme = {
    id: 'my-removable-theme', name: 'My Removable Theme', author: 'Artem', version: '1.0.0',
    colors: { ...DEFAULT_THEME.colors, accent: '#aa4488' },
  };
  await manager.importThemeFromObject(customTheme);
  assert.equal(manager.getTheme('my-removable-theme').source, 'local');
  await manager.removeTheme('my-removable-theme');
  assert.equal(manager.getThemes().some((theme) => theme.id === 'my-removable-theme'), false);
  assert.equal(manager.getActiveThemeId(), 'vanta-default');
});

test('ThemeManager can switch active themes and persist the selection across a fresh manager instance', async (t) => {
  const { rootDir, manager } = await createManager(t);
  const customTheme = {
    ...DEFAULT_THEME,
    id: 'midnight-red',
    name: 'Midnight Red',
    author: 'Artem',
    version: '1.0.0',
    colors: { ...DEFAULT_THEME.colors, accent: '#ff3b3b', background: '#090909' },
  };
  await manager.importThemeFromObject(customTheme, { persist: true });
  await manager.setActiveTheme('midnight-red');
  assert.equal(manager.getActiveThemeId(), 'midnight-red');
  const stored = JSON.parse(await fs.readFile(path.join(manager.themesDir, 'active-theme.json'), 'utf8'));
  assert.equal(stored.activeThemeId, 'midnight-red');

  const restartedManager = new ThemeManager({ rootDir });
  await restartedManager.init();
  assert.equal(restartedManager.getActiveThemeId(), 'midnight-red');
  assert.equal(restartedManager.getActiveTheme().colors.accent, '#ff3b3b');

  await restartedManager.removeTheme('midnight-red');
  assert.equal(restartedManager.getActiveThemeId(), 'vanta-default');
});

test('ThemeManager validates transparent colors and the safe visual schema', async (t) => {
  const { manager } = await createManager(t);
  const theme = { ...manager.getThemeTemplate(), id: 'safe-glass-test', name: 'Safe Glass Test' };
  theme.colors.surface = 'rgba(20, 20, 20, 0.72)';
  theme.background = {
    image: 'wallpaper.webp', position: 'center', size: 'cover', repeat: 'no-repeat', opacity: 0.35,
    overlay: 'rgba(0, 0, 0, 0.45)', gradient: { type: 'linear', angle: 135, colors: ['#080808', 'rgba(34, 0, 34, 0.8)'] },
  };
  theme.effects.blurSurface = 16;
  theme.effects.blurSidebar = 20;
  theme.effects.blurModal = 24;
  theme.shape = { radiusSmall: 6, radiusMedium: 10, radiusLarge: 14 };
  assert.equal(manager.validateTheme(theme).valid, true);
  const pixelStringBlur = manager.validateTheme({ ...theme, effects: { ...theme.effects, blurModal: '16px' } });
  assert.equal(pixelStringBlur.valid, true);
  assert.equal(pixelStringBlur.theme.effects.blurModal, 16);
  assert.equal(manager.validateTheme({ ...theme, effects: { ...theme.effects, blurModal: 'blur(16px)' } }).valid, false);
  assert.equal(manager.validateTheme({ ...theme, colors: { ...theme.colors, surface: 'url(https://example.com/x)' } }).valid, false);
  assert.equal(manager.validateTheme({ ...theme, colors: { ...theme.colors, surface: 'rgba(20, 20, 20, 1.5)' } }).valid, false);
  assert.equal(manager.validateTheme({ ...theme, effects: { ...theme.effects, blurModal: 25 } }).valid, false);
  assert.equal(manager.validateTheme({ ...theme, shape: { ...theme.shape, radiusLarge: 33 } }).valid, false);
  assert.equal(manager.validateTheme({ ...theme, background: { ...theme.background, opacity: 1.1 } }).valid, false);
  assert.equal(manager.validateTheme({ ...theme, background: { ...theme.background, overlay: 'url(file:///tmp/x)' } }).valid, false);
  assert.equal(manager.validateTheme({ ...theme, background: { ...theme.background, image: '../outside.jpg' } }).valid, false);
  assert.equal(manager.validateTheme({ ...theme, background: { ...theme.background, gradient: { type: 'linear', angle: 0, colors: ['#000', 'url(https://example.com)'] } } }).valid, false);
  assert.equal(manager.validateTheme({ ...theme, effects: { ...theme.effects, customCSS: 'body { display:none }' } }).valid, false);
  assert.equal(manager.validateTheme({ ...theme, script: 'alert(1)' }).valid, false);
  assert.equal(manager.validateTheme({ ...theme, preview: 'https://example.com/preview.png' }).valid, false);
});

test('localized theme names and descriptions validate, normalize, and persist in both languages', async (t) => {
  const { rootDir, manager } = await createManager(t);
  const theme = {
    ...manager.getThemeTemplate(),
    id: 'bilingual-theme',
    name: 'Aurora Glass',
    description: 'Fallback description',
    translations: {
      ru: { name: 'Аврора', description: 'Стеклянная тема с северным сиянием.' },
      en: { name: 'Aurora', description: 'A glass theme with northern lights.' },
    },
  };
  const validation = manager.validateTheme(theme);
  assert.equal(validation.valid, true, validation.errors.join('; '));
  await manager.importThemeFromObject(theme);
  assert.deepEqual(manager.getTheme(theme.id).translations, theme.translations);
  const stored = JSON.parse(await fs.readFile(path.join(rootDir, 'themes', theme.id, 'theme.json'), 'utf8'));
  assert.deepEqual(stored.translations, theme.translations);
  assert.equal(manager.validateTheme({ ...theme, translations: { fr: { description: 'Bonjour' } } }).valid, false);
  assert.equal(manager.validateTheme({ ...theme, translations: { ru: { description: { text: 'not plain text' } } } }).valid, false);
  assert.equal(manager.validateTheme({ ...theme, translations: { en: { description: 'x'.repeat(501) } } }).valid, false);
});

test('background image is optional, but a referenced missing asset cannot be imported', async (t) => {
  const { manager } = await createManager(t);
  const noWallpaper = { ...manager.getThemeTemplate(), id: 'no-wallpaper', name: 'No Wallpaper' };
  delete noWallpaper.background;
  assert.equal(manager.validateTheme(noWallpaper).valid, true);
  await manager.importThemeFromObject(noWallpaper);

  const missing = { ...manager.getThemeTemplate(), id: 'missing-wallpaper', name: 'Missing Wallpaper', background: { ...manager.getThemeTemplate().background, image: 'missing.jpg', opacity: 0.5 } };
  await assert.rejects(manager.importThemeFromObject(missing), /background image is missing/i);
  assert.equal(manager.getThemes().some((theme) => theme.id === missing.id), false);
});

test('theme archive imports a local background asset and enforces the 10 MB limit', async (t) => {
  const { rootDir, manager } = await createManager(t);
  const archivePath = path.join(rootDir, 'wallpaper-theme.vanta-theme');
  const archive = new AdmZip();
  const theme = { ...manager.getThemeTemplate(), id: 'theme-with-wallpaper', name: 'Theme With Wallpaper', background: { ...manager.getThemeTemplate().background, image: 'background.jpg', opacity: 0.45, overlay: 'rgba(0, 0, 0, 0.35)' } };
  const jpeg = await fs.readFile(path.join(__dirname, '../src/data/themes/vanta-glass/background.jpg'));
  archive.addFile('Theme With Wallpaper/theme.json', Buffer.from(JSON.stringify(theme), 'utf8'));
  archive.addFile('Theme With Wallpaper/background.jpg', jpeg);
  archive.writeZip(archivePath);

  await manager.importTheme(archivePath);
  const imported = manager.getThemes().find((item) => item.id === theme.id);
  assert.equal(imported.background.image, 'background.jpg');
  assert.equal(imported.background.opacity, 0.45);
  assert.match(imported.background.imageUrl, /^file:/);
  assert.deepEqual(await fs.readFile(path.join(rootDir, 'themes', theme.id, 'background.jpg')), jpeg);

  const oversizedPath = path.join(rootDir, 'oversized-theme.zip');
  const oversizedArchive = new AdmZip();
  const oversizedTheme = { ...manager.getThemeTemplate(), id: 'oversized-wallpaper', name: 'Oversized Wallpaper', background: { ...manager.getThemeTemplate().background, image: 'background.png' } };
  const oversizedPng = Buffer.alloc(10 * 1024 * 1024 + 1);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(oversizedPng);
  oversizedArchive.addFile('Oversized/theme.json', Buffer.from(JSON.stringify(oversizedTheme), 'utf8'));
  oversizedArchive.addFile('Oversized/background.png', oversizedPng);
  oversizedArchive.writeZip(oversizedPath);
  await assert.rejects(manager.importTheme(oversizedPath), /10 MB or smaller/i);

  const mismatchedPath = path.join(rootDir, 'mismatched-theme.zip');
  const mismatchedArchive = new AdmZip();
  const mismatchedTheme = { ...manager.getThemeTemplate(), id: 'mismatched-wallpaper', name: 'Mismatched Wallpaper', background: { ...manager.getThemeTemplate().background, image: 'background.jpg' } };
  const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
  mismatchedArchive.addFile('Mismatch/theme.json', Buffer.from(JSON.stringify(mismatchedTheme), 'utf8'));
  mismatchedArchive.addFile('Mismatch/background.jpg', pngBytes);
  mismatchedArchive.writeZip(mismatchedPath);
  await assert.rejects(manager.importTheme(mismatchedPath), /format does not match/i);
});

test('removing a wallpaper theme removes its asset and falls back from its active state', async (t) => {
  const { rootDir, manager } = await createManager(t);
  const theme = { ...manager.getThemeTemplate(), id: 'remove-wallpaper', name: 'Remove Wallpaper', background: { ...manager.getThemeTemplate().background, image: 'background.jpg' } };
  const assets = { 'background.jpg': await fs.readFile(path.join(__dirname, '../src/data/themes/vanta-glass/background.jpg')) };
  await manager.importThemeFromObject(theme, { assets });
  await manager.setActiveTheme(theme.id);
  const assetPath = path.join(rootDir, 'themes', theme.id, 'background.jpg');
  await manager.removeTheme(theme.id);
  assert.equal(manager.getActiveThemeId(), 'vanta-default');
  await assert.rejects(fs.access(assetPath), { code: 'ENOENT' });
  const persisted = JSON.parse(await fs.readFile(path.join(rootDir, 'themes', 'active-theme.json'), 'utf8'));
  assert.equal(persisted.activeThemeId, 'vanta-default');
});

test('Glass and AMOLED bundled examples validate, Glass loads its local wallpaper, and theme selection persists', async (t) => {
  const { rootDir, manager } = await createManager(t);
  const glassExample = JSON.parse(await fs.readFile(path.join(__dirname, '../docs/examples/glass-theme.json'), 'utf8'));
  const amoledExample = JSON.parse(await fs.readFile(path.join(__dirname, '../docs/examples/amoled-theme.json'), 'utf8'));
  const glass = manager.getThemes().find((theme) => theme.id === 'vanta-glass');
  const amoled = manager.getThemes().find((theme) => theme.id === 'vanta-amoled');
  assert.equal(manager.validateTheme(glassExample, new Set()).valid, true);
  assert.equal(manager.validateTheme(amoledExample, new Set()).valid, true);
  assert.deepEqual({ ...glass, source: undefined, preview: undefined, background: { ...glass.background, imageUrl: undefined } }, { ...glassExample, source: undefined, preview: undefined, background: { ...glassExample.background, imageUrl: undefined } });
  assert.ok(glass.background.imageUrl.startsWith('file:'));
  assert.equal((await fs.stat(path.join(rootDir, 'themes', 'vanta-glass', 'background.jpg'))).isFile(), true);
  assert.deepEqual(await fs.readFile(path.join(__dirname, '../docs/examples/background.jpg')), await fs.readFile(path.join(__dirname, '../src/data/themes/vanta-glass/background.jpg')));
  assert.equal(glass.colors.surface, 'rgba(14, 20, 34, 0.72)');
  await manager.setActiveTheme(glass.id);
  const restarted = new ThemeManager({ rootDir });
  await restarted.init();
  assert.equal(restarted.getActiveThemeId(), 'vanta-glass');
  assert.ok(restarted.getThemePreview('vanta-glass').background.imageUrl.startsWith('file:'));
  assert.equal(restarted.getThemes().some((theme) => theme.id === amoled.id), true);
});

test('catalog themes appear only as a separate read-only source and restore their active selection', async (t) => {
  const { rootDir, manager } = await createManager(t);
  const catalogTheme = {
    ...manager.getThemeTemplate(),
    id: 'community-night',
    name: 'Community Night',
    author: 'Theme Maker',
    description: 'A catalog-provided purple palette.',
    previewUrl: 'https://raw.githubusercontent.com/artem-prime42/dota2-media/main/images/Crimson%20Ronin%20Theme.png',
    downloadUrl: 'https://github.com/artem-prime42/dota2-mods/releases/download/Themes/crimson-ronin-theme.zip',
    colors: { ...manager.getThemeTemplate().colors, accent: '#a274ff' },
  };
  await manager.setCatalogThemes([catalogTheme]);
  const listed = manager.getThemes().find((theme) => theme.id === catalogTheme.id);
  assert.equal(listed.source, 'catalog');
  assert.equal(listed.author, 'Theme Maker');
  assert.equal(listed.description, catalogTheme.description);
  assert.equal(listed.preview, catalogTheme.previewUrl);
  assert.equal(listed.downloadUrl, catalogTheme.downloadUrl);
  await assert.rejects(manager.removeTheme(catalogTheme.id), /Catalog themes cannot be removed/);
  await manager.setActiveTheme(catalogTheme.id);

  const restarted = new ThemeManager({ rootDir });
  await restarted.init();
  assert.equal(restarted.getActiveThemeId(), 'vanta-default', 'remote selection is held as pending until catalog metadata arrives');
  await restarted.setCatalogThemes([catalogTheme]);
  assert.equal(restarted.getActiveThemeId(), catalogTheme.id);
  assert.equal(restarted.getActiveTheme().colors.accent, '#a274ff');

  await restarted.setCatalogThemes([{ ...catalogTheme, previewUrl: 'https://example.com/preview.png' }]);
  assert.equal(restarted.getThemes().find((theme) => theme.id === catalogTheme.id).preview.startsWith('data:image/svg+xml;'), true);
});
