const CANONICAL_HEROES = 'abaddon alchemist ancient_apparition anti_mage arc_warden axe bane batrider beastmaster bloodseeker bounty_hunter brewmaster bristleback broodmother centaur chaos_knight chen clinkz clockwerk crystal_maiden dark_seer dark_willow dawnbreaker dazzle death_prophet disruptor doom dragon_knight drow_ranger earth_spirit earthshaker elder_titan ember_spirit enchantress enigma faceless_void grimstroke gyrocopter hoodwink huskar invoker io jakiro juggernaut keeper_of_the_light kez kunkka largo legion_commander leshrac lich lifestealer lina lion lone_druid luna lycan magnus marci mars medusa meepo mirana monkey_king morphling muerta naga_siren nature_prophet necrophos night_stalker nyx_assassin ogre_magi omniknight oracle outworld_devourer pangolier phantom_assassin phantom_lancer phoenix primal_beast puck pudge pugna queen_of_pain razor riki ringmaster rubick sand_king shadow_demon shadow_fiend shadow_shaman silencer skywrath_mage slardar slark snapfire sniper spectre spirit_breaker storm_spirit sven techies templar_assassin terrorblade tidehunter timbersaw tinker tiny treant_protector troll_warlord tusk underlord undying ursa vengeful_spirit venomancer viper visage void_spirit warlock weaver windranger winter_wyvern witch_doctor wraith_king zeus'.split(' ');
const HERO_PORTRAITS = { anti_mage: 'antimage', clockwerk: 'rattletrap', doom: 'doom_bringer', io: 'wisp', lifestealer: 'life_stealer', magnus: 'magnataur', nature_prophet: 'furion', necrophos: 'necrolyte', outworld_devourer: 'obsidian_destroyer', queen_of_pain: 'queenofpain', shadow_fiend: 'nevermore', timbersaw: 'shredder', treant_protector: 'treant', underlord: 'abyssal_underlord', vengeful_spirit: 'vengefulspirit', wraith_king: 'skeleton_king', windranger: 'windrunner', zeus: 'zuus' };
const HERO_ATTRIBUTE_MAP = {
  strength: new Set('alchemist axe bristleback centaur chaos_knight clockwerk dawnbreaker doom dragon_knight earth_spirit earthshaker elder_titan huskar kunkka largo legion_commander lifestealer lycan mars night_stalker ogre_magi omniknight phoenix primal_beast pudge slardar spirit_breaker sven tidehunter timbersaw tiny treant_protector tusk underlord undying wraith_king'.split(' ')),
  agility: new Set('anti_mage bloodseeker bounty_hunter broodmother clinkz drow_ranger ember_spirit faceless_void gyrocopter hoodwink juggernaut kez lone_druid luna medusa meepo mirana monkey_king morphling naga_siren phantom_assassin phantom_lancer razor riki shadow_fiend slark sniper spectre templar_assassin terrorblade troll_warlord ursa vengeful_spirit viper weaver'.split(' ')),
  intelligence: new Set('ancient_apparition chen crystal_maiden dark_seer dark_willow disruptor enchantress grimstroke invoker jakiro keeper_of_the_light leshrac lich lina lion muerta necrophos oracle outworld_devourer puck pugna queen_of_pain rubick shadow_demon shadow_shaman silencer skywrath_mage storm_spirit tinker warlock witch_doctor zeus'.split(' ')),
  universal: new Set('abaddon arc_warden bane beastmaster batrider brewmaster dazzle death_prophet enigma io magnus marci nature_prophet nyx_assassin pangolier sand_king snapfire techies venomancer visage void_spirit windranger'.split(' ')),
};

function heroDirectoryLabel(id) {
  return id === 'anti_mage' ? 'Anti-Mage' : id.split('_').map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(' ');
}
function normalizeHeroId(value) {
  let raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  raw = raw.replace(/^npc_dota_hero_/, '');
  const aliases = {
    'anti mage': 'anti_mage', 'anti-mage': 'anti_mage', antimage: 'anti_mage',
    'nature prophet': 'nature_prophet', "nature's prophet": 'nature_prophet', 'natures prophet': 'nature_prophet', furion: 'nature_prophet',
    'outworld devourer': 'outworld_devourer', 'outworld-devourer': 'outworld_devourer', 'outworld destroyer': 'outworld_devourer', 'outworld-destroyer': 'outworld_devourer', outworld_destroyer: 'outworld_devourer', 'obsidian destroyer': 'outworld_devourer', 'obsidian-destroyer': 'outworld_devourer', obsidian_destroyer: 'outworld_devourer',
    'queen of pain': 'queen_of_pain', 'queen-of-pain': 'queen_of_pain', queenofpain: 'queen_of_pain',
    'shadow fiend': 'shadow_fiend', 'shadow-fiend': 'shadow_fiend', nevermore: 'shadow_fiend',
    'treant protector': 'treant_protector', 'treant-protector': 'treant_protector',
    'vengeful spirit': 'vengeful_spirit', 'vengeful-spirit': 'vengeful_spirit', vengefulspirit: 'vengeful_spirit',
    windrunner: 'windranger', rattletrap: 'clockwerk', wisp: 'io', 'life stealer': 'lifestealer', 'life-stealer': 'lifestealer', magnataur: 'magnus', 'abyssal underlord': 'underlord', 'abyssal-underlord': 'underlord', shredder: 'timbersaw', zuus: 'zeus', necrolyte: 'necrophos', skeleton_king: 'wraith_king', doom_bringer: 'doom',
  };
  return aliases[raw] || raw.replace(/['’.-]+/g, ' ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
function heroDirectoryIds(mod) {
  const values = [mod.hero, mod.heroId, mod.heroName, mod.heroLabel, ...(Array.isArray(mod.heroes) ? mod.heroes : []), ...(Array.isArray(mod.heroIds) ? mod.heroIds : [])];
  return [...new Set(values.map((value) => normalizeHeroId(value && typeof value === 'object' ? value.hero || value.heroId || value.key || value.name : value)).filter(Boolean))];
}
function heroDirectoryPortrait(id) { return HERO_PORTRAITS[id] || id; }
function heroDirectoryEscape(value) { return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function heroDirectoryAttribute(id) { return Object.entries(HERO_ATTRIBUTE_MAP).find(([, heroes]) => heroes.has(id))?.[0] || 'universal'; }
function renderHeroCategoryGrid() {
  const all = t('catalog.filterAll', 'All');
  const selected = state.heroDirectoryAttributes || [];
  const attribute = (key, label) => {
    const active = key === 'all' ? selected.length === 0 : selected.includes(key);
    return `<button type="button" class="hero-category-button${active ? ' active' : ''}" data-hero-attribute="${key}" aria-pressed="${active}">${label}</button>`;
  };
  return `<section class="hero-directory-controls"><label class="hero-directory-search">⌕<input id="hero-category-search" type="search" data-i18n-placeholder="search.heroCategory.placeholder" placeholder="${t('search.heroCategory.placeholder', 'Search heroes')}" value="${heroDirectoryEscape(state.heroDirectoryQuery || '')}"></label><div class="hero-category-options" aria-label="${t('catalog.heroAttributes', 'Attributes')}">${attribute('all', all)}${attribute('strength', t('catalog.filterStrength', 'Strength'))}${attribute('agility', t('catalog.filterAgility', 'Agility'))}${attribute('intelligence', t('catalog.filterIntelligence', 'Intelligence'))}${attribute('universal', t('catalog.filterUniversal', 'Universal'))}</div></section>`;
}

function renderHeroDirectory() {
  if (!Array.isArray(state.heroDirectoryAttributes)) {
    state.heroDirectoryAttributes = state.heroDirectoryAttribute && state.heroDirectoryAttribute !== 'all' ? [state.heroDirectoryAttribute] : [];
  }
  delete state.heroDirectoryAttribute;
  const shouldLoadCosmetics = !state.data.cosmetics && !state.heroDirectoryCosmeticsLoading;
  if (shouldLoadCosmetics) state.heroDirectoryCosmeticsLoading = true;
  const entries = new Map(CANONICAL_HEROES.map((id) => [id, { id, label: heroDirectoryLabel(id), count: 0, downloads: 0, updatedAt: 0, mods: [] }]));
  const countedMods = new Map();
  for (const mod of state.data.mods || []) {
    const modId = String(mod.id || mod.modId || `${mod.name || mod.title || ''}:${mod.categoryId || mod.category || ''}`);
    for (const id of heroDirectoryIds(mod)) {
      const entry = entries.get(id) || { id, label: heroDirectoryLabel(id), count: 0, downloads: 0, updatedAt: 0, mods: [] };
      if (!countedMods.has(id)) countedMods.set(id, new Set());
      if (!countedMods.get(id).has(modId)) {
        countedMods.get(id).add(modId);
        entry.count += 1;
        entry.downloads += Number(mod.downloads || 0);
        entry.updatedAt = Math.max(entry.updatedAt, Date.parse(mod.updatedAt || mod.createdAt || '') || 0);
        entry.mods.push(mod);
      }
      entries.set(id, entry);
    }
  }
  for (const cosmeticHero of state.data.cosmetics?.heroes || []) {
    const id = normalizeHeroId(cosmeticHero?.key);
    if (!id) continue;
    const entry = entries.get(id) || { id, label: cosmeticHero.name || heroDirectoryLabel(id), count: 0, downloads: 0, updatedAt: 0, mods: [] };
    entry.label = cosmeticHero.name || entry.label;
    entries.set(id, entry);
  }
  const heroes = [...entries.values()];
  const cosmeticHeroes = new Map((state.data.cosmetics?.heroes || []).map((hero) => [normalizeHeroId(hero.key), hero]));
  const skinCount = (hero) => (cosmeticHeroes.get(hero.id)?.slots || []).reduce((count, slot) => count + (slot.options || []).length, 0);
  const russian = state.data?.settings?.appLanguage === 'ru';
  const russianCountWord = (count, one, few, many) => {
    const lastTwo = count % 100;
    const last = count % 10;
    return lastTwo >= 11 && lastTwo <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
  };
  const heroCount = (count) => `${count} ${russian ? russianCountWord(count, 'герой', 'героя', 'героев') : count === 1 ? 'hero' : 'heroes'}`;
  const modCount = (count) => `${count} ${russian ? russianCountWord(count, 'мод', 'мода', 'модов') : count === 1 ? 'mod' : 'mods'}`;
  const countLabel = (hero) => {
    const skins = skinCount(hero);
    if (!state.data.cosmetics && state.heroDirectoryCosmeticsLoading) return t('catalog.heroItemsLoading', 'Loading items…');
    if (skins) return `${formatTranslation(t('catalog.heroSkinsCount', '{count} skins'), { count: skins })}${hero.count ? ` · ${modCount(hero.count)}` : ''}`;
    return modCount(hero.count);
  };
  $('#content').innerHTML = `<div class="hero-directory-head"><div class="hero-directory-tools" data-category-grid="1">${renderHeroCategoryGrid()}</div><span class="result-count" data-hero-result-count>${heroCount(heroes.length)}</span></div><div class="hero-grid">${heroes.map((hero) => `<article class="hero-card" data-hero="${heroDirectoryEscape(hero.id)}" role="button" tabindex="0"><img src="${HERO_PORTRAIT_BASE}${heroDirectoryPortrait(hero.id)}.png" alt="${heroDirectoryEscape(hero.label)}"><span class="hero-card-shade"></span><span class="hero-card-copy"><strong>${heroDirectoryEscape(hero.label)}</strong><small>${countLabel(hero)}</small></span></article>`).join('')}</div>`;
  document.querySelector('.hero-directory-head')?.setAttribute('data-enhanced', '1');
  const apply = () => {
    const query = String(state.heroDirectoryQuery || '').trim().toLowerCase();
    const selectedAttributes = state.heroDirectoryAttributes;
    const visible = heroes.filter((hero) => (!query || hero.label.toLowerCase().includes(query) || hero.id.includes(query)) && (!selectedAttributes.length || selectedAttributes.includes(heroDirectoryAttribute(hero.id))));
    const visibleIds = new Set(visible.map((hero) => hero.id));
    const grid = document.querySelector('.hero-grid');
    const cards = new Map([...document.querySelectorAll('.hero-card')].map((card) => [card.dataset.hero, card]));
    if (grid) visible.forEach((hero) => { const card = cards.get(hero.id); if (card) grid.appendChild(card); });
    document.querySelectorAll('.hero-card').forEach((card) => { card.style.display = visibleIds.has(card.dataset.hero) ? '' : 'none'; });
    const result = document.querySelector('[data-hero-result-count]'); if (result) result.textContent = heroCount(visible.length);
  };
  document.querySelector('#hero-category-search')?.addEventListener('input', (event) => {
    state.heroDirectoryQuery = event.target.value;
    apply();
  });
  document.querySelectorAll('[data-hero-attribute]').forEach((button) => button.onclick = () => {
    const attribute = button.dataset.heroAttribute;
    if (attribute === 'all') state.heroDirectoryAttributes = [];
    else {
      const selected = new Set(state.heroDirectoryAttributes);
      selected.has(attribute) ? selected.delete(attribute) : selected.add(attribute);
      state.heroDirectoryAttributes = [...selected];
    }
    document.querySelectorAll('[data-hero-attribute]').forEach((item) => {
      const active = item.dataset.heroAttribute === 'all' ? state.heroDirectoryAttributes.length === 0 : state.heroDirectoryAttributes.includes(item.dataset.heroAttribute);
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    apply();
  });
  document.querySelectorAll('[data-hero]').forEach((node) => { node.onclick = () => { state.hero = node.dataset.hero; state.heroSlot = 'all'; state.heroQuery = ''; loadCatalog(); }; node.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); node.click(); } }; });
  apply();
  window.restoreHeroDirectoryScroll?.();
  if (shouldLoadCosmetics) {
    call('cosmetics:list').then((data) => { state.data.cosmetics = data; }).catch((error) => { state.data.cosmetics = { heroes: [], error: error.message }; }).finally(() => {
      state.heroDirectoryCosmeticsLoading = false;
      if (state.view === 'mods' && state.section === 'heroes') {
        if (state.hero) renderHeroDetail();
        else renderHeroDirectory();
      }
    });
  }
}

window.renderHeroDirectory = renderHeroDirectory;
