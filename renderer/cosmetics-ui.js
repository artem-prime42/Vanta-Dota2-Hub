function cosmeticsText(ru, en) { return state.data?.settings?.appLanguage === 'ru' ? ru : en; }
function cosmeticsHtml(value) { return escapeHtml(value ?? ''); }
function cosmeticSlotText(slot) {
  const id = String(slot?.id || '').split(':').at(-1) || slot?.name || '';
  const normalized = id.toLowerCase().replace(/[\s-]+/g, '_');
  const isEarthshakerTotem = normalizeHeroId(state.cosmeticsHero || state.hero) === 'earthshaker' && normalized === 'weapon';
  return isEarthshakerTotem ? t('slot.totem', 'Totem') : slotLabel(id);
}
function cosmeticSlotName(slot) { return cosmeticsHtml(cosmeticSlotText(slot)); }
const COSMETIC_EFFECT_OPTIONS = [
  { id: '', ru: 'Без эффекта', en: 'No effect' },
  { id: 'fire', ru: 'Огонь', en: 'Fire' },
  { id: 'lightnings', ru: 'Молнии', en: 'Lightning' },
  { id: 'frostbloom', ru: 'Иней', en: 'Frostbloom' },
  { id: 'snow', ru: 'Снег', en: 'Snow' },
  { id: 'bubbles', ru: 'Пузыри', en: 'Bubbles' },
  { id: 'sand-storm', ru: 'Песчаная буря', en: 'Sandstorm' },
  { id: 'ghost', ru: 'Призрак', en: 'Ghost' },
];
function cosmeticPickItemId(value) { return String(typeof value === 'object' ? value?.itemId || '' : value || ''); }
function cosmeticPickEffectId(value) { return String(typeof value === 'object' ? value?.effectId || '' : ''); }
function cosmeticPickStyleId(value) { return String(typeof value === 'object' ? value?.styleId ?? '' : ''); }
function cosmeticSelectionValue(itemId, styleId = '', effectId = '') {
  return styleId !== '' || effectId ? { itemId, ...(styleId !== '' ? { styleId } : {}), ...(effectId ? { effectId } : {}) } : itemId;
}
function cosmeticSelectionForVariant(previous, itemId, styleId) {
  const effectId = cosmeticPickItemId(previous) === String(itemId) ? cosmeticPickEffectId(previous) : '';
  return cosmeticSelectionValue(String(itemId), String(styleId ?? ''), effectId);
}
function cosmeticStyleLabel(option) {
  const id = String(option?.styleId ?? '');
  const label = String(option?.styleName || '').trim();
  if (id === '0' && (!label || /^style\s*0$/i.test(label))) return '';
  return cosmeticsHtml(label || (id ? `Style ${id}` : ''));
}
function showCosmeticEffectPicker(slotId, itemId, currentEffectId, onSave, styleId = '') {
  const dialog = document.createElement('dialog');
  dialog.className = 'cosmetic-effect-dialog';
  const selected = COSMETIC_EFFECT_OPTIONS.some((effect) => effect.id === currentEffectId) ? currentEffectId : '';
  dialog.innerHTML = `<form method="dialog" class="cosmetic-effect-panel"><header><div><p class="eyebrow">${cosmeticsText('НАСТРОЙКА СКИНА', 'SKIN CUSTOMIZATION')}</p><h2>${cosmeticsText('Необычный эффект', 'Unusual effect')}</h2><p>${cosmeticsText('Выберите эффект частиц для выбранного скина.', 'Choose a particle effect for this selected skin.')}</p></div><button type="button" class="dialog-close" data-effect-close aria-label="${cosmeticsText('Закрыть', 'Close')}">×</button></header><div class="cosmetic-effect-options">${COSMETIC_EFFECT_OPTIONS.map((effect) => `<label class="cosmetic-effect-option ${selected === effect.id ? 'is-active' : ''}"><input type="radio" name="cosmetic-effect" value="${effect.id}" ${selected === effect.id ? 'checked' : ''}><span>${cosmeticsText(effect.ru, effect.en)}</span>${selected === effect.id ? '<b>✓</b>' : ''}</label>`).join('')}</div><footer><button type="button" class="action secondary" data-effect-cancel>${cosmeticsText('Отмена', 'Cancel')}</button><button type="submit" class="action">${cosmeticsText('Сохранить', 'Save')}</button></footer></form>`;
  const closeAnimated = () => {
    if (!dialog.open || dialog.classList.contains('is-closing')) return;
    dialog.classList.add('is-closing');
    const finish = () => {
      dialog.removeEventListener('animationend', finish);
      if (dialog.open) dialog.close();
      dialog.remove();
    };
    dialog.addEventListener('animationend', finish);
    setTimeout(finish, 220);
  };
  dialog.querySelector('[data-effect-close]').onclick = closeAnimated;
  dialog.querySelector('[data-effect-cancel]').onclick = closeAnimated;
  dialog.querySelectorAll('input[name="cosmetic-effect"]').forEach((input) => input.onchange = () => {
    dialog.querySelectorAll('.cosmetic-effect-option').forEach((option) => option.classList.toggle('is-active', option.querySelector('input').checked));
    dialog.querySelectorAll('.cosmetic-effect-option b').forEach((check) => check.remove());
    const active = dialog.querySelector('.cosmetic-effect-option.is-active');
    if (active) active.insertAdjacentHTML('beforeend', '<b>✓</b>');
  });
  dialog.querySelector('form').onsubmit = (event) => {
    event.preventDefault();
    const effectId = dialog.querySelector('input[name="cosmetic-effect"]:checked')?.value || '';
    onSave({ slotId, itemId, effectId });
    closeAnimated();
  };
  dialog.addEventListener('click', (event) => { if (event.target === dialog) closeAnimated(); });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.appendChild(dialog);
  dialog.showModal();
}

function cosmeticsLoaderNotice(data) {
  return data.loaderInstalled
    ? `<div class="cosmetics-loader-state is-ready"><span>✓</span>${cosmeticsText('Загрузчик настроен — можно применять образы.', 'The local loader is ready for loadouts.')}</div>`
    : `<div class="cosmetics-loader-state"><span>!</span>${cosmeticsText('Первое применение добавит локальный путь в gameinfo и подпись. Исходные файлы будут сохранены для отката.', 'The first apply adds a local gameinfo path and signature. Original files are backed up for rollback.')}</div>`;
}

function cosmeticPreviewMarkup(option, heroName) {
  const preview = option.previewUrl;
  const fallback = option.previewFallbackUrl;
  const rawRarity = String(option.quality || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  const rarityLabels = {
    arcana: 'Arcana', infused: 'Infused', immortal: 'Immortal', mythical: 'Mythical', legendary: 'Legendary',
    rare: 'Rare', uncommon: 'Uncommon', common: 'Common', ancient: 'Ancient',
    divine: 'Divine', 'immortal treasure': 'Immortal Treasure',
  };
  const rarity = rawRarity === 'unique' ? '' : (rarityLabels[rawRarity] || '');
  return `<div class="skin-card-image ${preview || fallback ? '' : 'no-image'}"><img ${preview || fallback ? `src="${cosmeticsHtml(preview || fallback)}"` : ''} ${fallback ? `data-preview-fallback="${cosmeticsHtml(fallback)}"` : ''} loading="lazy" alt="${cosmeticsHtml(option.name)} — ${cosmeticsHtml(heroName)}" data-skin-preview><span class="skin-card-image-fallback" aria-hidden="true">${heroName.slice(0, 1)}</span>${rarity ? `<span class="skin-card-quality rarity-${rawRarity.replace(/\s+/g, '-')}" title="${cosmeticsHtml(rarity)}">${cosmeticsHtml(rarity)}</span>` : ''}</div>`;
}

function bindCosmeticImageFallbacks(selector) {
  document.querySelectorAll(selector).forEach((image) => image.addEventListener('error', () => {
    const fallback = image.dataset.previewFallback;
    if (fallback && image.src !== fallback) {
      image.dataset.previewFallback = '';
      image.src = fallback;
      return;
    }
    image.closest('.skin-card-image, .cosmetic-hero-cover')?.classList.add('no-image');
  }));
}

function renderCosmeticsDirectory(data) {
  const heroes = data.heroes || [];
  const query = String(state.cosmeticsSearch || '').trim().toLowerCase();
  const heroCards = heroes.map((hero) => {
    const visibleSlots = (hero.slots || []).filter((slot) => String(slot.id || '').split(':').at(-1).toLowerCase() !== 'set');
    const options = visibleSlots.flatMap((slot) => slot.options.map((option) => ({ ...option, slotName: cosmeticSlotText(slot) })));
    const cover = options.find((option) => option.previewUrl || option.previewFallbackUrl);
    const count = options.length;
    return `<button type="button" class="cosmetic-hero-card" data-cosmetics-open="${cosmeticsHtml(hero.key)}" data-cosmetics-name="${cosmeticsHtml(hero.name.toLowerCase())}"><span class="cosmetic-hero-cover ${cover ? '' : 'no-image'}">${cover ? `<img src="${cosmeticsHtml(cover.previewUrl || cover.previewFallbackUrl)}" ${cover.previewFallbackUrl ? `data-preview-fallback="${cosmeticsHtml(cover.previewFallbackUrl)}"` : ''} loading="lazy" alt="">` : ''}<span>${hero.name.slice(0, 1)}</span></span><span class="cosmetic-hero-copy"><strong>${hero.name}</strong><small>${count} ${cosmeticsText('образов', 'looks')} · ${visibleSlots.length} ${cosmeticsText('слотов', 'slots')}</small></span><span class="cosmetic-hero-arrow">→</span></button>`;
  }).join('');
  $('#content').innerHTML = `<section class="cosmetics-page"><header class="cosmetics-heading"><div><p class="eyebrow">${cosmeticsText('ЛОКАЛЬНЫЕ СКИНЫ', 'LOCAL HERO SKINS')}</p><h2>${cosmeticsText('Выбери героя', 'Choose a hero')}</h2><p>${cosmeticsText('Готовый список предметов загружается из кэша игры при старте VANTA. Открой героя, чтобы выбрать образ на карточках.', 'The skin list is prepared from the local game schema when VANTA starts. Open a hero to choose a look from image cards.')}</p></div><div class="cosmetics-hero-count"><strong>${heroes.length}</strong><span>${cosmeticsText('героев', 'heroes')}</span></div></header>${cosmeticsLoaderNotice(data)}<label class="cosmetics-directory-search"><span aria-hidden="true">⌕</span><input id="cosmetics-search" type="search" placeholder="${cosmeticsText('Поиск героя', 'Search heroes')}" value="${cosmeticsHtml(state.cosmeticsSearch || '')}"></label><div class="cosmetics-hero-directory">${heroCards || `<div class="empty"><strong>${cosmeticsText('Скины не найдены', 'No skins found')}</strong></div>`}</div></section>`;
  $('#cosmetics-search').oninput = (event) => {
    state.cosmeticsSearch = event.currentTarget.value;
    const needle = state.cosmeticsSearch.trim().toLowerCase();
    document.querySelectorAll('[data-cosmetics-open]').forEach((card) => {
      card.hidden = Boolean(needle && !card.dataset.cosmeticsName.includes(needle));
    });
  };
  bindCosmeticImageFallbacks('[data-skin-preview], .cosmetic-hero-cover img');
  document.querySelectorAll('[data-cosmetics-open]').forEach((button) => button.onclick = () => {
    state.cosmeticsHero = button.dataset.cosmeticsOpen;
    state.cosmeticsSlotFilter = 'all';
    state.cosmeticsSkinSearch = '';
    renderCosmeticsView(data);
  });
}

function renderHeroCosmetics(data, hero) {
  const draft = state.cosmeticsDraft || {};
  const slots = (hero.slots || []).filter((slot) => String(slot.id || '').split(':').at(-1).toLowerCase() !== 'set');
  const allOptions = slots.flatMap((slot) => slot.options.map((option) => ({ ...option, slotId: slot.id, slotName: cosmeticSlotText(slot) })));
  const slotFilter = state.cosmeticsSlotFilter || 'all';
  const query = String(state.cosmeticsSkinSearch || '').trim().toLowerCase();
  const filtered = allOptions.filter((option) => (slotFilter === 'all' || option.slotId === slotFilter)
    && (!query || `${option.name} ${option.slotName}`.toLowerCase().includes(query)));
  const skinCards = filtered.map((option) => {
    const selected = cosmeticPickItemId(draft[option.slotId]) === option.id && cosmeticPickStyleId(draft[option.slotId]) === String(option.styleId ?? '');
    const selectedPick = draft[option.slotId];
    const effectId = selected ? cosmeticPickEffectId(selectedPick) : '';
    return `<article class="cosmetic-skin-card ${selected ? 'is-selected' : ''}"><button type="button" class="cosmetic-skin-select" data-cosmetic-slot="${cosmeticsHtml(option.slotId)}" data-cosmetic-item="${cosmeticsHtml(option.id)}" data-cosmetic-style="${cosmeticsHtml(option.styleId ?? '')}" aria-pressed="${selected}">${cosmeticPreviewMarkup(option, hero.name)}<span class="skin-card-body"><span class="skin-card-title">${cosmeticsHtml(option.name)}</span><span class="skin-card-meta">${cosmeticsHtml(option.slotName)}${option.styleId !== undefined && option.styleId !== null ? ` · ${cosmeticStyleLabel(option)}` : ''}</span>${selected && effectId ? `<span class="skin-card-effect-name">${cosmeticsHtml(COSMETIC_EFFECT_OPTIONS.find((effect) => effect.id === effectId)?.[state.data?.settings?.appLanguage === 'ru' ? 'ru' : 'en'] || effectId)}</span>` : ''}</span></button>${selected ? `<button type="button" class="skin-card-effect-button ${effectId ? 'has-effect' : ''}" data-cosmetic-effect-slot="${cosmeticsHtml(option.slotId)}" data-cosmetic-effect-item="${cosmeticsHtml(option.id)}" data-cosmetic-effect-style="${cosmeticsHtml(option.styleId ?? '')}" aria-label="${cosmeticsText('Настроить эффект для этого стиля', 'Set an effect for this style')}" title="${cosmeticsText('Настроить эффект для этого стиля', 'Set an effect for this style')}">+</button>` : ''}</article>`;
  }).join('');
  const selectedCount = Object.keys(draft).length;
  const changed = JSON.stringify(draft) !== JSON.stringify(data.picks || {});
  const canApply = changed || selectedCount > 0;
  $('#content').innerHTML = `<section class="cosmetics-page"><button type="button" class="back-link cosmetics-back" id="cosmetics-back">← ${cosmeticsText('Все герои', 'All heroes')}</button><header class="cosmetics-heading"><div><p class="eyebrow">${cosmeticsText('СТРАНИЦА ГЕРОЯ', 'HERO SKINS')}</p><h2>${cosmeticsHtml(hero.name)}</h2><p>${cosmeticsText('Выбирай отдельные предметы. Выбранные карточки объединятся в один образ.', 'Choose individual items. Selected cards combine into one loadout.')}</p></div><div class="cosmetics-hero-count"><strong>${allOptions.length}</strong><span>${cosmeticsText('образов', 'looks')}</span></div></header>${cosmeticsLoaderNotice(data)}<div class="cosmetics-card-toolbar"><div class="cosmetics-slot-filters"><button type="button" class="filter ${slotFilter === 'all' ? 'active' : ''}" data-cosmetic-filter="all">${cosmeticsText('Все слоты', 'All slots')}</button>${slots.map((slot) => `<button type="button" class="filter ${slotFilter === slot.id ? 'active' : ''}" data-cosmetic-filter="${cosmeticsHtml(slot.id)}">${cosmeticSlotName(slot)}</button>`).join('')}</div><label class="cosmetics-directory-search"><span aria-hidden="true">⌕</span><input id="cosmetics-skin-search" type="search" placeholder="${cosmeticsText('Поиск скинов', 'Search skins')}" value="${cosmeticsHtml(state.cosmeticsSkinSearch || '')}"></label><span class="cosmetics-slot-count">${filtered.length} ${cosmeticsText('карточек', 'cards')}</span></div><div class="cosmetics-skin-grid">${skinCards || `<div class="empty"><strong>${cosmeticsText('Скины не найдены', 'No skins found')}</strong></div>`}</div><footer class="cosmetics-footer"><div><strong>${cosmeticsText('Выбрано слотов', 'Selected slots')}: ${selectedCount}</strong><small>${cosmeticsText('Образ хранится локально на этом компьютере.', 'The loadout is stored locally on this computer.')}</small></div><div><button id="cosmetics-reset" class="action secondary" ${selectedCount ? '' : 'disabled'}>${cosmeticsText('Сбросить образ', 'Reset loadout')}</button><button id="cosmetics-apply" class="action" ${canApply ? '' : 'disabled'}>${cosmeticsText('Применить образ', 'Apply loadout')}</button></div></footer></section>`;
  $('#cosmetics-back').onclick = () => { state.cosmeticsHero = ''; state.cosmeticsSlotFilter = 'all'; renderCosmeticsView(data); };
  $('#cosmetics-skin-search').oninput = (event) => {
    state.cosmeticsSkinSearch = event.currentTarget.value;
    const selectionStart = event.currentTarget.selectionStart;
    const selectionEnd = event.currentTarget.selectionEnd;
    renderHeroCosmetics(data, hero);
    const input = $('#cosmetics-skin-search');
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(selectionStart, selectionEnd);
  };
  document.querySelectorAll('[data-cosmetic-filter]').forEach((button) => button.onclick = () => {
    state.cosmeticsSlotFilter = button.dataset.cosmeticFilter;
    renderHeroCosmetics(data, hero);
  });
  document.querySelectorAll('[data-cosmetic-item]').forEach((button) => button.onclick = () => {
    const slot = button.dataset.cosmeticSlot;
    const itemId = button.dataset.cosmeticItem;
    const styleId = button.dataset.cosmeticStyle || '';
    state.cosmeticsDraft ||= { ...(data.picks || {}) };
    const activeId = cosmeticPickItemId(state.cosmeticsDraft[slot]);
    const activeStyleId = cosmeticPickStyleId(state.cosmeticsDraft[slot]);
    if (activeId === itemId && activeStyleId === styleId) delete state.cosmeticsDraft[slot];
    else state.cosmeticsDraft[slot] = cosmeticSelectionForVariant(state.cosmeticsDraft[slot], itemId, styleId);
    renderHeroCosmetics(data, hero);
  });
  document.querySelectorAll('[data-cosmetic-effect-slot]').forEach((button) => button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const slot = button.dataset.cosmeticEffectSlot;
    const itemId = button.dataset.cosmeticEffectItem;
    const styleId = button.dataset.cosmeticEffectStyle || '';
    const active = state.cosmeticsDraft?.[slot];
    const currentEffect = cosmeticPickItemId(active) === itemId && cosmeticPickStyleId(active) === styleId
      ? cosmeticPickEffectId(active)
      : '';
    showCosmeticEffectPicker(slot, itemId, currentEffect, ({ effectId }) => {
      state.cosmeticsDraft ||= { ...(data.picks || {}) };
      state.cosmeticsDraft[slot] = cosmeticSelectionValue(itemId, styleId, effectId);
      renderHeroCosmetics(data, hero);
    }, styleId);
  });
  $('#cosmetics-reset').onclick = async () => applyCosmeticsLoadout({});
  $('#cosmetics-apply').onclick = async () => applyCosmeticsLoadout(state.cosmeticsDraft || {});
  bindCosmeticImageFallbacks('[data-skin-preview]');
}

function inlineHeroCosmeticsMarkup(data, hero) {
  const slots = (hero.slots || []).filter((slot) => String(slot.id || '').split(':').at(-1).toLowerCase() !== 'set');
  const draft = state.cosmeticsDraft || data.picks || {};
  const slotFilter = normalizedHeroSlot(state.heroSlot || 'all');
  const query = String(state.heroQuery || '').trim().toLowerCase();
  const options = slots.flatMap((slot) => slot.options.map((option) => ({ ...option, slotId: slot.id, slotName: cosmeticSlotText(slot) })))
    .filter((option) => (slotFilter === 'all' || normalizedHeroSlot(option.slotId.split(':').at(-1)) === slotFilter)
      && (!query || `${option.name} ${option.slotName}`.toLowerCase().includes(query)));
  const cards = options.map((option) => {
    const picked = cosmeticPickItemId(draft[option.slotId]) === option.id && cosmeticPickStyleId(draft[option.slotId]) === String(option.styleId ?? '');
    const selectedPick = draft[option.slotId];
    const effectId = picked ? cosmeticPickEffectId(selectedPick) : '';
    return `<article class="cosmetic-skin-card ${picked ? 'is-selected' : ''}"><button type="button" class="cosmetic-skin-select" data-inline-cosmetic-slot="${cosmeticsHtml(option.slotId)}" data-inline-cosmetic-item="${cosmeticsHtml(option.id)}" data-inline-cosmetic-style="${cosmeticsHtml(option.styleId ?? '')}" aria-pressed="${picked}">${cosmeticPreviewMarkup(option, hero.name)}<span class="skin-card-body"><span class="skin-card-title">${cosmeticsHtml(option.name)}</span><span class="skin-card-meta">${cosmeticsHtml(option.slotName)}${option.styleId !== undefined && option.styleId !== null ? ` · ${cosmeticStyleLabel(option)}` : ''}</span>${picked && effectId ? `<span class="skin-card-effect-name">${cosmeticsHtml(COSMETIC_EFFECT_OPTIONS.find((effect) => effect.id === effectId)?.[state.data?.settings?.appLanguage === 'ru' ? 'ru' : 'en'] || effectId)}</span>` : ''}</span></button>${picked ? `<button type="button" class="skin-card-effect-button ${effectId ? 'has-effect' : ''}" data-inline-effect-slot="${cosmeticsHtml(option.slotId)}" data-inline-effect-item="${cosmeticsHtml(option.id)}" data-inline-effect-style="${cosmeticsHtml(option.styleId ?? '')}" aria-label="${cosmeticsText('Настроить эффект для этого стиля', 'Set an effect for this style')}" title="${cosmeticsText('Настроить эффект для этого стиля', 'Set an effect for this style')}">+</button>` : ''}</article>`;
  }).join('');
  const selectedCount = slots.reduce((count, slot) => count + (draft[slot.id] ? 1 : 0), 0);
  const changed = JSON.stringify(draft) !== JSON.stringify(data.picks || {});
  return cards;
}

function inlineHeroCosmeticsActionsMarkup(data, hero) {
  if (!data || !hero) return '';
  const slots = (hero.slots || []).filter((slot) => String(slot.id || '').split(':').at(-1).toLowerCase() !== 'set');
  const draft = state.cosmeticsDraft || data.picks || {};
  const selectedCount = slots.reduce((count, slot) => count + (draft[slot.id] ? 1 : 0), 0);
  const changed = JSON.stringify(draft) !== JSON.stringify(data.picks || {});
  const canApply = changed || selectedCount > 0;
  return `<div class="hero-cosmetic-actions"><footer class="cosmetics-footer"><div><strong>${cosmeticsText('Выбрано слотов', 'Selected slots')}: ${selectedCount}</strong><small>${cosmeticsText('Предметы выбираются в общей сетке и применяются локально.', 'Choose items in the shared grid; changes are applied locally.')}</small></div><div><button type="button" class="action secondary" data-inline-cosmetic-reset ${selectedCount ? '' : 'disabled'}>${cosmeticsText('Сбросить', 'Reset')}</button><button type="button" class="action" data-inline-cosmetic-apply ${canApply ? '' : 'disabled'}>${cosmeticsText('Установить', 'Apply')}</button></div></footer></div>`;
}

function bindInlineHeroCosmetics(data, hero) {
  if (!data || !hero) return;
  document.querySelectorAll('[data-inline-cosmetic-item]').forEach((button) => button.onclick = () => {
    const slot = button.dataset.inlineCosmeticSlot;
    const itemId = button.dataset.inlineCosmeticItem;
    const styleId = button.dataset.inlineCosmeticStyle || '';
    state.cosmeticsDraft ||= { ...(data.picks || {}) };
    const activeId = cosmeticPickItemId(state.cosmeticsDraft[slot]);
    const activeStyleId = cosmeticPickStyleId(state.cosmeticsDraft[slot]);
    if (activeId === itemId && activeStyleId === styleId) delete state.cosmeticsDraft[slot];
    else state.cosmeticsDraft[slot] = cosmeticSelectionForVariant(state.cosmeticsDraft[slot], itemId, styleId);
    renderHeroDetail();
  });
  document.querySelectorAll('[data-inline-effect-slot]').forEach((button) => button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const slot = button.dataset.inlineEffectSlot;
    const itemId = button.dataset.inlineEffectItem;
    const styleId = button.dataset.inlineEffectStyle || '';
    const active = state.cosmeticsDraft?.[slot];
    const currentEffect = cosmeticPickItemId(active) === itemId && cosmeticPickStyleId(active) === styleId
      ? cosmeticPickEffectId(active)
      : '';
    showCosmeticEffectPicker(slot, itemId, currentEffect, ({ effectId }) => {
      state.cosmeticsDraft ||= { ...(data.picks || {}) };
      state.cosmeticsDraft[slot] = cosmeticSelectionValue(itemId, styleId, effectId);
      renderHeroDetail();
    }, styleId);
  });
  document.querySelector('[data-inline-cosmetic-reset]')?.addEventListener('click', () => applyCosmeticsLoadout({}));
  document.querySelector('[data-inline-cosmetic-apply]')?.addEventListener('click', () => applyCosmeticsLoadout(state.cosmeticsDraft || {}));
  bindCosmeticImageFallbacks('.hero-workspace [data-skin-preview]');
}

function renderCosmeticsView(data = state.data?.cosmetics) {
  if (!data) return;
  state.data.cosmetics = data;
  state.cosmeticsDraft ||= { ...(data.picks || {}) };
  if (!data.heroes?.length) {
    $('#content').innerHTML = `<section class="cosmetics-page"><header class="cosmetics-heading"><div><p class="eyebrow">${cosmeticsText('ЛОКАЛЬНЫЕ СКИНЫ', 'LOCAL HERO SKINS')}</p><h2>${cosmeticsText('Косметика героев', 'Hero cosmetics')}</h2></div></header><div class="empty"><strong>${cosmeticsHtml(data.error || cosmeticsText('В локальной схеме игры нет доступных предметов.', 'No wearable items were found in the local game schema.'))}</strong><p>${cosmeticsText('Проверьте путь к Dota 2 и целостность файлов игры.', 'Check the Dota 2 path and verify the game files.')}</p></div></section>`;
    return;
  }
  const hero = data.heroes.find((item) => item.key === state.cosmeticsHero);
  if (hero) renderHeroCosmetics(data, hero);
  else renderCosmeticsDirectory(data);
}

async function applyCosmeticsLoadout(picks) {
  const requestedView = state.view;
  const requestedHero = state.hero;
  if (Object.keys(picks).length && !state.data.cosmetics?.loaderInstalled) {
    const confirmation = await showAppConfirmDialog({
      title: cosmeticsText('Разрешить локальный загрузчик косметики?', 'Enable the local cosmetics loader?'),
      message: cosmeticsText('VANTA изменит gameinfo и dota.signatures, чтобы Dota могла читать сгенерированный items_game.txt. Оригиналы сохранятся для отката; закройте Dota 2 перед продолжением.', 'VANTA will modify gameinfo and dota.signatures so Dota can read the generated items_game.txt. Original files are backed up. Close Dota 2 before continuing.'),
      confirmLabel: cosmeticsText('Продолжить', 'Continue'),
      destructive: true,
    });
    if (!confirmation.confirmed) return;
  }
  try {
    const result = await call('cosmetics:apply', { picks });
    state.data.cosmetics = result;
    state.cosmeticsDraft = { ...(result.picks || {}) };
    if (state.view !== requestedView || state.hero !== requestedHero) return;
    if (state.view === 'mods' && state.hero) renderHeroDetail();
    else if (state.view === 'cosmetics') renderCosmeticsView(result);
    toast(result.discardedPicks?.length
      ? formatTranslation(t('cosmetics.stalePicksSkipped', 'Skipped {count} outdated skin choice(s).'), { count: result.discardedPicks.length })
      : cosmeticsText('Косметический образ применён.', 'Cosmetic loadout applied.'));
  } catch (error) {
    toast(error.message);
    try {
      const fresh = await call('cosmetics:list');
      state.data.cosmetics = fresh;
      state.cosmeticsDraft = { ...(fresh.picks || {}) };
      if (state.view !== requestedView || state.hero !== requestedHero) return;
      if (state.view === 'mods' && state.hero) renderHeroDetail();
      else if (state.view === 'cosmetics') renderCosmeticsView(fresh);
    } catch {}
  }
}

window.renderCosmeticsView = renderCosmeticsView;
window.loadCosmeticsView = async () => {
  if (state.view !== 'cosmetics') return;
  try {
    const data = await call('cosmetics:list');
    if (state.view !== 'cosmetics') return;
    state.data.cosmetics = data;
    state.cosmeticsDraft = { ...(data.picks || {}) };
    renderCosmeticsView(data);
  } catch (error) {
    if (state.view !== 'cosmetics') return;
    $('#content').innerHTML = `<div class="error"><strong>${cosmeticsText('Не удалось загрузить список косметики', 'Could not load the cosmetic list')}</strong>${cosmeticsHtml(error.message)}</div>`;
  }
};
