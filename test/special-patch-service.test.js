const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { VpkReader, VpkWriter } = require('vpk-tools');
const { JsonStorage } = require('../src/infrastructure/storage');
const {
  PATCH_MARKER,
  SpecialPatchService,
  appendSignature,
  ensurePatchSearchPath,
  gitBlobHash,
  replaceItemEntries,
  signatureLine,
  signaturesMatch,
} = require('../src/application/special-patch-service');

const weatherText = '"555"\n{\n\t"name"\t"Default Weather"\n\t"prefab"\t"weather"\n}\n';
const radiantText = '"677"\n{\n\t"name"\t"Default Radiant Towers"\n\t"prefab"\t"radianttowers"\n}\n';
const direText = '"678"\n{\n\t"name"\t"Default Dire Towers"\n\t"prefab"\t"diretowers"\n}\n';
const mods = [
  {
    id: 'weather-test', modType: 'special_patch', specialType: 'weather', name: 'Weather Test',
    author: 'h6rd', categoryId: 'weather', version: 'patch-r1', currentVersion: 'patch-r1',
    requiredFiles: [{ itemId: '555', fileName: 'Snow.txt', url: 'https://patch.test/Snow.txt', gitBlobSha: gitBlobHash(weatherText) }],
  },
  {
    id: 'tower-test', modType: 'special_patch', specialType: 'tower', name: 'Tower Test',
    author: 'h6rd', categoryId: 'towers', version: 'patch-r1', currentVersion: 'patch-r1',
    requiredFiles: [
      { itemId: '677', fileName: 'Towers_Radiant.txt', url: 'https://patch.test/Towers_Radiant.txt', gitBlobSha: gitBlobHash(radiantText) },
      { itemId: '678', fileName: 'Towers_Dire.txt', url: 'https://patch.test/Towers_Dire.txt', gitBlobSha: gitBlobHash(direText) },
    ],
  },
];

function makeBaseItemsGame(revision = 'base-one') {
  return `"items"\n{\n\t"store_currency_pricepoints"\n\t{\n\t\t"1" "${revision}"\n\t}\n\t"555" { "name" "Original Weather" }\n\t"677" { "name" "Original Radiant" }\n\t"678" { "name" "Original Dire" }\n}\n`;
}

async function writeBaseVpk(filePath, text) {
  const writer = new VpkWriter();
  writer.addFile('scripts/items/items_game.txt', Buffer.from(text, 'utf8'));
  writer.write(filePath);
}

async function createFixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-special-patch-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const dataRoot = path.join(temporary, 'vanta-data');
  const gamePath = path.join(temporary, 'steamapps', 'common', 'dota 2 beta', 'game');
  const dotaPath = path.join(gamePath, 'dota');
  const binPath = path.join(gamePath, 'bin', 'linuxsteamrt64');
  await fs.mkdir(dotaPath, { recursive: true });
  await fs.mkdir(binPath, { recursive: true });
  await fs.mkdir(path.dirname(path.dirname(path.dirname(gamePath))), { recursive: true });
  await fs.writeFile(path.join(path.dirname(path.dirname(path.dirname(gamePath))), 'appmanifest_570.acf'), '"AppState" { "buildid" "100" }');
  const pak01 = path.join(dotaPath, 'pak01_dir.vpk');
  await writeBaseVpk(pak01, makeBaseItemsGame());
  const gameinfo = path.join(dotaPath, 'gameinfo_branchspecific.gi');
  await fs.writeFile(gameinfo, 'FileSystem\n{\n\tSearchPaths\n\t{\n\t\tGame\t\tdota\n\t}\n}\n');
  const signatures = path.join(binPath, 'dota.signatures');
  await fs.writeFile(signatures, 'original signature data\n');
  const storage = new JsonStorage(dataRoot);
  await storage.init();
  const definitions = new Map([['https://patch.test/Snow.txt', weatherText], ['https://patch.test/Towers_Radiant.txt', radiantText], ['https://patch.test/Towers_Dire.txt', direText]]);
  const progress = [];
  const service = new SpecialPatchService({
    rootDir: dataRoot,
    storage,
    getGamePath: () => gamePath,
    getMods: () => mods,
    processRunning: async () => false,
    fetchImpl: async (url) => definitions.has(url)
      ? new Response(definitions.get(url), { status: 200 })
      : new Response('', { status: 404 }),
    onProgress: (event) => progress.push(event),
  });
  await service.init();
  return { dataRoot, gamePath, dotaPath, pak01, gameinfo, signatures, storage, service, progress, definitions };
}

test('Patcher-compatible helpers inject idempotent search paths and match signature hashes', () => {
  const original = 'FileSystem { SearchPaths { Game dota } }';
  const once = ensurePatchSearchPath(original);
  const twice = ensurePatchSearchPath(once);
  assert.equal(twice, once);
  assert.match(once, new RegExp(PATCH_MARKER));
  assert.match(once, /Game\s+DotaModdingCommunityMods/);
  assert.match(once, /Mod\s+DotaModdingCommunityMods/);
  assert.ok(once.indexOf('Game\t\tDotaModdingCommunityMods') < once.indexOf('Game dota'), 'special Game path must precede the base dota search path');
  assert.ok(once.indexOf('Mod\t\tDotaModdingCommunityMods') < once.indexOf('Game dota'), 'special Mod path must precede the base dota search path');
  const legacyOrder = 'FileSystem { SearchPaths { Game dota_mods\nGame dota\n// Patched by DotaModdingCommunity Patcher\nGame DotaModdingCommunityMods\nMod DotaModdingCommunityMods } }';
  const reordered = ensurePatchSearchPath(legacyOrder);
  assert.ok(reordered.indexOf('Game\t\tDotaModdingCommunityMods') < reordered.indexOf('Game dota_mods'));
  assert.equal(reordered.match(/Game\s+DotaModdingCommunityMods/g)?.length, 1);
  assert.equal(ensurePatchSearchPath(reordered), reordered);
  const signatures = appendSignature('original\n', Buffer.from(once));
  assert.equal(signatures.split('\n').at(-2), signatureLine(Buffer.from(once)));
  assert.equal(signaturesMatch(signatures, Buffer.from(once)), true);
  assert.equal(signaturesMatch(signatures, Buffer.from(`${once}\n`)), false);
});

test('items_game replacements are exact and reject missing base item IDs', () => {
  const base = makeBaseItemsGame();
  const result = replaceItemEntries(base, new Map([['555', { id: '555', content: weatherText }]]));
  assert.match(result, /Default Weather/);
  assert.doesNotMatch(result, /Original Weather/);
  assert.throws(() => replaceItemEntries(base, new Map([['999', { id: '999', content: '"999" { "name" "missing" }' }]])), /does not contain required item 999/);
});

test('special patches install/update/remove transactionally, combine weather and towers, detect game updates, and persist status', async (t) => {
  const fixture = await createFixture(t);
  const { service, storage, pak01, gameinfo, signatures, gamePath, dataRoot, progress } = fixture;

  await service.install(mods[0]);
  assert.equal(storage.state.installedMods['weather-test'].specialPatchState, 'updated');
  assert.equal(storage.state.installedMods['weather-test'].requiresPatchUpdate, false);
  assert.equal((await service.inspect(mods[0], storage.state.installedMods['weather-test'])).status, 'updated');

  await service.install(mods[1]);
  assert.ok(storage.state.installedMods['weather-test']);
  assert.ok(storage.state.installedMods['tower-test']);
  const patchReader = VpkReader.open(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk'));
  try {
    const items = patchReader.readFile('scripts/items/items_game.txt').toString('utf8');
    assert.match(items, /Default Weather/);
    assert.match(items, /Default Radiant Towers/);
    assert.match(items, /Default Dire Towers/);
  } finally { patchReader.close(); }

  const reopenedStorage = new JsonStorage(dataRoot);
  await reopenedStorage.init();
  assert.equal(reopenedStorage.state.installedMods['tower-test'].specialPatchState, 'updated');

  const appManifest = path.join(path.dirname(path.dirname(path.dirname(gamePath))), 'appmanifest_570.acf');
  await fs.writeFile(appManifest, '"AppState" { "buildid" "101" }');
  await writeBaseVpk(pak01, makeBaseItemsGame('base-two'));
  const stale = await service.inspect(mods[1], storage.state.installedMods['tower-test']);
  assert.equal(stale.status, 'update_required');
  assert.equal(stale.requiresPatchUpdate, true);

  await service.update(mods[0]);
  assert.equal(storage.state.installedMods['weather-test'].specialPatchState, 'updated');
  assert.equal(storage.state.installedMods['tower-test'].specialPatchState, 'updated');
  assert.equal((await service.inspect(mods[1], storage.state.installedMods['tower-test'])).status, 'updated');

  await service.remove('weather-test');
  assert.equal(storage.state.installedMods['weather-test'], undefined);
  assert.ok(storage.state.installedMods['tower-test']);
  const afterWeatherRemoval = VpkReader.open(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk'));
  try { assert.doesNotMatch(afterWeatherRemoval.readFile('scripts/items/items_game.txt').toString('utf8'), /Default Weather/); }
  finally { afterWeatherRemoval.close(); }

  await service.remove('tower-test');
  assert.deepEqual(storage.state.installedMods, {});
  assert.equal(await fs.readFile(gameinfo, 'utf8'), 'FileSystem\n{\n\tSearchPaths\n\t{\n\t\tGame\t\tdota\n\t}\n}\n');
  assert.equal(await fs.readFile(signatures, 'utf8'), 'original signature data\n');
  await assert.rejects(fs.access(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk')), { code: 'ENOENT' });
  assert.ok(progress.some((event) => event.state === 'completed' && event.operation === 'special-patch'));
});

test('special patch failures are explicit, preserve game files, and running Dota blocks writes', async (t) => {
  const fixture = await createFixture(t);
  const { service, storage, gameinfo, signatures, definitions } = fixture;
  await service.install(mods[0]);
  const oldGameinfo = await fs.readFile(gameinfo);
  const oldSignatures = await fs.readFile(signatures);

  definitions.set('https://patch.test/Snow.txt', `${weatherText}// tampered\n`);
  await assert.rejects(service.update(mods[0]), /Integrity check failed/);
  assert.equal(storage.state.installedMods['weather-test'].specialPatchState, 'error');
  assert.equal(storage.state.installedMods['weather-test'].requiresPatchUpdate, true);
  assert.deepEqual(await fs.readFile(gameinfo), oldGameinfo);
  assert.deepEqual(await fs.readFile(signatures), oldSignatures);

  definitions.set('https://patch.test/Snow.txt', weatherText);
  service.processRunning = async () => true;
  await assert.rejects(service.update(mods[0]), /Close Dota 2/);
  assert.deepEqual(await fs.readFile(gameinfo), oldGameinfo);
  assert.deepEqual(await fs.readFile(signatures), oldSignatures);
});
