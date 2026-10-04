const AUTHOR_MOD_CATEGORY_GROUPS = {
  heroes: new Set(['heroes', 'hero-items', 'herofx', 'hero-sounds']),
  world: new Set(['terrains', 'trees', 'river', 'creeps', 'towers', 'weather', 'roshan', 'ancient', 'tormentor', 'wards', 'couriers', 'pedestal', 'creep-deny']),
  interface: new Set(['backgrounds', 'huds', 'emblems', 'versus-screens', 'item-icons', 'ranks', 'pings', 'cursors', 'announcers', 'music', 'mega-kill']),
  effects: new Set(['shaders', 'ti-bp-effects', 'item-effects', 'ranged-attack', 'high-five']),
  other: new Set(['other', 'sites', 'sounds', 'optimization', 'packs']),
  themes: new Set(['theme', 'themes']),
  configs: new Set(['config', 'configs', 'hero-grid', 'hero-grids']),
};

const AUTHOR_SOCIAL_ICONS = {
  telegram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.7 4.3 18.6 20c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L6 13.6 1 12c-1.1-.3-1.1-1.1.2-1.6L20.7 2.8c.9-.3 1.6.2 1 1.5Z"/></svg>',
  discord: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.7 5.2a18 18 0 0 0-4.4-1.4l-.6 1.2a16 16 0 0 0-5.4 0l-.6-1.2a18 18 0 0 0-4.4 1.4C1.5 9.2.7 13 .9 16.7a18 18 0 0 0 5.4 2.7l1.2-2a11 11 0 0 1-1.9-.9l.5-.4a13 13 0 0 0 11.8 0l.5.4a11 11 0 0 1-1.9.9l1.2 2a18 18 0 0 0 5.4-2.7c.3-4.3-.7-8-3.4-11.5ZM8.8 14.7c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.4 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.2 3.6-6.2 3.6Z"/></svg>',
  twitch: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2 1.5 6v15h5v3h3l3-3h4l6-6V2H4Zm16 12-3.5 3.5H12l-3 3v-3H4.5V4H20v10ZM16 7h2v5h-2V7Zm-5 0h2v5h-2V7Z"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.3-8.4L1.8 2h6.5l4.5 6.8L18.9 2Zm-1.1 18h1.7L7.3 3.9H5.5L17.8 20Z"/></svg>',
  website: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 9h-3a15.7 15.7 0 0 0-1.4-5.1A8 8 0 0 1 18.9 11ZM12 4c1 1.4 1.7 4 1.9 7h-3.8c.2-3 1-5.6 1.9-7ZM4.1 13h3a15.7 15.7 0 0 0 1.4 5.1A8 8 0 0 1 4.1 13Zm3-2h-3a8 8 0 0 1 4.4-5.1A15.7 15.7 0 0 0 7.1 11ZM12 20c-1-1.4-1.7-4-1.9-7h3.8c-.2 3-1 5.6-1.9 7Zm2.5-1.9a15.7 15.7 0 0 0 1.4-5.1h3a8 8 0 0 1-4.4 5.1Z"/></svg>',
};

function authorProfileEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function authorProfileSafeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

function authorProfileIcon(type) {
  const key = String(type || '').toLowerCase().replace(/[^a-z]/g, '');
  const icon = AUTHOR_SOCIAL_ICONS[key] || AUTHOR_SOCIAL_ICONS.website;
  return `<span class="author-social-icon">${icon}</span>`;
}

function authorProfileCategory(mod) {
  const category = String(mod.categoryId || mod.category || '').toLowerCase();
  if (mod.modType === 'theme' || mod.modType === 'catalog_theme' || AUTHOR_MOD_CATEGORY_GROUPS.themes.has(category)) return 'themes';
  if (AUTHOR_MOD_CATEGORY_GROUPS.configs.has(category)) return 'configs';
  return Object.entries(AUTHOR_MOD_CATEGORY_GROUPS).find(([, categories]) => categories.has(category))?.[0] || 'other';
}

function authorProfileThemeToMod(theme) {
  return {
    ...theme,
    previewUrl: theme.previewUrl || theme.preview || null,
    downloadUrl: theme.downloadUrl || theme.file || null,
    categoryId: 'themes',
    modType: 'theme',
    version: theme.version || 'catalog',
    createdAt: theme.createdAt || null,
    hero: null,
    heroLabel: null,
    slot: null,
    tags: [],
  };
}

function authorProfileCategoryLabel(id) {
  const labels = {
    all: ['Все', 'All'], heroes: ['Герои', 'Heroes'], world: ['Мир', 'World'], interface: ['Интерфейс', 'Interface'],
    effects: ['Эффекты', 'Effects'], other: ['Другое', 'Other'], themes: ['Темы', 'Themes'], configs: ['Конфиги', 'Configs'],
  };
  const [ru, en] = labels[id] || labels.all;
  return state.data?.settings?.appLanguage === 'ru' ? ru : en;
}

renderAuthorProfile = function renderAuthorProfileThemed(author) {
  const authorName = String(author?.name || '');
  if (state.authorCategoryOwner !== authorName) {
    state.authorCategoryOwner = authorName;
    state.authorCategory = 'all';
  }
  const allMods = [
    ...(state.data.mods || []).filter((mod) => String(mod.author || '').toLocaleLowerCase() === authorName.toLocaleLowerCase()),
    ...(state.data.authorThemes || []).filter((theme) => String(theme.author || '').toLocaleLowerCase() === authorName.toLocaleLowerCase()).map(authorProfileThemeToMod),
  ];
  const ru = state.data?.settings?.appLanguage === 'ru';
  const tAuthor = (ruText, enText) => ru ? ruText : enText;
  const typeIcons = {
    telegram: 'telegram', discord: 'discord', youtube: 'youtube', twitch: 'twitch', twitter: 'x', x: 'x', website: 'website',
  };
  const links = Object.entries(author.links || {})
    .map(([type, href]) => [String(type), authorProfileSafeUrl(href)])
    .filter(([, href]) => href);
  if (author.authorLink && !links.some(([type]) => /^website$/i.test(type))) {
    const safeWebsite = authorProfileSafeUrl(author.authorLink);
    if (safeWebsite) links.push(['Website', safeWebsite]);
  }
  const socialMarkup = links.length ? `<nav class="author-links author-social-links" aria-label="${tAuthor('Социальные сети автора', 'Author social links')}">${links.map(([type, href]) => {
    const icon = typeIcons[type.toLowerCase()] || 'website';
    return `<a href="${authorProfileEscape(href)}" target="_blank" rel="noopener noreferrer" aria-label="${authorProfileEscape(type)}" title="${authorProfileEscape(type)}">${authorProfileIcon(icon)}<span>${authorProfileEscape(type)}</span><span class="author-social-external" aria-hidden="true">↗</span></a>`;
  }).join('')}</nav>` : '';
  const categoryIds = ['all', 'heroes', 'world', 'interface', 'effects', 'other', 'themes', 'configs'];
  state.authorCategory ||= 'all';
  const visibleMods = () => {
    const query = String(state.authorQuery || '').trim().toLocaleLowerCase();
    let mods = allMods.filter((mod) => (!query || `${mod.name} ${mod.description || ''}`.toLocaleLowerCase().includes(query))
      && (state.authorCategory === 'all' || authorProfileCategory(mod) === state.authorCategory));
    if (state.authorSort === 'date') mods.sort((a, b) => (Date.parse(b.updatedAt || b.createdAt || '') || 0) - (Date.parse(a.updatedAt || a.createdAt || '') || 0));
    else if (state.authorSort === 'name') mods.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return mods;
  };
  $('#content').innerHTML = `<button class="back-link" id="author-back">← ${t('catalog.backToAuthors', 'Back to authors')}</button><section class="author-profile"><header class="author-profile-head">${author.avatarUrl ? `<img class="author-profile-avatar" src="${authorProfileEscape(author.avatarUrl)}" alt="">` : `<span class="author-profile-avatar">${authorProfileEscape(authorName.slice(0, 1).toUpperCase())}</span>`}<div class="author-profile-copy"><p class="eyebrow">${t('catalog.authorProfile', 'AUTHOR PROFILE')}</p><h2>${authorProfileEscape(authorName)}</h2>${socialMarkup}<p>${authorProfileEscape(author.bio || t('catalog.authorBio', 'Creator of Dota 2 cosmetic modifications.'))}</p></div></header><div class="author-mod-toolbar"><div class="author-mod-toolbar-left"><label class="author-mod-search"><span aria-hidden="true">⌕</span><input id="author-mod-search" type="search" placeholder="${tAuthor('Поиск модов автора', 'Search this author’s mods')}" value="${authorProfileEscape(state.authorQuery || '')}" aria-label="${tAuthor('Поиск модов автора', 'Search this author’s mods')}"></label><nav class="author-mod-category-filters" aria-label="${tAuthor('Фильтры категорий', 'Category filters')}">${categoryIds.map((id) => `<button type="button" class="author-mod-category ${state.authorCategory === id ? 'active' : ''}" data-author-category="${id}">${authorProfileEscape(authorProfileCategoryLabel(id))}</button>`).join('')}</nav></div><select id="author-mod-sort" class="author-mod-sort" aria-label="${tAuthor('Сортировка модов', 'Sort author mods')}"><option value="default" ${state.authorSort === 'default' ? 'selected' : ''}>${t('catalog.defaultSort', 'Default')}</option><option value="date" ${state.authorSort === 'date' ? 'selected' : ''}>${t('catalog.newestFirst', 'Newest first')}</option><option value="name" ${state.authorSort === 'name' ? 'selected' : ''}>${t('catalog.nameAZ', 'Name A-Z')}</option></select></div><div class="author-mods-heading"><span id="author-mod-count"></span></div><div class="mod-grid" id="author-mod-grid"></div></section>`;
  const drawMods = () => {
    const mods = visibleMods();
    const grid = $('#author-mod-grid');
    const count = $('#author-mod-count');
    if (count) count.textContent = formatTranslation(t('catalog.authorMods', '{count} mods'), { count: mods.length });
    if (grid) grid.innerHTML = mods.length ? mods.map((mod) => card(mod)).join('') : `<div class="empty"><strong>${t('catalog.noMods', 'No mods found')}</strong>${t('catalog.authorEmpty', 'This author has no matching mods.')}</div>`;
    document.querySelectorAll('#author-mod-grid [data-action]').forEach((node) => node.onclick = () => action(node.dataset.action, node.dataset.id));
  };
  drawMods();
  $('#author-back').onclick = () => { state.author = ''; state.authorQuery = ''; state.authorCategory = 'all'; loadCatalog(); };
  $('#author-mod-search').oninput = (event) => { state.authorQuery = event.currentTarget.value; drawMods(); };
  $('#author-mod-sort').onchange = (event) => { state.authorSort = event.currentTarget.value; drawMods(); };
  document.querySelectorAll('[data-author-category]').forEach((button) => button.onclick = () => {
    state.authorCategory = button.dataset.authorCategory;
    document.querySelectorAll('[data-author-category]').forEach((item) => item.classList.toggle('active', item === button));
    drawMods();
  });
};
