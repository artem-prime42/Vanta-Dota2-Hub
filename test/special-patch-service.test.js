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
  buildPlatformSearchPaths,
  ensurePatchSearchPath,
  extractItemBlock,
  findMatchingBrace,
  hasPatchSearchPath,
  hasPatchSignature,
  gitBlobHash,
  isSignaturePathSupported,
  replaceItemEntries,
  signatureLine,
  signaturesMatch,
} = require('../src/application/special-patch-service');

const weatherText = '"555"\n{\n\t"name"\t"Default Weather"\n\t"prefab"\t"weather"\n}\n';
const radiantText = '"677"\n{\n\t"name"\t"Default Radiant Towers"\n\t"prefab"\t"radianttowers"\n}\n';
const direText = '"678"\n{\n\t"name"\t"Default Dire Towers"\n\t"prefab"\t"diretowers"\n}\n';
const WINDOWS_GAMEINFO_BASELINE = [
  '"GameInfo"',
  '{',
  '\tgame\t"Dota 2"',
  '\tFileSystem',
  '\t{',
  '\t\tSteamAppId\t570',
  '\t\t// Search paths are relative to the exe directory\\..\\',
  '\t}',
  '}',
  '',
].join('\r\n');
const WINDOWS_SIGNATURES_BASELINE = [
  '...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:224B6F879D00D419B6A10FE07B4DDB3D827FD31F;CRC:7B89F784',
  '...\\..\\..\\bin\\win64\\dota2.exe~SHA1:0123456789ABCDEF0123456789ABCDEF01234567;CRC:89ABCDEF',
  `DIGEST:${'A'.repeat(128)}`,
  '',
].join('\r\n');
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

function normalizedPathForComparison(value, platform = process.platform) {
  const normalized = String(value).replace(/\\/g, '/');
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function samePathForPlatform(left, right, platform = process.platform) {
  return normalizedPathForComparison(path.resolve(left), platform)
    === normalizedPathForComparison(path.resolve(right), platform);
}

function makeBaseItemsGame(revision = 'base-one') {
  return `"items"\n{\n\t"store_currency_pricepoints"\n\t{\n\t\t"1" "${revision}"\n\t}\n\t"555" { "name" "Original Weather" }\n\t"677" { "name" "Original Radiant" }\n\t"678" { "name" "Original Dire" }\n}\n`;
}

async function writeBaseVpk(filePath, text) {
  const writer = new VpkWriter();
  writer.addFile('scripts/items/items_game.txt', Buffer.from(text, 'utf8'));
  writer.write(filePath);
}

async function createFixture(t, { platform = process.platform, gameinfoText = 'FileSystem\n{\n\tSearchPaths\n\t{\n\t\tGame\t\tdota\n\t}\n}\n', onDiagnostics = () => {} } = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-special-patch-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const dataRoot = path.join(temporary, 'vanta-data');
  const gamePath = path.join(temporary, 'steamapps', 'common', 'dota 2 beta', 'game');
  const dotaPath = path.join(gamePath, 'dota');
  const binPath = path.join(gamePath, 'bin', 'linuxsteamrt64');
  const windowsBinPath = path.join(gamePath, 'bin', 'win64');
  await fs.mkdir(dotaPath, { recursive: true });
  await fs.mkdir(binPath, { recursive: true });
  await fs.mkdir(windowsBinPath, { recursive: true });
  await fs.mkdir(path.dirname(path.dirname(path.dirname(gamePath))), { recursive: true });
  await fs.writeFile(path.join(path.dirname(path.dirname(path.dirname(gamePath))), 'appmanifest_570.acf'), '"AppState" { "buildid" "100" }');
  const pak01 = path.join(dotaPath, 'pak01_dir.vpk');
  await writeBaseVpk(pak01, makeBaseItemsGame());
  const gameinfo = path.join(dotaPath, 'gameinfo_branchspecific.gi');
  await fs.writeFile(gameinfo, gameinfoText);
  const signatures = path.join(binPath, 'dota.signatures');
  const windowsSignatures = path.join(windowsBinPath, 'dota.signatures');
  await fs.writeFile(signatures, 'original signature data\n');
  await fs.writeFile(windowsSignatures, WINDOWS_SIGNATURES_BASELINE);
  const storage = new JsonStorage(dataRoot);
  await storage.init();
  const definitions = new Map([['https://patch.test/Snow.txt', weatherText], ['https://patch.test/Towers_Radiant.txt', radiantText], ['https://patch.test/Towers_Dire.txt', direText]]);
  const progress = [];
  const service = new SpecialPatchService({
    rootDir: dataRoot,
    storage,
    getGamePath: () => gamePath,
    getMods: () => mods,
    platform,
    processRunning: async () => false,
    onDiagnostics,
    fetchImpl: async (url) => definitions.has(url)
      ? new Response(definitions.get(url), { status: 200 })
      : new Response('', { status: 404 }),
    onProgress: (event) => progress.push(event),
  });
  await service.init();
  return { dataRoot, gamePath, dotaPath, pak01, gameinfo, signatures, windowsSignatures, storage, service, progress, definitions };
}

test('special patch state refresh is rate-limited to avoid repeated file hashing', async (t) => {
  const fixture = await createFixture(t);
  const { service } = fixture;

  await service.install(mods[0]);
  let inspectCalls = 0;
  const originalInspect = service.inspect.bind(service);
  service.inspect = async (...args) => {
    inspectCalls += 1;
    return originalInspect(...args);
  };

  await service.refreshStates();
  const afterFirstRefresh = inspectCalls;
  await service.refreshStates();
  assert.equal(inspectCalls, afterFirstRefresh, 'repeat refreshes within the cache window should not re-read game files');

  await new Promise((resolve) => setTimeout(resolve, 3100));
  await service.refreshStates();
  assert.ok(inspectCalls > afterFirstRefresh, 'after the cache expires, refresh should read files again');
});

test('Patcher-compatible helpers inject idempotent search paths and match signature hashes', () => {
  assert.equal(signatureLine(Buffer.from('abc')), '...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:A9993E364706816ABA3E25717850C26C9CD0D89D;CRC:C2412435', 'SHA-1 and little-endian CRC32 must match Python hashlib/zlib/struct output');
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
  const crlfWithoutSearchPaths = '"GameInfo"\r\n{\r\n\tFileSystem\r\n\t{\r\n\t\tSteamAppId\t570\r\n\t\tBreakpadAppId\t373300\r\n\t}\r\n}\r\n';
  const crlfPatched = ensurePatchSearchPath(crlfWithoutSearchPaths);
  assert.doesNotMatch(crlfPatched.replace(/\r\n/g, ''), /\n/);
  assert.equal(ensurePatchSearchPath(crlfPatched), crlfPatched);
  assert.match(crlfPatched, /Game\s+DotaModdingCommunityMods[\s\S]*Game\s+dota[\s\S]*Game\s+core/);
  assert.match(crlfPatched, /Mod\s+DotaModdingCommunityMods[\s\S]*Mod\s+dota/);
  assert.match(crlfPatched, /Write\s+dota[\s\S]*AddonRoot_Language[\s\S]*AddonRoot\s+dota_addons[\s\S]*PublicContent\s+dota_core[\s\S]*PublicContent\s+core/);
  assert.equal(crlfPatched.match(/SearchPaths/g)?.length, 1);
  assert.equal(crlfPatched.match(/Game\s+DotaModdingCommunityMods/g)?.length, 1);
  assert.equal(crlfPatched.match(/Mod\s+DotaModdingCommunityMods/g)?.length, 1);
  const signatures = appendSignature('original\n', Buffer.from(once));
  assert.equal(signatures.split('\n').at(-2), signatureLine(Buffer.from(once)));
  assert.equal(signaturesMatch(signatures, Buffer.from(once)), true);
  assert.equal(signaturesMatch(signatures, Buffer.from(`${once}\n`)), false);
  const windowsSignatures = appendSignature('DIGEST:original\r\n', Buffer.from(once), 'win32');
  assert.ok(windowsSignatures.includes('\r\n'), 'Windows signature databases should retain Windows CRLF line endings');
  assert.doesNotMatch(windowsSignatures.replace(/\r\n/g, ''), /\n/);
});

test('Windows signatures preserve Valve records before DIGEST and replace only VANTA records after it', () => {
  const patchedGameinfo = Buffer.from(ensurePatchSearchPath(WINDOWS_GAMEINFO_BASELINE, 'win32'));
  const vanillaLines = WINDOWS_SIGNATURES_BASELINE.split('\r\n').slice(0, 3);
  const staleVantaLine = '...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;CRC:FFFFFFFF';
  const source = `${WINDOWS_SIGNATURES_BASELINE}${staleVantaLine}\r\n`;
  const once = appendSignature(source, patchedGameinfo, 'win32');
  const twice = appendSignature(once, patchedGameinfo, 'win32');
  const lines = twice.split('\r\n');
  const digestIndex = lines.findIndex((line) => line.startsWith('DIGEST:'));
  const branchSignatureLines = lines.filter((line) => line.startsWith('...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:'));

  assert.deepEqual(lines.slice(0, digestIndex + 1), vanillaLines, 'all Valve-signed records and DIGEST must remain byte-for-byte in the same order');
  assert.equal(branchSignatureLines.length, 2, 'retain Valve’s pre-DIGEST record and exactly one VANTA post-DIGEST record');
  assert.equal(branchSignatureLines[0], vanillaLines[0]);
  assert.equal(branchSignatureLines[1], signatureLine(patchedGameinfo));
  assert.equal(lines.filter((line, index) => index > digestIndex && line === signatureLine(patchedGameinfo)).length, 1);
  assert.equal(hasPatchSignature(WINDOWS_SIGNATURES_BASELINE, patchedGameinfo.toString()), false, 'Valve’s pre-DIGEST hash is not a VANTA patch record');
  assert.equal(hasPatchSignature(source, patchedGameinfo.toString()), true, 'a VANTA-owned post-DIGEST record is recognized even if its hash is stale');
  assert.equal(hasPatchSignature(twice, patchedGameinfo.toString()), true, 'the exact VANTA record after DIGEST is recognized');
  assert.doesNotMatch(twice, /SHA1:FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;CRC:FFFFFFFF/);
  assert.equal(twice, once, 'reapplying the same patch signature is idempotent');
});

test('Windows and Linux use upstream Source 2 relative mounts without cross-platform absolute paths', () => {
  const windowsPaths = buildPlatformSearchPaths('win32');
  const linuxPaths = buildPlatformSearchPaths('linux');
  assert.deepEqual(windowsPaths, linuxPaths, 'h6rd/Patcher uses the same relative Source 2 mount names on both clients');
  const gameinfoPaths = windowsPaths.join('\n');
  assert.match(gameinfoPaths, /Game_Language\s+dota_\*LANGUAGE\*/);
  assert.match(gameinfoPaths, /Game_LowViolence\s+dota_lv/);
  assert.match(gameinfoPaths, /Game\s+DotaModdingCommunityMods[\s\S]*Game\s+dota[\s\S]*Game\s+core/);
  assert.match(gameinfoPaths, /Mod\s+DotaModdingCommunityMods[\s\S]*Mod\s+dota/);
  assert.doesNotMatch(gameinfoPaths, /linuxsteamrt64|\/home\/|\/bin\/|[A-Z]:\\/i);
  assert.equal(isSignaturePathSupported('win32', 'bin/win64/dota.signatures'), true);
  assert.equal(isSignaturePathSupported('win32', 'bin/linuxsteamrt64/dota.signatures'), false);
  assert.equal(isSignaturePathSupported('linux', 'bin/linuxsteamrt64/dota.signatures'), true);
});

test('Windows Weather install builds valid gameinfo, VPK, and matching win64 signatures', async (t) => {
  const fixture = await createFixture(t, { platform: 'win32', gameinfoText: WINDOWS_GAMEINFO_BASELINE });
  const { service, gameinfo, signatures, windowsSignatures, gamePath } = fixture;
  // The service canonicalizes its root; Windows realpath can normalize drive/path casing.
  const paths = service.getDotaPaths();
  assert.equal(normalizedPathForComparison(path.relative(paths.root, paths.gameinfo), service.platform), 'dota/gameinfo_branchspecific.gi');
  assert.equal(normalizedPathForComparison(path.relative(paths.root, paths.modVpk), service.platform), 'dotamoddingcommunitymods/pak01_dir.vpk');
  assert.equal(normalizedPathForComparison(path.relative(paths.root, windowsSignatures), service.platform), 'bin/win64/dota.signatures');
  const originalWindowsSignatures = await fs.readFile(windowsSignatures);
  const originalLinuxSignatures = await fs.readFile(signatures);

  await service.install(mods[0]);

  const gameinfoBytes = await fs.readFile(gameinfo);
  const patchedText = gameinfoBytes.toString('utf8');
  const fileSystemOpen = patchedText.indexOf('{', patchedText.indexOf('FileSystem'));
  const fileSystemClose = findMatchingBrace(patchedText, fileSystemOpen);
  const searchPathsOpen = patchedText.indexOf('{', patchedText.indexOf('SearchPaths'));
  const searchPathsClose = findMatchingBrace(patchedText, searchPathsOpen);
  assert.ok(fileSystemOpen >= 0 && fileSystemClose > fileSystemOpen, 'FileSystem block must remain balanced');
  assert.ok(searchPathsOpen > fileSystemOpen && searchPathsClose < fileSystemClose, 'SearchPaths must be nested inside FileSystem');
  assert.match(patchedText, /Game\s+DotaModdingCommunityMods/);
  assert.match(patchedText, /Mod\s+DotaModdingCommunityMods/);
  assert.match(patchedText, /Game_Language\s+dota_\*LANGUAGE\*[\s\S]*Game_LowViolence\s+dota_lv[\s\S]*Game\s+DotaModdingCommunityMods/);
  assert.doesNotMatch(patchedText, /linuxsteamrt64|\/home\/|\/usr\/|\/bin\//i);

  const manifest = await service.readSpecialManifest();
  assert.equal(manifest.platform, 'win32');
  assert.equal(manifest.signaturesRelativePath.replace(/\\/g, '/'), 'bin/win64/dota.signatures');
  const windowsSignatureText = await fs.readFile(windowsSignatures, 'utf8');
  assert.match(windowsSignatureText, /\r\n/);
  assert.doesNotMatch(windowsSignatureText.replace(/\r\n/g, ''), /\n/);
  assert.ok(signaturesMatch(windowsSignatureText, gameinfoBytes), 'signature digest must match the exact written gameinfo bytes');
  assert.notDeepEqual(await fs.readFile(windowsSignatures), originalWindowsSignatures);
  assert.deepEqual(await fs.readFile(signatures), originalLinuxSignatures, 'Windows install must not write the Linux signature database');

  const vpkPath = path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk');
  const unexpectedRuntimeAlias = path.join(gamePath, 'DotaModdingCommunityMods', 'pak01.vpk');
  assert.equal(await service.exists(unexpectedRuntimeAlias), false, 'Windows layout must not contain the Linux-only pak01.vpk alias');
  const reader = VpkReader.open(vpkPath);
  try {
    assert.deepEqual(reader.files(), ['scripts/items/items_game.txt']);
    const patchedItems = reader.readFile('scripts/items/items_game.txt').toString('utf8');
    assert.match(patchedItems, /Default Weather/);
    assert.doesNotMatch(patchedItems, /[A-Z]:\\|\/home\/|linuxsteamrt64/i);
    assert.equal((await reader.verify()).issues.length, 0);
  } finally { reader.close(); }
});

test('Windows Weather and Towers combine, reinstall idempotently, diagnose files, and restore exact baselines', async (t) => {
  const diagnostics = [];
  const fixture = await createFixture(t, { platform: 'win32', gameinfoText: WINDOWS_GAMEINFO_BASELINE, onDiagnostics: (entry) => diagnostics.push(entry) });
  const { service, gameinfo, windowsSignatures, gamePath } = fixture;
  const baselineGameinfo = await fs.readFile(gameinfo);
  const baselineSignatures = await fs.readFile(windowsSignatures);
  await service.install(mods[0]);
  await service.install(mods[1]);
  const combinedVpkPath = path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk');
  const combinedVpk = await fs.readFile(combinedVpkPath);
  const combinedGameinfo = await fs.readFile(gameinfo);
  const combinedSignatures = await fs.readFile(windowsSignatures, 'utf8');
  const combinedSignatureLines = combinedSignatures.split(/\r?\n/);
  const combinedDigestIndex = combinedSignatureLines.findIndex((line) => line.startsWith('DIGEST:'));
  assert.equal(combinedSignatureLines.slice(0, combinedDigestIndex).filter((line) => line.startsWith('...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:')).length, 1, 'Valve’s original branch hash remains before DIGEST');
  assert.equal(combinedSignatureLines.slice(combinedDigestIndex + 1).filter((line) => line.startsWith('...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:')).length, 1, 'exactly one VANTA branch hash is appended after DIGEST');
  assert.ok(signaturesMatch(combinedSignatures, combinedGameinfo));

  await service.install(mods[0]);
  assert.deepEqual(await fs.readFile(combinedVpkPath), combinedVpk, 'reinstall must not duplicate or alter an unchanged combined override');
  assert.deepEqual(await fs.readFile(gameinfo), combinedGameinfo, 'reinstall must not duplicate gameinfo search paths');
  const repeatedSignatures = await fs.readFile(windowsSignatures, 'utf8');
  const repeatedSignatureLines = repeatedSignatures.split(/\r?\n/);
  const repeatedDigestIndex = repeatedSignatureLines.findIndex((line) => line.startsWith('DIGEST:'));
  assert.equal(repeatedSignatureLines.slice(0, repeatedDigestIndex).filter((line) => line.startsWith('...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:')).length, 1);
  assert.equal(repeatedSignatureLines.slice(repeatedDigestIndex + 1).filter((line) => line.startsWith('...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:')).length, 1);
  assert.equal(await service.exists(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01.vpk')), false);

  let reader = VpkReader.open(combinedVpkPath);
  try {
    const combinedItems = reader.readFile('scripts/items/items_game.txt').toString('utf8');
    assert.match(combinedItems, /Default Weather/);
    assert.match(combinedItems, /Default Radiant Towers/);
    assert.match(combinedItems, /Default Dire Towers/);
  } finally { reader.close(); }

  await service.remove(mods[0].id);
  reader = VpkReader.open(combinedVpkPath);
  try {
    const towersOnly = reader.readFile('scripts/items/items_game.txt').toString('utf8');
    assert.doesNotMatch(towersOnly, /Default Weather/);
    assert.match(towersOnly, /Default Radiant Towers/);
    assert.match(towersOnly, /Default Dire Towers/);
  } finally { reader.close(); }

  await service.remove(mods[1].id);
  assert.deepEqual(await fs.readFile(gameinfo), baselineGameinfo);
  assert.deepEqual(await fs.readFile(windowsSignatures), baselineSignatures);
  assert.deepEqual((await fs.readdir(path.join(gamePath, 'DotaModdingCommunityMods'))).filter((name) => /^pak01(?:_dir)?\.vpk$/i.test(name)), []);

  const writeDiagnostics = diagnostics.filter((entry) => ['pre-write', 'installed'].includes(entry.stage));
  assert.ok(writeDiagnostics.length >= 6, 'each Windows patch write should emit pre-write and installed diagnostics');
  assert.ok(writeDiagnostics.every((entry) => entry.platform === 'Windows'));
  assert.ok(writeDiagnostics.some((entry) => entry.gameinfo?.endsWith(path.join('dota', 'gameinfo_branchspecific.gi'))));
  assert.ok(writeDiagnostics.some((entry) => entry.signatures?.endsWith(path.join('win64', 'dota.signatures'))));
  assert.ok(writeDiagnostics.some((entry) => entry.stage === 'installed' && entry.vpkFiles.length === 1 && entry.vpkFiles[0] === 'pak01_dir.vpk'));
  assert.ok(writeDiagnostics.every((entry) => entry.backupState?.gameinfoExists && entry.backupState?.signaturesExists));
});

test('Linux runtime compatibility writes the pak01.vpk alias alongside the upstream pack name', async (t) => {
  const fixture = await createFixture(t, { platform: 'linux', gameinfoText: 'FileSystem\n{\n\tSearchPaths\n\t{\n\t\tGame\t\tdota\n\t}\n}\n' });
  const { service, gamePath } = fixture;

  await service.install(mods[0]);

  const primary = path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk');
  const alias = path.join(gamePath, 'DotaModdingCommunityMods', 'pak01.vpk');
  assert.equal(await service.exists(primary), true, 'upstream override VPK should still be created');
  assert.equal(await service.exists(alias), true, 'Linux runtime mount path should also receive the pak01.vpk alias');

  const reader = VpkReader.open(alias);
  try {
    assert.deepEqual(reader.files(), ['scripts/items/items_game.txt']);
    assert.match(reader.readFile('scripts/items/items_game.txt').toString('utf8'), /Default Weather/);
  } finally { reader.close(); }
});

test('Linux install and repeat install preserve pre-DIGEST Valve signatures and uninstall restores both baselines', async (t) => {
  const fixture = await createFixture(t, { platform: 'linux', gameinfoText: WINDOWS_GAMEINFO_BASELINE });
  const { service, gamePath, gameinfo, signatures } = fixture;
  await fs.writeFile(signatures, WINDOWS_SIGNATURES_BASELINE);
  const baselineGameinfo = await fs.readFile(gameinfo);
  const baselineSignatures = await fs.readFile(signatures);

  await service.install(mods[0]);
  const primary = path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk');
  const alias = path.join(gamePath, 'DotaModdingCommunityMods', 'pak01.vpk');
  const firstPrimary = await fs.readFile(primary);
  const firstAlias = await fs.readFile(alias);
  const firstSignatures = await fs.readFile(signatures);
  const lines = firstSignatures.toString('utf8').split('\r\n');
  const digestIndex = lines.findIndex((line) => line.startsWith('DIGEST:'));
  assert.deepEqual(lines.slice(0, digestIndex + 1), baselineSignatures.toString('utf8').split('\r\n').slice(0, digestIndex + 1));
  assert.equal(lines.slice(digestIndex + 1).filter((line) => line.startsWith('...\\..\\..\\dota\\gameinfo_branchspecific.gi~')).length, 1);
  assert.deepEqual(firstAlias, firstPrimary);

  const backupDirectory = await service.getBackupDirectory(gamePath);
  assert.deepEqual(await fs.readFile(path.join(backupDirectory, 'gameinfo_branchspecific.gi')), baselineGameinfo);
  assert.deepEqual(await fs.readFile(await service.findSignatureBackup(backupDirectory, signatures)), baselineSignatures);

  await service.install(mods[0]);
  assert.deepEqual(await fs.readFile(primary), firstPrimary);
  assert.deepEqual(await fs.readFile(alias), firstAlias);
  assert.deepEqual(await fs.readFile(signatures), firstSignatures);

  await service.remove(mods[0].id);
  assert.deepEqual(await fs.readFile(gameinfo), baselineGameinfo);
  assert.deepEqual(await fs.readFile(signatures), baselineSignatures);
  assert.equal(await service.exists(primary), false);
  assert.equal(await service.exists(alias), false);
});

test('Linux uninstall with corrupted backups strips only VANTA edits and preserves Valve signature records', async (t) => {
  const fixture = await createFixture(t, { platform: 'linux', gameinfoText: WINDOWS_GAMEINFO_BASELINE });
  const { service, gamePath, gameinfo, signatures } = fixture;
  await fs.writeFile(signatures, WINDOWS_SIGNATURES_BASELINE);
  const baselineSignatures = await fs.readFile(signatures, 'utf8');
  await service.install(mods[0]);
  const backupDirectory = await service.getBackupDirectory(gamePath);
  const backupSignatures = await service.findSignatureBackup(backupDirectory, signatures);
  await fs.writeFile(path.join(backupDirectory, 'gameinfo_branchspecific.gi'), 'corrupted gameinfo backup');
  await fs.writeFile(backupSignatures, 'corrupted signatures backup');

  await service.remove(mods[0].id);

  const restoredGameinfo = await fs.readFile(gameinfo, 'utf8');
  const restoredSignatures = await fs.readFile(signatures, 'utf8');
  assert.doesNotMatch(restoredGameinfo, /DotaModdingCommunityMods|Patched by DotaModdingCommunity Patcher/);
  const expectedPrefix = baselineSignatures.split('\r\n');
  const actualLines = restoredSignatures.split(/\r?\n/);
  const expectedDigestIndex = expectedPrefix.findIndex((line) => line.startsWith('DIGEST:'));
  const actualDigestIndex = actualLines.findIndex((line) => line.startsWith('DIGEST:'));
  assert.deepEqual(actualLines.slice(0, actualDigestIndex + 1), expectedPrefix.slice(0, expectedDigestIndex + 1));
  assert.equal(actualLines.slice(actualDigestIndex + 1).filter((line) => line.startsWith('...\\..\\..\\dota\\gameinfo_branchspecific.gi~')).length, 0);
  assert.equal(await service.exists(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01.vpk')), false);
  assert.equal(await service.exists(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk')), false);
});

test('Windows refuses to fall back to a Linux-only signatures database', async (t) => {
  const fixture = await createFixture(t, { platform: 'win32', gameinfoText: WINDOWS_GAMEINFO_BASELINE });
  const { service, gameinfo, signatures, windowsSignatures, gamePath } = fixture;
  const originalGameinfo = await fs.readFile(gameinfo);
  const originalLinuxSignatures = await fs.readFile(signatures);
  await fs.rm(windowsSignatures);

  await assert.rejects(service.install(mods[0]), /dota\.signatures was not found in either supported platform folder/);

  assert.deepEqual(await fs.readFile(gameinfo), originalGameinfo);
  assert.deepEqual(await fs.readFile(signatures), originalLinuxSignatures);
  assert.equal(await service.exists(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk')), false);
});

test('Windows Weather remove restores baseline gameinfo and win64 signatures and removes override VPK', async (t) => {
  const fixture = await createFixture(t, { platform: 'win32', gameinfoText: WINDOWS_GAMEINFO_BASELINE });
  const { service, gameinfo, windowsSignatures, gamePath } = fixture;
  const originalSignatures = await fs.readFile(windowsSignatures);

  await service.install(mods[0]);
  await service.remove(mods[0].id);

  assert.deepEqual(await fs.readFile(gameinfo), Buffer.from(WINDOWS_GAMEINFO_BASELINE));
  assert.deepEqual(await fs.readFile(windowsSignatures), originalSignatures);
  assert.equal(await service.exists(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk')), false);
  assert.equal(await service.exists(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01.vpk')), false);
});

test('Windows Weather rollback restores exact game files and leaves no VPK aliases after a signature write failure', async (t) => {
  const fixture = await createFixture(t, { platform: 'win32', gameinfoText: WINDOWS_GAMEINFO_BASELINE });
  const { service, storage, gameinfo, windowsSignatures, signatures, gamePath } = fixture;
  const paths = service.getDotaPaths();
  // Intercept the exact canonical target the service will pass to atomicWrite().
  const targetSignatures = await service.findSignaturesPath(paths);
  const originalGameinfo = await fs.readFile(gameinfo);
  const originalWindowsSignatures = await fs.readFile(windowsSignatures);
  const originalLinuxSignatures = await fs.readFile(signatures);
  const originalAtomicWrite = service.atomicWrite.bind(service);
  let failedOnce = false;
  service.atomicWrite = async (filePath, data) => {
    if (samePathForPlatform(filePath, targetSignatures, service.platform) && !failedOnce) {
      failedOnce = true;
      const error = new Error('injected Windows signature write failure');
      error.code = 'EIO';
      throw error;
    }
    return originalAtomicWrite(filePath, data);
  };

  await assert.rejects(service.install(mods[0]), /injected Windows signature write failure/);
  assert.equal(failedOnce, true);
  assert.deepEqual(storage.state.installedMods, {});
  assert.deepEqual(await fs.readFile(gameinfo), originalGameinfo);
  assert.deepEqual(await fs.readFile(windowsSignatures), originalWindowsSignatures);
  assert.deepEqual(await fs.readFile(signatures), originalLinuxSignatures);
  await assert.rejects(fs.access(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01.vpk')), { code: 'ENOENT' });
});

test('Windows Weather items_game decoding matches Patcher UTF-8 errors=ignore behavior', async (t) => {
  const fixture = await createFixture(t, { platform: 'win32', gameinfoText: WINDOWS_GAMEINFO_BASELINE });
  const { service, pak01, gamePath } = fixture;
  const invalidBytes = Buffer.from([0xc3, 0x28, 0xef, 0xbf, 0xbd]);
  const baseItems = Buffer.concat([Buffer.from(makeBaseItemsGame(), 'utf8'), invalidBytes]);
  const writer = new VpkWriter();
  writer.addFile('scripts/items/items_game.txt', baseItems);
  writer.write(pak01);

  await service.install(mods[0]);

  const reader = VpkReader.open(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk'));
  try {
    const output = reader.readFile('scripts/items/items_game.txt').toString('utf8');
    assert.match(output, /\(\uFFFD$/u, 'valid UTF-8 replacement characters survive while malformed bytes are ignored');
    assert.doesNotMatch(output, /\uFFFD\uFFFD/u, 'invalid UTF-8 must not become an extra replacement character');
  } finally { reader.close(); }
});

test('Windows Weather update atomically replaces definition and keeps baseline backups', async (t) => {
  const fixture = await createFixture(t, { platform: 'win32', gameinfoText: WINDOWS_GAMEINFO_BASELINE });
  const { service, gameinfo, windowsSignatures, gamePath, definitions } = fixture;
  const firstSignatures = await fs.readFile(windowsSignatures);
  await service.install(mods[0]);
  const installedSignatures = await fs.readFile(windowsSignatures);
  assert.notDeepEqual(installedSignatures, firstSignatures);

  const updatedWeatherText = '"555"\n{\n\t"name"\t"Updated Default Weather"\n\t"prefab"\t"weather"\n}\n';
  const updatedMod = {
    ...mods[0],
    version: 'patch-r2',
    currentVersion: 'patch-r2',
    requiredFiles: [{ itemId: '555', fileName: 'Snow-v2.txt', url: 'https://patch.test/Snow-v2.txt', gitBlobSha: gitBlobHash(updatedWeatherText) }],
  };
  definitions.set('https://patch.test/Snow-v2.txt', updatedWeatherText);
  service.getMods = () => [updatedMod, mods[1]];

  await service.update(updatedMod);

  const reader = VpkReader.open(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk'));
  try {
    const patchedItems = reader.readFile('scripts/items/items_game.txt').toString('utf8');
    assert.match(patchedItems, /Updated Default Weather/);
    assert.doesNotMatch(patchedItems, /\t"name"\t"Default Weather"/);
  } finally { reader.close(); }
  assert.deepEqual(await fs.readFile(path.join(await service.getBackupDirectory(gamePath), 'gameinfo_branchspecific.gi')), Buffer.from(WINDOWS_GAMEINFO_BASELINE));
  assert.deepEqual(await fs.readFile(await service.findSignatureBackup(await service.getBackupDirectory(gamePath), windowsSignatures)), firstSignatures);
  assert.ok(signaturesMatch(await fs.readFile(windowsSignatures, 'utf8'), await fs.readFile(gameinfo)));
  assert.equal((await service.readSpecialManifest()).platform, 'win32');
});

test('Weather update reuses its clean backup when Steam resolves the game through a different symlink alias', async (t) => {
  if (process.platform === 'win32') return t.skip('Directory symlink creation requires elevated privileges on Windows runners.');
  const fixture = await createFixture(t, { gameinfoText: WINDOWS_GAMEINFO_BASELINE });
  const { service, gamePath } = fixture;
  await service.install(mods[0]);
  const originalBackupDirectory = await service.getBackupDirectory(gamePath);
  const backupGameinfoPath = path.join(originalBackupDirectory, 'gameinfo_branchspecific.gi');
  const originalBackupBytes = await fs.readFile(backupGameinfoPath);
  const aliasPath = path.join(path.dirname(gamePath), 'dota-game-alias');
  await fs.symlink(gamePath, aliasPath, 'dir');
  service.getGamePath = () => aliasPath;
  const updatedWeather = { ...mods[0], version: 'patch-r2', currentVersion: 'patch-r2' };

  await service.update(updatedWeather);

  const manifest = await service.readSpecialManifest();
  assert.equal(manifest.gamePath, await fs.realpath(gamePath), 'new metadata should store a stable canonical game path');
  assert.deepEqual(await fs.readFile(backupGameinfoPath), originalBackupBytes, 'the original clean backup must remain unchanged');
  assert.equal(await service.inspect(updatedWeather, service.storage.state.installedMods[updatedWeather.id]).then((state) => state.status), 'updated');
});

test('items_game replacements are exact and reject missing base item IDs', () => {
  const base = makeBaseItemsGame();
  const result = replaceItemEntries(base, new Map([['555', { id: '555', content: weatherText }]]));
  assert.match(result, /Default Weather/);
  assert.doesNotMatch(result, /Original Weather/);
  assert.throws(() => replaceItemEntries(base, new Map([['999', { id: '999', content: '"999" { "name" "missing" }' }]])), /does not contain required item 999/);
});

test('definition indentation matches Patcher space-to-tab normalization', () => {
  const definition = extractItemBlock('"555"\n{\n            "baseitem"\t"1"\n        "visuals"\n        {\n        }\n}\n');
  assert.equal(definition.id, '555');
  assert.equal(definition.content, '"555"\n{\n\t\t\t"baseitem"\t"1"\n\t\t"visuals"\n\t\t{\n\t\t}\n}');
});

test('stale patch backups are rebuilt from the current clean Dota files instead of aborting install', async (t) => {
  const fixture = await createFixture(t, { platform: 'linux' });
  const { service, storage, gameinfo, signatures, gamePath } = fixture;
  const cleanGameinfo = await fs.readFile(gameinfo);
  const cleanSignatureDatabase = Buffer.from(appendSignature('original signature data\n', cleanGameinfo));
  await fs.writeFile(signatures, cleanSignatureDatabase);
  const backupDirectory = await service.getBackupDirectory(gamePath);
  const backupGameinfo = path.join(backupDirectory, 'gameinfo_branchspecific.gi');
  const backupSignatures = await service.findSignatureBackup(backupDirectory, signatures);
  const stalePatchedGameinfo = ensurePatchSearchPath(cleanGameinfo.toString('utf8'));
  await fs.writeFile(backupGameinfo, stalePatchedGameinfo);
  await fs.writeFile(backupSignatures, appendSignature('stale backup signature\n', Buffer.from(stalePatchedGameinfo)));

  await service.install(mods[0]);

  assert.equal(await service.exists(backupGameinfo), true);
  assert.equal(hasPatchSearchPath(await fs.readFile(backupGameinfo, 'utf8')), false);
  assert.equal(hasPatchSignature(await fs.readFile(backupSignatures, 'utf8')), false);
  assert.deepEqual(await fs.readFile(backupSignatures), cleanSignatureDatabase);
  assert.equal(storage.state.installedMods['weather-test'].specialPatchState, 'updated');
});

test('uninstall clears stale library records after Steam verification without restoring stale backups', async (t) => {
  const fixture = await createFixture(t);
  const { service, storage, gameinfo, signatures, gamePath } = fixture;
  const cleanGameinfo = await fs.readFile(gameinfo);
  const cleanSignatures = Buffer.from(appendSignature('stock signature data\n', cleanGameinfo));

  await service.install(mods[0]);
  await fs.writeFile(gameinfo, cleanGameinfo);
  await fs.writeFile(signatures, cleanSignatures);
  await fs.rm(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk'), { force: true });
  const backupDirectory = await service.getBackupDirectory(gamePath);
  await fs.writeFile(path.join(backupDirectory, 'gameinfo_branchspecific.gi'), 'invalid stale backup');
  await fs.writeFile(await service.findSignatureBackup(backupDirectory, signatures), 'invalid stale signature backup');

  await service.remove('weather-test');

  assert.deepEqual(storage.state.installedMods, {});
  assert.deepEqual(await fs.readFile(gameinfo), cleanGameinfo);
  assert.deepEqual(await fs.readFile(signatures), cleanSignatures);
});

test('Linux patching prefers Linux signatures and falls back to an existing Windows signatures file', async (t) => {
  const fixture = await createFixture(t, { platform: 'linux' });
  const { service, storage, signatures, windowsSignatures } = fixture;
  await service.install(mods[0]);
  assert.equal((await service.readSpecialManifest()).signaturesRelativePath, path.join('bin', 'linuxsteamrt64', 'dota.signatures'));
  await service.remove('weather-test');

  await fs.rm(signatures);
  const originalWindowsSignatures = await fs.readFile(windowsSignatures);

  await service.install(mods[0]);

  assert.equal(storage.state.installedMods['weather-test'].specialPatchState, 'updated');
  assert.equal((await service.readSpecialManifest()).signaturesRelativePath, path.join('bin', 'win64', 'dota.signatures'));
  assert.notDeepEqual(await fs.readFile(windowsSignatures), originalWindowsSignatures);
});

test('patch install fails safely when neither platform has a signatures database', async (t) => {
  const fixture = await createFixture(t, { platform: 'linux' });
  const { service, storage, gameinfo, signatures, windowsSignatures, gamePath } = fixture;
  const originalGameinfo = await fs.readFile(gameinfo);
  await fs.rm(signatures);
  await fs.rm(windowsSignatures);

  await assert.rejects(service.install(mods[0]), /dota\.signatures was not found in either supported platform folder/);

  assert.deepEqual(storage.state.installedMods, {});
  assert.deepEqual(await fs.readFile(gameinfo), originalGameinfo);
  assert.equal(await service.exists(signatures), false);
  assert.equal(await service.exists(windowsSignatures), false);
  assert.equal(await service.exists(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk')), false);
});

test('removing one cross-platform patch preserves the other using an existing signature fallback', async (t) => {
  const fixture = await createFixture(t, { platform: 'win32' });
  const { service, storage, gameinfo, signatures, windowsSignatures, gamePath } = fixture;
  const originalGameinfo = await fs.readFile(gameinfo);
  const originalWindowsSignatures = await fs.readFile(windowsSignatures);
  await service.install(mods[0]);
  await service.install(mods[1]);
  service.platform = 'linux';
  await fs.rm(signatures);

  await service.remove('weather-test');

  assert.equal(storage.state.installedMods['weather-test'], undefined);
  assert.equal(storage.state.installedMods['tower-test'].specialPatchState, 'updated');
  assert.notDeepEqual(await fs.readFile(gameinfo), originalGameinfo);
  assert.notDeepEqual(await fs.readFile(windowsSignatures), originalWindowsSignatures);
  assert.equal((await service.readSpecialManifest()).signaturesRelativePath, path.join('bin', 'win64', 'dota.signatures'));
  assert.equal(await service.exists(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk')), true);
});

test('Windows special patches update win64 signatures and restore the matching backup', async (t) => {
  const fixture = await createFixture(t, { platform: 'win32' });
  const { service, signatures, windowsSignatures, gamePath } = fixture;
  const originalLinuxSignatures = await fs.readFile(signatures);
  await fs.writeFile(windowsSignatures, 'DIGEST: original Windows signature data\r\n');
  const originalWindowsSignaturesWithCrlf = await fs.readFile(windowsSignatures);

  await service.install(mods[0]);
  const manifest = await service.readSpecialManifest();
  assert.equal(manifest.signaturesRelativePath, path.join('bin', 'win64', 'dota.signatures'));
  assert.deepEqual(await fs.readFile(signatures), originalLinuxSignatures);
  assert.notDeepEqual(await fs.readFile(windowsSignatures), originalWindowsSignaturesWithCrlf);
  assert.match((await fs.readFile(windowsSignatures, 'utf8')), /\r\n/);
  assert.doesNotMatch((await fs.readFile(windowsSignatures, 'utf8')).replace(/\r\n/g, ''), /\n/);
  assert.equal((await service.inspect(mods[0], service.storage.state.installedMods['weather-test'])).status, 'updated');

  await service.remove('weather-test');
  assert.deepEqual(await fs.readFile(signatures), originalLinuxSignatures);
  assert.deepEqual(await fs.readFile(windowsSignatures), originalWindowsSignaturesWithCrlf);
  assert.equal(await service.exists(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk')), false);
});

test('Switching a special patch to Windows restores the previously patched Linux signature file', async (t) => {
  const fixture = await createFixture(t, { platform: 'linux' });
  const { service, signatures, windowsSignatures } = fixture;
  const originalLinuxSignatures = await fs.readFile(signatures);
  const originalWindowsSignatures = await fs.readFile(windowsSignatures);

  await service.install(mods[0]);
  assert.notDeepEqual(await fs.readFile(signatures), originalLinuxSignatures);
  service.platform = 'win32';
  await service.update(mods[0]);

  assert.deepEqual(await fs.readFile(signatures), originalLinuxSignatures);
  assert.notDeepEqual(await fs.readFile(windowsSignatures), originalWindowsSignatures);
  assert.equal((await service.readSpecialManifest()).signaturesRelativePath, path.join('bin', 'win64', 'dota.signatures'));

  await service.remove('weather-test');
  assert.deepEqual(await fs.readFile(signatures), originalLinuxSignatures);
  assert.deepEqual(await fs.readFile(windowsSignatures), originalWindowsSignatures);
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

test('missing gameinfo is rejected before update and uninstall restores missing patch-owned files', async (t) => {
  const fixture = await createFixture(t);
  const { service, gameinfo, signatures, gamePath } = fixture;
  const originalGameinfo = await fs.readFile(gameinfo);
  const originalSignatures = await fs.readFile(signatures);

  await service.install(mods[0]);
  await fs.rm(gameinfo);
  const patchedSignatures = await fs.readFile(signatures);
  await assert.rejects(service.update(mods[0]), /missing its gameinfo file/);
  assert.deepEqual(await fs.readFile(signatures), patchedSignatures);

  await service.remove('weather-test');
  assert.deepEqual(await fs.readFile(gameinfo), originalGameinfo);
  assert.deepEqual(await fs.readFile(signatures), originalSignatures);
  await assert.rejects(fs.access(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk')), { code: 'ENOENT' });
});

test('startup recovery restores persisted installed state after a crash during finalization', async (t) => {
  const fixture = await createFixture(t);
  const { service, storage, gameinfo, gamePath, dataRoot } = fixture;
  await service.install(mods[0]);
  const paths = service.getDotaPaths();
  const installedBefore = JSON.parse(JSON.stringify(storage.state.installedMods));
  await service.recordTransaction([paths.modVpk, paths.gameinfo, await service.findSignaturesPath(paths), service.manifestPath]);
  await fs.writeFile(gameinfo, 'interrupted write');
  await fs.rm(paths.modVpk, { force: true });
  await storage.patch({ installedMods: {} });

  const restarted = new SpecialPatchService({
    rootDir: dataRoot,
    storage,
    getGamePath: () => gamePath,
    getMods: () => mods,
    platform: process.platform,
    processRunning: async () => false,
  });
  await restarted.init();

  assert.deepEqual(storage.state.installedMods, installedBefore);
  assert.match(await fs.readFile(gameinfo, 'utf8'), new RegExp(PATCH_MARKER));
  assert.equal(await restarted.exists(paths.modVpk), true);
  assert.equal(await restarted.exists(service.journalPath), false);
});

test('uninstall recovers a missing override VPK and a lost manifest from persisted patch metadata', async (t) => {
  const fixture = await createFixture(t);
  const { service, storage, gameinfo, signatures, gamePath } = fixture;
  const originalGameinfo = await fs.readFile(gameinfo);
  const originalSignatures = await fs.readFile(signatures);

  await service.install(mods[0]);
  await fs.rm(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk'));
  await fs.rm(service.manifestPath);
  await service.remove('weather-test');

  assert.deepEqual(storage.state.installedMods, {});
  assert.deepEqual(await fs.readFile(gameinfo), originalGameinfo);
  assert.deepEqual(await fs.readFile(signatures), originalSignatures);
});

test('uninstall removes exact VANTA edits when original backups are corrupted', async (t) => {
  const fixture = await createFixture(t, { platform: 'win32', gameinfoText: WINDOWS_GAMEINFO_BASELINE });
  const { service, storage, gameinfo, windowsSignatures, gamePath } = fixture;
  await service.install(mods[0]);
  const paths = service.getDotaPaths();
  const backupSignatures = await service.findSignatureBackup(await service.getBackupDirectory(paths.root), windowsSignatures);
  const backupDirectory = await service.getBackupDirectory(paths.root);
  await fs.writeFile(path.join(backupDirectory, 'gameinfo_branchspecific.gi'), 'corrupted backup');
  await fs.writeFile(backupSignatures, 'corrupted signature backup');

  await service.remove('weather-test');

  assert.deepEqual(storage.state.installedMods, {});
  assert.doesNotMatch(await fs.readFile(gameinfo, 'utf8'), /DotaModdingCommunityMods|Patched by DotaModdingCommunity Patcher/);
  const restoredSignatures = (await fs.readFile(windowsSignatures, 'utf8')).split(/\r?\n/);
  const digestIndex = restoredSignatures.findIndex((line) => line.startsWith('DIGEST:'));
  assert.equal(restoredSignatures.slice(0, digestIndex).filter((line) => line.startsWith('...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:')).length, 1, 'Valve’s baseline branch hash is retained');
  assert.equal(restoredSignatures.slice(digestIndex + 1).filter((line) => line.startsWith('...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:')).length, 0, 'VANTA’s post-DIGEST branch hash is removed');
  await assert.rejects(fs.access(paths.modVpk), { code: 'ENOENT' });
});

test('a signatures write failure rolls back the earlier VPK and gameinfo writes', async (t) => {
  const fixture = await createFixture(t, { platform: 'linux' });
  const { service, storage, gameinfo, signatures, gamePath } = fixture;
  const paths = service.getDotaPaths();
  // Use the service-resolved target rather than the fixture's original path spelling.
  const targetSignatures = await service.findSignaturesPath(paths);
  const originalGameinfo = await fs.readFile(gameinfo);
  const originalSignatures = await fs.readFile(signatures);
  const originalAtomicWrite = service.atomicWrite.bind(service);
  let failedOnce = false;
  service.atomicWrite = async (filePath, data) => {
    if (samePathForPlatform(filePath, targetSignatures, service.platform) && !failedOnce) {
      failedOnce = true;
      const error = new Error('injected signatures write failure');
      error.code = 'EIO';
      throw error;
    }
    return originalAtomicWrite(filePath, data);
  };

  await assert.rejects(service.install(mods[0]), /injected signatures write failure/);
  assert.equal(failedOnce, true);
  assert.deepEqual(storage.state.installedMods, {});
  assert.deepEqual(await fs.readFile(gameinfo), originalGameinfo);
  assert.deepEqual(await fs.readFile(signatures), originalSignatures);
  await assert.rejects(fs.access(path.join(gamePath, 'DotaModdingCommunityMods', 'pak01_dir.vpk')), { code: 'ENOENT' });
});

test('separate VANTA service instances cannot patch the same game concurrently', async (t) => {
  const fixture = await createFixture(t);
  const { service, storage, dataRoot, gamePath } = fixture;
  const second = new SpecialPatchService({
    rootDir: dataRoot,
    storage,
    getGamePath: () => gamePath,
    getMods: () => mods,
    processRunning: async () => false,
  });
  await second.init();
  let entered;
  const enteredLock = new Promise((resolve) => { entered = resolve; });
  let resume;
  const waitForRelease = new Promise((resolve) => { resume = resolve; });
  const firstOperation = service.withLock(async () => { entered(); await waitForRelease; });
  await enteredLock;
  await assert.rejects(second.withLock(async () => {}), /Another VANTA instance/);
  resume();
  await firstOperation;
});
