const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { VpkReader, VpkWriter } = require('vpk-tools');
const { buildCosmeticListing, buildCosmeticReplacements, describeItems, itemNodes, sanitizeCosmeticSelections } = require('../src/application/cosmetic-builder');
const { SpecialPatchService } = require('../src/application/special-patch-service');
const { AppService } = require('../src/main/services/app-service');

const schema = `"items_game"
{
  "prefabs"
  {
    "default_item" { "item_slot" "weapon" }
    "wearable" { "item_slot" "weapon" "item_quality" "unique" }
  }
  "store_currency_pricepoints" { "0" "0" }
  "items"
  {
    "40" { "name" "Anti-Mage Default Weapon" "prefab" "default_item" "used_by_heroes" { "npc_dota_hero_antimage" "1" } }
    "41" { "name" "Anti-Mage Blade" "prefab" "wearable" "used_by_heroes" { "npc_dota_hero_antimage" "1" } "model_player" "models/items/antimage/blade.vmdl" }
    "10"
    {
      "name" "Axe Default Weapon"
      "prefab" "default_item"
      "item_slot" "weapon"
      "used_by_heroes" { "npc_dota_hero_axe" "1" }
    }
    "20"
    {
      "name" "Axe Frostblade"
      "prefab" "wearable"
      "item_quality" "immortal"
      "item_slot" "weapon"
      "used_by_heroes" { "npc_dota_hero_axe" "1" }
      "image_inventory" "econ/items/axe/frostblade"
      "model_player" "models/items/axe/frostblade.vmdl"
      "visuals"
      {
        "asset_modifier" { "type" "particle_create" "modifier" "particles/econ/items/axe/frostblade/frost.vpcf" }
        "styles"
        {
          "1" { "name" "Blue" "skin" "1" }
          "2" { "name" "Red" "skin" "2" }
          "3" { "name" "Gold" "skin" "3" }
        }
      }
      "unlock" { "price" "100" }
      "styles" { "1" { "name" "Blue" } "2" { "name" "Red" } "3" { "name" "Gold" } }
    }
    "25" { "name" "Axe Infused Blade" "prefab" "wearable" "item_rarity" "mythical" "item_quality" "infused" "item_slot" "weapon" "used_by_heroes" { "npc_dota_hero_axe" "1" } "model_player" "models/items/axe/infused.vmdl" }
    "21"
    {
      "name" "Axe of Phractos"
      "prefab" "wearable"
      "item_rarity" "mythical"
      "item_slot" "weapon"
      "used_by_heroes" { "npc_dota_hero_axe" "1" }
      "visuals" { "skin" "1" }
    }
    "11" { "name" "Axe Default Offhand" "prefab" "default_item" "item_slot" "offhand_weapon" "used_by_heroes" { "npc_dota_hero_axe" "1" } }
    "12" { "name" "Axe Default Arms" "prefab" "default_item" "item_slot" "arms" "used_by_heroes" { "npc_dota_hero_axe" "1" } }
    "13" { "name" "Axe Default Shoulders" "prefab" "default_item" "item_slot" "shoulders" "used_by_heroes" { "npc_dota_hero_axe" "1" } }
    "14" { "name" "Axe Default Back" "prefab" "default_item" "item_slot" "back" "used_by_heroes" { "npc_dota_hero_axe" "1" } }
    "22" { "name" "Axe Left Blade" "prefab" "wearable" "item_slot" "offhand_weapon" "used_by_heroes" { "npc_dota_hero_axe" "1" } "model_player" "models/items/axe/left_blade.vmdl" }
    "23" { "name" "Axe Bracers" "prefab" "wearable" "item_slot" "arm" "used_by_heroes" { "npc_dota_hero_axe" "1" } "model_player" "models/items/axe/bracers.vmdl" }
    "24" { "name" "Axe Pauldrons" "prefab" "wearable" "item_slot" "shoulder" "used_by_heroes" { "npc_dota_hero_axe" "1" } "model_player" "models/items/axe/pauldrons.vmdl" }
    "30"
    {
      "name" "Invoker Hat"
      "prefab" "wearable"
      "item_slot" "head"
      "used_by_heroes" { "npc_dota_hero_invoker" "1" }
      "visuals" { "skin" "1" }
    }
  }
}
`;

test('builds local hero and slot options from the installed item schema', () => {
  const heroes = describeItems(schema);
  const axe = heroes.find((hero) => hero.key === 'axe');
  assert.equal(axe.name, 'Axe');
  const slot = (id) => axe.slots.find((entry) => entry.id === `item:axe:${id}`);
  assert.equal(slot('weapon').targetId, '10');
  assert.deepEqual(slot('weapon').options.filter((option) => !option.styleId).map((option) => option.id), ['25', '21']);
  assert.equal(slot('weapon').options.find((option) => option.id === '20').quality, 'immortal');
  assert.equal(slot('weapon').options.find((option) => option.id === '21').quality, 'mythical');
  assert.equal(slot('weapon').options.find((option) => option.id === '25')?.quality, 'infused');
  assert.deepEqual(slot('weapon').options.filter((option) => option.id === '20' && option.styleId).map((option) => option.styleId), ['1', '2', '3']);
  assert.equal(slot('offhand').options[0].quality, '');
  assert.deepEqual(slot('weapon').options[0].effects, ['frost']);
  assert.equal(slot('weapon').options[0].icon, 'econ/items/axe/frostblade');
  assert.match(slot('weapon').options.find((option) => option.id === '21').previewUrl, /images\/Axe%20-%20AXE%20OF%20PHRACTOS\.webp$/);
  assert.equal(slot('offhand').targetId, '11');
  assert.deepEqual(slot('offhand').options.map((option) => option.id), ['22']);
  assert.equal(slot('arms').targetId, '12');
  assert.deepEqual(slot('arms').options.map((option) => option.id), ['23']);
  assert.equal(slot('shoulders').targetId, '13');
  assert.deepEqual(slot('shoulders').options.map((option) => option.id), ['24']);
  assert.equal(slot('back').targetId, '14');
  assert.deepEqual(slot('back').options, []);
});

test('maps the selected wearable onto the hero default item and retains its native visuals and icon', () => {
  const replacements = buildCosmeticReplacements(schema, { 'item:axe:weapon': '20' });
  const patch = replacements.get('10');
  assert.equal(patch.sourceId, '20');
  assert.match(patch.content, /^"10"\s*\{/);
  assert.match(patch.content, /"name"\s+"Axe Default Weapon"/);
  assert.match(patch.content, /"prefab"\s+"default_item"/);
  assert.match(patch.content, /"image_inventory"\s+"econ\/items\/axe\/frostblade"/);
  assert.match(patch.content, /particles\/econ\/items\/axe\/frostblade\/frost\.vpcf/);
  assert.doesNotMatch(patch.content, /"unlock"/);
  assert.doesNotMatch(patch.content, /"styles"/);
});

test('exposes alternate styles as separate options and applies their schema visuals to the generated default item', () => {
  const heroes = describeItems(schema);
  const options = heroes.find((hero) => hero.key === 'axe').slots.find((slot) => slot.id === 'item:axe:weapon').options;
  const secondStyle = options.find((option) => option.id === '20' && option.styleId === '2');
  const thirdStyle = options.find((option) => option.id === '20' && option.styleId === '3');
  assert.equal(secondStyle.name, 'Axe Frostblade · Red');
  assert.equal(thirdStyle.name, 'Axe Frostblade · Gold');

  const replacement = buildCosmeticReplacements(schema, { 'item:axe:weapon': { itemId: '20', styleId: '2' } }).get('10');
  assert.match(replacement.content, /"skin"\s+"2"/);
  assert.doesNotMatch(replacement.content, /"styles"\s*\{/);
  assert.doesNotMatch(replacement.content, /"skin"\s+"3"/);
});

test('hides the second Planetfall Arcana style and preserves first-style overrides', () => {
  const planetfallSchema = `"items_game" { "prefabs" { "default_item" { "item_slot" "weapon" } "wearable" { "item_slot" "weapon" } } "items" {
    "10" { "name" "Earthshaker Default Weapon" "prefab" "default_item" "used_by_heroes" { "npc_dota_hero_earthshaker" "1" } }
    "20" {
      "name" "Planetfall"
      "prefab" "wearable"
      "item_quality" "arcana"
      "item_slot" "weapon"
      "used_by_heroes" { "npc_dota_hero_earthshaker" "1" }
      "model_player" "models/items/earthshaker/planetfall.vmdl"
      "visuals" { "skin" "7" "styles"
      {
        "0" { "name" "Style 0" "skin" "0" }
        "1" { "name" "Style 1" "skin" "1" }
      }
      }
      "styles" { "0" { "name" "Style 0" "model_player" "models/items/earthshaker/planetfall.vmdl" } "1" { "name" "Style 1" "model_player" "models/items/earthshaker/planetfall_style1.vmdl" "visuals" { "asset_modifier" { "type" "particle_create" "modifier" "particles/items/planetfall_style1.vpcf" } } } }
    }
  } }`;
  const options = describeItems(planetfallSchema).find((hero) => hero.key === 'earthshaker').slots[0].options;

  assert.equal(options.length, 1);
  assert.deepEqual(options.map((option) => option.styleId), ['0']);
  assert.deepEqual(options.map((option) => option.name), ['Planetfall']);
  const secondStylePick = sanitizeCosmeticSelections(describeItems(planetfallSchema), {
    'item:earthshaker:weapon': { itemId: '20', styleId: '1' },
  });
  assert.deepEqual(secondStylePick.selections, {});

  const styleZero = buildCosmeticReplacements(planetfallSchema, { 'item:earthshaker:weapon': { itemId: '20', styleId: 0 } }).get('10');
  assert.match(styleZero.content, /"model_player"\s+"models\/items\/earthshaker\/planetfall\.vmdl"/);
  assert.match(styleZero.content, /"skin"\s+"0"/);
  const styleOne = buildCosmeticReplacements(planetfallSchema, { 'item:earthshaker:weapon': { itemId: '20', styleId: '1', effectId: 'fire' } }).get('10');
  assert.match(styleOne.content, /"model_player"\s+"models\/items\/earthshaker\/planetfall_style1\.vmdl"/);
  assert.match(styleOne.content, /"skin"\s+"1"/);
  assert.match(styleOne.content, /particles\/items\/planetfall_style1\.vpcf/);
  assert.match(styleOne.content, /courier_trail_lava\.vpcf/);
  assert.doesNotMatch(styleOne.content, /"skin"\s+"7"/);
});

test('does not expose schema styles for Almond the Frondillo', () => {
  const almondSchema = `"items_game" { "prefabs" { "default_item" { "item_slot" "courier" } "wearable" { "item_slot" "courier" } } "items" {
    "10" { "name" "Axe Default Courier" "prefab" "default_item" "used_by_heroes" { "npc_dota_hero_axe" "1" } }
    "20" { "name" "Almond the Frondillo" "prefab" "wearable" "item_slot" "courier" "used_by_heroes" { "npc_dota_hero_axe" "1" } "model_player" "models/items/courier/almond.vmdl" "visuals" { "styles" { "0" { "name" "Style 0" "skin" "0" } "1" { "name" "Style 1" "skin" "1" } } } }
  } }`;
  const options = describeItems(almondSchema).find((hero) => hero.key === 'axe').slots[0].options;
  assert.equal(options.length, 1);
  assert.equal(options[0].name, 'Almond the Frondillo');
  assert.equal(options[0].styleId, undefined);
});

test('localizes arcana and style names, exposes all three Tidehunter styles, and includes Infused items', () => {
  const styleSchema = `"items_game" { "prefabs" { "default_item" { "item_slot" "weapon" } "wearable" { "item_slot" "weapon" } } "items" {
    "1" { "name" "Tidehunter Default Weapon" "prefab" "default_item" "used_by_heroes" { "npc_dota_hero_tidehunter" "1" } }
    "2" { "name" "#DOTA_Tidehunter_Arcana" "prefab" "wearable" "item_quality" "arcana" "item_slot" "weapon" "used_by_heroes" { "npc_dota_hero_tidehunter" "1" } "image_inventory" "econ/items/tidehunter/arcana" "visuals" { "styles" { "1" { "name" "#TIDE_STYLE_ONE" "skin" "1" } "2" { "name" "#TIDE_STYLE_TWO" "skin" "2" } "3" { "name" "#TIDE_STYLE_THREE" "skin" "3" } } } }
    "3" { "name" "#DOTA_Axe_Infused" "prefab" "wearable" "item_quality" "infused" "item_slot" "weapon" "used_by_heroes" { "npc_dota_hero_axe" "1" } "image_inventory" "econ/items/axe/infused" }
    "4" { "name" "Axe Default Weapon" "prefab" "default_item" "item_slot" "weapon" "used_by_heroes" { "npc_dota_hero_axe" "1" } }
  } }`;
  const localization = `"lang" { "Tokens" { "DOTA_Tidehunter_Arcana" "Tidehunter Arcana" "TIDE_STYLE_ONE" "Style One" "TIDE_STYLE_TWO" "Style Two" "TIDE_STYLE_THREE" "Style Three" "DOTA_Axe_Infused" "Axe Infused Blade" } }`;
  const heroes = describeItems(styleSchema, { localization });
  const tideArcana = heroes.find((hero) => hero.key === 'tidehunter').slots[0].options;
  const styles = tideArcana.filter((option) => option.styleId);
  assert.deepEqual(styles.map((option) => option.styleId), ['1', '3']);
  assert.deepEqual(styles.map((option) => option.name), [
    'Tidehunter Arcana · Style One',
    'Tidehunter Arcana · Style Three',
  ]);
  assert.ok(styles.every((option) => !option.name.includes('#DOTA')));
  assert.match(styles[0].previewFallbackUrl, /tidehunter\/arcana\.png$/);
  const infused = heroes.find((hero) => hero.key === 'axe').slots[0].options[0];
  assert.equal(infused.name, 'Axe Infused Blade');
  assert.equal(infused.quality, 'infused');
  assert.match(infused.previewFallbackUrl, /axe\/infused\.png$/);

  const replacement = buildCosmeticReplacements(styleSchema, { 'item:tidehunter:weapon': { itemId: '2', styleId: '2' } }).get('1');
  assert.match(replacement.content, /"skin"\s+"2"/);
  const hiddenSecondStyle = sanitizeCosmeticSelections(heroes, { 'item:tidehunter:weapon': { itemId: '2', styleId: '2' } });
  assert.deepEqual(hiddenSecondStyle.selections, {});
  assert.deepEqual(hiddenSecondStyle.discarded, [{ slotId: 'item:tidehunter:weapon', itemId: '2' }]);
});

test('loads localized item labels from the selected language files inside the game VPK', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-cosmetic-localization-'));
  const gamePath = path.join(root, 'game');
  const pakPath = path.join(gamePath, 'dota', 'pak01_dir.vpk');
  await fs.mkdir(path.dirname(pakPath), { recursive: true });
  const writer = new VpkWriter();
  writer.addFile('scripts/items/items_game.txt', Buffer.from(`"items_game" { "prefabs" { "default_item" { "item_slot" "weapon" } "wearable" { "item_slot" "weapon" } } "items" { "1" { "name" "Axe Default" "prefab" "default_item" "used_by_heroes" { "npc_dota_hero_axe" "1" } } "2" { "name" "#DOTA_Axe_Arcana" "prefab" "wearable" "item_slot" "weapon" "used_by_heroes" { "npc_dota_hero_axe" "1" } "visuals" { "skin" "1" } } } }`));
  writer.addFile('resource/localization/items/items_russian.txt', Buffer.from(`"lang" { "Tokens" { "DOTA_Axe_Arcana" "Аркана Axe" } }`));
  writer.write(pakPath);

  const listing = buildCosmeticListing(gamePath, {}, 'russian');

  assert.equal(listing.error, null);
  assert.equal(listing.heroes.find((hero) => hero.key === 'axe').slots[0].options[0].name, 'Аркана Axe');
});

test('adds a selected unusual particle effect to the chosen cosmetic visuals', () => {
  const replacements = buildCosmeticReplacements(schema, {
    'item:axe:weapon': { itemId: '20', effectId: 'fire' },
  });
  const patch = replacements.get('10');
  assert.match(patch.content, /"type"\s+"particle_create"/);
  assert.match(patch.content, /courier_trail_lava\.vpcf/);
});

test('applies wearables from alternate left-hand, arm, and shoulder slot spellings', () => {
  const replacements = buildCosmeticReplacements(schema, {
    'item:axe:offhand': '22',
    'item:axe:arms': '23',
    'item:axe:shoulders': '24',
  });

  assert.deepEqual([...replacements.keys()], ['11', '12', '13']);
});

test('resolves inherited prefab weapon slots and canonicalizes Valve hero names', () => {
  const antiMage = describeItems(schema).find((hero) => hero.key === 'anti_mage');
  assert.ok(antiMage);
  assert.equal(antiMage.slots.find((slot) => slot.id === 'item:anti_mage:weapon')?.targetId, '40');
  assert.deepEqual(antiMage.slots.find((slot) => slot.id === 'item:anti_mage:weapon')?.options.map((option) => option.id), ['41']);
  assert.deepEqual([...buildCosmeticReplacements(schema, { 'item:anti_mage:weapon': '41' }).keys()], ['40']);
});

test('lists legacy Treant and Underlord cosmetics under their canonical hero names', () => {
  const legacyHeroSchema = `"items_game" { "prefabs" { "default_item" { "item_slot" "weapon" } "wearable" { "item_slot" "weapon" } } "items" {
    "1" { "name" "Treant Default" "prefab" "default_item" "used_by_heroes" { "npc_dota_hero_treant" "1" } }
    "2" { "name" "Treant Branches" "prefab" "wearable" "used_by_heroes" { "npc_dota_hero_treant" "1" } "model_player" "models/items/treant/branches.vmdl" }
    "3" { "name" "Underlord Default" "prefab" "default_item" "used_by_heroes" { "npc_dota_hero_abyssal_underlord" "1" } }
    "4" { "name" "Underlord Blade" "prefab" "wearable" "used_by_heroes" { "npc_dota_hero_abyssal_underlord" "1" } "model_player" "models/items/underlord/blade.vmdl" }
  } }`;
  const heroes = describeItems(legacyHeroSchema);
  const treant = heroes.find((hero) => hero.key === 'treant_protector');
  const underlord = heroes.find((hero) => hero.key === 'underlord');
  assert.equal(treant?.name, 'Treant Protector');
  assert.equal(treant?.slots[0].options[0].name, 'Treant Branches');
  assert.equal(underlord?.name, 'Underlord');
  assert.equal(underlord?.slots[0].options[0].name, 'Underlord Blade');
});

test('rejects item IDs that do not belong to the requested hero and slot', () => {
  assert.throws(() => buildCosmeticReplacements(schema, { 'item:axe:weapon': '30' }), /does not belong/i);
});

test('drops stale saved cosmetic picks and migrates legacy hero and slot aliases', () => {
  const heroes = describeItems(schema);
  const result = sanitizeCosmeticSelections(heroes, {
    'item:antimage:weapon': '41',
    'item:axe:offhand_weapon': '22',
    'item:anti_mage:head': '30',
  });

  assert.deepEqual(result.selections, {
    'item:anti_mage:weapon': '41',
    'item:axe:offhand': '22',
  });
  assert.deepEqual(result.discarded, [{ slotId: 'item:anti_mage:head', itemId: '30' }]);
});

test('sanitizes saved unusual effect selections while keeping legacy picks compatible', () => {
  const heroes = describeItems(schema);
  const result = sanitizeCosmeticSelections(heroes, {
    'item:axe:weapon': { itemId: '20', effectId: 'bubbles' },
    'item:anti_mage:weapon': '41',
    'item:axe:offhand': { itemId: '22', effectId: 'not-an-effect' },
  });

  assert.deepEqual(result.selections, {
    'item:axe:weapon': { itemId: '20', effectId: 'bubbles' },
    'item:anti_mage:weapon': '41',
    'item:axe:offhand': { itemId: '22' },
  });
  assert.deepEqual(result.discarded, []);
});

test('sanitizes style picks and rejects a style ID not present on the selected wearable', () => {
  const heroes = describeItems(schema);
  const valid = sanitizeCosmeticSelections(heroes, { 'item:axe:weapon': { itemId: '20', styleId: '2', effectId: 'fire' } });
  assert.deepEqual(valid.selections, { 'item:axe:weapon': { itemId: '20', styleId: '2', effectId: 'fire' } });
  const stale = sanitizeCosmeticSelections(heroes, { 'item:axe:weapon': { itemId: '20', styleId: '99' } });
  assert.deepEqual(stale.selections, {});
  assert.deepEqual(stale.discarded, [{ slotId: 'item:axe:weapon', itemId: '20' }]);
});

test('collapses hero cosmetic picks that share one default-item target before building the patch', () => {
  const sharedSlotSchema = `"items_game" { "prefabs" { "default_item" { "item_slot" "courier" } "wearable" { "item_slot" "courier" } } "items" {
    "1" { "name" "All Heroes' Default Pet" "prefab" "default_item" "used_by_heroes" { "npc_dota_hero_axe" "1" "npc_dota_hero_pudge" "1" } }
    "2" { "name" "Axe Pet" "prefab" "wearable" "used_by_heroes" { "npc_dota_hero_axe" "1" } "model_player" "models/items/axe/pet.vmdl" }
    "3" { "name" "Pudge Pet" "prefab" "wearable" "used_by_heroes" { "npc_dota_hero_pudge" "1" } "model_player" "models/items/pudge/pet.vmdl" }
  } }`;
  const heroes = describeItems(sharedSlotSchema);
  const selections = {
    'item:axe:courier': '2',
    'item:pudge:courier': '3',
  };

  const sanitized = sanitizeCosmeticSelections(heroes, selections);

  assert.deepEqual(sanitized.selections, { 'item:pudge:courier': '3' });
  assert.deepEqual(sanitized.discarded, [{ slotId: 'item:axe:courier', itemId: '2' }]);
  assert.deepEqual([...buildCosmeticReplacements(sharedSlotSchema, sanitized.selections).keys()], ['1']);
});

test('never accepts the removed Set slot from a cached or legacy cosmetic listing', () => {
  const result = sanitizeCosmeticSelections([{
    key: 'axe',
    slots: [{ id: 'item:axe:set', options: [{ id: '9001' }] }],
  }], { 'item:axe:set': '9001' });

  assert.deepEqual(result.selections, {});
  assert.deepEqual(result.discarded, [{ slotId: 'item:axe:set', itemId: '9001' }]);
});

test('AppService applies valid saved cosmetics while discarding stale selections', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-cosmetic-stale-picks-'));
  const service = new AppService({ rootDir: root });
  await service.storage.init();
  service.getCosmeticListing = async () => ({ heroes: describeItems(schema), error: null });
  await service.storage.patch({ settings: {
    ...service.storage.state.settings,
    cosmeticLoadout: { 'item:anti_mage:head': '30', 'item:antimage:weapon': '41' },
  } });
  let appliedPicks;
  service.specialPatches.applyCosmetics = async (picks) => {
    appliedPicks = picks;
    await service.storage.patch({ settings: { ...service.storage.state.settings, cosmeticLoadout: picks } });
    return { applied: Object.keys(picks).length };
  };

  const result = await service.applyCosmetics({ 'item:anti_mage:weapon': '41' });

  assert.deepEqual(appliedPicks, { 'item:anti_mage:weapon': '41' });
  assert.deepEqual(result.picks, { 'item:anti_mage:weapon': '41' });
  assert.deepEqual(result.discardedPicks, [{ slotId: 'item:anti_mage:head', itemId: '30' }]);
});

test('applying a new slot keeps the previously saved effect on another slot', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-cosmetic-preserve-effects-'));
  const service = new AppService({ rootDir: root });
  await service.storage.init();
  service.getCosmeticListing = async () => ({ heroes: describeItems(schema), error: null });
  const savedShoulders = { itemId: '24', effectId: 'fire' };
  await service.storage.patch({ settings: {
    ...service.storage.state.settings,
    cosmeticLoadout: { 'item:axe:shoulders': savedShoulders },
  } });
  service.specialPatches.applyCosmetics = async (picks) => {
    await service.storage.patch({ settings: { ...service.storage.state.settings, cosmeticLoadout: picks } });
    return { applied: Object.keys(picks).length };
  };

  const result = await service.applyCosmetics({
    'item:axe:shoulders': savedShoulders,
    'item:axe:weapon': { itemId: '20', styleId: '2' },
  });

  assert.deepEqual(result.picks, {
    'item:axe:shoulders': savedShoulders,
    'item:axe:weapon': { itemId: '20', styleId: '2' },
  });
  assert.equal(service.storage.state.settings.cosmeticLoadout['item:axe:shoulders'].effectId, 'fire');
});

test('builds the generated skin schema into a local VPK without network access', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-cosmetic-vpk-'));
  const gamePath = path.join(root, 'game');
  const pakPath = path.join(gamePath, 'dota', 'pak01_dir.vpk');
  await fs.mkdir(path.dirname(pakPath), { recursive: true });
  const baseWriter = new VpkWriter();
  baseWriter.addFile('scripts/items/items_game.txt', Buffer.from(schema));
  baseWriter.write(pakPath);
  const service = new SpecialPatchService({
    rootDir: root,
    storage: { state: { installedMods: {}, settings: {} }, patch: async () => {} },
    getGamePath: () => gamePath,
    getMods: () => [],
    fetchImpl: async () => { throw new Error('skin generation must not use the network'); },
    processRunning: async () => false,
    onDiagnostics: () => {},
  });
  const generatedPath = path.join(root, 'generated.vpk');

  await service.createPatchedVpk(pakPath, [], generatedPath, { 'item:axe:weapon': { itemId: '20', styleId: '2' } });

  const generated = VpkReader.open(generatedPath);
  try {
    const output = generated.readFile('scripts/items/items_game.txt').toString('utf8');
    const patchedItem = itemNodes(output).find((item) => item.id === '10');
    const patchedBlock = output.slice(patchedItem.start, patchedItem.end);
    assert.match(patchedBlock, /"image_inventory"\s+"econ\/items\/axe\/frostblade"/);
    assert.match(patchedBlock, /particles\/econ\/items\/axe\/frostblade\/frost\.vpcf/);
    assert.match(patchedBlock, /"skin"\s+"2"/);
    assert.doesNotMatch(patchedBlock, /"styles"\s*\{/);
    assert.doesNotMatch(patchedBlock, /"unlock"\s*\{/);
  } finally { generated.close(); }
});

test('AppService exposes an offline cosmetics state when no Dota path is configured', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-cosmetic-state-'));
  const service = new AppService({ rootDir: root });
  await service.storage.init();

  const state = await service.getCosmetics();

  assert.deepEqual(state.heroes, []);
  assert.match(state.error, /configure the dota 2 path/i);
  assert.equal(state.loaderInstalled, false);
});

test('AppService prepares and persists the hero list before the cosmetics page is opened', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-cosmetic-prebuilt-'));
  const gamePath = path.join(root, 'game');
  const pakPath = path.join(gamePath, 'dota', 'pak01_dir.vpk');
  await fs.mkdir(path.dirname(pakPath), { recursive: true });
  const writer = new VpkWriter();
  writer.addFile('scripts/items/items_game.txt', Buffer.from(schema));
  writer.write(pakPath);
  const first = new AppService({ rootDir: root });
  await first.storage.init();
  first.gamePath = gamePath;
  let builds = 0;
  const build = first.buildCosmeticListing;
  first.buildCosmeticListing = (...args) => { builds += 1; return build(...args); };
  const pakStat = await fs.stat(pakPath);
  await fs.mkdir(path.dirname(first.cosmeticListingCacheFile), { recursive: true });
  await fs.writeFile(first.cosmeticListingCacheFile, JSON.stringify({
    signature: `${path.resolve(gamePath)}|${pakStat.size}|${pakStat.mtimeMs}|cosmetics-v4|dev`,
    listing: { heroes: [], picks: {}, error: null },
  }));

  const prepared = await first.getCosmeticListing();
  const reused = await first.getCosmeticListing();
  assert.equal(prepared.heroes.some((hero) => hero.key === 'axe'), true);
  assert.deepEqual(reused, prepared);
  assert.equal(builds, 1);
  assert.equal((await fs.stat(first.cosmeticListingCacheFile)).isFile(), true);
  const refreshed = await first.getCosmeticListing({ forceRefresh: true });
  assert.deepEqual(refreshed, prepared);
  assert.equal(builds, 2);

  const restarted = new AppService({ rootDir: root });
  await restarted.storage.init();
  restarted.gamePath = gamePath;
  let restartBuilds = 0;
  const restartBuild = restarted.buildCosmeticListing;
  restarted.buildCosmeticListing = (...args) => { restartBuilds += 1; return restartBuild(...args); };
  await restarted.getCosmeticListing();
  assert.equal(restartBuilds, 0);
});
