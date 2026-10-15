const path = require('node:path');
const fsSync = require('node:fs');
const zlib = require('node:zlib');
const { VpkReader } = require('vpk-tools');
const { heroDisplayName, normalizeHeroKey } = require('../core/models');

const SCHEMA_ENTRY = 'scripts/items/items_game.txt';
const HERO_PREFIX = 'npc_dota_hero_';
const SLOT_ALIASES = { shoulder: 'shoulders', arm: 'arms', offhand_weapon: 'offhand', off_hand_weapon: 'offhand', off_hand: 'offhand' };
const COSMETIC_EFFECTS = [
  { id: 'fire', name: 'Огонь', nameEn: 'Fire', modifier: 'particles/econ/courier/courier_trail_lava/courier_trail_lava.vpcf' },
  { id: 'lightnings', name: 'Молнии', nameEn: 'Lightning', modifier: 'particles/econ/courier/courier_platinum_roshan/platinum_roshan_ambient.vpcf' },
  { id: 'frostbloom', name: 'Иней', nameEn: 'Frostbloom', modifier: 'particles/econ/seasonal/seasonal_ambient_silver.vpcf' },
  { id: 'snow', name: 'Снег', nameEn: 'Snow', modifier: 'particles/econ/seasonal/seasonal_ambient_snow.vpcf' },
  { id: 'bubbles', name: 'Пузыри', nameEn: 'Bubbles', modifier: 'particles/econ/seasonal/seasonal_ambient_bubbles.vpcf' },
  { id: 'sand-storm', name: 'Песчаная буря', nameEn: 'Sandstorm', modifier: 'particles/econ/courier/courier_roshan_desert_sands/baby_roshan_desert_sands_ambient.vpcf' },
  { id: 'ghost', name: 'Призрак', nameEn: 'Ghost', modifier: 'particles/econ/courier/courier_f2p/courier_f2p_10th_anniversary_ambient.vpcf' },
];
const COSMETIC_EFFECT_BY_ID = new Map(COSMETIC_EFFECTS.map((effect) => [effect.id, effect]));
const MEDIA_INDEX_FILE = path.join(__dirname, '..', 'data', 'cosmetic-media-index.json.gz');
const MEDIA_RAW_BASE_URL = 'https://raw.githubusercontent.com/artem-prime42/dota2-media';
const STEAM_ITEM_ICON_BASE_URL = 'https://cdn.cloudflare.steamstatic.com/apps/570/icons/';
const MEDIA_HERO_ALIASES = {
  anti_mage: ['Anti-Mage', 'Anti Mage'],
  clockwerk: ['Clockwerk', 'Rattletrap'],
  doom: ['Doom', 'Doom Bringer'],
  io: ['Io', 'Wisp'],
  lifestealer: ['Lifestealer', 'Life Stealer'],
  magnus: ['Magnus', 'Magnataur'],
  nature_prophet: ["Nature's Prophet", 'Nature Prophet'],
  necrophos: ['Necrophos', 'Necrolyte'],
  outworld_devourer: ['Outworld Destroyer', 'Outworld Devourer'],
  queen_of_pain: ['Queen of Pain'],
  shadow_fiend: ['Shadow Fiend'],
  timbersaw: ['Timbersaw', 'Shredder'],
  treant_protector: ['Treant Protector', 'Treant'],
  windranger: ['Windranger', 'Wind Runner'],
  wraith_king: ['Wraith King', 'Skeleton King'],
};
let mediaIndex = null;

function normalizedMediaKey(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function getMediaIndex() {
  if (mediaIndex) return mediaIndex;
  try {
    const archive = fsSync.readFileSync(MEDIA_INDEX_FILE);
    const payload = JSON.parse(zlib.gunzipSync(archive).toString('utf8'));
    const names = new Map();
    for (const file of payload.paths || []) {
      const basename = path.posix.basename(file, path.posix.extname(file));
      const key = normalizedMediaKey(basename);
      if (!names.has(key)) names.set(key, file);
    }
    mediaIndex = { commit: payload.commit, names };
  } catch {
    mediaIndex = { commit: 'main', names: new Map() };
  }
  return mediaIndex;
}

function cosmeticPreviewUrl(heroKey, heroName, itemName) {
  const index = getMediaIndex();
  const heroes = [...new Set([...(MEDIA_HERO_ALIASES[heroKey] || []), heroName])].filter(Boolean);
  const item = String(itemName || '').trim();
  const candidates = [];
  for (const hero of heroes) {
    candidates.push(normalizedMediaKey(`${hero} ${item}`));
    candidates.push(normalizedMediaKey(`${hero} ${item.replace(/\s+-\s+/g, ' ')}`));
  }
  candidates.push(normalizedMediaKey(item));
  const file = candidates.map((key) => index.names.get(key)).find(Boolean);
  return file ? `${MEDIA_RAW_BASE_URL}/${index.commit}/${file.split('/').map(encodeURIComponent).join('/')}` : null;
}

function cosmeticInventoryIconUrl(icon) {
  const relative = String(icon || '').trim().replace(/^\/+/, '');
  if (!relative || relative.includes('..') || !/^[a-z0-9_/-]+$/i.test(relative)) return null;
  return `${STEAM_ITEM_ICON_BASE_URL}${relative}.png`;
}

function skipTrivia(text, start, limit = text.length) {
  let index = start;
  while (index < limit) {
    if (/\s/.test(text[index])) { index += 1; continue; }
    if (text[index] === '/' && text[index + 1] === '/') {
      index += 2;
      while (index < limit && text[index] !== '\n') index += 1;
      continue;
    }
    break;
  }
  return index;
}

function readToken(text, start, limit = text.length) {
  let index = skipTrivia(text, start, limit);
  const tokenStart = index;
  if (index >= limit) return null;
  if (text[index] === '"') {
    index += 1;
    let value = '';
    while (index < limit) {
      const character = text[index++];
      if (character === '"') break;
      if (character === '\\' && index < limit) {
        const escaped = text[index++];
        value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
      } else value += character;
    }
    return { value, start: tokenStart, end: index };
  }
  while (index < limit && !/[\s{}]/.test(text[index])) index += 1;
  return index === tokenStart ? null : { value: text.slice(tokenStart, index), start: tokenStart, end: index };
}

function matchingBrace(text, openIndex) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '/' && text[index + 1] === '/') {
      index += 2;
      while (index < text.length && text[index] !== '\n') index += 1;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return index;
  }
  return -1;
}

function parseChildren(text, start, end) {
  const entries = [];
  let index = start;
  while ((index = skipTrivia(text, index, end)) < end) {
    const key = readToken(text, index, end);
    if (!key) break;
    index = skipTrivia(text, key.end, end);
    if (text[index] === '{') {
      const close = matchingBrace(text, index);
      if (close < 0 || close >= end) break;
      entries.push({ key: key.value, keyStart: key.start, keyEnd: key.end, start: key.start, end: close + 1, isBlock: true, bodyStart: index + 1, bodyEnd: close });
      index = close + 1;
      continue;
    }
    const value = readToken(text, index, end);
    if (!value) break;
    entries.push({ key: key.value, keyStart: key.start, keyEnd: key.end, start: key.start, end: value.end, isBlock: false, value: value.value, valueStart: value.start, valueEnd: value.end });
    index = value.end;
  }
  return entries;
}

function keyBlock(text, key, start = 0, end = text.length) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`(?:^|[\\s}])"?${escaped}"?\\s*\\{`, 'g');
  expression.lastIndex = start;
  const match = expression.exec(text);
  if (!match || match.index >= end) return null;
  const open = text.indexOf('{', match.index);
  const close = matchingBrace(text, open);
  return close >= 0 && close < end ? { open, close } : null;
}

function field(children, name) {
  return children.find((entry) => !entry.isBlock && entry.key.toLowerCase() === name.toLowerCase())?.value || '';
}

function block(children, name) {
  return children.find((entry) => entry.isBlock && entry.key.toLowerCase() === name.toLowerCase()) || null;
}

function prefabDefinitions(text) {
  const root = keyBlock(text, 'items_game');
  if (!root) return new Map();
  const rootChildren = parseChildren(text, root.open + 1, root.close);
  const prefabs = block(rootChildren, 'prefabs');
  if (!prefabs) return new Map();
  return new Map(parseChildren(text, prefabs.bodyStart, prefabs.bodyEnd)
    .filter((entry) => entry.isBlock)
    .map((entry) => [entry.key.toLowerCase(), parseChildren(text, entry.bodyStart, entry.bodyEnd)]));
}

function inheritedField(children, name, prefabs, visited = new Set()) {
  const direct = field(children, name);
  if (direct) return direct;
  for (const prefabName of field(children, 'prefab').toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    if (visited.has(prefabName)) continue;
    const prefab = prefabs.get(prefabName);
    if (!prefab) continue;
    const value = inheritedField(prefab, name, prefabs, new Set([...visited, prefabName]));
    if (value) return value;
  }
  return '';
}

function inheritedBlock(children, name, prefabs, visited = new Set()) {
  const direct = block(children, name);
  if (direct) return direct;
  for (const prefabName of field(children, 'prefab').toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    if (visited.has(prefabName)) continue;
    const prefab = prefabs.get(prefabName);
    if (!prefab) continue;
    const inherited = inheritedBlock(prefab, name, prefabs, new Set([...visited, prefabName]));
    if (inherited) return inherited;
  }
  return null;
}

function heroIds(text, node, prefabs = new Map()) {
  const usedBy = inheritedBlock(node.children, 'used_by_heroes', prefabs);
  if (!usedBy) return [];
  return [...new Set(parseChildren(text, usedBy.bodyStart, usedBy.bodyEnd)
    .filter((entry) => !entry.isBlock && entry.value !== '0' && entry.key.startsWith(HERO_PREFIX))
    .map((entry) => normalizeHeroKey(entry.key.slice(HERO_PREFIX.length)))
    .filter(Boolean))];
}

function normalizedSlot(value) {
  const slot = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return SLOT_ALIASES[slot] || slot;
}

function cosmeticRarity(children, prefabs) {
  const candidates = [
    field(children, 'item_rarity'),
    field(children, 'rarity'),
    field(children, 'quality'),
    field(children, 'item_quality'),
    inheritedField(children, 'item_rarity', prefabs),
    inheritedField(children, 'rarity', prefabs),
    inheritedField(children, 'quality', prefabs),
    inheritedField(children, 'item_quality', prefabs),
  ];
  const normalized = candidates.map((value) => String(value || '').trim().toLowerCase());
  if (normalized.includes('infused')) return 'infused';
  return normalized.find((value) => value && value !== 'unique') || '';
}

function styleNodes(text, styleBlock) {
  if (!styleBlock) return [];
  return parseChildren(text, styleBlock.bodyStart, styleBlock.bodyEnd)
    .filter((entry) => entry.isBlock && /^\d+$/.test(entry.key))
    .map((entry) => ({ ...entry, id: entry.key, name: field(parseChildren(text, entry.bodyStart, entry.bodyEnd), 'name') }));
}

function cosmeticStyles(text, children, prefabs) {
  const visuals = inheritedBlock(children, 'visuals', prefabs);
  const visualChildren = visuals ? parseChildren(text, visuals.bodyStart, visuals.bodyEnd) : [];
  const itemStyles = styleNodes(text, inheritedBlock(children, 'styles', prefabs));
  const visualStyles = styleNodes(text, block(visualChildren, 'styles'));
  const styles = new Map(itemStyles.map((style) => [style.id, style]));
  for (const style of visualStyles) {
    const previous = styles.get(style.id);
    styles.set(style.id, { ...previous, ...style, name: style.name || previous?.name });
  }
  return [...styles.values()]
    .filter((style) => (styleOverrideEntries(text, children, prefabs, style.id) || []).length > 0)
    .map((style) => ({ ...style, name: style.name || (style.id === '0' ? '' : `Style ${style.id}`) }))
    .sort((left, right) => Number(left.id) - Number(right.id));
}

function localizationTokens(text) {
  const tokensBlock = keyBlock(text, 'Tokens');
  if (!tokensBlock) return new Map();
  const tokens = new Map();
  for (const entry of parseChildren(text, tokensBlock.open + 1, tokensBlock.close)) {
    if (!entry.isBlock) tokens.set(entry.key.replace(/^#/, '').toLowerCase(), entry.value);
  }
  return tokens;
}

function localizedCosmeticName(value, tokens, fallback) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (!raw.startsWith('#')) return raw;
  const localized = tokens.get(raw.slice(1).toLowerCase());
  return localized?.trim() || fallback;
}

function fallbackCosmeticName(value, itemId) {
  const readable = String(value || '').replace(/^#/, '').replace(/^dota(?:_item)?_/i, '')
    .replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return readable || `Item ${itemId}`;
}

function isStylelessCosmetic(name, rawName = '') {
  const value = `${name} ${rawName}`.toLowerCase();
  const normalized = value.replace(/[^a-z0-9]+/g, ' ').trim();
  const compact = value.replace(/[^a-z0-9]+/g, '');
  return normalized.includes('almond the frondillo') || compact.includes('almondthefrondillo');
}

function cosmeticStyleCardName(itemName, style) {
  const styleName = String(style.name || '').trim();
  if (!styleName) return style.id === '0' ? itemName : `${itemName} · Style ${style.id}`;
  const itemKey = String(itemName).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const styleKey = styleName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (styleKey === itemKey) return itemName;
  if (styleKey.startsWith(itemKey)) {
    const suffix = styleName.slice(String(itemName).length).replace(/^[\s·:–—-]+/, '').trim();
    if (!suffix || (style.id === '0' && /^style\s*0$/i.test(suffix))) return itemName;
    return `${itemName} · ${suffix}`;
  }
  if (style.id === '0' && /^style\s*0$/i.test(styleName)) return itemName;
  return `${itemName} · ${styleName}`;
}

function styleOverrideEntries(text, children, prefabs, styleId) {
  if (styleId === null || styleId === undefined || String(styleId) === '') return [];
  const visuals = inheritedBlock(children, 'visuals', prefabs);
  const visualChildren = visuals ? parseChildren(text, visuals.bodyStart, visuals.bodyEnd) : [];
  const candidates = [block(visualChildren, 'styles'), inheritedBlock(children, 'styles', prefabs)].filter(Boolean);
  let foundStyle = false;
  const combined = [];
  for (const styleBlock of candidates) {
    const selected = styleNodes(text, styleBlock).find((style) => style.id === String(styleId));
    if (!selected) continue;
    foundStyle = true;
    const overrides = parseChildren(text, selected.bodyStart, selected.bodyEnd)
      .filter((entry) => entry.key.toLowerCase() !== 'name' && entry.key.toLowerCase() !== 'styles')
      .map((entry) => ({ key: entry.key, isBlock: entry.isBlock, raw: text.slice(entry.start, entry.end) }));
    for (const incoming of overrides) {
      const index = combined.findIndex((entry) => entry.key.toLowerCase() === incoming.key.toLowerCase());
      if (index < 0) {
        combined.push(incoming);
      } else if (combined[index].isBlock && incoming.isBlock) {
        combined[index] = {
          ...incoming,
          raw: mergeOverrideEntries(combined[index].raw, overrideEntryChildren(incoming)),
        };
      } else {
        combined[index] = incoming;
      }
    }
  }
  return foundStyle ? combined : null;
}

function visualEffectNames(text, node, prefabs = new Map()) {
  const visuals = inheritedBlock(node.children, 'visuals', prefabs);
  if (!visuals) return [];
  const section = text.slice(visuals.bodyStart, visuals.bodyEnd);
  const names = [...section.matchAll(/"(?:particle|modifier)"\s+"([^"]+\.vpcf)"/gi)].map((match) => path.basename(match[1], '.vpcf'));
  return [...new Set(names)];
}

function styleEffectNames(text, children, prefabs, styleId) {
  const entries = styleOverrideEntries(text, children, prefabs, styleId);
  if (!entries?.length) return [];
  const source = entries.map((entry) => entry.raw).join('\n');
  const names = [...source.matchAll(/"(?:particle|modifier)"\s+"([^"]+\.vpcf)"/gi)]
    .map((match) => path.basename(match[1], '.vpcf'));
  return [...new Set(names)];
}

function itemNodes(text) {
  const items = keyBlock(text, 'items');
  if (!items) throw new Error('The local items_game.txt has no items block');
  return parseChildren(text, items.open + 1, items.close)
    .filter((entry) => entry.isBlock && /^\d+$/.test(entry.key))
    .map((entry) => ({
      ...entry,
      id: entry.key,
      children: parseChildren(text, entry.bodyStart, entry.bodyEnd),
    }));
}

function describeItems(text, { localization = '' } = {}) {
  const tokens = localization instanceof Map ? localization : localizationTokens(String(localization || ''));
  const prefabs = prefabDefinitions(text);
  const items = itemNodes(text).map((item) => {
    const rawName = field(item.children, 'name');
    const quality = cosmeticRarity(item.children, prefabs);
    const parsedStyles = isStylelessCosmetic(
      localizedCosmeticName(rawName, tokens, fallbackCosmeticName(rawName, item.id)),
      rawName,
    ) ? [] : cosmeticStyles(text, item.children, prefabs).map((style) => ({
      ...style,
      name: localizedCosmeticName(style.name, tokens, style.id === '0' ? '' : `Style ${style.id}`),
    }));
    // Arcana alternate styles are not reliable in the generated client override.
    // Keep the first/default style selectable and omit only the second listed style.
    const styles = quality === 'arcana' ? parsedStyles.filter((_, index) => index !== 1) : parsedStyles;
    return {
      ...item,
      rawName,
      name: localizedCosmeticName(rawName, tokens, fallbackCosmeticName(rawName, item.id)),
      prefab: field(item.children, 'prefab').toLowerCase(),
      slot: normalizedSlot(inheritedField(item.children, 'item_slot', prefabs)),
      quality,
      model: inheritedField(item.children, 'model_player', prefabs),
      icon: inheritedField(item.children, 'image_inventory', prefabs),
      heroes: heroIds(text, item, prefabs),
      hasVisuals: Boolean(inheritedBlock(item.children, 'visuals', prefabs)),
      effects: visualEffectNames(text, item, prefabs),
      styles,
    };
  });
  const defaults = items.filter((item) => item.prefab === 'default_item');
  const wearables = items.filter((item) => item.prefab === 'wearable' && item.slot && item.heroes.length
    && (item.hasVisuals || item.model || item.quality === 'infused' || item.styles.length));
  const heroes = new Map();
  for (const item of defaults) {
    if (!item.slot || !item.heroes.length) continue;
    for (const hero of item.heroes) {
      const heroRecord = heroes.get(hero) || { key: hero, name: heroDisplayName(hero), slots: new Map() };
      const slotRecord = heroRecord.slots.get(item.slot) || { id: `item:${hero}:${item.slot}`, name: item.slot.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()), targetId: item.id, options: [] };
      heroRecord.slots.set(item.slot, slotRecord);
      heroes.set(hero, heroRecord);
    }
  }
  for (const item of wearables) {
    for (const hero of item.heroes) {
      const target = defaults.find((candidate) => candidate.slot === item.slot && candidate.heroes.includes(hero));
      if (!target) continue;
      const heroRecord = heroes.get(hero) || { key: hero, name: heroDisplayName(hero), slots: new Map() };
      const slotRecord = heroRecord.slots.get(item.slot) || { id: `item:${hero}:${item.slot}`, name: item.slot.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()), targetId: target.id, options: [] };
      if (slotRecord.options.some((option) => option.id === item.id)) continue;
      const cardStyles = item.styles.length ? item.styles : [{ id: '', name: '', base: true }];
      for (const style of cardStyles) {
        const styled = !style.base;
        slotRecord.options.push({
          id: item.id,
          ...(styled ? { styleId: style.id } : {}),
          name: styled ? cosmeticStyleCardName(item.name, style) : item.name,
          baseName: item.name,
          ...(styled && style.name ? { styleName: style.name } : {}),
          quality: item.quality || '',
          icon: item.icon || null,
          effects: [...new Set([...item.effects, ...(styled ? styleEffectNames(text, item.children, prefabs, style.id) : [])])],
          styles: item.styles.map(({ id, name }) => ({ id, name })),
          previewUrl: cosmeticPreviewUrl(hero, heroDisplayName(hero), `${item.name} Style ${style.id} ${style.name}`)
            || cosmeticPreviewUrl(hero, heroDisplayName(hero), `${item.name} Style ${style.id}`)
            || cosmeticPreviewUrl(hero, heroDisplayName(hero), `${item.name} ${style.name}`)
            || cosmeticPreviewUrl(hero, heroDisplayName(hero), item.name),
          previewFallbackUrl: cosmeticInventoryIconUrl(item.icon),
        });
      }
      heroRecord.slots.set(item.slot, slotRecord);
      heroes.set(hero, heroRecord);
    }
  }
  return [...heroes.values()].map((hero) => ({
    key: hero.key,
    name: hero.name,
    slots: [...hero.slots.values()].map((slot) => ({
      ...slot,
      options: slot.options.sort((left, right) => (left.baseName || left.name).localeCompare(right.baseName || right.name)
        || Number(left.styleId || 0) - Number(right.styleId || 0)),
    })).sort((left, right) => left.name.localeCompare(right.name)),
  })).sort((left, right) => left.name.localeCompare(right.name));
}

function buildWearableBlock(text, source, target, effectId = '', styleOverrides = []) {
  let output = text.slice(source.start, source.end);
  const sourceChildren = parseChildren(output, output.indexOf('{') + 1, output.lastIndexOf('}'));
  const edits = [];
  const idStart = source.keyStart - source.start;
  const idEnd = source.keyEnd - source.start;
  edits.push({ start: idStart, end: idEnd, text: `"${target.id}"` });
  const name = sourceChildren.find((entry) => !entry.isBlock && entry.key.toLowerCase() === 'name');
  const prefab = sourceChildren.find((entry) => !entry.isBlock && entry.key.toLowerCase() === 'prefab');
  if (name) edits.push({ start: name.valueStart, end: name.valueEnd, text: `"${String(target.name).replace(/[\\"]/g, '\\$&')}"` });
  if (prefab) edits.push({ start: prefab.valueStart, end: prefab.valueEnd, text: '"default_item"' });
  const removeRestrictions = (entries) => {
    for (const entry of entries) {
      if (!entry.isBlock) continue;
      if (['unlock', 'styles'].includes(entry.key.toLowerCase())) edits.push({ start: entry.start, end: entry.end, text: '' });
      else removeRestrictions(parseChildren(output, entry.bodyStart, entry.bodyEnd));
    }
  };
  removeRestrictions(sourceChildren);
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  if (styleOverrides.length) output = applyStyleOverrides(output, styleOverrides);
  const effect = COSMETIC_EFFECT_BY_ID.get(effectId);
  if (effect) output = appendCosmeticEffect(output, effect);
  return output;
}

function overrideEntryChildren(entry) {
  if (!entry.isBlock) return [];
  const open = entry.raw.indexOf('{');
  const close = entry.raw.lastIndexOf('}');
  if (open < 0 || close <= open) return [];
  return parseChildren(entry.raw, open + 1, close)
    .filter((child) => child.key.toLowerCase() !== 'styles')
    .map((child) => ({ key: child.key, isBlock: child.isBlock, raw: entry.raw.slice(child.start, child.end) }));
}

function mergeOverrideEntries(blockText, overrideEntries) {
  const open = blockText.indexOf('{');
  const close = blockText.lastIndexOf('}');
  if (open < 0 || close <= open) return blockText;
  const currentEntries = parseChildren(blockText, open + 1, close);
  const edits = [];
  const additions = [];
  for (const incoming of overrideEntries.filter((entry) => entry.key.toLowerCase() !== 'styles')) {
    const existing = currentEntries.find((entry) => entry.key.toLowerCase() === incoming.key.toLowerCase());
    if (incoming.isBlock && existing?.isBlock) {
      const currentText = blockText.slice(existing.start, existing.end);
      edits.push({
        start: existing.start,
        end: existing.end,
        text: mergeOverrideEntries(currentText, overrideEntryChildren(incoming)),
      });
    } else if (existing) {
      edits.push({ start: existing.start, end: existing.end, text: incoming.raw });
    } else additions.push(incoming.raw);
  }
  let output = blockText;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  if (!additions.length) return output;
  const outputClose = output.lastIndexOf('}');
  return `${output.slice(0, outputClose)}\n      ${additions.join('\n      ')}\n    ${output.slice(outputClose)}`;
}

function applyStyleOverrides(itemBlockText, overrideEntries) {
  const visualKeys = new Set(['skin', 'asset_modifier', 'asset_modifiers', 'particle', 'particles', 'modifier']);
  const visualOverrides = [];
  const itemOverrides = [];
  for (const entry of overrideEntries) {
    if (entry.isBlock && entry.key.toLowerCase() === 'visuals') visualOverrides.push(...overrideEntryChildren(entry));
    else if (visualKeys.has(entry.key.toLowerCase())) visualOverrides.push(entry);
    else itemOverrides.push(entry);
  }

  let output = itemOverrides.length ? mergeOverrideEntries(itemBlockText, itemOverrides) : itemBlockText;
  if (!visualOverrides.length) return output;
  const open = output.indexOf('{');
  const close = output.lastIndexOf('}');
  const children = parseChildren(output, open + 1, close);
  const visuals = block(children, 'visuals');
  if (visuals) {
    const current = output.slice(visuals.start, visuals.end);
    const merged = mergeOverrideEntries(current, visualOverrides);
    return `${output.slice(0, visuals.start)}${merged}${output.slice(visuals.end)}`;
  }
  return mergeOverrideEntries(output, [{
    key: 'visuals',
    isBlock: true,
    raw: `"visuals" {\n      ${visualOverrides.map((entry) => entry.raw).join('\n      ')}\n    }`,
  }]);
}

function appendCosmeticEffect(itemBlockText, effect) {
  const outerClose = itemBlockText.lastIndexOf('}');
  const children = parseChildren(itemBlockText, itemBlockText.indexOf('{') + 1, outerClose);
  const visuals = block(children, 'visuals');
  const modifier = `"asset_modifier" { "type" "particle_create" "modifier" "${effect.modifier}" }`;
  if (visuals) {
    const current = itemBlockText.slice(visuals.bodyStart, visuals.bodyEnd);
    if (current.toLowerCase().includes(effect.modifier.toLowerCase())) return itemBlockText;
    return `${itemBlockText.slice(0, visuals.bodyEnd)}\n      ${modifier}\n    ${itemBlockText.slice(visuals.bodyEnd)}`;
  }
  return `${itemBlockText.slice(0, outerClose)}\n    "visuals" {\n      ${modifier}\n    }\n  ${itemBlockText.slice(outerClose)}`;
}

function buildCosmeticReplacements(text, selections = {}) {
  const nodes = itemNodes(text);
  const prefabs = prefabDefinitions(text);
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const replacements = new Map();
  const errors = [];
  for (const [slotId, rawItemId] of Object.entries(selections || {})) {
    const itemId = String(typeof rawItemId === 'object' ? rawItemId?.itemId || '' : rawItemId || '');
    const effectId = typeof rawItemId === 'object' ? String(rawItemId?.effectId || '') : '';
    const styleId = typeof rawItemId === 'object' ? String(rawItemId?.styleId ?? '') : '';
    if (!itemId) continue;
    const match = /^item:([a-z0-9_]+):([a-z0-9_]+)$/i.exec(slotId);
    if (!match) { errors.push(`Invalid cosmetic slot: ${slotId}`); continue; }
    const [, hero, slot] = match;
    const donor = byId.get(itemId);
    if (!donor) { errors.push(`Cosmetic item ${itemId} is not present in the installed game schema.`); continue; }
    const donorData = {
      name: field(donor.children, 'name'),
      prefab: field(donor.children, 'prefab').toLowerCase(),
      slot: normalizedSlot(inheritedField(donor.children, 'item_slot', prefabs)),
      heroes: heroIds(text, donor, prefabs),
    };
    if (donorData.prefab !== 'wearable' || donorData.slot !== normalizedSlot(slot) || !donorData.heroes.includes(hero)) {
      errors.push(`${donorData.name || itemId} does not belong to ${heroDisplayName(hero)} · ${slot}.`);
      continue;
    }
    const styleOverrides = styleOverrideEntries(text, donor.children, prefabs, styleId);
    if (styleOverrides === null) {
      errors.push(`${donorData.name || itemId} does not have style ${styleId} in the installed game schema.`);
      continue;
    }
    const base = nodes.find((item) => item.id !== donor.id
      && field(item.children, 'prefab').toLowerCase() === 'default_item'
      && normalizedSlot(inheritedField(item.children, 'item_slot', prefabs)) === donorData.slot
      && heroIds(text, item, prefabs).includes(hero));
    if (!base) { errors.push(`No default ${slot} item exists for ${heroDisplayName(hero)}.`); continue; }
    const baseName = field(base.children, 'name') || base.id;
    if (replacements.has(base.id)) { errors.push(`More than one selected skin targets ${baseName}.`); continue; }
    replacements.set(base.id, { id: base.id, content: buildWearableBlock(text, donor, { id: base.id, name: baseName }, COSMETIC_EFFECT_BY_ID.has(effectId) ? effectId : '', styleOverrides), sourceId: donor.id, sourceName: donorData.name, styleId });
  }
  if (errors.length) throw new Error(errors.join(' '));
  return replacements;
}

function sanitizeCosmeticSelections(heroes, selections = {}) {
  const available = new Map();
  for (const hero of Array.isArray(heroes) ? heroes : []) {
    const heroKey = normalizeHeroKey(hero?.key);
    if (!heroKey) continue;
    for (const slot of hero.slots || []) {
      const slotKey = normalizedSlot(String(slot?.id || '').split(':').at(-1));
      if (!slotKey || slotKey === 'set') continue;
      const id = `item:${heroKey}:${slotKey}`;
      const itemStyles = new Map();
      for (const option of slot.options || []) {
        const itemId = String(option.id);
        if (!itemStyles.has(itemId)) itemStyles.set(itemId, new Set(['']));
        if (option.styleId !== undefined && option.styleId !== null && String(option.styleId) !== '') itemStyles.get(itemId).add(String(option.styleId));
        for (const style of option.styles || []) itemStyles.get(itemId).add(String(style.id));
      }
      available.set(id, { itemStyles, targetId: String(slot?.targetId || '') });
    }
  }

  const valid = {};
  const discarded = [];
  const conflicts = new Set();
  const targetOwners = new Map();
  const sourceEntries = selections && typeof selections === 'object' && !Array.isArray(selections) ? Object.entries(selections) : [];
  for (const [rawSlotId, rawSelection] of sourceEntries) {
    const itemId = String(typeof rawSelection === 'object' ? rawSelection?.itemId || '' : rawSelection || '');
    const styleId = typeof rawSelection === 'object' ? String(rawSelection?.styleId ?? '') : '';
    const effectId = typeof rawSelection === 'object' && COSMETIC_EFFECT_BY_ID.has(String(rawSelection.effectId || ''))
      ? String(rawSelection.effectId)
      : '';
    if (!itemId) continue;
    const match = /^item:([^:]+):(.+)$/i.exec(rawSlotId);
    const heroKey = match ? normalizeHeroKey(match[1]) : null;
    const slotKey = match ? normalizedSlot(match[2]) : '';
    const slotId = heroKey && slotKey ? `item:${heroKey}:${slotKey}` : '';
    const slotData = available.get(slotId);
    if (!slotData?.itemStyles.get(itemId)?.has(styleId)) {
      discarded.push({ slotId: rawSlotId, itemId });
      continue;
    }
    if (conflicts.has(slotId)) {
      discarded.push({ slotId: rawSlotId, itemId });
      continue;
    }
    if (Object.hasOwn(valid, slotId)) {
      const previous = valid[slotId];
      const previousId = String(typeof previous === 'object' ? previous.itemId || '' : previous);
      if (previousId === itemId) {
        const previousStyleId = typeof previous === 'object' ? String(previous.styleId ?? '') : '';
        const previousEffectId = typeof previous === 'object' ? String(previous.effectId || '') : '';
          const mergedStyleId = styleId || previousStyleId;
          const mergedEffectId = effectId || previousEffectId;
          valid[slotId] = mergedStyleId || mergedEffectId
            ? { itemId, ...(mergedStyleId ? { styleId: mergedStyleId } : {}), ...(mergedEffectId ? { effectId: mergedEffectId } : {}) }
            : itemId;
        continue;
      }
      delete valid[slotId];
      conflicts.add(slotId);
      discarded.push({ slotId, itemId: previousId }, { slotId: rawSlotId, itemId });
      for (const [targetId, ownerSlotId] of targetOwners) {
        if (ownerSlotId === slotId) targetOwners.delete(targetId);
      }
      continue;
    }

    const targetOwner = slotData.targetId ? targetOwners.get(slotData.targetId) : null;
    if (targetOwner && targetOwner !== slotId && Object.hasOwn(valid, targetOwner)) {
      const previous = valid[targetOwner];
      const previousId = String(typeof previous === 'object' ? previous.itemId || '' : previous);
      const previousStyleId = typeof previous === 'object' ? String(previous.styleId || '') : '';
      const previousEffectId = typeof previous === 'object' ? String(previous.effectId || '') : '';
      if (previousId === itemId && previousStyleId === styleId && previousEffectId === effectId) continue;
      delete valid[targetOwner];
      discarded.push({ slotId: targetOwner, itemId: previousId });
      targetOwners.delete(slotData.targetId);
    }
    valid[slotId] = typeof rawSelection === 'object'
      ? { itemId, ...(styleId ? { styleId } : {}), ...(effectId ? { effectId } : {}) }
      : itemId;
    if (slotData.targetId) targetOwners.set(slotData.targetId, slotId);
  }
  return { selections: valid, discarded };
}

function readGameCosmeticData(gamePath, language = 'english') {
  const pakPath = path.join(gamePath, 'dota', 'pak01_dir.vpk');
  const reader = VpkReader.open(pakPath);
  try {
    if (!reader.has(SCHEMA_ENTRY)) throw new Error('The installed Dota VPK does not contain items_game.txt. Verify Dota 2 files in Steam.');
    const preferred = String(language || 'english').toLowerCase().replace(/^dota_/, '');
    const locales = [...new Set([preferred, 'english', 'russian'].filter((locale) => /^[a-z0-9_-]+$/.test(locale)))];
    const tokens = new Map();
    for (const locale of locales.reverse()) {
      const entry = `resource/localization/items/items_${locale}.txt`;
      if (!reader.has(entry)) continue;
      for (const [key, value] of localizationTokens(reader.readFile(entry).toString('utf8'))) tokens.set(key, value);
    }
    return { text: reader.readFile(SCHEMA_ENTRY).toString('utf8'), localization: tokens };
  } finally { reader.close(); }
}

function readGameItems(gamePath) {
  return readGameCosmeticData(gamePath).text;
}

function buildCosmeticListing(gamePath, picks = {}, language = 'english') {
  if (!gamePath) return { heroes: [], picks, error: 'Configure the Dota 2 path first.' };
  try {
    const data = readGameCosmeticData(gamePath, language);
    return { heroes: describeItems(data.text, { localization: data.localization }), picks, error: null };
  } catch (error) {
    return { heroes: [], picks, error: error.message };
  }
}

module.exports = {
  SCHEMA_ENTRY,
  COSMETIC_EFFECTS,
  buildCosmeticListing,
  buildCosmeticReplacements,
  describeItems,
  itemNodes,
  matchingBrace,
  parseChildren,
  readGameItems,
  readGameCosmeticData,
  sanitizeCosmeticSelections,
};
