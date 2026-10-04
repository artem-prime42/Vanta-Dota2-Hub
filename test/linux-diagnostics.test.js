const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { VpkWriter } = require('vpk-tools');
const { SpecialPatchService, appendSignature, ensurePatchSearchPath } = require('../src/application/special-patch-service');
const { collectLinuxDiagnostic, compareDotaInstallations, inspectLinuxProcesses } = require('../src/infrastructure/linux-diagnostics');
const { detectDotaInstallation } = require('../src/infrastructure/steam-detector');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

async function createFakeProcProcess(procRoot, pid, { comm, executable, cwd, commandLine = [], mountNamespace = 'mnt:[100]', cgroup = '0::/user.slice', flatpakId = null, flatpakRoot = false }) {
  const base = path.join(procRoot, String(pid));
  await fs.mkdir(path.join(base, 'ns'), { recursive: true });
  const processRoot = path.join(base, 'process-root');
  await fs.mkdir(processRoot, { recursive: true });
  await fs.writeFile(path.join(base, 'comm'), `${comm}\n`);
  await fs.writeFile(path.join(base, 'cmdline'), Buffer.from([...(commandLine.length ? commandLine : [executable]), ''].join('\0')));
  await fs.writeFile(path.join(base, 'cgroup'), `${cgroup}\n`);
  await fs.writeFile(path.join(base, 'environ'), flatpakId ? `FLATPAK_ID=${flatpakId}\0` : '');
  await fs.symlink(executable, path.join(base, 'exe'));
  await fs.symlink(cwd, path.join(base, 'cwd'));
  await fs.symlink(mountNamespace, path.join(base, 'ns', 'mnt'));
  await fs.symlink(processRoot, path.join(base, 'root'));
  if (flatpakRoot) await fs.writeFile(path.join(processRoot, '.flatpak-info'), '[Application]\nname=com.valvesoftware.Steam\n');
}

async function createFakeProcRoot(root) {
  const procRoot = path.join(root, 'proc');
  await fs.mkdir(path.join(procRoot, 'self', 'ns'), { recursive: true });
  await fs.symlink('mnt:[100]', path.join(procRoot, 'self', 'ns', 'mnt'));
  return procRoot;
}

test('Linux diagnostic captures project-parser verification for primary Weather VPK and pak01 alias', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux-only report');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-linux-diagnostic-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const rootDir = path.join(temporary, 'userdata');
  const gameRoot = path.join(temporary, 'steamapps', 'common', 'dota 2 beta', 'game');
  const modDirectory = path.join(gameRoot, 'DotaModdingCommunityMods');
  const gameinfoPath = path.join(gameRoot, 'dota', 'gameinfo_branchspecific.gi');
  const signaturesPath = path.join(gameRoot, 'bin', 'linuxsteamrt64', 'dota.signatures');
  await fs.mkdir(path.dirname(gameinfoPath), { recursive: true });
  await fs.mkdir(path.dirname(signaturesPath), { recursive: true });
  await fs.mkdir(modDirectory, { recursive: true });
  const baseWriter = new VpkWriter();
  baseWriter.addFile('scripts/items/items_game.txt', Buffer.from('baseline items'));
  baseWriter.write(path.join(gameRoot, 'dota', 'pak01_dir.vpk'));

  const gameinfoBaseline = Buffer.from('"GameInfo"\n{\n\tFileSystem\n\t{\n\t\tSearchPaths\n\t\t{\n\t\t\tGame\tdota\n\t\t}\n\t}\n}\n');
  const gameinfoInstalled = Buffer.from(ensurePatchSearchPath(gameinfoBaseline.toString('utf8'), 'linux'));
  await fs.writeFile(gameinfoPath, gameinfoInstalled);
  const signaturesBaseline = Buffer.from('...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:VALVE;CRC:VALVE\nDIGEST:fixture\n');
  const signaturesInstalled = Buffer.from(appendSignature(signaturesBaseline.toString('utf8'), gameinfoInstalled, 'linux'));
  await fs.writeFile(signaturesPath, signaturesInstalled);

  const itemsGame = Buffer.from('"items_game" { "555" { "name" "Diagnostic Weather" } }\n');
  const writer = new VpkWriter();
  writer.addFile('scripts/items/items_game.txt', itemsGame);
  const primaryPath = path.join(modDirectory, 'pak01_dir.vpk');
  const aliasPath = path.join(modDirectory, 'pak01.vpk');
  writer.write(primaryPath);
  await fs.copyFile(primaryPath, aliasPath);
  await fs.writeFile(path.join(modDirectory, 'pak02_dir.vpk'), 'other pak inventory marker');
  await fs.writeFile(path.join(modDirectory, 'console.log'), 'ERROR: failed to open pak01.vpk\nMarkContentCorrupt: /home/private-user/example\n');
  await fs.mkdir(path.join(gameRoot, 'dota_mods'), { recursive: true });
  await fs.writeFile(path.join(gameRoot, 'dota_mods', 'pak99_dir.vpk'), 'legacy pack inventory marker');

  const storage = { state: { installedMods: { weather: { id: 'weather', modType: 'special_patch', specialType: 'weather', currentVersion: 'local-test', specialPatchState: 'updated' } } } };
  const service = new SpecialPatchService({ rootDir, storage, getGamePath: () => gameRoot, getMods: () => [], platform: 'linux', processRunning: async () => false });
  const paths = service.getDotaPaths();
  const backupDirectory = await service.getBackupDirectory(gameRoot);
  const backupGameinfo = path.join(backupDirectory, 'gameinfo_branchspecific.gi');
  const backupSignatures = service.getSignatureBackupPath(backupDirectory, signaturesPath);
  await fs.writeFile(backupGameinfo, gameinfoBaseline);
  await fs.writeFile(backupSignatures, signaturesBaseline);
  const originalSignaturesHash = sha256(signaturesBaseline);
  await service.writeJson(service.manifestPath, {
    gamePath: gameRoot,
    platform: 'linux',
    originalGameinfoHash: sha256(gameinfoBaseline),
    originalSignaturesHash,
    gameinfoHash: sha256(gameinfoInstalled),
    signaturesHash: sha256(signaturesInstalled),
    modVpkHash: sha256(await fs.readFile(primaryPath)),
    signaturesRelativePath: path.relative(gameRoot, signaturesPath),
  });

  const report = await collectLinuxDiagnostic({
    service,
    appVersion: '2.0.12',
    steamRootsOverride: [],
    runningSteamClientsOverride: [],
    processDiagnosticsOverride: {
      available: true,
      runningDotaDetected: 'NO',
      runningDotaProcesses: [],
      runningSteamProcesses: [],
      primaryDota: null,
      associatedSteam: null,
      runningDotaExecutable: 'UNKNOWN',
      runningDotaWorkingDirectory: 'UNKNOWN',
      runningDotaCommandLine: 'UNKNOWN',
      runningDotaPathNormalized: 'UNKNOWN',
      runningDotaSteamLibrary: 'UNKNOWN',
      steamType: 'UNKNOWN',
      steamPath: 'UNKNOWN',
      steamLibrary: 'UNKNOWN',
      sandboxContext: 'UNKNOWN',
      multipleDotaInstallationsRunning: false,
      vantaMountNamespace: 'mnt:[100]',
      inaccessibleProcessCount: 0,
    },
  });
  const { weatherTowersVpk, gameinfoValidation, signaturesValidation } = report.game;
  assert.equal(report.vantaVersion, '2.0.12');
  assert.equal(report.runningDotaDetected, 'NO');
  assert.equal(report.runningDotaExecutable, 'UNKNOWN');
  assert.equal(report.runningDotaPathNormalized, 'UNKNOWN');
  assert.equal(report.sameDotaInstallation, 'UNKNOWN');
  assert.equal(report.runtime.steamPath, 'UNKNOWN');
  assert.equal(report.runtime.steamLibrary, 'UNKNOWN');
  assert.equal(weatherTowersVpk.primaryVpk.readableByProjectParser, true);
  assert.equal(weatherTowersVpk.linuxAliasVpk.readableByProjectParser, true);
  assert.equal(weatherTowersVpk.primaryAndAliasSha256Match, true);
  assert.equal(weatherTowersVpk.primaryVpk.entryCount, 1);
  assert.equal(weatherTowersVpk.linuxAliasVpk.entries[0].path, 'scripts/items/items_game.txt');
  assert.equal(weatherTowersVpk.primaryVpk.entries[0].crcMatches, true);
  assert.equal(weatherTowersVpk.primaryVpk.entries[0].repeatedReadMatches, true);
  assert.equal(weatherTowersVpk.primaryVpk.verification.ok, true);
  assert.ok(report.game.files.vpkDirectoryFiles.some(({ name }) => name === 'pak02_dir.vpk'));
  assert.ok(report.game.files.baseDotaVpkFiles.some(({ name }) => name === 'pak01_dir.vpk'));
  assert.ok(report.game.files.legacyDotaModsVpkFiles.some(({ name }) => name === 'pak99_dir.vpk'));
  assert.equal(gameinfoValidation.baseline.matchesManifestOriginalHash, true);
  assert.equal(gameinfoValidation.current.matchesManifestInstalledHash, true);
  assert.equal(gameinfoValidation.current.searchPaths.modMountPresent, true);
  assert.equal(gameinfoValidation.current.searchPaths.absoluteSearchPaths.length, 0);
  assert.equal(signaturesValidation.preDigestRecordsPreserved, true);
  assert.equal(signaturesValidation.baseline.expectedHashMatches, true);
  assert.equal(signaturesValidation.current.signatureMatchesExactGameinfo, true);
  assert.equal(signaturesValidation.current.postDigestVantaBranchRecordCount, 1);
  const consoleLog = report.logs.inventory.find((entry) => entry.kind === 'dota-console' && entry.absolutePath.endsWith('DotaModdingCommunityMods/console.log'));
  assert.ok(consoleLog);
  assert.equal(consoleLog.signalCounts.find((entry) => entry.name === 'vpk_read_or_crc_error').count, 1);
  assert.equal(consoleLog.signalCounts.find((entry) => entry.name === 'content_marked_corrupt').count, 1);
  assert.equal(JSON.stringify(report).includes(os.homedir()), false, 'home path must be normalized before sharing');
  assert.doesNotMatch(JSON.stringify(report), /private-user|MarkContentCorrupt/);
  assert.equal(paths.modVpk, primaryPath);
});

test('Linux process probe resolves the running Dota path through an external Steam library', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux-only /proc inspection');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-proc-native-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const procRoot = await createFakeProcRoot(temporary);
  const steamRoot = path.join(temporary, 'native-steam', 'Steam');
  const alternateLibrary = path.join(temporary, 'mnt', 'games', 'SteamLibrary');
  const gameRoot = path.join(alternateLibrary, 'steamapps', 'common', 'dota 2 beta', 'game');
  const executable = path.join(gameRoot, 'bin', 'linuxsteamrt64', 'dota2');
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.mkdir(path.join(gameRoot, 'dota'), { recursive: true });
  await fs.mkdir(path.join(steamRoot, 'ubuntu12_32'), { recursive: true });
  await fs.mkdir(path.join(steamRoot, 'steamapps'), { recursive: true });
  await fs.writeFile(executable, 'dota binary marker');
  await fs.writeFile(path.join(gameRoot, 'dota', 'pak01_dir.vpk'), 'base vpk marker');
  const steamExecutable = path.join(steamRoot, 'ubuntu12_32', 'steam');
  await fs.writeFile(steamExecutable, 'steam binary marker');
  await fs.writeFile(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders" { "1" { "path" "${alternateLibrary}" } }`);
  await createFakeProcProcess(procRoot, 2101, { comm: 'steam', executable: steamExecutable, cwd: steamRoot, commandLine: [steamExecutable] });
  await createFakeProcProcess(procRoot, 2102, {
    comm: 'dota2',
    executable,
    cwd: gameRoot,
    commandLine: [executable, '-language', 'english'],
  });

  const runtime = await inspectLinuxProcesses({ procRoot, steamRootCandidates: [steamRoot], home: temporary });
  assert.equal(runtime.runningDotaDetected, 'YES');
  assert.equal(runtime.primaryDota.pid, 2102);
  assert.equal(runtime.primaryDota.gameRootNormalized, gameRoot);
  assert.equal(runtime.runningDotaPathNormalized, gameRoot);
  assert.equal(runtime.steamType, 'native');
  assert.equal(runtime.associatedSteam?.steamPathNormalized, steamRoot);
  assert.equal(runtime.steamLibrary, alternateLibrary);
  assert.equal(runtime.primaryDota.sameMountNamespaceAsVanta, true);
  assert.equal(runtime.sandboxContext, 'host-or-runtime-not-identifiable');
  assert.match(runtime.runningDotaCommandLine, /-language english/);
  assert.equal(runtime.runningDotaProcesses.length, 1);
});

test('Linux process probe classifies Flatpak from process evidence and redacts identifiers', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux-only /proc inspection');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-proc-flatpak-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const procRoot = await createFakeProcRoot(temporary);
  const steamRoot = path.join(temporary, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam');
  const library = path.join(temporary, 'separate-library');
  const gameRoot = path.join(library, 'steamapps', 'common', 'dota 2 beta', 'game');
  const executable = path.join(gameRoot, 'bin', 'linuxsteamrt64', 'dota2');
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.mkdir(path.join(gameRoot, 'dota'), { recursive: true });
  await fs.mkdir(path.join(steamRoot, 'ubuntu12_32'), { recursive: true });
  await fs.mkdir(path.join(steamRoot, 'steamapps'), { recursive: true });
  await fs.writeFile(executable, 'dota binary marker');
  await fs.writeFile(path.join(gameRoot, 'dota', 'pak01_dir.vpk'), 'base vpk marker');
  const steamExecutable = path.join(steamRoot, 'ubuntu12_32', 'steam');
  await fs.writeFile(steamExecutable, 'steam binary marker');
  await fs.writeFile(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders" { "1" { "path" "${library}" } }`);
  await createFakeProcProcess(procRoot, 3101, {
    comm: 'steam',
    executable: steamExecutable,
    cwd: steamRoot,
    commandLine: [steamExecutable],
    flatpakId: 'com.valvesoftware.Steam',
    flatpakRoot: true,
    cgroup: '0::/app.slice/app-flatpak-com.valvesoftware.Steam.scope',
  });
  await createFakeProcProcess(procRoot, 3102, {
    comm: 'dota2',
    executable,
    cwd: gameRoot,
    commandLine: [executable, '-steamid', '76561198012345678'],
    cgroup: '0::/app.slice/app-flatpak-com.valvesoftware.Steam.scope/pressure-vessel',
    mountNamespace: 'mnt:[200]',
  });

  const runtime = await inspectLinuxProcesses({ procRoot, steamRootCandidates: [steamRoot], home: temporary });
  assert.equal(runtime.runningDotaDetected, 'YES');
  assert.equal(runtime.steamType, 'flatpak');
  assert.equal(runtime.associatedSteam?.steamPathNormalized, steamRoot);
  assert.equal(runtime.sandboxContext, 'pressure-vessel');
  assert.equal(runtime.primaryDota.sameMountNamespaceAsVanta, false);
  assert.doesNotMatch(runtime.runningDotaCommandLine, /76561198012345678/);
  assert.match(runtime.runningDotaCommandLine, /<steam-id>/);
});

test('Linux process probe reports UNKNOWN path when Dota is absent and detects split installations', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux-only /proc inspection');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-proc-unknown-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const procRoot = await createFakeProcRoot(temporary);
  const empty = await inspectLinuxProcesses({ procRoot, home: temporary });
  assert.equal(empty.runningDotaDetected, 'NO');
  assert.equal(empty.runningDotaExecutable, 'UNKNOWN');
  assert.equal(empty.runningDotaPathNormalized, 'UNKNOWN');

  const firstRoot = path.join(temporary, 'library-a', 'steamapps', 'common', 'dota 2 beta', 'game');
  const secondRoot = path.join(temporary, 'library-b', 'steamapps', 'common', 'dota 2 beta', 'game');
  for (const [pid, gameRoot] of [[4101, firstRoot], [4102, secondRoot]]) {
    const executable = path.join(gameRoot, 'bin', 'linuxsteamrt64', 'dota2');
    await fs.mkdir(path.dirname(executable), { recursive: true });
    await fs.mkdir(path.join(gameRoot, 'dota'), { recursive: true });
    await fs.writeFile(executable, 'dota');
    await fs.writeFile(path.join(gameRoot, 'dota', 'pak01_dir.vpk'), 'base');
    await createFakeProcProcess(procRoot, pid, { comm: 'dota2', executable, cwd: gameRoot });
  }
  const multiple = await inspectLinuxProcesses({ procRoot, home: temporary });
  assert.equal(multiple.runningDotaDetected, 'YES');
  assert.equal(multiple.multipleDotaInstallationsRunning, true);
  assert.equal(multiple.runningDotaPathNormalized, 'UNKNOWN', 'do not pick an arbitrary live Dota process');
  assert.equal(compareDotaInstallations('/games/a/game', '/games/a/game'), 'YES');
  assert.equal(compareDotaInstallations('/games/a/game', '/mnt/b/game'), 'NO');
  assert.equal(compareDotaInstallations('/games/a/game', 'UNKNOWN'), 'UNKNOWN');
});

test('Steam auto-detection picks the first installed library rather than the active Steam instance', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'vanta-multiple-steam-libraries-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const nativeLibrary = path.join(temporary, 'native', 'steamapps', 'common', 'dota 2 beta', 'game');
  const flatpakLibrary = path.join(temporary, 'flatpak', 'steamapps', 'common', 'dota 2 beta', 'game');
  for (const gameRoot of [nativeLibrary, flatpakLibrary]) {
    await fs.mkdir(path.join(gameRoot, 'dota'), { recursive: true });
    await fs.writeFile(path.join(gameRoot, 'dota', 'pak01_dir.vpk'), 'base');
  }
  const detected = await detectDotaInstallation({ libraries: [path.dirname(path.dirname(path.dirname(path.dirname(nativeLibrary)))), path.dirname(path.dirname(path.dirname(path.dirname(flatpakLibrary))))] });
  assert.equal(detected.gamePath, nativeLibrary);
  assert.notEqual(detected.gamePath, flatpakLibrary);
});
