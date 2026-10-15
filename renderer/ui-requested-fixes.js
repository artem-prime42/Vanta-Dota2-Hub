const REQUESTED_SOCIALS = [
  ['Telegram', 'https://t.me/vanta_hubx'],
  ['Discord', 'https://discord.gg/hcaQVThnmG'],
];

function requestedLanguage() { return state.data?.settings?.appLanguage === 'ru' ? 'ru' : 'en'; }
function requestedText(ru, en) { return requestedLanguage() === 'ru' ? ru : en; }

function addRequestedSettings() {
  const panel = document.querySelector('.settings-panel');
  if (!panel || panel.querySelector('.requested-socials')) return;
  const socials = document.createElement('div');
  socials.className = 'setting-row requested-socials';
  socials.innerHTML = `<div><strong>${requestedText('Социальные сети', 'Social networks')}</strong><div class="setting-value">${requestedText('Новости и поддержка проекта', 'Project news and support')}</div></div><div class="social-actions">${REQUESTED_SOCIALS.map(([name, url]) => `<a class="social-button social-${name.toLowerCase()}" href="${url}" target="_blank" rel="noreferrer">${name}</a>`).join('')}</div>`;
  panel.appendChild(socials);
}

function addInstalledFileNames() {
  document.querySelectorAll('.library-mod:not(.external-file)').forEach((row) => {
    if (row.querySelector('.installed-file-name')) return;
    const id = row.querySelector('[data-library-select]')?.dataset.librarySelect;
    const record = id && (Array.isArray(state.data.installed)
      ? state.data.installed.find((item) => String(item.id || item.modId) === String(id))
      : state.data.installed?.[id] || Object.values(state.data.installed || {}).find((item) => String(item?.id || item?.modId) === String(id)));
    const fileName = record?.installedFiles?.[0];
    if (!fileName) return;
    const info = row.querySelector('.library-mod-info');
    if (!info) return;
    const label = document.createElement('small');
    label.className = 'installed-file-name';
    label.textContent = fileName;
    info.appendChild(label);
  });
}

function removeAuthorPlaceholder() {
  document.querySelectorAll('.author-profile-copy > p:not(.eyebrow)').forEach((node) => {
    if (node.textContent.trim() === 'Creator of Dota 2 cosmetic modifications.') node.remove();
  });
}

function arrangeModCardActions() {
  document.querySelectorAll('.mod-card').forEach((card) => {
    const footer = card.querySelector('.card-footer');
    const downloads = card.querySelector('.download-count');
    const action = footer?.querySelector('[data-action="install"], [data-action="update"]');
    if (!footer || !downloads || !action || footer.dataset.actionsArranged) return;
    footer.dataset.actionsArranged = '1';
    const badge = footer.querySelector('.badge') || document.createElement('span');
    action.remove();
    downloads.remove();
    footer.replaceChildren(action, badge, downloads);
  });
}

function orderHeroSlots() {
  const tabs = document.querySelector('.slot-tabs');
  if (!tabs || tabs.dataset.ordered) return;
  const buttons = [...tabs.querySelectorAll('[data-slot]')].filter((button) => button.dataset.slot !== 'set');
  tabs.querySelectorAll('[data-slot="set"]').forEach((button) => button.remove());
  const all = buttons.find((button) => button.dataset.slot === 'all');
  if (!all) return;
  tabs.dataset.ordered = '1';
  all.textContent = requestedText('Все слоты', 'All slots');
  [all, ...buttons.filter((button) => button !== all)].forEach((button) => tabs.appendChild(button));
}

const requestedUiObserver = new MutationObserver(() => {
  addRequestedSettings();
  addInstalledFileNames();
  removeAuthorPlaceholder();
  arrangeModCardActions();
  orderHeroSlots();
});
requestedUiObserver.observe(document.body, { childList: true, subtree: true });
addRequestedSettings();