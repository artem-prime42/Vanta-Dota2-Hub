document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-card-hero], [data-card-category]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const categorySections = {
    heroes: 'heroes', 'hero-items': 'heroes', herofx: 'heroes', 'hero-sounds': 'other',
    terrains: 'world', terrain: 'world', landscapes: 'world', landscape: 'world', maps: 'world', map: 'world', trees: 'world', river: 'world', creeps: 'world', towers: 'world', weather: 'world', roshan: 'world', ancient: 'world', tormentor: 'world', wards: 'world', couriers: 'world', 'creep-deny': 'world', 'kill-effects': 'world',
    backgrounds: 'interface', huds: 'interface', emblems: 'interface', 'versus-screens': 'interface', 'item-icons': 'interface', ranks: 'interface', pings: 'interface', cursors: 'interface', 'loading-screens': 'interface', announcers: 'interface', 'mega-kill': 'interface', 'kill-streak': 'interface', music: 'interface',
    shaders: 'effects', 'ti-bp-effects': 'effects', 'item-effects': 'effects', 'ranged-attack': 'effects', 'high-five': 'effects',
    pedestal: 'other', packs: 'other', optimization: 'other', other: 'other', sites: 'other', sounds: 'other', fonts: 'other'
  };
  if (button.dataset.cardHero) {
    state.view = 'mods';
    state.section = 'heroes';
    state.hero = button.dataset.cardHero;
    state.heroSlot = button.dataset.cardSlot || 'all';
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === 'mods'));
  } else {
    state.view = 'mods';
    state.section = categorySections[button.dataset.cardCategory] || 'other';
    state.category = button.dataset.cardCategory;
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === 'mods'));
  }
  loadCatalog();
}, true);

document.addEventListener('click', (event) => {
  if (event.target.closest('.nav-item, .top-tab')) document.querySelector('#details')?.close();
});

document.querySelector('#details')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
