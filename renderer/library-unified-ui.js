function libraryEscape(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function librarySlotLabel(slot) {
  return typeof slotLabel === 'function' ? slotLabel(slot) : String(slot || '');
}

function libraryInstalledItems(installed = state.data?.installed) {
  const entries = Array.isArray(installed)
    ? installed.map((item, index) => [String(index), item])
    : Object.entries(installed && typeof installed === 'object' ? installed : {});
  return entries
    .filter(([, item]) => item && typeof item === 'object' && !Array.isArray(item))
    .map(([key, item]) => ({ ...item, id: item.id || item.modId || key, modId: item.modId || item.id || key }));
}
function libraryItemId(item) { return item?.id || item?.modId; }
function isPinnedLibrarySpecialPatch(item) {
  return item?.modType === 'special_patch' && ['tower', 'weather'].includes(item.specialType);
}
function libraryPriorityValue(item) {
  const deployedFileName = item?.gameFileName || item?.deployedFileName || item?.fileName;
  const fileMatch = String(deployedFileName || '').match(/pak(\d{2})_dir\.vpk/i);
  if (fileMatch) return Number.parseInt(fileMatch[1], 10);
  const explicit = Number(item?.priority);
  if (Number.isFinite(explicit)) return explicit;
  return 99;
}
function libraryPriorityLabel(item) {
  const value = libraryPriorityValue(item);
  return `Priority ${String(value).padStart(2, '0')}`;
}
function findLibraryItem(id) { return libraryInstalledItems().find((item) => String(libraryItemId(item)) === String(id)); }
function hasInstalledLibraryId(id) {
  if (!id) return false;
  return libraryInstalledItems().some((item) => String(libraryItemId(item)) === String(id));
}
function normalizeLibraryCategoryKey(value) {
  if (!value) return 'other';
  const category = String(value).trim();
  return {
    Pack: 'packs',
    pack: 'packs',
    Terrain: 'terrains',
    terrain: 'terrains',
    Landscapes: 'terrains',
    landscapes: 'terrains',
    Landscape: 'terrains',
    landscape: 'terrains',
    Terrains: 'terrains',
    terrains: 'terrains',
    Heroes: 'heroes',
    'Hero sounds': 'hero-sounds',
    'Hero sounds': 'hero-sounds',
    'Hero items': 'hero-items',
    'Hero effects': 'herofx',
    Sounds: 'sounds',
    'Menu backgrounds': 'backgrounds',
    HUDs: 'huds',
    "Versus Screen": 'versus-screens',
    'Item icons': 'item-icons',
    'Item effects': 'item-effects',
    'High five': 'high-five',
    World: 'world',
    Interface: 'interface',
    Effects: 'effects',
    Other: 'other'
  }[category] ?? (category in (CATEGORY_LABELS || {}) ? category : category.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''));
}
function libraryCategory(item) {
  if (item.type === 'pack' || item.categoryId === 'packs') return t('catalog.filterPacks', 'Packs');
  const raw = item.category || item.categoryId || 'other';
  const key = normalizeLibraryCategoryKey(raw);
  return CATEGORY_LABELS[key] || CATEGORY_LABELS[raw] || t('catalog.filterOther', 'Other');
}
function libraryCategoryOrder(category) {
  const key = normalizeLibraryCategoryKey(category);
  return { packs: 0, heroes: 1, 'hero-sounds': 2, other: 3, world: 4, interface: 5, effects: 6 }[key] ?? 99;
}
function libraryFilterForItem(item) { if (item.type === 'pack' || item.categoryId === 'packs') return 'packs'; const category = normalizeLibraryCategoryKey(item.categoryId || item.category || ''); if (['heroes', 'hero-items', 'herofx'].includes(category)) return 'heroes'; if (category === 'hero-sounds') return 'hero-sounds'; if (['terrains', 'trees', 'river', 'creeps', 'towers', 'weather', 'roshan', 'ancient', 'tormentor', 'wards', 'couriers', 'pedestal', 'creep-deny'].includes(category)) return 'world'; if (['backgrounds', 'huds', 'emblems', 'versus-screens', 'item-icons', 'ranks', 'pings', 'cursors'].includes(category)) return 'interface'; if (['shaders', 'ti-bp-effects', 'item-effects', 'ranged-attack', 'high-five'].includes(category)) return 'effects'; return 'other'; }
function libraryFilterOptions() { const russian = state.data?.settings?.appLanguage === 'ru'; return [{ id: 'all', ru: 'Все', en: 'All' }, { id: 'heroes', ru: 'Герои', en: 'Heroes' }, { id: 'world', ru: 'Мир', en: 'World' }, { id: 'interface', ru: 'Интерфейс', en: 'Interface' }, { id: 'effects', ru: 'Эффекты', en: 'Effects' }, { id: 'other', ru: 'Остальное', en: 'Other' }].map((option) => ({ ...option, label: russian ? option.ru : option.en })); }

function libraryHeroGroup(item) {
  const key = normalizeHeroId(item.hero || item.heroId || item.heroName || item.heroLabel);
  if (!key) return null;
  const localHero = state.data?.cosmetics?.heroes?.find((hero) => normalizeHeroId(hero.key) === key);
  const itemLabel = String(item.heroLabel || '').trim();
  const fallbackName = key.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
  const displayName = localHero?.name || (itemLabel && normalizeHeroId(itemLabel) !== key ? itemLabel : fallbackName);
  return { key, name: displayName };
}

function libraryHeroSections(items, row) {
  const heroes = new Map();
  const unknown = [];
  for (const item of items) {
    const hero = libraryHeroGroup(item);
    if (!hero) { unknown.push(item); continue; }
    if (!heroes.has(hero.key)) heroes.set(hero.key, { name: hero.name, items: [] });
    heroes.get(hero.key).items.push(item);
  }
  const sections = [...heroes.values()]
    .sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }))
    .map((hero) => `<section class="library-hero-group"><h3 class="library-hero-group-heading">— ${libraryEscape(hero.name)} —</h3><div class="library-mod-list">${hero.items.map(row).join('')}</div></section>`);
  if (unknown.length) sections.push(`<section class="library-hero-group library-hero-group-other"><h3 class="library-hero-group-heading">— ${state.data?.settings?.appLanguage === 'ru' ? 'Другие' : 'Other'} —</h3><div class="library-mod-list">${unknown.map(row).join('')}</div></section>`);
  return sections.join('');
}

function libraryGeneratedCosmeticItems() {
  const data = state.data?.cosmetics;
  const picks = state.data?.settings?.cosmeticLoadout || data?.picks || {};
  const result = [];
  for (const [slotId, rawSelection] of Object.entries(picks)) {
    if (!slotId.startsWith('item:')) continue;
    const itemId = String(typeof rawSelection === 'object' ? rawSelection?.itemId || '' : rawSelection || '');
    const styleId = typeof rawSelection === 'object' ? String(rawSelection?.styleId || '') : '';
    const effectId = typeof rawSelection === 'object' ? String(rawSelection?.effectId || '') : '';
    if (!itemId) continue;
    const match = /^item:([^:]+):(.+)$/.exec(slotId);
    if (!match) continue;
    const [, heroKey, slotKey] = match;
    const hero = data?.heroes?.find((entry) => normalizeHeroId(entry.key) === normalizeHeroId(heroKey));
    const slot = hero?.slots?.find((entry) => entry.id === slotId);
    const option = slot?.options?.find((entry) => String(entry.id) === itemId && String(entry.styleId || '') === styleId);
    result.push({
      id: `cosmetic:${slotId}`,
      modId: `cosmetic:${slotId}`,
      libraryKind: 'generated-cosmetic',
      cosmeticSlotId: slotId,
      cosmeticItemId: itemId,
      cosmeticStyleId: styleId,
      unusualEffect: effectId ? libraryCosmeticEffectLabel(effectId) : '',
      name: option?.name || (state.data?.settings?.appLanguage === 'ru' ? `Предмет ${itemId}` : `Item ${itemId}`),
      displayName: option?.name || (state.data?.settings?.appLanguage === 'ru' ? `Предмет ${itemId}` : `Item ${itemId}`),
      hero: heroKey,
      heroLabel: hero?.name || heroKey.replace(/_/g, ' '),
      slot: slot?.name || slotKey.replace(/_/g, ' '),
      previewUrl: option?.previewUrl || null,
      categoryId: 'heroes',
      enabled: true,
      generatedCosmetic: true,
    });
  }
  return result;
}
function isGeneratedCosmeticItem(item) { return item?.libraryKind === 'generated-cosmetic' || item?.generatedCosmetic === true; }
function libraryCosmeticEffectLabel(effectId) {
  if (!effectId) return '';
  if (typeof cosmeticEffectLabel === 'function') return cosmeticEffectLabel(effectId);
  const effect = (state.data?.cosmetics?.effects || []).find((entry) => entry.id === effectId);
  return effect?.nameEn || effect?.name || effect?.ru || effectId;
}

function showUnifiedPackContents(pack) {
  if (!pack) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'pack-content-dialog';
  const sources = pack.sourceMods || pack.packMods || [];
  dialog.innerHTML = `<button class="dialog-close" type="button" aria-label="${t('common.close', 'Close')}">×</button><div class="pack-content-body"><p class="eyebrow">${t('catalog.packContents', 'PACK CONTENTS')}</p><h2>${libraryEscape(pack.displayName || pack.name)}</h2><p class="pack-content-count">${formatTranslation(t('catalog.heroModsCount', '{count} mods'), { count: sources.length })}</p><div class="pack-mod-card-grid">${sources.length ? sources.map((source) => { const preview = source.previewUrl ? `<img src="${libraryEscape(source.previewUrl)}" loading="lazy" alt="">` : '<div class="pack-mod-card-empty">◈</div>'; const subtitle = [source.heroLabel || source.hero, librarySlotLabel(source.slot), source.author].filter(Boolean).map(libraryEscape).join(' · '); return `<article class="pack-mod-card">${preview}<div><strong>${libraryEscape(source.displayName || source.name || source.id || source.modId)}</strong>${subtitle ? `<small>${subtitle}</small>` : ''}</div></article>`; }).join('') : `<div class="empty"><strong>${t('catalog.packNoMetadata', 'No mod metadata')}</strong>${t('catalog.packNoMetadataHint', 'This pack has no stored mod metadata.')}</div>`}</div></div>`;
  document.body.appendChild(dialog);
  dialog.querySelector('.dialog-close').onclick = () => dialog.close();
  dialog.onclick = (event) => { if (event.target === dialog) dialog.close(); };
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

function skinPresetEntries(preset) {
  const heroes = state.data?.cosmetics?.heroes || [];
  return Object.entries(preset?.picks || {}).map(([slotId, selection]) => {
    if (!slotId.startsWith('item:')) return null;
    const itemId = String(typeof selection === 'object' ? selection?.itemId || '' : selection || '');
    const styleId = typeof selection === 'object' ? String(selection?.styleId || '') : '';
    const match = /^item:([^:]+):(.+)$/.exec(slotId);
    if (!itemId || !match) return null;
    const [, rawHeroKey, slotKey] = match;
    const heroKey = normalizeHeroId(rawHeroKey);
    const hero = heroes.find((entry) => normalizeHeroId(entry.key) === heroKey);
    const slot = hero?.slots?.find((entry) => entry.id === slotId);
    const option = slot?.options?.find((entry) => String(entry.id) === itemId && String(entry.styleId || '') === styleId);
    return {
      slotId,
      name: option?.name || `${hero?.name || heroKey.replace(/_/g, ' ')} · ${itemId}`,
      subtitle: [hero?.name || heroKey.replace(/_/g, ' '), librarySlotLabel(slot?.name || slotKey), option?.styleName].filter(Boolean).join(' · '),
      previewUrl: option?.previewUrl || null,
    };
  }).filter(Boolean);
}

function skinPresetContentsMarkup(preset) {
  const entries = skinPresetEntries(preset);
  const russian = state.data?.settings?.appLanguage === 'ru';
  const cards = entries.map((entry) => `<article class="skin-preset-mod-card"><div class="skin-preset-mod-preview">${entry.previewUrl ? `<img src="${libraryEscape(entry.previewUrl)}" loading="lazy" alt="">` : '<span aria-hidden="true">◈</span>'}</div><div class="skin-preset-mod-info"><strong>${libraryEscape(entry.name)}</strong><small>${libraryEscape(entry.subtitle)}</small></div><button type="button" class="skin-preset-mod-remove" data-preset-remove-slot="${libraryEscape(entry.slotId)}" aria-label="${russian ? 'Удалить мод из набора' : 'Remove mod from set'}" title="${russian ? 'Удалить мод из набора' : 'Remove mod from set'}">×</button></article>`).join('');
  return `<header class="skin-preset-contents-head"><div><p class="eyebrow">${russian ? 'СОХРАНЁННЫЙ НАБОР' : 'SAVED SKIN SET'}</p><h2>${libraryEscape(preset.name)}</h2><small>${formatTranslation(t('catalog.skinSetCount', '{count} skins'), { count: entries.length })}</small></div><button type="button" class="dialog-close" data-preset-close aria-label="${t('common.close', 'Close')}">×</button></header><div class="skin-preset-mod-list">${cards || `<div class="skin-preset-mod-empty">${russian ? 'В наборе больше нет модов.' : 'There are no mods in this set.'}</div>`}</div>`;
}

function showSkinPresetContents(preset) {
  const dialog = document.createElement('dialog');
  dialog.className = 'skin-preset-contents-dialog';
  let activePreset = preset;
  const renderContents = () => { dialog.innerHTML = skinPresetContentsMarkup(activePreset); };
  const close = () => {
    if (!dialog.open || dialog.classList.contains('is-closing')) return;
    dialog.classList.add('is-closing');
    const finish = () => { if (!dialog.open) return; dialog.close(); };
    dialog.addEventListener('animationend', (event) => { if (event.target === dialog) finish(); }, { once: true });
    setTimeout(finish, 240);
  };
  renderContents();
  dialog.addEventListener('click', async (event) => {
    if (event.target === dialog || event.target.closest('[data-preset-close]')) { close(); return; }
    const button = event.target.closest('[data-preset-remove-slot]');
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      const result = await call('cosmetics:preset-remove-pick', { id: activePreset.id, slotId: button.dataset.presetRemoveSlot });
      state.data.settings.skinLoadoutPresets = result.presets;
      activePreset = result.preset;
      renderContents();
      toast(t('catalog.skinSetModRemoved', 'Mod removed from the saved set.'));
    } catch (error) { button.disabled = false; toast(error.message); }
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.appendChild(dialog);
  dialog.showModal();
}

function renderLibrary() {
  const items = [...libraryInstalledItems().filter((item) => !(item.modType === 'special_patch' && item.specialType === 'cosmetics')), ...libraryGeneratedCosmeticItems()];
  const validFilters = new Set(libraryFilterOptions().map((option) => option.id));
  const filter = validFilters.has(state.libraryFilter) ? state.libraryFilter : 'all';
  state.libraryFilter = filter;
  const query = String(state.query || '').trim().toLowerCase();
  const visibleItems = items
    .slice()
    .sort((left, right) => {
      const leftPinned = isPinnedLibrarySpecialPatch(left) ? 0 : 1;
      const rightPinned = isPinnedLibrarySpecialPatch(right) ? 0 : 1;
      if (leftPinned !== rightPinned) return leftPinned - rightPinned;
      return libraryPriorityValue(left) - libraryPriorityValue(right);
    })
    .filter((item) => {
    if (filter !== 'all' && libraryFilterForItem(item) !== filter) return false;
    if (!query) return true;
    return [item.displayName, item.name, item.categoryId, item.category, item.hero, item.heroLabel, item.fileName, ...(Array.isArray(item.installedFiles) ? item.installedFiles : [])].filter(Boolean).join(' ').toLowerCase().includes(query);
  });
  const groups = new Map();
  visibleItems.forEach((item) => { const category = libraryFilterForItem(item) === 'heroes' ? 'heroes' : libraryCategory(item); if (!groups.has(category)) groups.set(category, []); groups.get(category).push(item); });
  const selected = state.librarySelection;
  const row = (item) => {
    const id = libraryItemId(item);
    const pack = item.type === 'pack';
    const generatedCosmetic = isGeneratedCosmeticItem(item);
    const isPinnedPatch = isPinnedLibrarySpecialPatch(item);
    const name = item.displayName || item.name || id;
    const fileName = item.gameFileName || item.deployedFileName || item.fileName || item.installedFiles?.[0] || '';
    const checkbox = isPinnedPatch ? '' : `<label class="library-check"><input type="checkbox" data-library-select="${libraryEscape(id)}" aria-label="${libraryEscape(formatTranslation(t('catalog.selectMod', 'Select {name}'), { name }))}" ${selected.has(id) ? 'checked' : ''}><span></span></label>`;
    const packButton = pack && !selected.size ? `<button class="action secondary library-pack-info" data-pack-content="${libraryEscape(id)}" title="${t('catalog.viewPackContents', 'View Pack contents')}" aria-label="${t('catalog.viewPackContents', 'View Pack contents')}">!</button>` : '';
    const dragHandle = isPinnedPatch || generatedCosmetic ? '' : `<button type="button" class="library-drag-handle" draggable="true" aria-label="Reorder mod" data-library-drag-id="${libraryEscape(id)}"><span class="drag-dots"><i></i><i></i><i></i><i></i><i></i><i></i></span></button>`;
    const toggleButton = isPinnedPatch || generatedCosmetic || selected.size ? '' : `<button class="toggle-button ${item.enabled !== false ? 'on' : ''}" data-library-toggle="${libraryEscape(id)}" data-library-enabled="${item.enabled !== false}">${item.enabled !== false ? t('catalog.actionEnabled', 'Enabled') : t('catalog.actionDisabled', 'Disabled')}</button>`;
    const metadata = generatedCosmetic
      ? [item.heroLabel, librarySlotLabel(item.slot), item.unusualEffect].filter(Boolean).map(libraryEscape).join(' · ')
      : `${libraryEscape(libraryCategory(item))}${item.heroLabel ? ` · ${libraryEscape(item.heroLabel)}` : ''}${item.slot ? ` · ${libraryEscape(librarySlotLabel(item.slot))}` : ''}`;
    const patchInfo = generatedCosmetic ? '' : isPinnedPatch ? (() => {
      const record = findLibraryItem(id) || state.data?.installed?.[id] || null;
      const rawVersion = String(record?.currentVersion ?? record?.version ?? '').trim();
      const revision = rawVersion ? rawVersion.slice(0, 7) : '—';
      const statusText = record?.specialPatchState === 'error'
        ? specialPatchText('Ошибка патча', 'Patch error')
        : (record?.requiresPatchUpdate || record?.specialPatchState === 'update_required')
          ? specialPatchText('Требуется обновить патч', 'Requires patch update')
          : specialPatchText('Патч актуален', 'Patch up to date');
      return `<small>${specialPatchText('Версия патча', 'Patch revision')}: ${libraryEscape(revision)}</small><small><span class="special-patch-badge">PATCH</span> <span>${libraryEscape(statusText)}</span></small>`;
    })() : `<small>${libraryEscape(libraryPriorityLabel(item))} · ${libraryEscape(fileName)} · ${item.enabled === false ? t('catalog.actionDisabled', 'Disabled') : t('catalog.actionEnabled', 'Enabled')}</small>`;
    const actions = generatedCosmetic
      ? `<button class="action secondary" data-library-cosmetic-remove="${libraryEscape(item.cosmeticSlotId)}">${t('catalog.removeCosmeticItem', 'Remove skin')}</button>`
      : selected.size ? '' : `<button class="action secondary" data-library-remove="${libraryEscape(id)}">${t('catalog.uninstall', 'Remove')}</button>`;
    return `<article class="library-mod ${pack ? 'library-pack-item' : ''} ${generatedCosmetic ? 'library-generated-cosmetic-item' : ''} ${selected.has(id) ? 'selected' : ''} ${isPinnedPatch ? 'library-special-patch-row' : ''}" data-library-id="${libraryEscape(id)}">${checkbox}${dragHandle}${item.previewUrl ? `<img src="${libraryEscape(item.previewUrl)}" loading="lazy" alt="">` : '<div class="library-thumb-empty">◈</div>'}<div class="library-mod-info"><strong>${libraryEscape(name)}</strong>${metadata ? `<small>${metadata}</small>` : ''}${patchInfo}</div><div class="library-mod-actions">${toggleButton}${packButton}${actions}</div></article>`;
  };
  const sections = [...groups.entries()].sort(([left], [right]) => libraryCategoryOrder(left) - libraryCategoryOrder(right) || left.localeCompare(right)).map(([category, categoryItems]) => {
    const title = category === 'heroes' ? libraryFilterOptions().find((option) => option.id === 'heroes').label : category;
    const content = category === 'heroes' ? libraryHeroSections(categoryItems, row) : `<div class="library-mod-list">${categoryItems.map(row).join('')}</div>`;
    return `<section class="library-section"><div class="library-section-heading"><h2>${libraryEscape(title)}</h2><span>${categoryItems.length}</span></div>${content}</section>`;
  }).join('');
  const russian = state.data?.settings?.appLanguage === 'ru';
  const cosmeticPicksExist = Object.keys(state.data.settings?.cosmeticLoadout || {}).length > 0 || Boolean(state.data.installed?.['vanta-generated-cosmetics']);
  const deletableCount = libraryInstalledItems().filter((item) => !(item.modType === 'special_patch' && item.specialType === 'cosmetics')).length + (cosmeticPicksExist ? 1 : 0);
  const skinPresets = Array.isArray(state.data.settings?.skinLoadoutPresets) ? state.data.settings.skinLoadoutPresets : [];
  const appliedSkinCount = Object.keys(state.data.settings?.cosmeticLoadout || {}).length;
  const presetSection = `<section class="library-section skin-presets-section"><div class="library-section-heading"><h2>${t('catalog.skinSets')}</h2><span>${skinPresets.length}</span><button class="action secondary" id="library-save-skin-set" ${appliedSkinCount ? '' : 'disabled'}>${t('catalog.saveSkinSet')}</button></div>${skinPresets.length ? `<div class="skin-preset-list">${skinPresets.map((preset) => `<article class="skin-preset-row"><div><strong>${libraryEscape(preset.name)}</strong><small>${formatTranslation(t('catalog.skinSetCount', '{count} skins'), { count: Object.keys(preset.picks || {}).length })}</small></div><div class="skin-preset-actions"><button class="action secondary skin-preset-view" data-skin-preset-view="${libraryEscape(preset.id)}" aria-label="${state.data?.settings?.appLanguage === 'ru' ? 'Показать моды набора' : 'Show set mods'}" title="${state.data?.settings?.appLanguage === 'ru' ? 'Показать моды набора' : 'Show set mods'}">!</button><button class="action" data-skin-preset-apply="${libraryEscape(preset.id)}">${t('catalog.applySkinSet')}</button><button class="action secondary" data-skin-preset-delete="${libraryEscape(preset.id)}">${t('catalog.deleteSkinSet')}</button></div></article>`).join('')}</div>` : `<p class="skin-preset-empty">${t('catalog.skinSetEmpty')}</p>`}</section>`;
  $('#content').innerHTML = `<div class="library-header"><div><p class="eyebrow">VANTAMODS</p><p>${t('catalog.libraryManage', 'Manage local VPK packages and their game deployment.')}</p><small class="library-reinstall-hint">${t('catalog.reinstallingMods')}</small><div class="library-filters" role="tablist" aria-label="${t('catalog.libraryFilters', 'Library filters')}">${libraryFilterOptions().map((option) => `<button class="library-filter ${filter === option.id ? 'active' : ''}" data-library-filter="${option.id}">${option.label}</button>`).join('')}</div></div><div class="library-header-actions"><button class="action" id="library-reinstall">${t('catalog.reinstallMods')}</button><button class="action secondary" id="library-delete-all" ${deletableCount ? '' : 'disabled'}>${t('catalog.deleteAll', 'Delete all')}</button></div></div>${presetSection}<div class="library-bulk"><span>${selected.size} ${t('catalog.selectedShort', 'selected')}</span><button class="action secondary" id="library-remove-selected" ${selected.size ? '' : 'disabled'}>${t('common.delete', 'Delete')}</button></div>${sections || `<div class="empty"><strong>${t('catalog.libraryEmptyTitle', 'Library is empty')}</strong>${t('catalog.libraryEmptyHint', 'Install mods to add them to your managed Library.')}</div>`}`;
  bindLibrarySearch();
  bindUnifiedLibrary();
  renderExternalFiles();
  syncLibraryBulkUi();
  if (typeof decorateSpecialLibrary === 'function') decorateSpecialLibrary();
}

function bindLibrarySearch() {
  const filters = document.querySelector('.library-header .library-filters');
  if (!filters) return;
  const label = document.createElement('label');
  label.className = 'library-search';
  label.innerHTML = '<span aria-hidden="true">⌕</span>';
  const input = document.createElement('input');
  input.id = 'library-search';
  input.type = 'search';
  input.placeholder = t('search.library.placeholder', 'Search mods');
  input.setAttribute('aria-label', input.placeholder);
  input.value = state.query || '';
  label.append(input);
  filters.before(label);
  input.oninput = () => {
    const cursor = input.selectionStart;
    state.query = input.value;
    const topSearch = document.querySelector('#search');
    if (topSearch) topSearch.value = state.query;
    renderLibrary();
    const nextInput = document.querySelector('#library-search');
    nextInput?.focus({ preventScroll: true });
    if (nextInput && cursor !== null) nextInput.setSelectionRange(cursor, cursor);
  };
}

function bindUnifiedLibrary() {
  document.querySelectorAll('[data-skin-preset-view]').forEach((button) => button.onclick = () => {
    const preset = (state.data.settings?.skinLoadoutPresets || []).find((item) => item.id === button.dataset.skinPresetView);
    if (preset) showSkinPresetContents(preset);
  });
  $('#library-save-skin-set')?.addEventListener('click', async () => {
    const result = await showAppInputDialog({ title: t('catalog.saveSkinSet'), label: t('catalog.skinSetName'), placeholder: t('catalog.skinSetName'), confirmLabel: t('common.save', 'Save'), validate: (value) => !value.trim() ? t('savedPacks.validationRequired', 'Enter a name.') : '' });
    if (!result.confirmed) return;
    try {
      const saved = await call('cosmetics:preset-save', { name: result.value });
      state.data.settings.skinLoadoutPresets = saved.presets;
      renderLibrary();
      toast(t('catalog.skinSetSaved'));
    } catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-skin-preset-apply]').forEach((button) => button.onclick = async () => {
    const preset = (state.data.settings?.skinLoadoutPresets || []).find((item) => item.id === button.dataset.skinPresetApply);
    if (!preset) return;
    if (!state.data.cosmetics?.loaderInstalled) {
      const confirmation = await showAppConfirmDialog({ title: t('catalog.skinSets'), message: t('catalog.skinSetApplyWarning'), confirmLabel: cosmeticsText('Продолжить', 'Continue'), destructive: true });
      if (!confirmation.confirmed) return;
    }
    button.disabled = true;
    try {
      const cosmetics = await call('cosmetics:preset-apply', { id: preset.id });
      state.data = await call('library:get');
      state.data.cosmetics = cosmetics;
      state.cosmeticsDraft = { ...(cosmetics.picks || {}) };
      renderLibrary();
      toast(t('catalog.skinSetApplied'));
    } catch (error) { toast(error.message); }
    finally { if (button.isConnected) button.disabled = false; }
  });
  document.querySelectorAll('[data-skin-preset-delete]').forEach((button) => button.onclick = async () => {
    try {
      const result = await call('cosmetics:preset-delete', { id: button.dataset.skinPresetDelete });
      state.data.settings.skinLoadoutPresets = result.presets;
      renderLibrary();
      toast(t('catalog.skinSetDeleted'));
    } catch (error) { toast(error.message); }
  });
  $('#library-reinstall')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      state.data = await call('library:reinstall-mods');
      renderLibrary();
      const summary = state.data.reinstall || { succeeded: 0, failed: 0 };
      const failedMods = (summary.results || []).filter((result) => result.status === 'failed').map((result) => result.name);
      const failures = failedMods.length ? ` ${formatTranslation(t('catalog.reinstallFailedMods'), { mods: failedMods.join(', ') })}` : '';
      toast(`${formatTranslation(t('catalog.reinstallDone'), { succeeded: summary.succeeded, failed: summary.failed })}${failures}`);
    } catch (error) { toast(error.message); }
    finally { if (button.isConnected) button.disabled = false; }
  });
  $('#library-check')?.addEventListener('click', async () => { try { state.data = await call('library:diagnose'); state.view = 'discover'; renderDotaStatus?.(); } catch (error) { toast(error.message); } });
  document.querySelectorAll('[data-library-filter]').forEach((button) => { button.onclick = () => { state.libraryFilter = button.dataset.libraryFilter; renderLibrary(); }; });
  document.querySelectorAll('[data-library-select]').forEach((input) => { input.onchange = () => { input.checked ? state.librarySelection.add(input.dataset.librarySelect) : state.librarySelection.delete(input.dataset.librarySelect); renderLibrary(); }; });
  document.querySelectorAll('[data-library-toggle]').forEach((button) => { button.onclick = async () => { try { const item = findLibraryItem(button.dataset.libraryToggle); state.data = await call('mod:set-enabled', { id: button.dataset.libraryToggle, enabled: item?.enabled === false }); renderLibrary(); } catch (error) { toast(error.message); } }; });
  document.querySelectorAll('[data-library-rename]').forEach((button) => { button.onclick = async () => { const item = findLibraryItem(button.dataset.libraryRename); const result = await showAppInputDialog({ title: t('catalog.renameTitle', 'Rename item'), label: t('catalog.libraryNamePrompt', 'Library name'), value: item?.displayName || item?.name || '', placeholder: t('catalog.libraryNamePrompt', 'Library name'), confirmLabel: t('common.save', 'Save'), validate: (value) => !value ? t('catalog.libraryNameRequired', 'Enter a name.') : '' }); if (!result.confirmed) return; try { state.data = await call('mod:rename', { id: button.dataset.libraryRename, name: result.value }); renderLibrary(); } catch (error) { toast(error.message); } }; });
  document.querySelectorAll('[data-library-remove]').forEach((button) => { button.onclick = async () => { const confirmation = await showAppConfirmDialog({ title: t('catalog.removeLibraryItemTitle', 'Remove library item'), message: t('catalog.removeLibraryItem', 'Remove this Library item?'), confirmLabel: t('catalog.uninstall', 'Remove'), destructive: true }); if (!confirmation.confirmed) return; try { state.data = await call('mod:uninstall', { id: button.dataset.libraryRemove }); state.librarySelection.delete(button.dataset.libraryRemove); renderLibrary(); } catch (error) { toast(error.message); } }; });
  document.querySelectorAll('[data-library-cosmetic-remove]').forEach((button) => { button.onclick = async () => {
    const slotId = button.dataset.libraryCosmeticRemove;
    const confirmation = await showAppConfirmDialog({ title: t('catalog.removeCosmeticItemTitle', 'Remove selected skin'), message: t('catalog.removeCosmeticItemConfirm', 'Remove this skin from the generated loadout?'), confirmLabel: t('catalog.removeCosmeticItem', 'Remove skin'), destructive: true });
    if (!confirmation.confirmed) return;
    try {
      const picks = { ...(state.data.settings?.cosmeticLoadout || {}) };
      delete picks[slotId];
      delete picks[`effect:${slotId}`];
      const cosmetics = await call('cosmetics:apply', { picks });
      state.data = await call('library:get');
      state.data.cosmetics = cosmetics;
      state.cosmeticsDraft = { ...(cosmetics.picks || {}) };
      state.librarySelection.delete(`cosmetic:${slotId}`);
      renderLibrary();
    } catch (error) { toast(error.message); }
  }; });
  document.querySelectorAll('[data-pack-content]').forEach((button) => { button.onclick = async () => { try { showUnifiedPackContents(await call('library:pack-contents', { id: button.dataset.packContent })); } catch (error) { toast(/missing/i.test(error.message) ? t('savedPacks.fileMissing', 'Saved pack file was not found.') : t('savedPacks.viewerError', 'Could not open pack contents.')); } }; });
  document.querySelectorAll('.library-drag-handle').forEach((handle) => {
    handle.addEventListener('dragstart', (event) => {
      const id = handle.dataset.libraryDragId;
      if (!id) return;
      state.libraryDraggingId = id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
      handle.closest('.library-mod')?.classList.add('dragging');
    });
    handle.addEventListener('dragend', () => {
      state.libraryDraggingId = '';
      document.querySelectorAll('.library-mod').forEach((row) => row.classList.remove('dragging', 'drop-target'));
    });
  });
  document.querySelectorAll('.library-mod').forEach((row) => {
    row.addEventListener('dragover', (event) => {
      if (!state.libraryDraggingId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.library-mod').forEach((item) => item.classList.toggle('drop-target', item === row));
    });
    row.addEventListener('drop', async (event) => {
      if (!state.libraryDraggingId) return;
      event.preventDefault();
      const draggedId = state.libraryDraggingId;
      const targetId = row.dataset.libraryId;
      if (row.classList.contains('library-generated-cosmetic-item')) return;
      if (!draggedId || !targetId || draggedId === targetId) return;
      const currentOrder = Array.from(document.querySelectorAll('.library-mod[data-library-id]:not(.library-generated-cosmetic-item)')).map((item) => item.dataset.libraryId);
      const sourceIndex = currentOrder.indexOf(draggedId);
      const targetIndex = currentOrder.indexOf(targetId);
      if (sourceIndex < 0 || targetIndex < 0) return;
      const nextOrder = [...currentOrder];
      const [movedId] = nextOrder.splice(sourceIndex, 1);
      nextOrder.splice(targetIndex, 0, movedId);
      try {
        state.data = await call('mod:reorder', { ids: nextOrder });
        renderLibrary();
      } catch (error) { toast(error.message); }
      finally { state.libraryDraggingId = ''; document.querySelectorAll('.library-mod').forEach((item) => item.classList.remove('dragging', 'drop-target')); }
    });
  });
  $('#library-delete-all')?.addEventListener('click', async () => {
    const managed = libraryInstalledItems().filter((item) => !(item.modType === 'special_patch' && item.specialType === 'cosmetics'));
    const cosmeticPicks = Object.keys(state.data.settings?.cosmeticLoadout || {});
    const hasGeneratedCosmetics = cosmeticPicks.length > 0 || Boolean(state.data.installed?.['vanta-generated-cosmetics']);
    const count = managed.length + (hasGeneratedCosmetics ? 1 : 0);
    if (!count) return;
    const confirmation = await showAppConfirmDialog({
      title: t('catalog.deleteAllTitle', 'Delete all Library items'),
      message: formatTranslation(t('catalog.deleteAllConfirm', 'Remove all {count} managed Library item(s)? This cannot be undone.'), { count }),
      confirmLabel: t('catalog.deleteAll', 'Delete all'),
      destructive: true,
    });
    if (!confirmation.confirmed) return;
    try {
      if (hasGeneratedCosmetics) await call('cosmetics:apply', { picks: {} });
      for (const item of managed) await call('mod:uninstall', { id: libraryItemId(item) });
      state.librarySelection.clear();
      state.data = await call('library:get');
      renderLibrary();
      toast(t('catalog.deleteAllDone', 'All managed Library items were removed.'));
    } catch (error) {
      try { state.data = await call('library:get'); renderLibrary(); } catch {}
      toast(error.message);
    }
  });
  $('#library-pack')?.addEventListener('click', () => { const ids = [...state.librarySelection].filter((id) => !id.startsWith('external:') && !id.startsWith('cosmetic:item:')); if (ids.length < 2) return toast(t('catalog.selectAtLeastTwoMods', 'Select at least two mods to merge.')); openMergePackDialog(ids); });
  const selectedManaged = () => [...state.librarySelection].filter((id) => !id.startsWith('external:') && !id.startsWith('cosmetic:item:'));
  const selectedCosmetics = () => [...state.librarySelection].filter((id) => id.startsWith('cosmetic:item:')).map((id) => id.slice('cosmetic:'.length));
  $('#library-remove-selected')?.addEventListener('click', async () => { const managed = selectedManaged(); const cosmetics = selectedCosmetics(); const external = [...state.librarySelection].filter((value) => value.startsWith('external:')); if (!managed.length && !cosmetics.length && !external.length) return toast(t('catalog.selectModFirst', 'Select a mod first.')); const confirmation = await showAppConfirmDialog({ title: t('catalog.removeSelectedModTitle', 'Remove selected mods'), message: formatTranslation(t('catalog.removeSelectedCount', 'Remove {count} selected mod(s)?'), { count: managed.length + cosmetics.length + external.length }), confirmLabel: t('catalog.uninstall', 'Remove'), destructive: true }); if (!confirmation.confirmed) return; for (const id of managed) await call('mod:uninstall', { id }); for (const id of external) { const file = state.data.external.find((item) => item.id === id); if (file) await call('external:remove', { relativePath: file.relativePath }); } if (cosmetics.length) { const picks = { ...(state.data.settings?.cosmeticLoadout || {}) }; cosmetics.forEach((slotId) => { delete picks[slotId]; delete picks[`effect:${slotId}`]; }); await call('cosmetics:apply', { picks }); } state.librarySelection.clear(); state.data = await call('library:get'); if (cosmetics.length) state.data.cosmetics = await call('cosmetics:list'); renderLibrary(); });
}

window.renderLibrary = renderLibrary;
window.bindLibrary = bindUnifiedLibrary;
