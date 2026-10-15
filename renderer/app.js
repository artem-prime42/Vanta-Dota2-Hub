window.vanta.onUpdateEvent?.(handleUpdateEvent);
const state = { view: 'discover', query: '', category: 'all', section: 'heroes', lastModsSection: 'heroes', recentExpanded: false, hero: '', heroQuery: '', heroSlot: 'all', heroDirectoryFilters: { attribute: 'all', rarity: 'all', tag: 'all', sort: 'all' }, author: '', authorQuery: '', authorSort: 'default', librarySelection: new Set(), archiveSelection: new Set(), themeFilter: 'all', themeQuery: '', themeReturnView: null, update: { status: 'idle', version: null, progress: 0, error: null }, data: { mods: [], categories: [], installed: {}, favorites: [], authors: [], packs: [], savedPacks: [], archives: [] } };
const catalogPageCache = new Map();
document.querySelector('#refresh')?.addEventListener?.('click', () => catalogPageCache.clear(), true);
const CATEGORY_LABELS = new Proxy({ heroes: 'Heroes', 'hero-items': 'Hero items', herofx: 'Hero effects', 'hero-sounds': 'Hero sounds', sounds: 'Sounds', announcers: 'Announcers', music: 'Music', 'mega-kill': 'Mega-kills', terrains: 'Terrains', trees: 'Trees', river: 'River', creeps: 'Creeps', towers: 'Towers', weather: 'Weather', roshan: 'Roshan', ancient: 'Ancients', tormentor: 'Tormentor', wards: 'Wards', couriers: 'Couriers', pedestal: 'Pedestals', 'creep-deny': 'Deny creeps', backgrounds: 'Menu backgrounds', huds: 'HUDs', emblems: 'Emblems', 'versus-screens': 'Versus Screen', 'item-icons': 'Item icons', ranks: 'Ranks', pings: 'Pings', cursors: 'Cursors', shaders: 'Shaders', 'ti-bp-effects': 'Effect packs', 'item-effects': 'Item effects', 'ranged-attack': 'Ranged attacks', 'high-five': 'High five', packs: 'Packs', optimization: 'Optimization', other: 'Other', sites: 'Sites' }, {
  get(target, property) {
    if (typeof property !== 'string') return Reflect.get(target, property);
    const fallback = property === 'themes'
      ? (state.data?.settings?.appLanguage === 'ru' ? 'Темы' : 'Themes')
      : target[property] ?? property;
    const translationMap = {
      heroes: 'catalog.filterHeroes',
      'hero-items': 'catalog.filterHeroItems',
      herofx: 'catalog.filterHeroEffects',
      'hero-sounds': 'catalog.filterHeroSounds',
      sounds: 'catalog.filterSounds',
      announcers: 'catalog.filterAnnouncers',
      music: 'catalog.filterMusic',
      'mega-kill': 'catalog.filterMegaKills',
      terrains: 'catalog.filterTerrains',
      terrain: 'catalog.filterTerrains',
      landscapes: 'catalog.filterTerrains',
      landscape: 'catalog.filterTerrains',
      trees: 'catalog.filterTrees',
      river: 'catalog.filterRiver',
      creeps: 'catalog.filterCreeps',
      towers: 'catalog.filterTowers',
      weather: 'catalog.filterWeather',
      roshan: 'catalog.filterRoshan',
      ancient: 'catalog.filterAncient',
      tormentor: 'catalog.filterTormentor',
      wards: 'catalog.filterWards',
      couriers: 'catalog.filterCouriers',
      pedestal: 'catalog.filterPedestal',
      'creep-deny': 'catalog.filterCreepDeny',
      backgrounds: 'catalog.filterBackgrounds',
      huds: 'catalog.filterHuds',
      emblems: 'catalog.filterEmblems',
      'versus-screens': 'catalog.filterVersusScreens',
      'item-icons': 'catalog.filterItemIcons',
      ranks: 'catalog.filterRanks',
      pings: 'catalog.filterPings',
      cursors: 'catalog.filterCursors',
      shaders: 'catalog.filterShaders',
      'ti-bp-effects': 'catalog.filterTiBpEffects',
      'item-effects': 'catalog.filterItemEffects',
      'ranged-attack': 'catalog.filterRangedAttack',
      'high-five': 'catalog.filterHighFive',
      packs: 'catalog.filterVersusScreens',
      mount: 'catalog.filterMount',
      mounts: 'catalog.filterMount',
      optimization: 'catalog.filterOptimization',
      other: 'catalog.filterOther',
      sites: 'catalog.filterSites'
    };
    return translationMap[property] ? t(translationMap[property], fallback) : fallback;
  }
});
const HERO_PORTRAIT_BASE = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/';
const MOD_SECTION_CATEGORIES = {
  heroes: new Set(['heroes', 'hero-items', 'herofx']),
  world: new Set(['terrains', 'terrain', 'landscapes', 'landscape', 'maps', 'map', 'trees', 'river', 'creeps', 'towers', 'weather', 'roshan', 'ancient', 'tormentor', 'wards', 'couriers', 'creep-deny']),
  interface: new Set(['backgrounds', 'huds', 'emblems', 'versus-screens', 'item-icons', 'ranks', 'pings', 'cursors', 'announcers', 'mega-kill', 'music', 'fonts', 'packs']),
  effects: new Set(['shaders', 'ti-bp-effects', 'item-effects', 'ranged-attack', 'high-five']),
  other: new Set(['hero-sounds', 'sounds', 'optimization', 'other', 'sites', 'pedestal']),
};
const VISIBLE_MOD_SECTIONS = new Set(['heroes', 'world', 'interface']);
function normalizedCatalogCategory(value) {
  const category = String(value || '').trim().toLowerCase().replace(/[ _]+/g, '-');
  return ['terrain', 'terrains', 'landscape', 'landscapes', 'map', 'maps'].includes(category) ? 'terrains' : category;
}
const HERO_PORTRAIT_ALIASES = { 'anti mage': 'antimage', 'anti-mage': 'antimage', anti_mage: 'antimage', clockwerk: 'rattletrap', doom: 'doom_bringer', io: 'wisp', lifestealer: 'life_stealer', magnus: 'magnataur', 'nature prophet': 'furion', necrophos: 'necrolyte', outworld_devourer: 'obsidian_destroyer', 'outworld devourer': 'obsidian_destroyer', 'queen of pain': 'queenofpain', 'shadow fiend': 'nevermore', timbersaw: 'shredder', 'treant protector': 'treant', underlord: 'abyssal_underlord', 'vengeful spirit': 'vengefulspirit', wraith_king: 'skeleton_king', windranger: 'windrunner', zeus: 'zuus' };
const HERO_ID_TO_KEY = { 1: 'anti_mage', 2: 'axe', 3: 'bane', 4: 'bloodseeker', 5: 'crystal_maiden', 6: 'drow_ranger', 7: 'earthshaker', 8: 'juggernaut', 9: 'mirana', 10: 'morphling', 11: 'shadow_fiend', 12: 'phantom_lancer', 13: 'puck', 14: 'pudge', 15: 'razor', 16: 'sand_king', 17: 'storm_spirit', 18: 'sven', 19: 'tiny', 20: 'vengeful_spirit', 21: 'windranger', 22: 'zeus', 23: 'kunkka', 25: 'lina', 26: 'lion', 27: 'shadow_shaman', 28: 'slardar', 29: 'tidehunter', 30: 'witch_doctor', 31: 'lich', 32: 'riki', 33: 'enigma', 34: 'tinker', 35: 'sniper', 36: 'necrophos', 37: 'warlock', 38: 'beastmaster', 39: 'queen_of_pain', 40: 'venomancer', 41: 'faceless_void', 42: 'wraith_king', 43: 'death_prophet', 44: 'phantom_assassin', 45: 'pugna', 46: 'templar_assassin', 47: 'viper', 48: 'luna', 49: 'dragon_knight', 50: 'dazzle', 51: 'clockwerk', 52: 'leshrac', 53: 'nature_prophet', 54: 'lifestealer', 55: 'dark_seer', 56: 'clinkz', 57: 'omniknight', 58: 'enchantress', 59: 'huskar', 60: 'night_stalker', 61: 'broodmother', 62: 'bounty_hunter', 63: 'weaver', 64: 'jakiro', 65: 'batrider', 66: 'chen', 67: 'spectre', 68: 'ancient_apparition', 69: 'doom', 70: 'ursa', 71: 'spirit_breaker', 72: 'gyrocopter', 73: 'alchemist', 74: 'invoker', 75: 'silencer', 76: 'outworld_devourer', 77: 'lycan', 78: 'brewmaster', 79: 'shadow_demon', 80: 'lone_druid', 81: 'chaos_knight', 82: 'meepo', 83: 'treant_protector', 84: 'ogre_magi', 85: 'undying', 86: 'rubick', 87: 'disruptor', 88: 'nyx_assassin', 89: 'naga_siren', 90: 'keeper_of_the_light', 91: 'io', 92: 'visage', 93: 'slark', 94: 'medusa', 95: 'troll_warlord', 96: 'centaur', 97: 'magnus', 98: 'timbersaw', 99: 'bristleback', 100: 'tusk', 101: 'skywrath_mage', 102: 'abaddon', 103: 'elder_titan', 104: 'legion_commander', 105: 'techies', 106: 'ember_spirit', 107: 'earth_spirit', 108: 'underlord', 109: 'terrorblade', 110: 'phoenix', 111: 'oracle', 112: 'winter_wyvern', 113: 'arc_warden', 114: 'monkey_king', 119: 'dark_willow', 120: 'pangolier', 121: 'grimstroke', 123: 'hoodwink', 126: 'void_spirit', 128: 'snapfire', 129: 'mars', 131: 'ringmaster', 135: 'dawnbreaker', 136: 'marci', 137: 'primal_beast', 138: 'muerta', 145: 'kez', 155: 'largo' };
function normalizeHeroId(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return HERO_ID_TO_KEY[Number(raw)] || raw;
  const aliases = {
    'anti mage': 'anti_mage', 'anti-mage': 'anti_mage', antimage: 'anti_mage',
    'nature prophet': 'nature_prophet', "nature's prophet": 'nature_prophet', 'natures prophet': 'nature_prophet', furion: 'nature_prophet',
    'outworld devourer': 'outworld_devourer', 'outworld-devourer': 'outworld_devourer', 'outworld destroyer': 'outworld_devourer', 'outworld-destroyer': 'outworld_devourer', outworld_destroyer: 'outworld_devourer', 'obsidian destroyer': 'outworld_devourer', 'obsidian-destroyer': 'outworld_devourer', obsidian_destroyer: 'outworld_devourer',
    'queen of pain': 'queen_of_pain', 'queen-of-pain': 'queen_of_pain', queenofpain: 'queen_of_pain',
    'shadow fiend': 'shadow_fiend', 'shadow-fiend': 'shadow_fiend', nevermore: 'shadow_fiend',
    treant: 'treant_protector', 'treant protector': 'treant_protector', 'treant-protector': 'treant_protector',
    'vengeful spirit': 'vengeful_spirit', 'vengeful-spirit': 'vengeful_spirit', vengefulspirit: 'vengeful_spirit',
    windrunner: 'windranger', 'rattletrap': 'clockwerk', wisp: 'io', 'life stealer': 'lifestealer', 'life-stealer': 'lifestealer', magnataur: 'magnus', abyssal_underlord: 'underlord', abyssalunderlord: 'underlord', 'abyssal underlord': 'underlord', 'abyssal-underlord': 'underlord', shredder: 'timbersaw',
  };
  return aliases[raw] || raw.replace(/['’.-]+/g, ' ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
function heroPortraitId(hero) { const value = normalizeHeroId(hero); return HERO_PORTRAIT_ALIASES[value] || value; }
const $ = (selector) => document.querySelector(selector);
const call = async (channel, payload) => { const response = await window.vanta.call(channel, payload); if (!response.ok) throw new Error(response.error); return response.data; };
if (typeof window.addEventListener === 'function') {
  window.addEventListener('error', (event) => { window.vanta.call('diagnostics:renderer-log', { level: 'error', message: event.message, stack: event.error?.stack || '' }).catch(() => {}); });
  window.addEventListener('unhandledrejection', (event) => { const reason = event.reason; window.vanta.call('diagnostics:renderer-log', { level: 'error', message: reason?.message || String(reason), stack: reason?.stack || '' }).catch(() => {}); });
}
function toast(message) { const node = $('#toast'); if (!node) return; node.textContent = window.i18n?.localizeToast?.(message) ?? message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 3500); }
const downloadProgressTasks = new Map();
function downloadProgressText(ru, en) { return state.data?.settings?.appLanguage === 'ru' ? ru : en; }
function formatDownloadedBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
function localizedDownloadPhase(task) {
  if (state.data?.settings?.appLanguage !== 'ru') return task.phase || 'Preparing…';
  const phases = {
    'Preparing download': 'Подготовка скачивания',
    'Downloading': 'Скачивание архива',
    'Download complete': 'Архив скачан',
    'Download already cached': 'Архив уже скачан',
    'Preparing mod files': 'Подготовка файлов мода',
    'Installing into Dota 2': 'Установка в Dota 2',
    'Installed': 'Мод установлен',
    'Importing theme': 'Импорт темы',
    'Theme installed': 'Тема установлена',
    'Download failed': 'Ошибка скачивания',
    'Installation failed': 'Ошибка установки',
  };
  return phases[task.phase] || window.i18n?.localizeToast?.(task.phase || 'Подготовка…') || task.phase || 'Подготовка…';
}
function renderDownloadProgress() {
  const panel = $('#download-progress-panel');
  if (!panel) return;
  const tasks = [...downloadProgressTasks.values()];
  panel.hidden = tasks.length === 0;
  panel.innerHTML = tasks.map((task) => {
    const isDownloading = task.state === 'downloading';
    const hasPercent = task.percent !== null && task.percent !== undefined && Number.isFinite(Number(task.percent));
    const percent = hasPercent ? Math.max(0, Math.min(100, Number(task.percent))) : null;
    const barWidth = percent === null ? 100 : percent;
    const active = task.state !== 'failed' && task.state !== 'canceled' && task.state !== 'completed';
    return `<div class="download-progress-item ${active ? 'is-active' : task.state}"><div class="download-progress-heading"><strong></strong><span class="download-progress-status"></span></div><div class="download-progress-phase"></div><div class="download-progress-track ${percent === null && active ? 'is-indeterminate' : ''}"><span style="width:${barWidth}%"></span></div><small class="download-progress-details"></small></div>`;
  }).join('');
  tasks.forEach((task, index) => {
    const item = panel.children[index];
    const mod = state.data?.mods?.find((candidate) => candidate.id === task.id)
      || state.data?.authorThemes?.find((candidate) => candidate.id === task.id)
      || state.data?.installed?.[task.id];
    item.querySelector('strong').textContent = task.name || mod?.name || task.id;
    const hasPercent = task.percent !== null && task.percent !== undefined && Number.isFinite(Number(task.percent));
    item.querySelector('.download-progress-status').textContent = task.state === 'downloading'
      ? (hasPercent ? `${Math.round(task.percent)}%` : '…')
      : task.state === 'completed' ? '100%'
        : task.state === 'failed' ? downloadProgressText('Ошибка', 'Failed')
          : task.state === 'canceled' ? downloadProgressText('Отменено', 'Canceled') : downloadProgressText('Установка', 'Installing');
    item.querySelector('.download-progress-phase').textContent = localizedDownloadPhase(task);
    const details = task.state === 'downloading'
      ? (hasPercent
        ? `${Math.round(task.percent)}% · ${formatDownloadedBytes(task.loaded)} / ${formatDownloadedBytes(task.total)}`
        : `${formatDownloadedBytes(task.loaded)} · ${downloadProgressText('размер неизвестен', 'size unknown')}`)
      : window.i18n?.localizeToast?.(task.error || task.phase || '') || task.error || task.phase || '';
    item.querySelector('.download-progress-details').textContent = details;
    const progressBar = item.querySelector('.download-progress-track span');
    progressBar.style.width = `${task.state === 'completed' ? 100 : hasPercent ? Math.max(0, Math.min(100, Number(task.percent))) : 100}%`;
    item.classList.toggle('is-indeterminate', task.state !== 'downloading' && task.state !== 'completed' && task.state !== 'failed' && task.state !== 'canceled');
  });
}
function updateDownloadProgress(event) {
  if (!event || !['mod-install', 'theme-install', 'special-patch', 'library-reinstall'].includes(event.operation)) return;
  if (event.operation === 'library-reinstall' && event.id !== 'library-reinstall') return;
  const key = `${event.operation}:${event.id}`;
  const previous = downloadProgressTasks.get(key);
  if (previous?.dismissTimer) clearTimeout(previous.dismissTimer);
  const task = { ...previous, ...event, dismissTimer: null };
  if (event.state === 'completed' || event.state === 'failed' || event.state === 'canceled') {
    task.dismissTimer = setTimeout(() => { downloadProgressTasks.delete(key); renderDownloadProgress(); }, event.state === 'completed' ? 5000 : 10000);
  }
  downloadProgressTasks.set(key, task);
  renderDownloadProgress();
}
function renderUpdatePanel() {
  const panel = $('#update-panel');
  if (!panel) return;
  const update = state.update;
  if (!['available', 'downloading', 'downloaded', 'error'].includes(update.status)) { panel.hidden = true; panel.innerHTML = ''; return; }
  const version = escapeHtml(update.version || '');
  const copy = update.status === 'available'
    ? `<strong>${t('update.availableTitle', 'Update available')}</strong><p>${formatTranslation(t('update.availableMessage', 'VANTA {version} is ready.'), { version })}</p><div class="update-actions"><button class="action" data-update-download>${t('update.download', 'Update')}</button><button class="action secondary" data-update-later>${t('update.later', 'Later')}</button></div>`
    : update.status === 'downloading'
      ? `<strong>${t('update.downloadingTitle', 'Updating VANTA')}</strong><p>${t('update.downloadingMessage', 'Downloading the new version...')}</p><div class="update-progress"><span style="width:${Math.max(0, Math.min(100, Number(update.progress) || 0))}%"></span></div><small>${Math.round(update.progress || 0)}%</small>`
      : update.status === 'downloaded'
        ? `<strong>${t('update.readyTitle', 'Update ready')}</strong><p>${formatTranslation(t('update.readyMessage', 'VANTA {version} is ready to install.'), { version })}</p><div class="update-actions"><button class="action" data-update-install>${t('update.restart', 'Restart and update')}</button><button class="action secondary" data-update-later>${t('update.later', 'Later')}</button></div>`
        : `<strong>${t('update.errorTitle', 'VANTA update failed')}</strong><p>${escapeHtml(update.error || t('update.errorMessage', 'The update could not be completed.'))}</p><div class="update-actions"><button class="action" data-update-retry>${t('update.retry', 'Retry')}</button><button class="action secondary" data-update-later>${t('update.later', 'Later')}</button></div>`;
  panel.innerHTML = copy;
  panel.hidden = false;
  panel.querySelector('[data-update-download]')?.addEventListener('click', () => call('update:download'));
  panel.querySelector('[data-update-install]')?.addEventListener('click', () => call('update:install'));
  panel.querySelector('[data-update-retry]')?.addEventListener('click', () => call('update:check', { manual: true }));
  panel.querySelector('[data-update-later]')?.addEventListener('click', () => { panel.hidden = true; });
}
function handleUpdateEvent(update) { state.update = { ...state.update, ...update }; renderUpdatePanel(); }
function closeAnimatedDialog(dialog, payload, resolve) {
  if (!dialog.open || dialog.classList.contains('is-closing')) return;
  dialog.classList.add('is-closing');
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    dialog.removeEventListener('animationend', finish);
    dialog.close();
    dialog.remove();
    resolve(payload);
  };
  dialog.addEventListener('animationend', finish);
  setTimeout(finish, 220);
}
function showComingSoonDialog(section) {
  const isRussian = state.data?.settings?.appLanguage === 'ru';
  const sectionName = t(section === 'world' ? 'top.world' : 'top.interface', section);
  const dialog = document.createElement('dialog');
  dialog.className = 'app-modal-dialog coming-soon-dialog';
  dialog.setAttribute('aria-labelledby', 'coming-soon-title');
  dialog.setAttribute('aria-describedby', 'coming-soon-message');
  dialog.innerHTML = `
    <div class="app-modal-form coming-soon-form">
      <span class="coming-soon-icon" aria-hidden="true">✦</span>
      <p class="eyebrow coming-soon-kicker">VANTA · ${escapeHtml(sectionName)}</p>
      <h2 id="coming-soon-title">${isRussian ? 'В разработке' : 'Under development'}</h2>
      <p class="app-modal-message coming-soon-message" id="coming-soon-message">${isRussian
        ? `Раздел «${escapeHtml(sectionName)}» появится в одном из следующих обновлений.`
        : `The ${escapeHtml(sectionName)} section is coming in a future update.`}</p>
      <div class="app-modal-actions coming-soon-actions">
        <button type="button" class="action coming-soon-ok">${isRussian ? 'Ок' : 'OK'}</button>
      </div>
    </div>`;
  const close = () => closeAnimatedDialog(dialog, undefined, () => {});
  dialog.querySelector('.coming-soon-ok').addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
  document.body.appendChild(dialog);
  dialog.showModal();
  dialog.querySelector('.coming-soon-ok').focus({ preventScroll: true });
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function showAppInputDialog({ title, message = '', label = '', value = '', placeholder = '', confirmLabel = t('common.save', 'Save'), cancelLabel = t('common.cancel', 'Cancel'), maxLength = 80, validate = () => '' }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-modal-dialog';
    dialog.innerHTML = `
      <form class="app-modal-form" method="dialog">
        <div class="app-modal-header">
          <h2>${escapeHtml(title || '')}</h2>
          <button type="button" class="dialog-close app-modal-close" aria-label="${escapeHtml(t('common.close', 'Close'))}">×</button>
        </div>
        ${message ? `<p class="app-modal-message">${escapeHtml(message)}</p>` : ''}
        ${label ? `<label class="app-modal-label" for="app-modal-input">${escapeHtml(label)}</label>` : ''}
        <input id="app-modal-input" class="app-modal-input" type="text" value="${escapeHtml(value)}" maxlength="${Number.isFinite(maxLength) ? maxLength : 80}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" spellcheck="false" />
        <div class="app-modal-error" role="alert" hidden></div>
        <div class="app-modal-actions">
          <button type="button" class="action secondary app-modal-cancel">${escapeHtml(cancelLabel)}</button>
          <button type="submit" class="action app-modal-submit">${escapeHtml(confirmLabel)}</button>
        </div>
      </form>
    `;
    const input = dialog.querySelector('#app-modal-input');
    const form = dialog.querySelector('.app-modal-form');
    const error = dialog.querySelector('.app-modal-error');
    const closeDialog = (payload) => closeAnimatedDialog(dialog, payload, resolve);
    const cancel = () => closeDialog({ confirmed: false, value: null });
    const submit = () => {
      const nextValue = input.value.trim();
      const issue = validate(nextValue);
      if (issue) {
        error.textContent = issue;
        error.hidden = false;
        input.focus({ preventScroll: true });
        return;
      }
      closeDialog({ confirmed: true, value: nextValue });
    };
    form.querySelector('.app-modal-close').onclick = cancel;
    form.querySelector('.app-modal-cancel').onclick = cancel;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit();
    });
    dialog.addEventListener('close', () => { if (!dialog.classList.contains('is-closing')) dialog.remove(); });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) cancel(); });
    dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } });
    document.body.appendChild(dialog);
    dialog.showModal();
    input.focus({ preventScroll: true });
    if (value) { input.setSelectionRange(value.length, value.length); }
  });
}
function showAppConfirmDialog({ title, message = '', confirmLabel = t('common.delete', 'Delete'), cancelLabel = t('common.cancel', 'Cancel'), destructive = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-modal-dialog app-modal-confirm';
    dialog.innerHTML = `
      <form class="app-modal-form" method="dialog">
        <div class="app-modal-header">
          <h2>${escapeHtml(title || '')}</h2>
          <button type="button" class="dialog-close app-modal-close" aria-label="${escapeHtml(t('common.close', 'Close'))}">×</button>
        </div>
        ${message ? `<p class="app-modal-message">${escapeHtml(message)}</p>` : ''}
        <div class="app-modal-actions">
          <button type="button" class="action secondary app-modal-cancel">${escapeHtml(cancelLabel)}</button>
          <button type="submit" class="action ${destructive ? 'danger' : ''} app-modal-submit">${escapeHtml(confirmLabel)}</button>
        </div>
      </form>
    `;
    const form = dialog.querySelector('.app-modal-form');
    const closeDialog = (payload) => closeAnimatedDialog(dialog, payload, resolve);
    const cancel = () => closeDialog({ confirmed: false });
    form.querySelector('.app-modal-close').onclick = cancel;
    form.querySelector('.app-modal-cancel').onclick = cancel;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      closeDialog({ confirmed: true });
    });
    dialog.addEventListener('close', () => { if (!dialog.classList.contains('is-closing')) dialog.remove(); });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) cancel(); });
    dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}
window.showAppInputDialog = showAppInputDialog;
window.showAppConfirmDialog = showAppConfirmDialog;

function i18nKey(key, fallback) { return t(key, fallback); }
function slotLabel(slot) {
  const raw = String(slot || '').trim();
  if (!raw) return '';
  const normalized = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const map = {
    head: 'slot.head',
    hands: 'slot.hands',
    summon: 'slot.summon',
    shoulder: 'slot.shoulders',
    shoulders: 'slot.shoulders',
    belt: 'slot.belt',
    back: 'slot.back',
    cape: 'slot.back',
    weapon: 'slot.weapon',
    arms: 'slot.arms',
    arm: 'slot.arms',
    'ambient effects': 'slot.ambientEffects',
    legs: 'slot.legs',
    neck: 'slot.neck',
    taunt: 'slot.taunt',
    'off hand': 'slot.offhand',
    'off hand weapon': 'slot.offhand',
    'offhand weapon': 'slot.offhand',
    offhand: 'slot.offhand',
    armor: 'slot.armor',
    armour: 'slot.armor',
    misc: 'slot.misc',
    tail: 'slot.tail',
    mount: 'slot.mount',
    courier: 'slot.courier',
    ward: 'slot.ward',
    'hero effects': 'slot.heroEffects',
    'persona selector': 'slot.personaSelector',
    persona: 'slot.personaBase',
    body: 'slot.body',
    face: 'slot.face',
    hair: 'slot.hair',
    costume: 'slot.costume',
    'hero base': 'slot.heroBase',
    'hero voice': 'slot.heroVoice',
    'custom effects': 'slot.customEffects',
  };
  const persona = normalized.match(/^(.+?) persona (\d+)$/);
  const baseKey = persona ? map[persona[1]] : map[normalized];
  const baseLabel = baseKey ? t(baseKey, normalized) : t(`slot.${normalized.replace(/\s+/g, '')}`, normalized);
  if (persona) return formatTranslation(t('slot.persona', '{slot} · Persona {number}'), { slot: baseLabel, number: persona[2] });
  return baseLabel;
}
function isVideoPreview(url) { return /\.(?:mp4|webm|ogg|mov)(?:[?#].*)?$/i.test(String(url || '')); }
function showPreview(url, title = t('catalog.preview', 'Preview'), poster = '') { if (!isVideoPreview(url)) return; const dialog = $('#video-preview'); const content = $('#video-preview-content'); if (!dialog || !content) return; content.replaceChildren(); const heading = document.createElement('h2'); heading.textContent = title; const frame = document.createElement('div'); frame.className = 'video-preview-frame'; const video = document.createElement('video'); video.controls = true; video.setAttribute('controls', '');
video.autoplay = true;
video.playsInline = true;
video.setAttribute('playsinline', '');
video.preload = 'auto';
video.style.width = '100%';
video.style.height = '100%';
video.style.maxHeight = '70vh';
video.style.objectFit = 'contain';
video.style.pointerEvents = 'auto';
if (poster) video.poster = poster;
const source = document.createElement('source');
source.src = url;
source.type = /\.webm(?:[?#].*)?$/i.test(url) ? 'video/webm' : 'video/mp4';
const status = document.createElement('p');
status.className = 'video-preview-status';
status.textContent = t('catalog.videoLoading');
video.append(source);
frame.append(video);
content.append(heading, frame, status);
video.addEventListener('loadeddata', () => { status.remove(); video.play().catch(() => {}); }, { once: true });
video.addEventListener('error', () => { status.textContent = t('catalog.videoError'); });
dialog.showModal();
video.load();
}
function bindPreviewButtons() { document.querySelectorAll('[data-preview-url]').forEach((button) => { button.onclick = () => showPreview(button.dataset.previewUrl, button.dataset.previewTitle || t('catalog.preview', 'Preview')); }); }
function setTitle() {
  const isHeroDetail = state.view === 'mods' && state.section === 'heroes' && Boolean(state.hero);
  const isHeroDirectory = state.view === 'mods' && state.section === 'heroes' && !state.hero;
  const titleText = ({ discover: t('nav.home'), mods: t('nav.mods'), cosmetics: t('nav.cosmetics', 'Cosmetics'), installed: t('nav.library'), 'saved-packs': t('nav.savedPacks', 'Packs'), 'download-archives': state.data?.settings?.appLanguage === 'ru' ? 'Скачанные архивы' : 'Downloaded archives', authors: t('nav.authors'), guides: t('nav.guides'), 'hero-grids': t('nav.heroGrids', 'Hero Grids'), settings: t('nav.settings'), themes: state.data?.settings?.appLanguage === 'ru' ? 'Темы' : 'Themes' })[state.view];
  const title = $('#page-title');
  const heading = title?.parentElement;
  if (heading && isHeroDetail) {
    const heroKey = normalizeHeroId(state.hero);
    const heroLabel = typeof heroDirectoryLabel === 'function' ? heroDirectoryLabel(heroKey) : state.hero.replace(/_/g, ' ');
    heading.classList.add('hero-page-heading');
    heading.innerHTML = `<p class="eyebrow">${t('catalog.heroLoadout').toUpperCase()}</p><h1 id="page-title">${escapeHtml(heroLabel)}</h1><p class="hero-page-description">${t('catalog.heroLoadoutDesc')}</p>`;
  } else if (heading?.classList.contains('hero-page-heading')) {
    heading.classList.remove('hero-page-heading');
    heading.innerHTML = '<h1 id="page-title"></h1>';
    $('#page-title').textContent = titleText || '';
  } else if (title) title.textContent = titleText || '';
  const search = $('.topbar .search');
  if (search) {
    const searchableCategory = state.view === 'mods' && ['world', 'interface'].includes(state.section);
    const hideSearch = !searchableCategory && (state.view === 'discover' || state.view === 'installed' || isHeroDirectory || isHeroDetail || state.view === 'settings' || state.view === 'hero-grids' || state.view === 'download-archives' || state.view === 'themes' || state.view === 'cosmetics');
    search.classList.toggle('settings-hidden', hideSearch);
    const searchInput = search.querySelector('input');
    const searchKey = state.view === 'saved-packs' ? 'search.packs.placeholder' : state.view === 'installed' ? 'search.library.placeholder' : 'search.placeholder';
    searchInput?.setAttribute('data-i18n-placeholder', searchKey);
    searchInput?.setAttribute('placeholder', t(searchKey));
  }
  document.querySelectorAll('.top-tab').forEach((tab) => tab.classList.toggle('active', state.view === 'mods' && tab.dataset.top === state.section));
}
async function loadCatalog() {
  if (state.view === 'authors' || state.view === 'saved-packs') {
    state.view = 'installed';
    state.author = '';
    return loadCatalog();
  }
  if (state.view === 'mods' && !VISIBLE_MOD_SECTIONS.has(state.section)) {
    state.section = 'heroes';
    state.lastModsSection = 'heroes';
  }
  const focusedSearch = document.activeElement?.id === 'search';
  const searchSelection = focusedSearch ? { start: $('#search').selectionStart, end: $('#search').selectionEnd } : null;
  const restoreSearchFocus = () => {
    if (!focusedSearch) return;
    const input = $('#search');
    if (!input) return;
    input.focus({ preventScroll: true });
    if (searchSelection) input.setSelectionRange(searchSelection.start, searchSelection.end);
  };
  const requestedView = state.view;
  const requestedSection = state.section;
  const requestedCategory = state.category;
  const requestedHero = state.hero;
  const requestedAuthor = state.author;
  const requestedQuery = state.view === 'authors' ? state.authorQuery : state.view === 'mods' && state.hero ? state.heroQuery : state.query;
  const isCurrentRequest = () => state.view === requestedView && state.section === requestedSection && state.category === requestedCategory && state.hero === requestedHero && state.author === requestedAuthor && (state.view === 'authors' ? state.authorQuery : state.view === 'mods' && state.hero ? state.heroQuery : state.query) === requestedQuery;
  const isHeroSection = requestedView === 'mods' && requestedSection === 'heroes';
  const isHeroDirectory = isHeroSection && !requestedHero;
  const libraryPayload = {
    query: isHeroDirectory ? '' : requestedQuery,
    category: 'all',
    ...(requestedView === 'mods' && requestedHero ? { hero: requestedHero } : {}),
    installedOnly: requestedView === 'installed',
  };
  const catalogCacheKey = `${requestedView}:${JSON.stringify(libraryPayload)}`;
  const cachedEntry = requestedView === 'saved-packs' ? null : catalogPageCache.get(catalogCacheKey);
  const cachedCatalog = cachedEntry && Date.now() - cachedEntry.createdAt < 60_000 ? cachedEntry.data : null;
  if (cachedEntry && !cachedCatalog) catalogPageCache.delete(catalogCacheKey);
  const content = $('#content');
  const staleCosmeticsView = Boolean(content.querySelector('.cosmetics-page')) && requestedView !== 'cosmetics';
  const canKeepCurrentView = requestedView !== 'saved-packs' && !staleCosmeticsView && Boolean(content.children?.length);
  setTitle();
  if (requestedView === 'cosmetics') {
    content.classList.remove('catalog-refreshing');
    await window.loadCosmeticsView?.();
    return;
  }
  if (requestedView === 'mods' && !state.hero) {
    content.querySelectorAll('[data-category]').forEach((button) => button.classList.toggle('active', button.dataset.category === state.category));
  }
  if (cachedCatalog) {
    state.data = { ...state.data, ...cachedCatalog };
    content.classList.remove('catalog-refreshing');
    render();
    restoreSearchFocus();
    return;
  }
  if (canKeepCurrentView) content.classList.add('catalog-refreshing');
  else content.innerHTML = `<div class="empty"><strong>${state.data?.settings?.appLanguage === 'ru' ? 'Загружаем библиотеку' : 'Loading VantaMods'}</strong></div>`;

  if (state.view === 'download-archives') {
    try {
      const data = await call('downloads:list');
      if (!isCurrentRequest()) return;
      state.data = { ...state.data, ...data };
      content.classList.remove('catalog-refreshing');
      render();
      return;
    } catch (error) {
      if (!isCurrentRequest()) return;
      content.classList.remove('catalog-refreshing');
      content.innerHTML = `<div class="error"><strong>${t('catalog.unavailable')}</strong>${escapeHtml(error.message)}</div>`;
      return;
    }
  }

  try {
    const data = await call('library:mods', libraryPayload);
    if (!isCurrentRequest()) return;
    catalogPageCache.set(catalogCacheKey, { createdAt: Date.now(), data: { mods: data.mods, categories: data.categories } });
    if (catalogPageCache.size > 32) catalogPageCache.delete(catalogPageCache.keys().next().value);
    state.data = { ...state.data, ...data };
    content.classList.remove('catalog-refreshing');
    updateGameStatus(state.data.gamePath);
    render();
    restoreSearchFocus();
  } catch (error) {
    if (!isCurrentRequest()) return;
    content.classList.remove('catalog-refreshing');
    if (canKeepCurrentView) toast(error.message);
    else content.innerHTML = `<div class="error"><strong>${t('catalog.unavailable')}</strong>${error.message}</div>`;
  }
}
function updateGameStatus(gamePath) { const text = gamePath ? formatTranslation(t('catalog.gameReadyWithPath', 'Dota 2 ready · {path}'), { path: gamePath }) : t('catalog.gameMissing', 'Dota 2 not found — set the path in settings'); const status = $('#status-text'); const dot = $('#status-dot'); const sidebarText = $('#sidebar-status-text'); const sidebarDot = $('#sidebar-status-dot'); if (status) status.textContent = text; if (dot) dot.classList.toggle('ready', Boolean(gamePath)); if (sidebarText) sidebarText.textContent = gamePath ? t('status.dotaReady', 'Dota 2 ready') : t('status.dotaMissing', 'Dota 2 not found'); if (sidebarDot) sidebarDot.classList.toggle('ready', Boolean(gamePath)); }
function renderSavedPacks() { state.view = 'installed'; return renderLibrary(); }
function getInstalledRecord(id) {
  const installed = state.data?.installed;
  if (Array.isArray(installed)) return installed.find((record) => String(record?.id || record?.modId) === String(id));
  return installed?.[id] || Object.values(installed || {}).find((record) => String(record?.id || record?.modId) === String(id));
}
function render() { if (state.view === 'authors' || state.view === 'saved-packs') state.view = 'installed'; if (state.view !== 'download-archives') document.querySelector('.download-archive-bulk[data-archive-portal]')?.remove(); $('#content').classList.remove('catalog-refreshing'); setTitle(); document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === state.view)); const activeTheme = (state.data.themes || []).find((theme) => theme.id === state.data.settings?.activeThemeId) || (state.data.themes || []).find((theme) => theme.id === 'vanta-default'); if (activeTheme) window.applyVantaTheme?.(activeTheme);
if (state.view === 'cosmetics') return window.renderCosmeticsView?.(state.data.cosmetics);
if (state.view === 'settings') return renderSettings();
if (state.view === 'themes') return renderThemesPage();
if (state.view === 'download-archives') return renderDownloadArchives();
if (state.view === 'installed') return renderLibrary();
if (state.view === 'mods' && state.section === 'heroes') return state.hero ? renderHeroDetail() : renderHeroDirectory();
const categories = state.data.categories || [];
const mods = state.data.mods || [];
if (state.view === 'discover') return renderHome();
const visibleMods = state.view === 'mods'
  ? mods.filter((mod) => (state.section === 'all' || MOD_SECTION_CATEGORIES[state.section]?.has(normalizedCatalogCategory(mod.categoryId)))
    && (state.category === 'all' || normalizedCatalogCategory(mod.categoryId) === normalizedCatalogCategory(state.category)))
  : mods;
const sectionCategories = state.view === 'mods' && state.section !== 'all'
  ? categories.filter((category) => MOD_SECTION_CATEGORIES[state.section]?.has(normalizedCatalogCategory(category)))
  : categories;
const categoryOptions = state.view === 'mods' && state.section === 'world'
  ? [...new Set(['terrains', ...sectionCategories.map(normalizedCatalogCategory)])]
  : sectionCategories;
const filter = `<div class="toolbar"><div class="filters"><button class="filter ${state.category === 'all' ? 'active' : ''}" data-category="all">${t('catalog.allMods', 'All mods')}</button>${categoryOptions.map((category) => `<button class="filter ${normalizedCatalogCategory(state.category) === normalizedCatalogCategory(category) ? 'active' : ''}" data-category="${category}">${CATEGORY_LABELS[category] || category}</button>`).join('')}</div><span class="result-count">${formatTranslation(t('catalog.heroModsCount', '{count} mods'), { count: visibleMods.length })}</span></div>`;
const cards = visibleMods.length ? `<div class="mod-grid">${visibleMods.map(card).join('')}</div>` : `<div class="empty"><strong>${t('catalog.empty', 'Nothing here yet')}</strong>${t('catalog.emptyHint', 'Try another search or category.')}</div>`;
$('#content').innerHTML = filter + cards;
document.querySelectorAll('[data-category]').forEach((node) => node.onclick = () => { state.category = node.dataset.category; loadCatalog(); });
document.querySelectorAll('[data-action]').forEach((node) => node.onclick = () => action(node.dataset.action, node.dataset.id));
}
function renderLibrary() { const installed = Object.values(state.data.installed || {}); const groups = { packs: [], heroes: [], heroSounds: [], world: [], interface: [], effects: [], other: [] }; const categoryGroup = (category, mod) => mod.type === 'pack' || category === 'packs' ? 'packs' : ['heroes', 'hero-items', 'herofx'].includes(category) ? 'heroes' : category === 'hero-sounds' ? 'heroSounds' : ['terrains', 'trees', 'river', 'creeps', 'towers', 'roshan', 'ancient', 'tormentor', 'wards', 'couriers', 'pedestal', 'creep-deny'].includes(category) ? 'world' : ['backgrounds', 'huds', 'emblems', 'versus-screens', 'item-icons', 'ranks', 'pings', 'cursors'].includes(category) ? 'interface' : ['shaders', 'ti-bp-effects', 'item-effects', 'ranged-attack', 'high-five'].includes(category) ? 'effects' : 'other'; installed.forEach((mod) => groups[categoryGroup(mod.categoryId, mod)].push(mod)); const labels = { packs: t('catalog.filterPacks', 'Packs'), heroes: t('catalog.filterHeroes', 'Heroes'), heroSounds: t('catalog.filterHeroes', 'Hero sounds'), world: t('catalog.filterWorld', 'World'), interface: t('catalog.filterInterface', 'Interface'), effects: t('catalog.filterEffects', 'Effects'), other: t('catalog.filterOther', 'Other') }; const selected = state.librarySelection; const row = (mod) => `<article class="library-mod ${selected.has(mod.modId) ? 'selected' : ''}"><label class="library-check"><input type="checkbox" data-library-select="${mod.modId}" ${selected.has(mod.modId) ? 'checked' : ''}><span></span></label>${mod.previewUrl ? `<img src="${mod.previewUrl}" loading="lazy" alt="">` : '<div class="library-thumb-empty">◈</div>'}<div class="library-mod-info"><strong>${mod.name || mod.modId}</strong><small>${CATEGORY_LABELS[mod.categoryId] || mod.categoryId}${mod.heroLabel ? ` · ${mod.heroLabel}` : ''}${mod.slot ? ` · ${slotLabel(mod.slot)}` : ''}</small><small>${mod.enabled === false ? t('catalog.actionDisabled', 'Disabled') : t('catalog.actionEnabled', 'Enabled')} · ${formatModDate(mod.installedAt)}</small></div><div class="library-mod-actions"><button class="toggle-button ${mod.enabled !== false ? 'on' : ''}" data-library-toggle="${mod.modId}">${mod.enabled !== false ? t('catalog.actionEnabled', 'Enabled') : t('catalog.actionDisabled', 'Disabled')}</button><button class="action secondary" data-library-remove="${mod.modId}">${t('catalog.uninstall', 'Remove')}</button></div></article>`; const sections = Object.entries(groups).filter(([, mods]) => mods.length).map(([id, mods]) => `<section class="library-section"><div class="library-section-heading"><h2>${labels[id]}</h2><span>${mods.length}</span></div><div class="library-mod-list">${mods.map(row).join('')}</div></section>`).join(''); const packs = state.data.packs || []; $('#content').innerHTML = `<div class="library-header"><div><p class="eyebrow">LOCAL LIBRARY</p><h2>Installed mods</h2><p>Manage ownership, enabled state and saved mod packs.</p></div><div class="library-header-actions"><button class="action secondary" id="library-select-all">Select all</button><button class="action" id="library-pack">Create pack</button></div></div><div class="library-bulk"><span>${selected.size} selected</span><button class="action secondary" id="library-enable-selected" ${selected.size ? '' : 'disabled'}>Enable selected</button><button class="action secondary" id="library-disable-selected" ${selected.size ? '' : 'disabled'}>Disable selected</button><button class="action secondary" id="library-remove-selected" ${selected.size ? '' : 'disabled'}>Remove selected</button></div>${sections || '<div class="empty"><strong>Library is empty</strong>Install a mod from Mods to see it here.</div>'}${packs.length ? `<section class="library-section packs-section"><div class="library-section-heading"><h2>Packs</h2><span>${packs.length}</span></div>${packs.map((pack) => `<div class="pack-row"><strong>${pack.name}</strong><span>${pack.modIds.length} mods</span><button class="action secondary" data-pack-delete="${pack.id}">Delete</button></div>`).join('')}</section>` : ''}`; bindLibrary(); renderExternalFiles(); syncLibraryBulkUi(); }
function bindLibrary() { document.querySelectorAll('[data-library-select]').forEach((input) => input.onchange = () => { input.checked ? state.librarySelection.add(input.dataset.librarySelect) : state.librarySelection.delete(input.dataset.librarySelect); renderLibrary(); }); document.querySelectorAll('[data-library-toggle]').forEach((button) => button.onclick = async () => { state.data = await call('mod:set-enabled', { id: button.dataset.libraryToggle, enabled: button.textContent.trim() !== t('catalog.actionEnabled', 'Enabled') }); renderLibrary(); }); document.querySelectorAll('[data-library-remove]').forEach((button) => button.onclick = async () => { const confirmation = await showAppConfirmDialog({ title: t('catalog.removeInstalledModTitle', 'Remove mod'), message: t('catalog.removeInstalledMod', 'Remove this installed mod?'), confirmLabel: t('catalog.uninstall', 'Uninstall'), destructive: true }); if (!confirmation.confirmed) return; state.data = await call('mod:uninstall', { id: button.dataset.libraryRemove }); state.librarySelection.delete(button.dataset.libraryRemove); renderLibrary(); }); $('#library-select-all').onclick = () => { const entries = Array.isArray(state.data.installed) ? state.data.installed : Object.values(state.data.installed || {}); entries.forEach((item) => state.librarySelection.add(item?.id || item?.modId)); renderLibrary(); }; $('#library-pack').onclick = async () => { const entries = Array.isArray(state.data.installed) ? state.data.installed : Object.values(state.data.installed || {}); const validIds = new Set(entries.map((item) => item?.id || item?.modId).filter(Boolean));
const ids = [...state.librarySelection].filter((id) => validIds.has(id));
if (!ids.length) return toast(t('catalog.selectModsFirst', 'Select mods first.'));
state.librarySelection = new Set(ids);
const result = await showAppInputDialog({ title: t('savedPacks.saveTitle', 'Save pack'), label: t('catalog.packName', 'Pack name'), placeholder: t('savedPacks.namePlaceholder', 'My pack'), confirmLabel: t('common.save', 'Save'), validate: (value) => { if (!value) return t('savedPacks.validationRequired', 'Enter a pack name.');
return '';
} });
if (!result.confirmed) return;
state.data = await call('library:save-pack', { name: result.value, modIds: ids });
state.librarySelection.clear();
renderLibrary();
toast(t('catalog.packSaved', 'Pack saved.'));
};
$('#library-enable-selected').onclick = () => bulkLibrarySet(true);
$('#library-disable-selected').onclick = () => bulkLibrarySet(false);
$('#library-remove-selected').onclick = async () => {
const ids = [...state.librarySelection];
if (!ids.length) return toast(t('catalog.selectModsFirst', 'Select mods first.'));
const confirmation = await showAppConfirmDialog({
title: t('catalog.removeSelectedModsTitle', 'Remove selected mods'),
message: formatTranslation(t('catalog.removeSelectedMods', 'Remove {count} selected mod(s)?'), { count: ids.length }),
confirmLabel: t('catalog.uninstall', 'Uninstall'),
destructive: true,
});
if (!confirmation.confirmed) return;
for (const id of ids) await call('mod:uninstall', { id });
state.librarySelection.clear();
await loadCatalog();
};
document.querySelectorAll('[data-pack-delete]').forEach((button) => button.onclick = async () => {
state.data = await call('library:delete-pack', { id: button.dataset.packDelete });
renderLibrary();
});
}
async function bulkLibrarySet(enabled) { for (const id of state.librarySelection) await call('mod:set-enabled', { id, enabled }); state.data = await call('library:get'); renderLibrary(); }
function renderExternalFiles() { const files = state.data.external || []; if (!files.length) return; const section = document.createElement('section'); section.className = 'library-section external-files-section'; section.innerHTML = `<div class="library-section-heading"><h2>${t('catalog.externalFiles')}</h2><span>${files.length}</span></div><p class="external-note">${t('catalog.externalFilesNote')}</p><div class="library-mod-list">${files.map((file) => `<article class="library-mod external-file"><img src="${file.previewUrl || ''}" loading="lazy" alt=""><div class="library-mod-info"><strong>${file.fileName}</strong><small>${file.category}${file.heroLabel ? ` · ${file.heroLabel}` : ''}</small><small>${(file.size / 1024 / 1024).toFixed(1)} MB · ${file.relativePath}</small></div><span class="external-badge">${t('catalog.externalBadge')}</span></article>`).join('')}</div>`; $('#content').appendChild(section); }
function renderRecent(mods) {
  const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const recent = [...mods]
    .filter((mod) => {
      const date = Date.parse(mod.createdAt || '');
      return Number.isFinite(date) && date >= cutoff;
    })
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const first = recent.slice(0, 6);
  const remaining = recent.slice(6);
  if (!recent.length) return '';
  const expanded = state.recentExpanded;
  const toggleLabel = expanded ? t('catalog.hideRecent', 'Hide') : t('catalog.more', 'More');
  const headingControls = `<div class="recent-heading-meta"><span>${formatTranslation(t('catalog.recentCount', '{count} new mods'), { count: recent.length })}</span>${remaining.length ? `<button id="recent-more" class="recent-more" aria-expanded="${expanded}">${toggleLabel}</button>` : ''}</div>`;
  return `<section class="recent-section"><div class="recent-heading"><div><p class="eyebrow">${t('catalog.recentlyAddedBadge', 'LAST 7 DAYS')}</p><h2>${t('catalog.recentlyAdded', 'Recently added')}</h2></div>${headingControls}</div><div class="mod-grid recent-grid">${first.map(card).join('')}</div>${remaining.length ? `<div class="mod-grid recent-more-items ${expanded ? '' : 'hidden'}">${remaining.map(card).join('')}</div>` : ''}</section>`;
}
function renderHome() {
  const mods = state.data.mods || [];
  $('#content').innerHTML = `${renderFeatured(mods)}${renderRecent(mods)}`;
  bindFeatured();
  bindCardLinks();
  document.querySelectorAll('.recent-section [data-action]').forEach((button) => {
    button.onclick = () => action(button.dataset.action, button.dataset.id);
  });
  $('#recent-more')?.addEventListener('click', () => {
    state.recentExpanded = !state.recentExpanded;
    renderHome();
  });
}
function renderHeroDirectory() { const heroes = new Map(); for (const mod of state.data.mods || []) { const id = normalizeHeroId(mod.hero || mod.heroId || mod.heroName || mod.heroLabel); if (!id) continue; const entry = heroes.get(id) || { id, label: mod.heroLabel || id.replace(/_/g, ' '), count: 0 }; entry.count += 1; entry.label = mod.heroLabel || entry.label; heroes.set(id, entry); } const list = [...heroes.values()].sort((left, right) => left.label.localeCompare(right.label)); $('#content').innerHTML = `<div class="hero-directory-head"><div><p class="eyebrow">${t('catalog.authorIntro')}</p><h2>${t('catalog.chooseHero')}</h2><p>${t('catalog.heroDirectoryDesc')}</p></div><span class="result-count">${formatTranslation(t('catalog.heroBadges', '{count} heroes'), { count: list.length })}</span></div><div class="hero-grid">${list.map((hero) => `<button class="hero-card" data-hero="${hero.id}"><img src="${HERO_PORTRAIT_BASE}${heroPortraitId(hero.id)}.png" alt="${hero.label}"><span class="hero-card-shade"></span><span class="hero-card-copy"><strong>${hero.label}</strong><small>${formatTranslation(t('catalog.heroModsCount', '{count} mods'), { count: hero.count })}</small></span></button>`).join('')}</div>`; document.querySelectorAll('[data-hero]').forEach((node) => node.onclick = () => { state.hero = node.dataset.hero; state.heroSlot = 'all'; state.heroQuery = ''; loadCatalog(); }); }
function normalizedHeroSlot(value) {
  const slot = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ({ off_hand: 'offhand', offhand_weapon: 'offhand', off_hand_weapon: 'offhand', shoulder: 'shoulders', totem: 'weapon' })[slot] || slot;
}
function heroSlotLabel(slot) {
  if (normalizeHeroId(state.hero) === 'earthshaker' && normalizedHeroSlot(slot) === 'weapon') return state.data?.settings?.appLanguage === 'ru' ? 'Тотем' : 'Totem';
  return slotLabel(slot);
}
function renderHeroDetail() {
  const previousItemsScrollTop = document.querySelector('.hero-items-content')?.scrollTop || 0;
  const previousPageScrollY = window.scrollY || 0;
  const heroKey = normalizeHeroId(state.hero);
  const heroMods = (state.data.mods || []).filter((mod) => heroDirectoryIds(mod).includes(heroKey));
  const cosmeticData = state.data.cosmetics;
  const cosmeticHero = cosmeticData?.heroes?.find((item) => normalizeHeroId(item.key) === heroKey);
  const catalogSlots = heroMods.map((mod) => mod.slot).filter((slot) => slot && normalizedHeroSlot(slot) !== 'set');
  const cosmeticSlots = (cosmeticHero?.slots || []).map((slot) => slot.id.split(':').at(-1)).filter((slot) => slot && normalizedHeroSlot(slot) !== 'set');
  const slots = [...new Map([...catalogSlots, ...cosmeticSlots].map((slot) => [normalizedHeroSlot(slot), slot])).values()]
    .sort((left, right) => left.localeCompare(right));
  const activeSlot = normalizedHeroSlot(state.heroSlot || 'all');
  const visibleMods = heroMods.filter((mod) => normalizedHeroSlot(mod.slot) !== 'set' && (activeSlot === 'all' || normalizedHeroSlot(mod.slot) === activeSlot));
  const cosmeticCards = cosmeticHero ? inlineHeroCosmeticsMarkup(cosmeticData, cosmeticHero) : '';
  const emptyGrid = !visibleMods.length && !cosmeticCards;
  const isRussian = state.data?.settings?.appLanguage === 'ru';
  $('#content').innerHTML = `<button class="back-link" id="hero-back">← ${t('catalog.backToHeroes')}</button><section class="hero-workspace"><div class="hero-preview-pane"><div class="hero-preview-placeholder"><span aria-hidden="true">◈</span><strong>${isRussian ? 'Окно для предпросмотра' : 'Preview window'}</strong></div>${cosmeticHero ? `<div class="hero-preview-actions">${inlineHeroCosmeticsActionsMarkup(cosmeticData, cosmeticHero)}</div>` : ''}</div><div class="hero-items-pane"><div class="hero-items-layout"><aside class="hero-slot-sidebar"><p class="eyebrow">${isRussian ? 'СЛОТЫ' : 'SLOTS'}</p><div class="hero-slot-list"><button class="filter ${activeSlot === 'all' ? 'active' : ''}" data-slot="all">${t('catalog.allSlots')}</button>${slots.map((slot) => `<button class="filter ${activeSlot === normalizedHeroSlot(slot) ? 'active' : ''}" data-slot="${escapeHtml(slot)}">${escapeHtml(heroSlotLabel(slot))}</button>`).join('')}</div></aside><div class="hero-items-content"><label class="hero-search"><span>⌕</span><input id="hero-search" type="search" data-i18n-placeholder="search.hero.placeholder" placeholder="${t('search.hero.placeholder')}" value="${escapeHtml(state.heroQuery || '')}"></label><div class="hero-mod-grid">${visibleMods.map(card).join('')}${cosmeticCards}${emptyGrid ? `<div class="empty"><strong>${t('catalog.noMods')}</strong>${t('catalog.emptySlotHint', 'Try another slot or search.')}</div>` : ''}</div></div></div></div></section>`;
  requestAnimationFrame(() => {
    const itemsContent = document.querySelector('.hero-items-content');
    if (itemsContent) itemsContent.scrollTop = previousItemsScrollTop;
    window.scrollTo(0, previousPageScrollY);
  });
  $('#hero-back').onclick = () => { state.hero = ''; state.heroSlot = 'all'; state.heroQuery = ''; loadCatalog(); };
  $('#hero-search').oninput = (event) => { state.heroQuery = event.target.value; clearTimeout(window.heroSearchTimer); window.heroSearchTimer = setTimeout(loadCatalog, 220); };
  document.querySelectorAll('.hero-slot-list [data-slot]').forEach((node) => node.onclick = () => { state.heroSlot = node.dataset.slot; renderHeroDetail(); });
  document.querySelectorAll('.hero-workspace [data-action]').forEach((node) => node.onclick = () => action(node.dataset.action, node.dataset.id));
  bindInlineHeroCosmetics(cosmeticData, cosmeticHero);
  if (!cosmeticData && !state.cosmeticsLoading) {
    state.cosmeticsLoading = true;
    call('cosmetics:list').then((data) => {
      state.data.cosmetics = data;
      state.cosmeticsDraft ||= { ...(data.picks || {}) };
    }).catch((error) => { state.data.cosmetics = { heroes: [], error: error.message }; }).finally(() => {
      state.cosmeticsLoading = false;
      if (state.view === 'mods' && normalizeHeroId(state.hero) === heroKey) renderHeroDetail();
    });
  }
}
function patchNotesText(ru, en) { return state.data?.settings?.appLanguage === 'ru' ? ru : en; }
function renderPatchNotesContent() {
  const isRussian = state.data?.settings?.appLanguage === 'ru';
  const sections = isRussian ? [
    { title: 'Полностью переработана система скинов', bullets: ['<strong>10 500+ скинов</strong> теперь доступны в приложении!', 'Выбирайте любой скин и устанавливайте его на любого героя.', 'Добавляйте к скинам любые <strong>Unusual-эффекты</strong> и создавайте собственные комбинации.', 'Полностью обновлена система управления и установки модификаций.'] },
    { title: 'Обновлённый интерфейс', bullets: ['Улучшена навигация и взаимодействие с системой скинов.', 'Работа с модификациями стала удобнее.'] },
    { title: 'Исправления и улучшения', bullets: ['Исправлены различные ошибки.', 'Улучшена стабильность работы приложения.', 'Проведена дополнительная оптимизация внутренних систем.'] },
  ] : [
    { title: 'Completely redesigned skin system', bullets: ['<strong>10,500+ skins</strong> are now available in the app!', 'Choose any skin and install it on any hero.', 'Add any <strong>Unusual effects</strong> to skins and create your own combinations.', 'The mod management and installation system has been completely updated.'] },
    { title: 'Updated interface', bullets: ['Improved navigation and interaction with the skin system.', 'Managing mods is now more convenient.'] },
    { title: 'Fixes and improvements', bullets: ['Fixed various bugs.', 'Improved application stability.', 'Further optimized internal systems.'] },
  ];
  const list = sections.map((section, index) => `<article class="patch-notes-item"><span class="patch-notes-number">${index + 1}</span><div><h3>${section.title}</h3><ul>${section.bullets.map((bullet) => `<li>${bullet}</li>`).join('')}</ul></div></article>`).join('');
  const intro = isRussian ? 'Главное обновление системы скинов и управления модификациями.' : 'A major update to the skin system and mod management.';
  return `<div class="patch-notes-banner"><span>VANTA UPDATE · 2.0.14</span></div><div class="patch-notes-body"><p class="eyebrow">${isRussian ? 'ЧТО НОВОГО' : 'WHAT’S NEW'}</p><h2 id="patch-notes-title">${isRussian ? 'Патчноут 2.0.14' : 'Patch notes 2.0.14'}</h2><p class="patch-notes-intro">${intro}</p><div class="patch-notes-list">${list}</div><div class="patch-notes-footer"><span>${isRussian ? 'Спасибо, что пользуетесь VANTA' : 'Thanks for using VANTA'}</span><b>VANTA · 2.0.14</b></div></div>`;
}
function openPatchNotes() {
  const dialog = $('#patch-notes');
  const content = $('#patch-notes-content');
  if (!dialog || !content) return;
  dialog.classList.remove('is-closing');
  content.innerHTML = renderPatchNotesContent();
  dialog.showModal();
}
function closePatchNotes() {
  const dialog = $('#patch-notes');
  if (!dialog?.open || dialog.classList.contains('is-closing')) return;
  dialog.classList.add('is-closing');
  let finished = false;
  let fallbackTimer;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(fallbackTimer);
    dialog.removeEventListener('animationend', onAnimationEnd);
    if (dialog.open) dialog.close();
    dialog.classList.remove('is-closing');
  };
  const onAnimationEnd = (event) => {
    if (event.target === dialog) finish();
  };
  dialog.addEventListener('animationend', onAnimationEnd);
  fallbackTimer = setTimeout(finish, 240);
}
function renderFeatured(mods) {
  const patchNotesSlide = `<article class="featured-slide featured-patch-notes active" data-slide="0" style="--featured-image:url('https://raw.githubusercontent.com/artem-prime42/dota2-media/main/images/patchno.jpg')"><div class="featured-shade"></div><div class="featured-copy"><span class="featured-kicker">VANTA UPDATE · 2.0.14</span><h2>${patchNotesText('Патчноут 2.0.14', 'Patch notes 2.0.14')}</h2><p>${patchNotesText('10 500+ скинов, Unusual-эффекты и обновлённое управление модификациями.', '10,500+ skins, Unusual effects, and improved mod management.')}</p><div class="featured-actions"><button class="action patch-notes-open" data-open-patch-notes>${patchNotesText('Подробнее', 'Learn more')} <span aria-hidden="true">↗</span></button></div></div></article>`;
  return `<section class="featured" data-featured-index="0"><div class="featured-track">${patchNotesSlide}</div></section>`;
}
$('#close-patch-notes')?.addEventListener('click', closePatchNotes);
$('#patch-notes')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closePatchNotes();
});
$('#patch-notes')?.addEventListener('cancel', (event) => {
  event.preventDefault();
  closePatchNotes();
});
function bindFeatured() {
  const root = $('.featured');
  if (!root) return;
  const slides = [...root.querySelectorAll('.featured-slide')];
  let index = 0;
  const show = (next) => {
    index = (next + slides.length) % slides.length;
    slides.forEach((slide, position) => slide.classList.toggle('active', position === index));
    root.querySelectorAll('.featured-dot').forEach((dot, position) => dot.classList.toggle('active', position === index));
  };
  root.querySelector('[data-open-patch-notes]')?.addEventListener('click', openPatchNotes);
  root.querySelectorAll('[data-featured-move]').forEach((button) => button.onclick = () => show(index + Number(button.dataset.featuredMove)));
  root.querySelectorAll('[data-featured-dot]').forEach((button) => button.onclick = () => show(Number(button.dataset.featuredDot)));
  root.querySelectorAll('[data-action]').forEach((button) => button.onclick = () => action(button.dataset.action, button.dataset.id));
}
function bindCardLinks() {
  document.querySelectorAll('[data-card-hero]').forEach((button) => button.onclick = () => { state.view = 'mods'; state.section = 'heroes'; state.hero = button.dataset.cardHero; state.heroSlot = button.dataset.cardSlot || 'all'; loadCatalog(); });
  document.querySelectorAll('[data-card-category]').forEach((button) => button.onclick = () => { state.view = 'mods'; state.section = 'all'; state.category = button.dataset.cardCategory; loadCatalog(); });
}
function renderAuthors() { state.view = 'installed'; return renderLibrary(); }
function renderAuthorProfile() { state.view = 'installed'; return renderLibrary(); }
function formatModDate(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) return t('catalog.dateUnknown', 'Date unavailable'); const locale = state.data?.settings?.appLanguage === 'ru' ? 'ru-RU' : 'en-US'; return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}
function releasedLabel() { return t('catalog.released', 'Released'); }
function downloadsLabel(value, includeCount = false) { const count = Number(value || 0).toLocaleString(); const label = t('catalog.downloads', 'Downloads'); return includeCount ? `${label}: ${count}` : `${downloadsIcon()} ${count}`;
}
function downloadsIcon() { return '<span class="download-icon" aria-hidden="true">&#8595;</span>';
}
function isHiddenAuthor(name) { return /^unknown(?: author)?$/i.test(String(name || '').trim());
}
function getAuthorCardProfile(name) { return state.data.authors?.find((author) => author.name.toLowerCase() === name.toLowerCase()) || null;
}
function card(mod) { const installed = getInstalledRecord(mod.id);
const hasUpdate = installed && installed.version !== mod.version;
const authorName = String(mod.author || '').trim();
const hasAuthor = authorName && !/^anonymous$/i.test(authorName);
const preview = mod.previewUrl ? `<img class="preview" loading="lazy" src="${escapeHtml(mod.previewUrl)}" alt="">` : '<div class="preview preview-empty">◈</div>';
const chips = [`<button class="card-chip" data-card-category="${escapeHtml(mod.categoryId)}">${CATEGORY_LABELS[mod.categoryId] || mod.categoryId}</button>`, mod.hero ? `<button class="card-chip" data-card-hero="${escapeHtml(mod.hero)}">${escapeHtml(mod.heroLabel || mod.hero)}</button>` : '', mod.slot ? `<button class="card-chip" data-card-slot="${escapeHtml(mod.slot)}" data-card-hero="${escapeHtml(mod.hero || '')}">${slotLabel(mod.slot)}</button>` : ''].join('');
return `<article class="mod-card"><button class="open-card" data-action="details" data-id="${escapeHtml(mod.id)}">${preview}</button><div class="card-body"><div class="card-top"><div class="mod-name" title="${escapeHtml(mod.name)}">${escapeHtml(mod.name)}</div></div><div class="card-author">${hasAuthor ? `<span class="mod-author-text">${escapeHtml(authorName)}</span>` : `<span class="no-author">${t('catalog.noAuthor', 'Community mod')}</span>`}</div><div class="card-chips">${chips}</div><div class="card-date">${releasedLabel()} ${formatModDate(mod.createdAt)}</div><div class="card-footer"><span class="badge">${hasUpdate ? t('catalog.updateAvailable', 'Update available') : installed ? t('catalog.installed', 'Installed') : t('catalog.cosmetic', 'Cosmetic')}</span><button class="action ${installed && !hasUpdate ? 'secondary' : ''}" data-action="${hasUpdate ? 'update' : installed ? 'uninstall' : 'install'}" data-id="${escapeHtml(mod.id)}">${hasUpdate ? t('catalog.update', 'Update') : installed ? t('catalog.uninstall', 'Uninstall') : t('catalog.installMod', 'Install mod')}</button><span class="download-count">${downloadsLabel(mod.downloads)}</span></div></div></article>`;
}
function renderSettings() { const path = state.data.gamePath || t('settings.notConfigured', 'Not configured'); const settings = state.data.settings || {}; const language = settings.appLanguage || 'en'; const enabled = (value) => value ? t('settings.toggleEnabled', 'Enabled') : t('settings.toggleDisabled', 'Disabled'); $('#content').innerHTML = `<div class="settings-panel"><h2>${t('settings.title', 'Settings')}</h2><p>${t('catalog.settingsDescription', 'Control the game connection, interface behavior and update preferences.')}</p><div class="setting-row"><div><strong>${t('settings.pathLabel', 'Dota 2 installation')}</strong><div class="setting-value" title="${path}">${path}</div></div><div><button id="detect-game" class="action secondary">${t('settings.autoDetect', 'Auto detect')}</button><button id="browse-game" class="action">${t('settings.browse', 'Browse')}</button></div></div><div class="setting-row"><div><strong>${t('settings.languageFolder', 'Language folder')}</strong><div class="setting-value">${settings.langSuffix || 'russian'}</div></div><select id="language-folder"><option value="russian">${t('settings.languages.ru', 'Russian')}</option><option value="english">${t('settings.languages.en', 'English')}</option><option value="schinese">${t('settings.languages.zh', 'Simplified Chinese')}</option></select></div><div class="setting-row"><div><strong>${t('settings.appLanguage', 'Application language')}</strong><div class="setting-value">${t('settings.languageHint', 'VANTA interface language')}</div></div><select id="app-language"><option value="en">${t('settings.languages.en', 'English')}</option><option value="ru">${t('settings.languages.ru', 'Russian')}</option></select></div><div class="setting-row"><div><strong>${t('settings.autoUpdate', 'Auto update')}</strong><div class="setting-value">${t('settings.autoUpdateHint', 'Check for VANTA updates')}</div></div><button id="auto-update" class="toggle-button ${settings.autoUpdateEnabled !== false ? 'on' : ''}">${enabled(settings.autoUpdateEnabled !== false)}</button></div><div class="setting-row"><div><strong>${t('settings.scale', 'Interface scale')}</strong><div class="setting-value">${t('settings.scaleHint', 'Adjust interface density')}</div></div><div class="scale-control"><input id="interface-scale" type="range" min="0.8" max="1.4" step="0.05" value="${settings.interfaceScale || 1}"><output id="interface-scale-value">${Number(settings.interfaceScale || 1).toFixed(2)}×</output><button id="reset-interface-scale" class="action secondary">${t('settings.reset', 'Reset')}</button></div></div><div class="setting-row"><div><strong>${t('settings.discordActivity', 'Discord activity')}</strong><div class="setting-value">${t('settings.discordActivityHint', 'Show VANTA activity in Discord')}</div></div><button id="discord-activity" class="toggle-button ${settings.discordActivityEnabled ? 'on' : ''}">${enabled(settings.discordActivityEnabled)}</button></div><div class="setting-row"><div><strong>${t('settings.catalogSource', 'Cosmetic data source')}</strong><div class="setting-value">${state.data.gamePath ? 'Dota 2 · items_game.txt' : t('settings.notConfigured', 'Not configured')}</div></div><span class="badge">${state.data.gamePath ? 'LOCAL' : 'OFFLINE'}</span></div></div>`; const set = async (key, value) => { state.data = await call('settings:set', { key, value }); renderSettings(); }; $('#detect-game').onclick = async () => { try { state.data = await call('game:detect'); updateGameStatus(state.data.gamePath); renderSettings(); toast(state.data.gamePath ? formatTranslation(t('settings.gameReadyStatus', 'Dota 2 ready · {path}'), { path: state.data.gamePath }) : t('settings.gameMissingStatus', 'Dota 2 not found — set the path in settings')); } catch (error) { toast(error.message); } }; $('#browse-game').onclick = async () => { try { state.data = await call('game:set-path'); updateGameStatus(state.data.gamePath); renderSettings(); } catch (error) { toast(error.message); } }; $('#language-folder').value = settings.langSuffix || 'russian'; $('#app-language').value = language; $('#language-folder').onchange = (event) => set('langSuffix', event.target.value); $('#app-language').onchange = (event) => set('appLanguage', event.target.value); $('#auto-update').onclick = () => set('autoUpdateEnabled', settings.autoUpdateEnabled === false); $('#discord-activity').onclick = () => set('discordActivityEnabled', !settings.discordActivityEnabled); $('#interface-scale').oninput = (event) => { document.documentElement.style.setProperty('--app-ui-scale', event.target.value); $('#interface-scale-value').value = `${Number(event.target.value).toFixed(2)}×`; }; $('#interface-scale').onchange = (event) => set('interfaceScale', Number(event.target.value)); $('#reset-interface-scale').onclick = () => { document.documentElement.style.setProperty('--app-ui-scale', '1'); set('interfaceScale', 1); }; }
async function action(type, id) { try { if (type === 'details') return showDetails(id); if (type === 'favorite') state.data = await call('favorite:toggle', { id }); const currentCatalog = { mods: state.data.mods, categories: state.data.categories }; if (type === 'install' || type === 'update') { const mod = state.data.mods.find((item) => item.id === id) || state.data.authorThemes?.find((item) => item.id === id); const operation = mod?.modType === 'theme' ? 'theme-install' : mod?.modType === 'special_patch' ? 'special-patch' : 'mod-install'; updateDownloadProgress({ id, name: mod?.name || id, operation, state: 'downloading', phase: downloadProgressText('Подготовка скачивания…', 'Preparing download…'), percent: null }); toast(type === 'update' ? t('catalog.downloadingUpdate', 'Downloading update...') : t('catalog.downloadingInstall', 'Downloading and installing...')); state.data = { ...await call(type === 'update' ? 'mod:update' : 'mod:install', { id }), ...currentCatalog }; updateDownloadProgress({ id, name: mod?.name || id, operation, state: 'completed', phase: type === 'update' ? downloadProgressText('Мод обновлён', 'Mod updated') : downloadProgressText('Мод установлен', 'Mod installed'), percent: 100 }); toast(type === 'update' ? t('catalog.modUpdated', 'Mod updated.') : t('catalog.modInstalled', 'Mod installed.')); } if (type === 'uninstall') { const modName = state.data.mods.find((mod) => mod.id === id)?.name || id; const confirmation = await showAppConfirmDialog({ title: t('catalog.removeInstalledModTitle', 'Remove mod'), message: formatTranslation(t('catalog.removeInstalledModMessage', 'Remove "{name}" from the library?'), { name: modName }), confirmLabel: t('catalog.uninstall', 'Uninstall'), destructive: true }); if (!confirmation.confirmed) return; state.data = { ...await call('mod:uninstall', { id }), ...currentCatalog }; toast(t('catalog.modRemoved', 'Mod removed.')); } render(); } catch (error) { if (type === 'install' || type === 'update') { const mod = state.data.mods.find((item) => item.id === id) || state.data.authorThemes?.find((item) => item.id === id); updateDownloadProgress({ id, name: mod?.name || id, operation: mod?.modType === 'theme' ? 'theme-install' : mod?.modType === 'special_patch' ? 'special-patch' : 'mod-install', state: 'failed', phase: downloadProgressText('Операция не выполнена', 'Operation failed'), error: error.message }); } toast(error.message); } }
function showDetails(id) { const mod = state.data.mods.find((item) => item.id === id);
if (!mod) return;
const installed = getInstalledRecord(id);
const videoButton = isVideoPreview(mod.videoUrl) ? `<button class="action secondary preview-action details-preview-button" data-preview-url="${escapeHtml(mod.videoUrl)}" data-preview-title="${escapeHtml(mod.name)}">${t('catalog.preview', 'Preview')}</button>` : '';
$('#details-content').innerHTML = `${mod.previewUrl ? `<img class="details-hero" src="${escapeHtml(mod.previewUrl)}" alt="">` : ''}<div class="details-body"><div class="eyebrow">${CATEGORY_LABELS[mod.categoryId] || mod.categoryId} ${mod.heroLabel ? `· ${escapeHtml(mod.heroLabel)}` : ''}</div><h2>${escapeHtml(mod.name)}</h2>${mod.author ? `<p class="details-author">${escapeHtml(mod.author)}</p>` : ''}<div class="meta">${releasedLabel()} ${formatModDate(mod.createdAt)}</div><p>${escapeHtml(mod.description)}</p><div class="card-chips"><button class="card-chip" data-card-category="${escapeHtml(mod.categoryId)}">${CATEGORY_LABELS[mod.categoryId] || mod.categoryId}</button>${mod.hero ? `<button class="card-chip" data-card-hero="${escapeHtml(mod.hero)}">${escapeHtml(mod.heroLabel || mod.hero)}</button>` : ''}${mod.slot ? `<button class="card-chip" data-card-slot="${escapeHtml(mod.slot)}" data-card-hero="${escapeHtml(mod.hero || '')}">${slotLabel(mod.slot)}</button>` : ''}</div><div class="details-actions">${videoButton}<button class="action ${installed ? 'secondary' : ''}" data-action="${installed ? 'uninstall' : 'install'}" data-id="${escapeHtml(id)}">${installed ? t('catalog.uninstall', 'Uninstall') : t('catalog.installMod', 'Install mod')}</button></div></div>`;
$('#details').showModal();
bindPreviewButtons();
document.querySelectorAll('#details [data-action]').forEach((node) => node.onclick = async () => { $('#details').close(); await action(node.dataset.action, node.dataset.id); });
}
document.querySelectorAll('.nav-item[data-view]').forEach((node) => node.onclick = () => { const nextView = node.dataset.view; if (nextView === 'themes') state.themeReturnView = state.view === 'themes' ? state.themeReturnView : state.view; state.view = nextView; state.category = 'all'; state.hero = ''; if (nextView === 'mods') state.section = VISIBLE_MOD_SECTIONS.has(state.lastModsSection) ? state.lastModsSection : 'heroes'; if (state.view !== 'authors') state.author = ''; window.scrollTo(0, 0); document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item === node)); if (state.view === 'settings' || state.view === 'themes') { render(); return; } loadCatalog(); }); document.querySelectorAll('.top-tab').forEach((node) => node.onclick = () => { state.section = node.dataset.top; state.lastModsSection = node.dataset.top; state.category = 'all'; state.hero = ''; state.view = 'mods'; window.scrollTo(0, 0); document.querySelectorAll('.top-tab').forEach((item) => item.classList.toggle('active', item === node)); document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === state.view)); loadCatalog(); }); $('#search').oninput = (event) => { state.query = event.target.value; clearTimeout(window.searchTimer); window.searchTimer = setTimeout(loadCatalog, 220); };
$('#close-details').onclick = () => $('#details').close();
window.vanta.onDownloadProgress(updateDownloadProgress);
if (typeof window.addEventListener === 'function') window.addEventListener('keydown', (event) => window.onThemeSearchShortcut?.(event));
$('#play-game')?.addEventListener('click', async () => {
  try {
    const result = await call('game:play');
    if (!result.cancelled) toast(state.data?.settings?.appLanguage === 'ru' ? 'Запуск Dota 2 через Steam…' : 'Launching Dota 2 through Steam…');
  } catch (error) { toast(error.message); }
});
document.querySelectorAll('.top-tab[data-top="world"], .top-tab[data-top="interface"]').forEach((node) => {
  node.onclick = () => showComingSoonDialog(node.dataset.top);
});
call('app:init').then((data) => { if (data && typeof data === 'object') { state.data = data; const playButton = $('#play-game'); if (playButton) playButton.hidden = !['win32', 'linux'].includes(state.data.platform); updateGameStatus(state.data.gamePath); } return loadCatalog(); }).catch(() => loadCatalog());