const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

const MAX_BACKGROUND_BYTES = 10 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
const MAX_THEME_JSON_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const BACKGROUND_POSITIONS = new Set(['center', 'top', 'bottom', 'left', 'right', 'top left', 'top right', 'bottom left', 'bottom right', 'left top', 'right top', 'left bottom', 'right bottom']);
const BACKGROUND_SIZES = new Set(['cover', 'contain', 'auto']);
const BACKGROUND_REPEATS = new Set(['no-repeat', 'repeat', 'repeat-x', 'repeat-y', 'space', 'round']);

const SEMANTIC_THEME_TOKENS = [
  'background', 'surface', 'surfaceElevated', 'surfaceHover', 'surfaceActive',
  'text', 'textMuted', 'textDisabled', 'border', 'accent', 'accentHover',
  'accentActive', 'success', 'warning', 'danger', 'overlay', 'shadow', 'input',
  'button', 'card', 'sidebar', 'modal', 'tooltip', 'scrollbar', 'focus'
];

const DEFAULT_THEME = {
  id: 'vanta-default',
  name: 'VANTA Default',
  author: 'VANTA',
  version: '2.0.11',
  description: 'Default VANTA interface theme.',
  source: 'local',
  background: { position: 'center', size: 'cover', repeat: 'no-repeat', opacity: 0, overlay: 'rgba(0, 0, 0, 0)' },
  effects: { blurSurface: 0, blurSidebar: 0, blurModal: 0, shadowSmall: 'rgba(0, 0, 0, 0.25)', shadowMedium: 'rgba(0, 0, 0, 0.4)', shadowLarge: 'rgba(0, 0, 0, 0.55)' },
  shape: { radiusSmall: 4, radiusMedium: 8, radiusLarge: 14 },
  colors: {
    background: '#070707',
    surface: '#111111',
    surfaceElevated: '#1a1a1a',
    surfaceHover: '#202020',
    surfaceActive: '#2a2a2a',
    text: '#f2f2f2',
    textMuted: '#9a9a9a',
    textDisabled: '#6a6a6a',
    border: '#2d2d2d',
    accent: '#f2f2f2',
    accentHover: '#ffffff',
    accentActive: '#d0d0d0',
    success: '#4ade80',
    warning: '#facc15',
    danger: '#ef4444',
    overlay: 'rgba(0, 0, 0, 0.65)',
    shadow: 'rgba(0, 0, 0, 0.55)',
    input: '#101010',
    button: '#f2f2f2',
    card: '#171717',
    sidebar: '#0d0d0d',
    modal: '#171717',
    tooltip: '#1f1f1f',
    scrollbar: '#5a5a5a',
    focus: '#d8d8d8',
  },
};

function createBundledTheme({ id, name, author = 'VANTA', description, colors, background, effects, shape }) {
  return {
    id,
    name,
    author,
    version: '1.0.0',
    description,
    source: 'builtin',
    colors: { ...DEFAULT_THEME.colors, ...colors },
    ...(background ? { background } : {}),
    ...(effects ? { effects } : {}),
    ...(shape ? { shape } : {}),
  };
}

const BUNDLED_THEMES = [
  createBundledTheme({
    id: 'vanta-midnight-red',
    name: 'Midnight Red',
    description: 'Deep charcoal surfaces with a vivid crimson accent.',
    colors: {
      background: '#10070b', surface: '#1a0d12', surfaceElevated: '#27131b', surfaceHover: '#391a25', surfaceActive: '#4b202f',
      text: '#fff1f4', textMuted: '#ca929f', textDisabled: '#79505b', border: '#63303f', accent: '#ff3158', accentHover: '#ff6682', accentActive: '#d91f45',
      input: '#160a10', button: '#ff3158', card: '#211018', sidebar: '#14090e', modal: '#211018', tooltip: '#391a25', scrollbar: '#a6405b', focus: '#ff91a7',
    },
  }),
  createBundledTheme({
    id: 'vanta-cyberpunk',
    name: 'Cyberpunk Neon',
    description: 'Electric cyan and violet highlights over a futuristic night palette.',
    colors: {
      background: '#080914', surface: '#101326', surfaceElevated: '#191d36', surfaceHover: '#252b4a', surfaceActive: '#30365b',
      text: '#f0f4ff', textMuted: '#9ba8ce', textDisabled: '#626c90', border: '#343b67', accent: '#54f2df', accentHover: '#87fff1', accentActive: '#30cdbd',
      success: '#69f0a4', warning: '#ffe66d', danger: '#ff528b', input: '#0d1020', button: '#54f2df', card: '#14182d', sidebar: '#0b0d1a', modal: '#14182d', tooltip: '#242a49', scrollbar: '#6774bf', focus: '#a98bff',
    },
  }),
  createBundledTheme({
    id: 'vanta-ocean',
    name: 'Abyssal Ocean',
    description: 'Cool ocean blues, clean surfaces, and a bright aqua action color.',
    colors: {
      background: '#061118', surface: '#0c1d27', surfaceElevated: '#142b38', surfaceHover: '#1c3a4a', surfaceActive: '#25495b',
      text: '#eaf8ff', textMuted: '#91b6c8', textDisabled: '#5d7c8b', border: '#285064', accent: '#48c8e8', accentHover: '#7eddf2', accentActive: '#28a7c7',
      success: '#53dda0', warning: '#ffcf70', danger: '#ff687d', input: '#091923', button: '#48c8e8', card: '#10232e', sidebar: '#081720', modal: '#10232e', tooltip: '#1c3543', scrollbar: '#397b91', focus: '#8ee8f6',
    },
  }),
  createBundledTheme({
    id: 'vanta-emerald',
    name: 'Emerald Grove',
    description: 'A calm forest palette with emerald accents and warm readable text.',
    colors: {
      background: '#0a100d', surface: '#111b15', surfaceElevated: '#1a291f', surfaceHover: '#24392b', surfaceActive: '#304a38',
      text: '#eff8f0', textMuted: '#a3c0a8', textDisabled: '#667f6b', border: '#365642', accent: '#65d98b', accentHover: '#92edaa', accentActive: '#43b96b',
      success: '#65d98b', warning: '#e9ce72', danger: '#eb7474', input: '#0d1711', button: '#65d98b', card: '#152219', sidebar: '#0c1510', modal: '#152219', tooltip: '#263c2d', scrollbar: '#4c805b', focus: '#a0f1b4',
    },
  }),
  createBundledTheme({
    id: 'vanta-glass',
    name: 'Glass',
    description: 'A layered glass interface with a local abstract wallpaper, soft blur, and translucent surfaces.',
    colors: {
      background: '#090d18', surface: 'rgba(14, 20, 34, 0.72)', surfaceElevated: 'rgba(30, 37, 58, 0.78)', surfaceHover: 'rgba(46, 56, 82, 0.82)', surfaceActive: 'rgba(59, 70, 99, 0.86)',
      text: '#f3f5ff', textMuted: '#b1bad1', textDisabled: '#77819b', border: 'rgba(226, 232, 255, 0.16)', accent: '#9a8cff', accentHover: '#b8adff', accentActive: '#7969df',
      success: '#70e4b3', warning: '#f5d37a', danger: '#ff8295', input: 'rgba(8, 13, 26, 0.72)', button: '#9a8cff', card: 'rgba(18, 25, 43, 0.68)', sidebar: 'rgba(9, 14, 27, 0.78)', modal: 'rgba(15, 20, 34, 0.9)', tooltip: 'rgba(32, 39, 59, 0.94)', scrollbar: '#7168a8', focus: '#c5bcff',
    },
    background: { image: 'background.jpg', position: 'center', size: 'cover', repeat: 'no-repeat', opacity: 0.78, overlay: 'rgba(5, 8, 18, 0.4)', gradient: { type: 'linear', angle: 135, colors: ['rgba(7, 10, 22, 0.25)', 'rgba(34, 18, 48, 0.3)'] } },
    effects: { blurSurface: 8, blurSidebar: 10, blurModal: 6, shadowSmall: 'rgba(0, 0, 0, 0.2)', shadowMedium: 'rgba(0, 0, 0, 0.38)', shadowLarge: 'rgba(0, 0, 0, 0.58)' },
    shape: { radiusSmall: 8, radiusMedium: 14, radiusLarge: 22 },
  }),
  createBundledTheme({
    id: 'vanta-amoled',
    name: 'AMOLED Minimal',
    description: 'Near-black surfaces, subtle outlines, compact corners, and a focused crimson accent.',
    colors: {
      background: '#000000', surface: '#030303', surfaceElevated: '#080808', surfaceHover: '#101010', surfaceActive: '#171717',
      text: '#f7f7f7', textMuted: '#a0a0a0', textDisabled: '#5c5c5c', border: 'rgba(255, 255, 255, 0.09)', accent: '#ff3b55', accentHover: '#ff6679', accentActive: '#d92d45',
      input: '#050505', button: '#ff3b55', card: '#050505', sidebar: '#010101', modal: '#060606', tooltip: '#111111', scrollbar: '#4b4b4b', focus: '#ff8191',
    },
    effects: { blurSurface: 0, blurSidebar: 0, blurModal: 0, shadowSmall: 'rgba(0, 0, 0, 0.25)', shadowMedium: 'rgba(0, 0, 0, 0.42)', shadowLarge: 'rgba(0, 0, 0, 0.68)' },
    shape: { radiusSmall: 2, radiusMedium: 4, radiusLarge: 7 },
  }),
];
const BUNDLED_THEME_IDS = new Set([DEFAULT_THEME.id, ...BUNDLED_THEMES.map((theme) => theme.id)]);

function escapeXmlAttribute(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
}

function buildThemePreview(theme) {
  const colors = { ...DEFAULT_THEME.colors, ...(theme && typeof theme === 'object' && theme.colors ? theme.colors : {}) };
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="720" height="480" viewBox="0 0 720 480">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="${escapeXmlAttribute(colors.background)}"/>
          <stop offset="100%" stop-color="${escapeXmlAttribute(colors.surface)}"/>
        </linearGradient>
      </defs>
      <rect width="720" height="480" fill="url(#bg)"/>
      <rect x="26" y="26" width="668" height="428" rx="22" fill="${escapeXmlAttribute(colors.surfaceElevated)}" stroke="${escapeXmlAttribute(colors.border)}"/>
      <rect x="52" y="54" width="160" height="34" rx="8" fill="${escapeXmlAttribute(colors.surfaceHover)}"/>
      <rect x="52" y="110" width="430" height="242" rx="16" fill="${escapeXmlAttribute(colors.card)}" stroke="${escapeXmlAttribute(colors.border)}"/>
      <rect x="500" y="110" width="160" height="152" rx="14" fill="${escapeXmlAttribute(colors.surfaceHover)}"/>
      <rect x="52" y="372" width="160" height="30" rx="8" fill="${escapeXmlAttribute(colors.button || colors.accent)}" opacity="0.9"/>
      <rect x="220" y="372" width="160" height="30" rx="8" fill="${escapeXmlAttribute(colors.surfaceHover)}"/>
      <rect x="52" y="126" width="180" height="12" rx="6" fill="${escapeXmlAttribute(colors.text)}" opacity="0.75"/>
      <rect x="52" y="150" width="230" height="10" rx="5" fill="${escapeXmlAttribute(colors.textMuted)}" opacity="0.7"/>
      <rect x="52" y="170" width="120" height="10" rx="5" fill="${escapeXmlAttribute(colors.accent)}" opacity="0.9"/>
      <rect x="52" y="212" width="70" height="70" rx="12" fill="${escapeXmlAttribute(colors.accent)}" opacity="0.8"/>
      <rect x="136" y="212" width="70" height="70" rx="12" fill="${escapeXmlAttribute(colors.success)}" opacity="0.85"/>
      <rect x="220" y="212" width="70" height="70" rx="12" fill="${escapeXmlAttribute(colors.warning)}" opacity="0.85"/>
      <rect x="304" y="212" width="70" height="70" rx="12" fill="${escapeXmlAttribute(colors.danger)}" opacity="0.9"/>
      <circle cx="556" cy="156" r="34" fill="${escapeXmlAttribute(colors.accent)}" opacity="0.9"/>
      <rect x="516" y="206" width="80" height="10" rx="5" fill="${escapeXmlAttribute(colors.text)}" opacity="0.8"/>
      <rect x="516" y="224" width="120" height="10" rx="5" fill="${escapeXmlAttribute(colors.textMuted)}" opacity="0.7"/>
      <rect x="516" y="246" width="110" height="10" rx="5" fill="${escapeXmlAttribute(colors.textMuted)}" opacity="0.7"/>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function sanitizeThemeId(value) {
  const next = String(value || '').trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
  return next || 'custom-theme';
}

function isValidColor(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(trimmed)) return true;
  if (/^(?:transparent|black|white|red|green|blue|yellow|cyan|magenta|gray|grey|orange|purple|pink|navy|teal|lime|silver|maroon|olive|aqua|fuchsia)$/i.test(trimmed)) return true;
  const functional = trimmed.match(/^(rgba?|hsla?)\(([^()]*)\)$/i);
  if (!functional) return false;
  const [, type, body] = functional;
  const parts = body.split(',').map((part) => part.trim());
  const isAlpha = type.toLowerCase().endsWith('a');
  if (parts.length !== (isAlpha ? 4 : 3)) return false;
  const alpha = parts[3];
  if (isAlpha) {
    const amount = Number(alpha.endsWith('%') ? alpha.slice(0, -1) : alpha);
    if (!Number.isFinite(amount) || amount < 0 || amount > (alpha.endsWith('%') ? 100 : 1)) return false;
  }
  if (type.toLowerCase().startsWith('rgb')) {
    return parts.slice(0, 3).every((part) => {
      if (!/^(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(part)) return false;
      const percentage = part.endsWith('%');
      const amount = Number(percentage ? part.slice(0, -1) : part);
      return amount >= 0 && amount <= (percentage ? 100 : 255);
    });
  }
  const hue = parts[0].replace(/deg$/i, '');
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(hue) || Number(hue) < 0 || Number(hue) > 360) return false;
  return parts.slice(1, 3).every((part) => /^\d+(?:\.\d+)?%$/.test(part) && Number(part.slice(0, -1)) <= 100);
}

function isSafeImageFilename(value) {
  if (typeof value !== 'string' || value !== path.basename(value) || value.includes('..') || /[\\/:\0]/.test(value)) return false;
  return Boolean(IMAGE_TYPES[path.extname(value).toLowerCase()]);
}

function isValidImageBytes(filename, buffer) {
  if (!isSafeImageFilename(filename) || !Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BACKGROUND_BYTES) return false;
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (extension === '.jpg' || extension === '.jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
}

function isValidPreviewData(value) {
  const match = typeof value === 'string' && value.match(/^data:image\/png;base64,([a-z\d+/]+=*)$/i);
  if (!match || match[1].length > Math.ceil(MAX_PREVIEW_BYTES * 4 / 3)) return false;
  const bytes = Buffer.from(match[1], 'base64');
  return bytes.length <= MAX_PREVIEW_BYTES && isValidImageBytes('preview.png', bytes);
}

function normalizeBackground(background = {}) {
  const source = background && typeof background === 'object' && !Array.isArray(background) ? background : {};
  return {
    ...(source.image ? { image: String(source.image) } : {}),
    position: source.position ?? 'center',
    size: source.size ?? 'cover',
    repeat: source.repeat ?? 'no-repeat',
    opacity: source.opacity ?? 0,
    overlay: source.overlay ?? 'rgba(0, 0, 0, 0)',
    ...(source.gradient ? { gradient: source.gradient } : {}),
  };
}

function normalizeEffects(effects = {}) {
  const source = effects && typeof effects === 'object' && !Array.isArray(effects) ? effects : {};
  const blur = (value) => typeof value === 'string' && /^\s*(?:\d+(?:\.\d+)?|\.\d+)\s*(?:px)?\s*$/i.test(value)
    ? Number.parseFloat(value)
    : value;
  return {
    blurSurface: blur(source.blurSurface ?? 0),
    blurSidebar: blur(source.blurSidebar ?? 0),
    blurModal: blur(source.blurModal ?? 0),
    shadowSmall: source.shadowSmall ?? DEFAULT_THEME.effects.shadowSmall,
    shadowMedium: source.shadowMedium ?? DEFAULT_THEME.effects.shadowMedium,
    shadowLarge: source.shadowLarge ?? DEFAULT_THEME.effects.shadowLarge,
  };
}

function normalizeShape(shape = {}) {
  const source = shape && typeof shape === 'object' && !Array.isArray(shape) ? shape : {};
  return {
    radiusSmall: source.radiusSmall ?? DEFAULT_THEME.shape.radiusSmall,
    radiusMedium: source.radiusMedium ?? DEFAULT_THEME.shape.radiusMedium,
    radiusLarge: source.radiusLarge ?? DEFAULT_THEME.shape.radiusLarge,
  };
}

function normalizeTranslations(translations = {}) {
  const source = translations && typeof translations === 'object' && !Array.isArray(translations) ? translations : {};
  const normalized = {};
  for (const language of ['ru', 'en']) {
    const locale = source[language];
    if (!locale || typeof locale !== 'object' || Array.isArray(locale)) continue;
    normalized[language] = {
      ...(typeof locale.name === 'string' ? { name: locale.name } : {}),
      ...(typeof locale.description === 'string' ? { description: locale.description } : {}),
    };
  }
  return normalized;
}

function normalizeTheme(theme, existingIds = new Set()) {
  const source = theme && typeof theme === 'object' ? theme : {};
  const colors = { ...DEFAULT_THEME.colors, ...(source.colors || {}) };
  const id = sanitizeThemeId(source.id || 'custom-theme');
  return {
    id,
    name: String(source.name || 'Custom theme'),
    author: String(source.author || 'Unknown author'),
    version: String(source.version || '1.0.0'),
    description: typeof source.description === 'string' ? source.description : '',
    ...(source.translations !== undefined ? { translations: normalizeTranslations(source.translations) } : {}),
    source: BUNDLED_THEME_IDS.has(source.id) ? 'builtin' : 'local',
    preview: source.preview || null,
    colors: Object.fromEntries(SEMANTIC_THEME_TOKENS.map((token) => [token, colors[token] || DEFAULT_THEME.colors[token]])),
    background: normalizeBackground(source.background),
    effects: normalizeEffects(source.effects),
    shape: normalizeShape(source.shape),
  };
}

function createThemeTemplate() {
  return {
    id: 'my-theme',
    name: 'My Theme',
    author: 'Your Name',
    version: '1.0.0',
    description: 'My custom VANTA theme',
    translations: {
      ru: { name: 'Моя тема', description: 'Моё оформление VANTA.' },
      en: { name: 'My Theme', description: 'My custom VANTA theme.' },
    },
    colors: Object.fromEntries(SEMANTIC_THEME_TOKENS.map((token) => [token, DEFAULT_THEME.colors[token]])),
    background: { ...DEFAULT_THEME.background },
    effects: { ...DEFAULT_THEME.effects },
    shape: { ...DEFAULT_THEME.shape },
  };
}

class ThemeManager {
  constructor({ rootDir, themesDir, activeThemeId = 'vanta-default', fallbackThemeId = 'vanta-default' } = {}) {
    this.rootDir = rootDir || path.join(process.cwd(), 'userdata');
    this.themesDir = themesDir || path.join(this.rootDir, 'themes');
    this.fallbackThemeId = fallbackThemeId;
    this.activeThemeId = activeThemeId || fallbackThemeId;
    this.themes = new Map();
    this.catalogThemes = new Map();
    this.backgroundImageUrls = new Map();
    this.pendingActiveThemeId = null;
    this.stateFile = path.join(this.themesDir, 'active-theme.json');
  }

  async init() {
    await fs.mkdir(this.themesDir, { recursive: true });
    await this.ensureDefaultTheme();
    await this.loadThemes();
    await this.restoreActiveTheme();
    this.setActiveTheme(this.activeThemeId, { persist: false });
    return this.getThemes();
  }

  async ensureDefaultTheme() {
    for (const theme of [DEFAULT_THEME, ...BUNDLED_THEMES]) {
      const themeDir = path.join(this.themesDir, theme.id);
      await fs.mkdir(themeDir, { recursive: true });
      const themeDirStat = await fs.lstat(themeDir);
      if (!themeDirStat.isDirectory() || themeDirStat.isSymbolicLink()) throw new Error(`Theme directory must not be a symbolic link: ${theme.id}`);
      const themePath = path.join(themeDir, 'theme.json');
      try {
        await fs.access(themePath);
      } catch (error) {
        await fs.writeFile(themePath, JSON.stringify(theme, null, 2), 'utf8');
      }
      if (theme.id === 'vanta-glass' && theme.background?.image) {
        const assetPath = path.join(__dirname, '../data/themes/vanta-glass/background.jpg');
        const targetPath = path.join(themeDir, theme.background.image);
        try {
          const stat = await fs.lstat(targetPath);
          if (!stat.isFile() || stat.isSymbolicLink()) {
            if (stat.isSymbolicLink()) await fs.unlink(targetPath);
            await fs.copyFile(assetPath, targetPath);
          } else {
            const existing = await fs.readFile(targetPath);
            if (!isValidImageBytes(theme.background.image, existing)) await fs.copyFile(assetPath, targetPath);
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await fs.copyFile(assetPath, targetPath);
        }
      }
    }
  }

  async loadThemes() {
    this.themes = new Map();
    this.backgroundImageUrls = new Map();
    const entries = await fs.readdir(this.themesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const themePath = path.join(this.themesDir, entry.name, 'theme.json');
      try {
        const data = JSON.parse(await fs.readFile(themePath, 'utf8'));
        if (data && typeof data === 'object' && data.preview && !isValidPreviewData(data.preview)) delete data.preview;
        const normalized = normalizeTheme(data, this.themes.keys());
        const validation = this.validateTheme(normalized, this.themes.keys());
        if (!validation.valid) continue;
        if (normalized.background.image) {
          const imageUrl = await this.resolveBackgroundImage(normalized.background.image, path.dirname(themePath));
          this.backgroundImageUrls.set(normalized.id, imageUrl);
        }
        this.themes.set(normalized.id, normalized);
      } catch {
        // Ignore malformed or partially written theme directories.
      }
    }
    if (!this.themes.has(this.fallbackThemeId)) {
      const defaultTheme = normalizeTheme(DEFAULT_THEME, this.themes.keys());
      this.themes.set(defaultTheme.id, defaultTheme);
    }
    const ordered = [...this.themes.values()].sort((left, right) => left.name.localeCompare(right.name));
    this.themes = new Map(ordered.map((theme) => [theme.id, theme]));
    return [...this.themes.values()];
  }

  async restoreActiveTheme() {
    try {
      const file = await fs.readFile(this.stateFile, 'utf8');
      const persisted = JSON.parse(file);
      if (persisted && persisted.activeThemeId) {
        const persistedId = sanitizeThemeId(persisted.activeThemeId);
        if (this.themes.has(persistedId) || this.catalogThemes.has(persistedId)) this.activeThemeId = persistedId;
        else {
          this.pendingActiveThemeId = persistedId;
          this.activeThemeId = this.fallbackThemeId;
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!this.pendingActiveThemeId) {
      this.activeThemeId = this.resolveThemeId(this.activeThemeId);
      await this.persistActiveTheme();
    }
    return this.activeThemeId;
  }

  isAllowedCatalogPreviewUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && url.hostname === 'raw.githubusercontent.com'
        && (/^\/artem-prime42\/dota2-mod-manager-catalog\/main\/themes\/[a-z0-9_-]+\/preview\.(?:png|jpe?g|webp)$/i.test(url.pathname)
          || /^\/artem-prime42\/dota2-media\/main\/images\/[^/]+\.(?:png|jpe?g|webp)$/i.test(url.pathname));
    } catch { return false; }
  }

  isAllowedCatalogThemeDownloadUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && url.hostname === 'github.com'
        && /^\/artem-prime42\/dota2-mods\/releases\/download\/[^/]+\/[^/]+\.zip$/i.test(url.pathname)
        ? url.href
        : null;
    } catch { return null; }
  }

  async setCatalogThemes(items = []) {
    const next = new Map();
    const occupied = new Set(this.themes.keys());
    for (const raw of Array.isArray(items) ? items : []) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const catalogPreviewUrl = this.isAllowedCatalogPreviewUrl(raw.previewUrl) ? raw.previewUrl : null;
      const downloadUrl = this.isAllowedCatalogThemeDownloadUrl(raw.downloadUrl || raw.file);
      const candidate = { ...raw };
      delete candidate.previewUrl;
      delete candidate.catalogPreviewUrl;
      delete candidate.downloadUrl;
      delete candidate.file;
      delete candidate.createdAt;
      delete candidate.downloads;
      delete candidate.modType;
      delete candidate.categoryId;
      if (candidate.background?.image) continue;
      if (catalogPreviewUrl && !candidate.preview) candidate.preview = undefined;
      const candidateId = sanitizeThemeId(candidate.id);
      const occupiedIds = new Set([...occupied].filter((id) => id !== candidateId));
      const validation = this.validateTheme(candidate, new Set([...occupiedIds, ...next.keys()]));
      if (!validation.valid) continue;
      const theme = { ...validation.theme, source: 'catalog', catalogPreviewUrl, downloadUrl };
      next.set(theme.id, theme);
    }
    this.catalogThemes = next;
    if (this.pendingActiveThemeId && this.catalogThemes.has(this.pendingActiveThemeId)) {
      this.activeThemeId = this.pendingActiveThemeId;
      this.pendingActiveThemeId = null;
      await this.persistActiveTheme();
    }
    return this.getThemes();
  }

  async persistActiveTheme() {
    await fs.mkdir(this.themesDir, { recursive: true });
    const payload = JSON.stringify({ activeThemeId: this.resolveThemeId(this.activeThemeId) }, null, 2);
    await fs.writeFile(this.stateFile, payload, 'utf8');
  }

  resolveThemeId(themeId) {
    const next = sanitizeThemeId(themeId);
    if (!this.themes || !this.themes.size) return this.fallbackThemeId;
    return this.themes.has(next) || this.catalogThemes.has(next) ? next : this.fallbackThemeId;
  }

  getTheme(themeId) {
    const resolved = this.resolveThemeId(themeId);
    return this.themes.get(resolved) || this.catalogThemes.get(resolved) || this.themes.get(this.fallbackThemeId) || normalizeTheme(DEFAULT_THEME, this.themes.keys());
  }

  getActiveTheme() {
    return this.getTheme(this.activeThemeId);
  }

  getActiveThemeId() {
    return this.resolveThemeId(this.activeThemeId);
  }

  getThemeTemplate() {
    return createThemeTemplate();
  }

  getThemes() {
    const themes = [
      ...this.themes.values(),
      ...[...this.catalogThemes.entries()].filter(([id]) => !this.themes.has(id)).map(([, theme]) => theme),
    ];
    return themes.sort((left, right) => left.name.localeCompare(right.name)).map((theme) => ({
      ...theme,
      background: { ...theme.background, imageUrl: this.backgroundImageUrls.get(theme.id) || null },
      source: BUNDLED_THEME_IDS.has(theme.id) ? 'builtin' : (this.themes.has(theme.id) ? 'local' : 'catalog'),
      preview: this.catalogThemes.get(theme.id)?.catalogPreviewUrl || theme.catalogPreviewUrl || theme.preview || buildThemePreview(theme),
    }));
  }

  getThemePreview(themeId) {
    const theme = this.getTheme(themeId);
    return {
      ...theme,
      background: { ...theme.background, imageUrl: this.backgroundImageUrls.get(theme.id) || null },
      preview: this.catalogThemes.get(theme.id)?.catalogPreviewUrl || theme.catalogPreviewUrl || theme.preview || buildThemePreview(theme),
      source: BUNDLED_THEME_IDS.has(theme.id) ? 'builtin' : (this.themes.has(theme.id) ? 'local' : 'catalog'),
    };
  }

  searchThemes(query, themes = this.getThemes()) {
    const needle = String(query || '').trim().toLocaleLowerCase();
    const source = Array.isArray(themes) ? themes : [];
    if (!needle) return [...source];
    return source.filter((theme) => [theme.name, theme.author, theme.description]
      .some((value) => String(value || '').toLocaleLowerCase().includes(needle)));
  }

  validateTheme(theme, existingIds = this.themes ? this.themes.keys() : []) {
    const errors = [];
    const source = theme && typeof theme === 'object' ? theme : {};
    const existingSet = existingIds && typeof existingIds.has === 'function'
      ? existingIds
      : new Set(Array.isArray(existingIds) ? existingIds : (existingIds ? [...existingIds] : []));
    const normalized = normalizeTheme(source, existingSet);
    const allowedTopLevel = new Set(['id', 'name', 'author', 'version', 'description', 'translations', 'source', 'preview', 'colors', 'background', 'effects', 'shape']);
    for (const key of Object.keys(source)) {
      if (!allowedTopLevel.has(key)) errors.push(`Unknown theme field: ${key}`);
    }
    if (!source.id || !String(source.id).trim()) errors.push('Theme id is required');
    else {
      const id = sanitizeThemeId(source.id);
      if (id !== source.id && !/^[a-z0-9][a-z0-9-]*$/i.test(String(source.id).trim())) {
        errors.push('Theme id must contain only letters, numbers, dashes, or underscores.');
      }
      if (existingSet.has(id)) {
        errors.push(`Theme id is a duplicate and already in use: ${id}`);
      }
    }
    if (!source.name || !String(source.name).trim()) errors.push('Theme name is required');
    if (!source.author || !String(source.author).trim()) errors.push('Theme author is required');
    if (!source.version || !String(source.version).trim()) errors.push('Theme version is required');
    if (source.translations !== undefined) {
      if (!source.translations || typeof source.translations !== 'object' || Array.isArray(source.translations)) errors.push('Theme translations must be an object with ru/en fields');
      else {
        for (const language of Object.keys(source.translations)) {
          if (!['ru', 'en'].includes(language)) { errors.push(`Unsupported theme translation language: ${language}`); continue; }
          const locale = source.translations[language];
          if (!locale || typeof locale !== 'object' || Array.isArray(locale)) { errors.push(`Theme ${language} translation must be an object`); continue; }
          for (const key of Object.keys(locale)) if (!['name', 'description'].includes(key)) errors.push(`Unsupported ${language} translation field: ${key}`);
          if (locale.name !== undefined && (typeof locale.name !== 'string' || locale.name.length > 100)) errors.push(`Theme ${language} name must be text of 100 characters or fewer`);
          if (locale.description !== undefined && (typeof locale.description !== 'string' || locale.description.length > 500)) errors.push(`Theme ${language} description must be text of 500 characters or fewer`);
        }
      }
    }
    if (!source.colors || typeof source.colors !== 'object' || Array.isArray(source.colors)) {
      errors.push('Theme colors must be an object');
      return { valid: false, errors, theme: normalized };
    }
    const extraTokenKeys = Object.keys(source.colors).filter((token) => !SEMANTIC_THEME_TOKENS.includes(token));
    if (extraTokenKeys.length) errors.push(`Unsupported theme tokens: ${extraTokenKeys.join(', ')}`);
    for (const token of SEMANTIC_THEME_TOKENS) {
      const value = source.colors[token];
      if (value === undefined || value === null || value === '') errors.push(`Theme color ${token} is required`);
      else if (!isValidColor(String(value))) errors.push(`Theme color ${token} must be a valid CSS color string`);
    }
    if (source.preview !== undefined && source.preview !== null && !isValidPreviewData(source.preview)) errors.push('Theme preview must be a local PNG data image no larger than 5 MB');
    if (source.background !== undefined) {
      if (!source.background || typeof source.background !== 'object' || Array.isArray(source.background)) errors.push('Theme background must be an object');
      else {
        const allowed = new Set(['image', 'position', 'size', 'repeat', 'opacity', 'overlay', 'gradient']);
        for (const key of Object.keys(source.background)) if (!allowed.has(key)) errors.push(`Unsupported background field: ${key}`);
        const background = normalized.background;
        if (Object.hasOwn(source.background, 'image') && !isSafeImageFilename(source.background.image)) errors.push('Background image must be a PNG, JPG, JPEG, or WebP file name inside the theme folder');
        for (const key of ['position', 'size', 'repeat', 'overlay']) {
          if (Object.hasOwn(source.background, key) && typeof source.background[key] !== 'string') errors.push(`Background ${key} must be a string`);
        }
        if (!BACKGROUND_POSITIONS.has(background.position)) errors.push('Background position is invalid');
        if (!BACKGROUND_SIZES.has(background.size)) errors.push('Background size must be cover, contain, or auto');
        if (!BACKGROUND_REPEATS.has(background.repeat)) errors.push('Background repeat is invalid');
        if ((Object.hasOwn(source.background, 'opacity') && typeof source.background.opacity !== 'number') || typeof background.opacity !== 'number' || !Number.isFinite(background.opacity) || background.opacity < 0 || background.opacity > 1) errors.push('Background opacity must be a number between 0 and 1');
        if (!isValidColor(String(Object.hasOwn(source.background, 'overlay') ? source.background.overlay : background.overlay))) errors.push('Background overlay must be a safe color value');
        if (Object.hasOwn(source.background, 'gradient')) {
          const gradient = source.background.gradient;
          if (!gradient || typeof gradient !== 'object' || Array.isArray(gradient)) errors.push('Background gradient must be an object');
          else {
            for (const key of Object.keys(gradient)) if (!['type', 'angle', 'colors'].includes(key)) errors.push(`Unsupported gradient field: ${key}`);
            if (gradient.type !== 'linear') errors.push('Background gradient type must be linear');
            if (typeof gradient.angle !== 'number' || !Number.isFinite(gradient.angle) || gradient.angle < 0 || gradient.angle > 360) errors.push('Gradient angle must be a number between 0 and 360 degrees');
            if (!Array.isArray(gradient.colors) || gradient.colors.length < 2 || gradient.colors.length > 5 || gradient.colors.some((color) => !isValidColor(color))) errors.push('Gradient must contain 2 to 5 safe colors');
          }
        }
      }
    }
    if (source.effects !== undefined) {
      if (!source.effects || typeof source.effects !== 'object' || Array.isArray(source.effects)) errors.push('Theme effects must be an object');
      else {
        const allowed = new Set(['blurSurface', 'blurSidebar', 'blurModal', 'shadowSmall', 'shadowMedium', 'shadowLarge']);
        for (const key of Object.keys(source.effects)) if (!allowed.has(key)) errors.push(`Unsupported effect: ${key}`);
        for (const key of ['blurSurface', 'blurSidebar', 'blurModal']) {
          const value = normalized.effects[key];
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 24) errors.push(`${key} must be a number between 0 and 24 pixels`);
        }
        for (const key of ['shadowSmall', 'shadowMedium', 'shadowLarge']) {
          const value = Object.hasOwn(source.effects, key) ? source.effects[key] : normalized.effects[key];
          if (!isValidColor(String(value))) errors.push(`${key} must be a safe color value`);
        }
      }
    }
    if (source.shape !== undefined) {
      if (!source.shape || typeof source.shape !== 'object' || Array.isArray(source.shape)) errors.push('Theme shape must be an object');
      else {
        const allowed = new Set(['radiusSmall', 'radiusMedium', 'radiusLarge']);
        for (const key of Object.keys(source.shape)) if (!allowed.has(key)) errors.push(`Unsupported shape field: ${key}`);
        for (const key of ['radiusSmall', 'radiusMedium', 'radiusLarge']) {
          const value = normalized.shape[key];
          if ((Object.hasOwn(source.shape, key) && typeof source.shape[key] !== 'number') || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 32) errors.push(`${key} must be a number between 0 and 32 pixels`);
        }
      }
    }
    return { valid: errors.length === 0, errors, theme: normalized };
  }

  async resolveBackgroundImage(filename, themeDirectory) {
    const { realPath } = await this.readBackgroundImage(filename, themeDirectory);
    return pathToFileURL(realPath).href;
  }

  async readBackgroundImage(filename, themeDirectory) {
    if (!isSafeImageFilename(filename)) throw new Error('Background image must be a PNG, JPG, JPEG, or WebP file name inside the theme folder.');
    const realDirectory = await fs.realpath(themeDirectory);
    const imagePath = path.resolve(realDirectory, filename);
    if (path.dirname(imagePath) !== realDirectory) throw new Error('Background image path must stay inside the theme folder.');
    let stat;
    try { stat = await fs.lstat(imagePath); }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error(`Background image is missing beside theme.json: ${filename}`);
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Background image must be a regular file inside the theme folder.');
    const realPath = await fs.realpath(imagePath);
    const relative = path.relative(realDirectory, realPath);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Background image path must stay inside the theme folder.');
    if (stat.size > MAX_BACKGROUND_BYTES) throw new Error('Background image must be 10 MB or smaller.');
    const bytes = await fs.readFile(realPath);
    if (!isValidImageBytes(filename, bytes)) throw new Error('Background image format does not match its PNG, JPG, JPEG, or WebP extension.');
    return { realPath, bytes };
  }

  async writeThemeAsset(themeDirectory, filename, bytes) {
    if (!isValidImageBytes(filename, bytes)) throw new Error('Background image must be a valid PNG, JPG, JPEG, or WebP file no larger than 10 MB.');
    await fs.mkdir(themeDirectory, { recursive: true });
    const targetPath = path.join(themeDirectory, filename);
    const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      const existing = await fs.lstat(targetPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (existing) {
        if (existing.isDirectory() && !existing.isSymbolicLink()) throw new Error('Background image path is occupied by a directory.');
        await fs.unlink(targetPath);
      }
      await fs.writeFile(temporaryPath, bytes, { flag: 'wx' });
      await fs.rename(temporaryPath, targetPath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
  }

  async setActiveTheme(themeId, { persist = true } = {}) {
    const resolved = this.resolveThemeId(themeId);
    this.activeThemeId = resolved;
    if (persist) {
      this.pendingActiveThemeId = null;
      await this.persistActiveTheme();
    }
    return this.getActiveTheme();
  }

  async importThemeFromObject(theme, { persist = true, assets = {} } = {}) {
    const validation = this.validateTheme(theme, this.themes.keys());
    if (!validation.valid) throw new Error(validation.errors.join('; '));
    const normalized = validation.theme;
    const directory = path.join(this.themesDir, normalized.id);
    await fs.mkdir(directory, { recursive: true });
    const directoryStat = await fs.lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('Theme destination must be a normal directory.');
    if (persist) {
      if (normalized.background.image) {
        const providedAsset = assets[normalized.background.image];
        if (providedAsset) await this.writeThemeAsset(directory, normalized.background.image, providedAsset);
        const imageUrl = await this.resolveBackgroundImage(normalized.background.image, directory);
        this.backgroundImageUrls.set(normalized.id, imageUrl);
      } else {
        this.backgroundImageUrls.delete(normalized.id);
      }
      await fs.writeFile(path.join(directory, 'theme.json'), JSON.stringify(normalized, null, 2), 'utf8');
      this.themes.set(normalized.id, normalized);
    }
    return normalized;
  }

  async importTheme(themePath) {
    const resolvedPath = path.resolve(themePath);
    const ext = path.extname(resolvedPath).toLowerCase();
    if (ext === '.json') {
      const stat = await fs.stat(resolvedPath);
      if (stat.size > MAX_THEME_JSON_BYTES) throw new Error('Theme JSON must be 8 MB or smaller.');
      const raw = JSON.parse(await fs.readFile(resolvedPath, 'utf8'));
      const validation = this.validateTheme(raw, this.themes.keys());
      if (!validation.valid) throw new Error(validation.errors.join('; '));
      const assets = {};
      if (validation.theme.background.image) {
        const { bytes } = await this.readBackgroundImage(validation.theme.background.image, path.dirname(resolvedPath));
        assets[validation.theme.background.image] = bytes;
      }
      return this.importThemeFromObject(raw, { persist: true, assets });
    }
    if (ext === '.zip' || ext === '.vanta-theme') {
      const archiveStat = await fs.stat(resolvedPath);
      if (archiveStat.size > 20 * 1024 * 1024) throw new Error('Theme archive must be 20 MB or smaller.');
      let zip;
      try {
        zip = require('adm-zip');
      } catch (error) {
        throw new Error('ZIP imports require the adm-zip dependency.');
      }
      const archive = new zip(resolvedPath);
      const entries = archive.getEntries();
      const archiveName = (entry) => {
        const name = entry.entryName.replace(/\\/g, '/');
        if (name.includes('\0') || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..')) throw new Error('ZIP theme contains an unsafe path');
        return name;
      };
      for (const entry of entries) archiveName(entry);
      const themeEntry = entries.find((entry) => /(?:^|\/)theme\.json$/i.test(archiveName(entry)) && !entry.isDirectory);
      if (!themeEntry) throw new Error('ZIP theme does not contain a theme.json file');
      if (Number(themeEntry.header?.size || 0) > MAX_THEME_JSON_BYTES) throw new Error('Theme JSON must be 8 MB or smaller.');
      const normalizedEntry = archiveName(themeEntry);
      const raw = JSON.parse(themeEntry.getData().toString('utf8'));
      const validation = this.validateTheme(raw, this.themes.keys());
      if (!validation.valid) throw new Error(validation.errors.join('; '));
      const themeDirectory = path.posix.dirname(normalizedEntry);
      const previewEntry = entries.find((entry) => {
        const normalizedName = archiveName(entry);
        return !entry.isDirectory
          && path.posix.dirname(normalizedName) === themeDirectory
          && /^preview\.png$/i.test(path.posix.basename(normalizedName));
      });
      const assets = {};
      if (validation.theme.background.image) {
        const backgroundEntry = entries.find((entry) => !entry.isDirectory
          && path.posix.dirname(archiveName(entry)) === themeDirectory
          && path.posix.basename(archiveName(entry)) === validation.theme.background.image);
        if (!backgroundEntry) throw new Error(`Theme archive is missing background image: ${validation.theme.background.image}`);
        if (Number(backgroundEntry.header?.size || 0) > MAX_BACKGROUND_BYTES) throw new Error('Background image must be 10 MB or smaller.');
        assets[validation.theme.background.image] = backgroundEntry.getData();
        if (!isValidImageBytes(validation.theme.background.image, assets[validation.theme.background.image])) throw new Error('Background image format does not match its extension.');
      }
      if (previewEntry) {
        if (Number(previewEntry.header?.size || 0) > MAX_PREVIEW_BYTES) throw new Error('Theme preview.png must be 5 MB or smaller');
        const image = previewEntry.getData();
        if (!isValidImageBytes('preview.png', image)) throw new Error('Theme preview.png is not a valid PNG image');
        raw.preview = `data:image/png;base64,${image.toString('base64')}`;
      }
      return this.importThemeFromObject(raw, { persist: true, assets });
    }
    throw new Error('Theme imports must be .json or .vanta-theme files');
  }

  async removeTheme(themeId) {
    const resolved = sanitizeThemeId(themeId);
    if (this.catalogThemes.has(resolved) && !this.themes.has(resolved)) throw new Error('Catalog themes cannot be removed from the local theme store.');
    if (!resolved || BUNDLED_THEME_IDS.has(resolved)) {
      throw new Error('Built-in themes cannot be removed');
    }
    const themeDir = path.join(this.themesDir, resolved);
    await fs.rm(themeDir, { recursive: true, force: true });
    this.themes.delete(resolved);
    this.backgroundImageUrls.delete(resolved);
    if (this.activeThemeId === resolved) {
      this.activeThemeId = this.fallbackThemeId;
      await this.persistActiveTheme();
    }
    return this.getActiveTheme();
  }
}

module.exports = { ThemeManager, DEFAULT_THEME, BUNDLED_THEMES, SEMANTIC_THEME_TOKENS, createThemeTemplate };
