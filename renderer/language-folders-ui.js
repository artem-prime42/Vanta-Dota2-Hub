async function loadRealLanguageFolders() {
  const select = document.querySelector('#language-folder');
  if (!select) return;
  const gamePath = state.data?.gamePath || '';
  if (select.dataset.loadedPath === gamePath) return;
  select.dataset.loadedPath = gamePath;
  try {
    const folders = await call('game:language-folders');
    const current = String(state.data?.settings?.langSuffix || select.value || 'russian').replace(/^dota_/i, '');
    const options = [...new Set([...folders, current])];
    select.innerHTML = options.map((folder) => `<option value="${folder}">${folder}</option>`).join('');
    select.value = current;
  } catch {
    select.dataset.loadedPath = '';
  }
}
const languageFolderObserver = new MutationObserver(loadRealLanguageFolders);
languageFolderObserver.observe(document.body, { childList: true, subtree: true });
loadRealLanguageFolders();
