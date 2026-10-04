function specialPatchText(ru, en) { return state.data?.settings?.appLanguage === 'ru' ? ru : en; }
function isSpecialCatalogMod(mod) { return mod?.modType === 'special_patch' && ['tower', 'weather'].includes(mod.specialType); }
function specialInstalled(id) { return state.data?.installed?.[id] || null; }
function specialNeedsUpdate(record) { return Boolean(record?.requiresPatchUpdate || record?.specialPatchState === 'update_required' || record?.specialPatchState === 'error'); }

function hideSpecialPatchDownloadCounts() {
  document.querySelectorAll('.mod-card').forEach((card) => {
    const id = card.querySelector('[data-action="details"][data-id]')?.dataset.id;
    if (!isSpecialCatalogMod(state.data?.mods?.find((mod) => mod.id === id))) return;
    card.querySelectorAll('.download-count, .download-stat').forEach((node) => node.remove());
  });
  document.querySelectorAll('.featured-slide').forEach((slide) => {
    const name = slide.querySelector('h2')?.textContent.trim();
    const mod = state.data?.mods?.find((item) => item.name === name);
    if (isSpecialCatalogMod(mod)) slide.querySelectorAll('.download-stat, .download-count').forEach((node) => node.remove());
  });
  const detailsMod = state.data?.mods?.find((mod) => mod.id === state.specialPreviewModId);
  if (isSpecialCatalogMod(detailsMod)) {
    document.querySelectorAll('#details .details-download-pill, #details .download-count, #details .download-stat').forEach((node) => node.remove());
  }
}

function decorateSpecialDetails() {
  const content = document.querySelector('#details-content');
  const modId = state.specialPreviewModId;
  if (!content || !modId) return;
  const mod = state.data?.mods?.find((item) => item.id === modId);
  if (!isSpecialCatalogMod(mod)) return;
  const image = content.querySelector('.details-hero');
  if (image && !image.closest('.special-patch-preview')) {
    const frame = document.createElement('div');
    frame.className = 'special-patch-preview';
    image.replaceWith(frame);
    frame.append(image);
  }
}

async function updateSpecialPatch(id, button) {
  if (!button || button.disabled) return;
  button.disabled = true;
  button.dataset.updating = '1';
  button.textContent = specialPatchText('Обновление…', 'Updating…');
  try {
    await call('mod:update', { id });
    state.data = await call('library:get');
    state.specialPatchUpdateSuccessIds ||= new Set();
    state.specialPatchUpdateSuccessIds.add(id);
    setTimeout(() => { state.specialPatchUpdateSuccessIds.delete(id); decorateSpecialLibrary(); }, 3200);
    renderLibrary();
    toast(specialPatchText('Специальный патч обновлён.', 'Special patch updated.'));
  } catch (error) {
    button.disabled = false;
    button.dataset.updating = '';
    button.textContent = specialPatchText('Повторить', 'Retry');
    try { state.data = await call('library:get'); renderLibrary(); } catch {}
    toast(error.message || specialPatchText('Не удалось обновить патч.', 'Could not update the patch.'));
  }
}

function decorateSpecialLibrary() {
  document.querySelectorAll('.library-mod[data-library-id]').forEach((row) => {
    const id = row.dataset.libraryId;
    const record = specialInstalled(id);
    if (record?.modType !== 'special_patch') return;
    row.classList.add('special-patch-library-row');
    row.querySelector('.library-check')?.remove();
    row.querySelector('.library-drag-handle')?.remove();
    row.querySelector('[data-library-toggle]')?.remove();
    const info = row.querySelector('.library-mod-info');
    if (info && !info.querySelector('.special-patch-library-state')) {
      const detailLine = info.querySelectorAll('small')[1];
      if (detailLine) {
        const revision = String(record.currentVersion || record.version || '').slice(0, 7);
        detailLine.textContent = `${specialPatchText('Версия патча', 'Patch revision')}: ${revision || '—'}`;
      }
      const status = document.createElement('span');
      const needsUpdate = specialNeedsUpdate(record);
      status.className = `special-patch-library-state${needsUpdate ? ' needs-update' : ''}`;
      const statusText = record.specialPatchState === 'error'
        ? specialPatchText('Ошибка патча', 'Patch error')
        : needsUpdate
          ? specialPatchText('Требуется обновить патч', 'Requires patch update')
          : specialPatchText('Патч актуален', 'Patch up to date');
      status.innerHTML = `<span class="special-patch-badge">PATCH</span><span>${statusText}</span>`;
      info.append(status);
      if (record.patchError) {
        const error = document.createElement('small');
        error.className = 'special-patch-library-error';
        error.textContent = record.patchError;
        info.append(error);
      }
    }
    const actions = row.querySelector('.library-mod-actions');
    if (!actions) return;
    let update = actions.querySelector('[data-special-patch-update]');
    const justUpdated = state.specialPatchUpdateSuccessIds?.has(id);
    if (specialNeedsUpdate(record) || justUpdated) {
      if (!update) {
        update = document.createElement('button');
        update.type = 'button';
        update.className = 'action secondary special-patch-update-button';
        update.dataset.specialPatchUpdate = id;
        actions.insertBefore(update, actions.firstChild);
      }
      update.textContent = justUpdated ? specialPatchText('Обновлено', 'Updated') : specialPatchText('Обновить', 'Update');
      update.disabled = Boolean(justUpdated);
      update.dataset.updating = '';
      if (!update.dataset.bound) {
        update.dataset.bound = '1';
        update.addEventListener('click', () => updateSpecialPatch(id, update));
      }
    } else update?.remove();
  });
}

const specialPatchObserver = new MutationObserver(() => {
  hideSpecialPatchDownloadCounts();
  decorateSpecialDetails();
  decorateSpecialLibrary();
});
specialPatchObserver.observe(document.body, { childList: true, subtree: true });
document.addEventListener('click', (event) => {
  const detailsButton = event.target.closest('[data-action="details"][data-id]');
  if (detailsButton) state.specialPreviewModId = detailsButton.dataset.id;
  const bulkButton = event.target.closest('#library-select-all, #library-enable-selected, #library-disable-selected, #library-remove-selected, #library-pack');
  if (bulkButton) {
    for (const [id, item] of Object.entries(state.data?.installed || {})) {
      if (item?.modType === 'special_patch') state.librarySelection.delete(id);
    }
    if (bulkButton.id === 'library-select-all') queueMicrotask(() => {
      for (const [id, item] of Object.entries(state.data?.installed || {})) {
        if (item?.modType === 'special_patch') state.librarySelection.delete(id);
      }
      syncLibraryBulkUi?.();
    });
  }
}, true);
window.vanta.onDownloadProgress((event) => {
  if (event.operation !== 'special-patch') return;
  const button = document.querySelector(`[data-special-patch-update="${CSS.escape(String(event.id || ''))}"]`);
  if (!button || !button.dataset.updating) return;
  if (event.state === 'failed') {
    button.disabled = false;
    button.dataset.updating = '';
    button.textContent = specialPatchText('Повторить', 'Retry');
    return;
  }
  if (event.state === 'completed') {
    button.textContent = specialPatchText('Обновлено', 'Updated');
    return;
  }
  const percent = Math.max(0, Math.min(100, Number(event.percent) || 0));
  button.textContent = `${specialPatchText('Обновление…', 'Updating…')} ${percent}%`;
  button.title = event.phase || '';
});
