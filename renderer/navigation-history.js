(() => {
  const routeFields = ['view', 'section', 'lastModsSection', 'category', 'hero', 'heroSlot', 'heroQuery', 'author', 'authorQuery', 'authorSort', 'query', 'recentExpanded'];
  const snapshot = () => Object.fromEntries(routeFields.map((field) => [field, state[field]]));
  const routeKey = (route) => JSON.stringify(route);
  const entries = [snapshot()];
  let position = 0;

  function syncNavigation() {
    document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
    document.querySelectorAll('.top-tab').forEach((button) => button.classList.toggle('active', state.view === 'mods' && button.dataset.top === state.section));
    const search = document.querySelector('#search');
    if (search) search.value = state.query || '';
    document.querySelector('#details')?.close();

    if (state.view === 'guides') renderGuides();
    else if (state.view === 'hero-grids') loadHeroGrids();
    else if (state.view === 'settings') render();
    else loadCatalog();
  }

  function moveHistory(direction) {
    const nextPosition = position + direction;
    if (nextPosition < 0 || nextPosition >= entries.length) return;
    position = nextPosition;
    Object.assign(state, entries[position]);
    syncNavigation();
  }

  window.addEventListener('click', (event) => {
    const target = event.target.closest('.nav-item[data-view], .top-tab, [data-card-author], [data-card-hero], [data-card-category], [data-author], [data-hero], #author-back, #hero-back, #settings-browse-archives, #download-archives-back');
    if (!target) return;

    const previous = snapshot();
    entries[position] = previous;
    setTimeout(() => {
      const next = snapshot();
      if (routeKey(previous) === routeKey(next)) return;
      entries.splice(position + 1);
      entries.push(next);
      position = entries.length - 1;
    }, 0);
  }, true);

  window.addEventListener('mousedown', (event) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    moveHistory(event.button === 3 ? -1 : 1);
  }, true);

  window.addEventListener('auxclick', (event) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
})();
