function archiveText(ru, en) { return state.data?.settings?.appLanguage === 'ru' ? ru : en; }
function archiveEscape(value) { return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function archiveSize(bytes) { const size = Number(bytes || 0); if (size < 1024) return `${size} B`; if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`; if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`; return `${(size / 1024 ** 3).toFixed(2)} GB`; }
function archiveDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(state.data?.settings?.appLanguage === 'ru' ? 'ru-RU' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
function syncArchiveSelectionUi(changedCard = null) {
  const selected = state.archiveSelection;
  if (changedCard) changedCard.classList.toggle('selected', selected.has(changedCard.dataset.archiveCard));
  const panel = document.querySelector('.download-archive-bulk');
  const count = panel?.querySelector('.floating-selection-count');
  if (!panel || !count) return;
  panel.classList.toggle('has-selection', selected.size > 0);
  count.textContent = formatTranslation(archiveText('Выбрано: {count}', 'Selected: {count}'), { count: selected.size });
  let hasInstallableSelection = false;
  for (const key of selected) {
    if (state.archiveByKey?.get(key)?.available) { hasInstallableSelection = true; break; }
  }
  const install = panel.querySelector('#archive-bulk-install');
  const remove = panel.querySelector('#archive-bulk-delete');
  if (install) install.disabled = !hasInstallableSelection;
  if (remove) remove.disabled = selected.size === 0;
}

function renderDownloadArchives() {
  document.querySelector('.download-archive-bulk[data-archive-portal]')?.remove();
  const archives = state.data.archives || [];
  state.archiveByKey = new Map(archives.map((archive) => [archive.key, archive]));
  state.archiveCardNodes = new Map();
  const visibleCount = Math.min(state.archiveVisibleCount || 24, archives.length);
  const selected = state.archiveSelection;
  const card = (archive) => {
    const preview = archive.previewUrl ? `<img src="${archiveEscape(archive.previewUrl)}" loading="lazy" alt="">` : '<div class="download-archive-preview-empty">◈</div>';
    const subtitle = [archive.categoryId ? (CATEGORY_LABELS[archive.categoryId] || archive.categoryId) : '', archive.heroLabel, archive.slot, archive.author].filter(Boolean).map(archiveEscape).join(' · ');
    const installed = archive.installed || Boolean(state.data.installed?.[archive.id]);
    const date = archiveDate(archive.downloadedAt);
    return `<article class="download-archive-card ${selected.has(archive.key) ? 'selected' : ''}" data-archive-card="${archiveEscape(archive.key)}"><label class="download-archive-select" title="${archiveText('Выбрать архив', 'Select archive')}"><input type="checkbox" data-archive-select="${archiveEscape(archive.key)}" ${selected.has(archive.key) ? 'checked' : ''}><span></span></label>${preview}<div class="download-archive-info"><strong title="${archiveEscape(archive.name)}">${archiveEscape(archive.name)}</strong>${subtitle ? `<small>${subtitle}</small>` : ''}<small>${archiveSize(archive.size)}${date ? ` · ${date}` : ''}</small>${installed ? `<span class="download-archive-installed">✓ ${archiveText('Установлен', 'Installed')}</span>` : ''}${!archive.available ? `<span class="download-archive-missing">${archiveText('Мод отсутствует в каталоге', 'Mod is no longer in catalog')}</span>` : ''}</div><div class="download-archive-actions"><button class="action" data-archive-install="${archiveEscape(archive.id)}" ${archive.available ? '' : 'disabled'}>${installed ? archiveText('Установить заново', 'Reinstall') : archiveText('Установить', 'Install')}</button><button class="action secondary" data-archive-delete="${archiveEscape(archive.key)}">${archiveText('Удалить', 'Delete')}</button></div></article>`;
  };
  let hasInstallableSelection = false;
  for (const key of selected) { if (state.archiveByKey.get(key)?.available) { hasInstallableSelection = true; break; } }
  const moreCount = archives.length - visibleCount;
  const archiveList = archives.length ? `<div class="download-archive-grid" id="download-archive-grid">${archives.slice(0, visibleCount).map(card).join('')}</div>${moreCount ? `<button class="action secondary download-archives-more" id="download-archives-more">${formatTranslation(archiveText('Показать ещё ({count})', 'Show more ({count})'), { count: moreCount })}</button>` : ''}` : `<div class="empty"><strong>${archiveText('Скачанных архивов пока нет', 'No downloaded archives')}</strong>${archiveText('После загрузки моды появятся здесь.', 'Downloaded mods will appear here.')}</div>`;
  $('#content').innerHTML = `<div class="download-archives-page"><div class="download-archives-heading"><div><p class="eyebrow">${archiveText('ЛОКАЛЬНОЕ ХРАНИЛИЩЕ', 'LOCAL STORAGE')}</p><h2>${archiveText('Скачанные архивы', 'Downloaded archives')}</h2><p>${archiveText('Архивы можно установить повторно, не скачивая их заново.', 'Reinstall cached mods without downloading them again.')}</p></div><button class="action secondary" id="download-archives-back">← ${archiveText('Настройки', 'Settings')}</button></div>${archiveList}<aside class="download-archive-bulk ${selected.size ? 'has-selection' : ''}" aria-live="polite"><button class="floating-selection-cancel" id="archive-selection-clear" aria-label="${archiveText('Снять выделение', 'Clear selection')}" title="${archiveText('Снять выделение', 'Clear selection')}">×</button><span class="floating-selection-count">${formatTranslation(archiveText('Выбрано: {count}', 'Selected: {count}'), { count: selected.size })}</span><button class="action secondary" id="archive-bulk-install" ${hasInstallableSelection ? '' : 'disabled'}>${archiveText('Установить', 'Install')}</button><button class="action danger" id="archive-bulk-delete" ${selected.size ? '' : 'disabled'}>${archiveText('Удалить', 'Delete')}</button></aside></div>`;
  const bulkPanel = document.querySelector('.download-archive-bulk');
  if (bulkPanel) { bulkPanel.dataset.archivePortal = '1'; document.body.appendChild(bulkPanel); }

  const refresh = async () => { state.data = { ...state.data, ...await call('downloads:list') }; renderDownloadArchives(); };
  const install = async (ids, button = null) => {
    if (button) button.disabled = true;
    try {
      const result = await call('downloads:install', { ids });
      state.data = { ...state.data, ...result };
      const failed = (result.results || []).filter((item) => !item.ok);
      await refresh();
      toast(failed.length ? `${archiveText('Не удалось установить', 'Could not install')}: ${failed.map((item) => `${item.id} — ${item.error}`).join('; ')}` : archiveText('Моды установлены.', 'Mods installed.'));
    } catch (error) { toast(error.message); }
    finally { if (button?.isConnected) button.disabled = false; }
  };
  const remove = async (keys) => {
    if (!keys.length) return;
    const confirmation = await showAppConfirmDialog({ title: archiveText('Удалить архивы?', 'Delete archives?'), message: formatTranslation(archiveText('Удалить выбранные архивы ({count})?', 'Delete selected archives ({count})?'), { count: keys.length }), confirmLabel: archiveText('Удалить', 'Delete'), destructive: true });
    if (!confirmation.confirmed) return;
    try {
      state.data = { ...state.data, ...await call('downloads:delete-many', { keys }) };
      keys.forEach((key) => selected.delete(key));
      renderDownloadArchives();
      toast(archiveText('Архивы удалены.', 'Archives deleted.'));
    } catch (error) { toast(error.message); }
  };

  document.querySelector('#download-archives-back').onclick = () => { state.view = 'settings'; render(); };
  const bindCards = (cards) => cards.forEach((cardNode) => {
    if (cardNode.dataset.archiveBound) return;
    cardNode.dataset.archiveBound = '1';
    state.archiveCardNodes.set(cardNode.dataset.archiveCard, cardNode);
    const input = cardNode.querySelector('[data-archive-select]');
    input.onchange = () => { input.checked ? selected.add(input.dataset.archiveSelect) : selected.delete(input.dataset.archiveSelect); syncArchiveSelectionUi(cardNode); };
    cardNode.querySelector('[data-archive-install]')?.addEventListener('click', (event) => install([event.currentTarget.dataset.archiveInstall], event.currentTarget));
    cardNode.querySelector('[data-archive-delete]')?.addEventListener('click', (event) => remove([event.currentTarget.dataset.archiveDelete]));
  });
  bindCards(document.querySelectorAll('.download-archive-card'));
  document.querySelector('#download-archives-more')?.addEventListener('click', (event) => {
    const grid = document.querySelector('#download-archive-grid');
    const start = Math.min(state.archiveVisibleCount || 24, archives.length);
    const end = Math.min(start + 24, archives.length);
    if (!grid || end <= start) return;
    grid.insertAdjacentHTML('beforeend', archives.slice(start, end).map(card).join(''));
    state.archiveVisibleCount = end;
    bindCards(grid.querySelectorAll('.download-archive-card:not([data-archive-bound])'));
    const remaining = archives.length - end;
    if (remaining) event.currentTarget.textContent = formatTranslation(archiveText('Показать ещё ({count})', 'Show more ({count})'), { count: remaining });
    else event.currentTarget.remove();
  });
  document.querySelector('#archive-selection-clear').onclick = () => { selected.forEach((key) => state.archiveCardNodes.get(key)?.classList.remove('selected')); selected.clear(); syncArchiveSelectionUi(); };
  document.querySelector('#archive-bulk-install').onclick = () => { const ids = [...new Set(archives.filter((archive) => selected.has(archive.key) && archive.available).map((archive) => archive.id))]; if (ids.length) install(ids); else toast(archiveText('Выбранные моды больше недоступны в каталоге.', 'Selected mods are no longer available in the catalog.')); };
  document.querySelector('#archive-bulk-delete').onclick = () => remove([...selected]);
}

const downloadArchivePortalObserver = new MutationObserver(() => {
  if (!document.querySelector('#content .download-archives-page')) document.querySelector('.download-archive-bulk[data-archive-portal]')?.remove();
});
downloadArchivePortalObserver.observe(document.querySelector('#content'), { childList: true, subtree: true });
