const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { VpkReader } = require('vpk-tools');
const { discoverSteamRoots, parseLibraryPaths } = require('./hero-grid-installer');
const { findKeyBlock, hasPatchSearchPath, hasPatchSignature, signatureLine, signaturesMatch } = require('../application/special-patch-service');

const VPK_NAME = /^pak\d+(?:_dir|_\d+)?\.vpk$/i;
const REDACTED_HOME = '~';

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function displayPath(filePath) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  const home = path.resolve(os.homedir());
  if (resolved === home) return REDACTED_HOME;
  if (resolved.startsWith(`${home}${path.sep}`)) return `${REDACTED_HOME}${resolved.slice(home.length)}`;
  return resolved;
}

function normalizeVpkHeader(buffer, reader) {
  return {
    rawHex: buffer.subarray(0, Math.min(reader.header.headerLength || 28, 32)).toString('hex'),
    signatureHex: buffer.subarray(0, 4).toString('hex'),
    signatureLittleEndian: buffer.length >= 4 ? buffer.readUInt32LE(0) : null,
    version: reader.header.version,
    headerLength: reader.header.headerLength,
    treeSize: reader.header.treeSize,
    fileDataSectionSize: reader.header.fileDataSectionSize,
    archiveMD5SectionSize: reader.header.archiveMD5SectionSize,
    otherMD5SectionSize: reader.header.otherMD5SectionSize,
    signatureSectionSize: reader.header.signatureSectionSize,
  };
}

async function fileMetadata(filePath, { includePath = true, includeHash = true, includeTextMetadata = true } = {}) {
  try {
    const [stat, lst] = await Promise.all([fs.stat(filePath), fs.lstat(filePath)]);
    const bytes = stat.isFile() && (includeHash || includeTextMetadata) ? await fs.readFile(filePath) : null;
    let symlinkTarget = null;
    if (lst.isSymbolicLink()) {
      const target = await fs.readlink(filePath);
      symlinkTarget = displayPath(path.isAbsolute(target) ? target : path.resolve(path.dirname(filePath), target));
    }
    return {
      ...(includePath ? { absolutePath: displayPath(filePath) } : {}),
      exists: true,
      type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
      sizeBytes: stat.isFile() ? stat.size : null,
      sha256: bytes && includeHash ? sha256(bytes) : null,
      mode: `0${(lst.mode & 0o7777).toString(8)}`,
      uid: stat.uid,
      gid: stat.gid,
      linkCount: stat.nlink,
      isSymlink: lst.isSymbolicLink(),
      symlinkTarget,
      isHardLinked: stat.nlink > 1,
      readable: await fs.access(filePath, fsSync.constants.R_OK).then(() => true, () => false),
      writable: await fs.access(filePath, fsSync.constants.W_OK).then(() => true, () => false),
      executable: await fs.access(filePath, fsSync.constants.X_OK).then(() => true, () => false),
      mtime: stat.mtime.toISOString(),
      ...(bytes && includeTextMetadata ? {
        byteOrderMarkUtf8: bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
        nulByteCount: bytes.reduce((count, value) => count + Number(value === 0), 0),
        lineEndings: {
          crlf: (bytes.toString('utf8').match(/\r\n/g) || []).length,
          lfOnly: (bytes.toString('utf8').match(/(?<!\r)\n/g) || []).length,
          crOnly: (bytes.toString('utf8').match(/\r(?!\n)/g) || []).length,
        },
      } : {}),
    };
  } catch (error) {
    return { ...(includePath ? { absolutePath: displayPath(filePath) } : {}), exists: false, error: error.code || error.message };
  }
}

async function inspectVpk(filePath) {
  const info = await fileMetadata(filePath, { includeTextMetadata: false });
  if (!info.exists) return { ...info, parser: 'vpk-tools', readableByProjectParser: false, entries: [], verification: null };
  let reader;
  try {
    const bytes = await fs.readFile(filePath);
    reader = VpkReader.open(filePath);
    const names = reader.files();
    const entries = [];
    for (const name of names) {
      const indexEntry = reader.get(name);
      const first = reader.readFile(name);
      const second = reader.readFile(name);
      const calculatedCrc32 = crc32(first);
      entries.push({
        path: name,
        sizeBytes: first.length,
        crc32Expected: Number(indexEntry.crc) >>> 0,
        crc32Actual: calculatedCrc32,
        crcMatches: (Number(indexEntry.crc) >>> 0) === calculatedCrc32,
        sha256: sha256(first),
        opened: true,
        repeatedReadMatches: first.equals(second),
        repeatedReadSha256: sha256(second),
        archiveIndex: indexEntry.archiveIndex,
        entryOffset: indexEntry.entryOffset,
        preloadBytes: indexEntry.preloadBytes,
      });
    }
    const verification = await reader.verify();
    return {
      ...info,
      parser: 'vpk-tools',
      readableByProjectParser: true,
      header: normalizeVpkHeader(bytes, reader),
      entryCount: names.length,
      entries,
      verification,
      allEntriesOpened: entries.every((entry) => entry.opened),
      allExpectedCrcsMatch: entries.every((entry) => entry.crcMatches),
      allRepeatedReadsMatch: entries.every((entry) => entry.repeatedReadMatches),
      readBackMatchesSourceFile: sha256(await fs.readFile(filePath)) === info.sha256,
    };
  } catch (error) {
    return { ...info, parser: 'vpk-tools', readableByProjectParser: false, parserError: error.message, entries: [], verification: null };
  } finally {
    reader?.close();
  }
}

function parseGameinfo(buffer, gameRoot) {
  const text = buffer.toString('utf8');
  const fileSystem = findKeyBlock(text, 'FileSystem');
  const searchPaths = fileSystem && findKeyBlock(text, 'SearchPaths', fileSystem.openIndex + 1, fileSystem.closeIndex);
  const block = searchPaths ? text.slice(searchPaths.openIndex + 1, searchPaths.closeIndex) : '';
  const entries = block.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('//')).map((line) => {
    const match = line.match(/^([^\s"]+)\s+(?:"([^"]*)"|([^\s]+))/);
    if (!match) return { kind: null, value: null, sourceLine: '<unparsed entry>', isAbsolutePath: false };
    const originalValue = match[2] ?? match[3];
    const isAbsolutePath = path.isAbsolute(originalValue) || /^[A-Za-z]:[\\/]/.test(originalValue);
    const value = path.isAbsolute(originalValue) ? displayPath(originalValue)
      : /^[A-Za-z]:[\\/]/.test(originalValue) ? `${originalValue.slice(0, 2)}\\<redacted>` : originalValue;
    const targetPath = !isAbsolutePath && !/[<>*?]/.test(originalValue) ? path.resolve(gameRoot, originalValue) : null;
    return { kind: match[1], value, sourceLine: `${match[1]}\t${value}`, isAbsolutePath, targetExists: targetPath ? fsSync.existsSync(targetPath) : null, resolvedRelativeTarget: targetPath ? displayPath(targetPath) : null };
  });
  const patchMounts = entries.filter((entry) => ['Game', 'Mod'].includes(entry.kind) && entry.value === 'DotaModdingCommunityMods');
  const normalizedMounts = entries.filter((entry) => ['Game', 'Mod'].includes(entry.kind)).map((entry) => `${entry.kind}\0${entry.value}`);
  const duplicates = normalizedMounts.filter((value, index) => normalizedMounts.indexOf(value) !== index);
  const invalidPaths = entries.filter((entry) => entry.isAbsolutePath);
  const mountDirectoryExists = fsSync.existsSync(path.join(gameRoot, 'DotaModdingCommunityMods'));
  const balanced = Boolean(fileSystem && searchPaths && findKeyBlock(text, 'GameInfo'));
  return {
    syntax: { balancedTopLevelAndFileSystem: balanced, fileSystemBlockFound: Boolean(fileSystem), searchPathsFound: Boolean(searchPaths) },
    encoding: { utf8ReplacementCharacterCount: (text.match(/\ufffd/g) || []).length, bom: buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) },
    nulBytes: [...buffer].filter((value) => value === 0).length,
    lineEndings: { crlf: (text.match(/\r\n/g) || []).length, lfOnly: (text.match(/(?<!\r)\n/g) || []).length, crOnly: (text.match(/\r(?!\n)/g) || []).length },
    searchPaths: {
      orderedEntries: entries,
      patchMounts,
      gameMountBeforeBaseDota: entries.findIndex((entry) => entry.kind === 'Game' && entry.value === 'DotaModdingCommunityMods') >= 0
        && entries.findIndex((entry) => entry.kind === 'Game' && entry.value === 'DotaModdingCommunityMods') < entries.findIndex((entry) => entry.kind === 'Game' && entry.value === 'dota'),
      modMountPresent: entries.some((entry) => entry.kind === 'Mod' && entry.value === 'DotaModdingCommunityMods'),
      duplicateSearchPaths: [...new Set(duplicates)].map((value) => value.split('\0')),
      absoluteSearchPaths: invalidPaths,
      mountDirectoryExists,
      mountPath: displayPath(path.join(gameRoot, 'DotaModdingCommunityMods')),
    },
    containsVantaPatchMarker: hasPatchSearchPath(text),
  };
}

function signatureSummary(buffer, gameinfoBuffer, expectedOriginalHash = null) {
  if (!buffer) return { exists: false };
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/);
  const digestIndex = lines.findIndex((line) => line.startsWith('DIGEST:'));
  const valveLines = digestIndex < 0 ? lines : lines.slice(0, digestIndex + 1);
  const vantaPostDigest = digestIndex < 0 ? [] : lines.slice(digestIndex + 1).filter((line) => line.startsWith('...\\..\\..\\dota\\gameinfo_branchspecific.gi~'));
  return {
    exists: true,
    sizeBytes: buffer.length,
    sha256: sha256(buffer),
    expectedHashMatches: expectedOriginalHash ? sha256(buffer) === expectedOriginalHash : null,
    digestIndex,
    digestPresent: digestIndex >= 0,
    valveRecordsBeforeDigestCount: digestIndex < 0 ? null : lines.slice(0, digestIndex).filter((line) => line.startsWith('...')).length,
    valveRecordsAndDigestSha256: sha256(Buffer.from(valveLines.join('\n'))),
    postDigestVantaBranchRecordCount: vantaPostDigest.length,
    postDigestVantaBranchRecordsMatchGameinfo: vantaPostDigest.some((line) => line === signatureLine(gameinfoBuffer)),
    patchSignatureRecognized: hasPatchSignature(text, gameinfoBuffer.toString('utf8')),
    signatureMatchesExactGameinfo: signaturesMatch(text, gameinfoBuffer),
    encoding: { utf8Bom: buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), nulBytes: [...buffer].filter((value) => value === 0).length },
    lineEndings: { crlf: (text.match(/\r\n/g) || []).length, lfOnly: (text.match(/(?<!\r)\n/g) || []).length, crOnly: (text.match(/\r(?!\n)/g) || []).length },
  };
}

function getFilesystemType(filePath) {
  try {
    const resolved = path.resolve(filePath);
    const mountLines = fsSync.readFileSync('/proc/self/mountinfo', 'utf8').split('\n');
    let best = null;
    for (const line of mountLines) {
      const separator = line.indexOf(' - ');
      if (separator < 0) continue;
      const left = line.slice(0, separator).split(' ');
      const right = line.slice(separator + 3).split(' ');
      const mountPoint = left[4]?.replace(/\\([0-7]{3})/g, (_m, octal) => String.fromCharCode(parseInt(octal, 8)));
      if (!mountPoint || !(resolved === mountPoint || resolved.startsWith(`${mountPoint.replace(/\/$/, '')}/`))) continue;
      if (!best || mountPoint.length > best.mountPoint.length) best = { mountPoint, type: right[0] };
    }
    return best ? { type: best.type, mountPoint: displayPath(best.mountPoint) } : { type: null, mountPoint: null };
  } catch { return { type: null, mountPoint: null }; }
}

async function detectRunningSteamClients() {
  const results = [];
  let procEntries;
  try { procEntries = await fs.readdir('/proc', { withFileTypes: true }); } catch { return results; }
  for (const entry of procEntries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    let command;
    try { command = (await fs.readFile(path.join('/proc', entry.name, 'cmdline'))).toString('utf8').replace(/\0/g, ' '); } catch { continue; }
    if (!/(?:^|[\s/])steam(?:webhelper|service|\.sh)?(?:$|[\s/])/i.test(command) && !/com\.valvesoftware\.Steam/i.test(command)) continue;
    const type = /com\.valvesoftware\.Steam|\.var\/app\/com\.valvesoftware\.Steam/i.test(command) ? 'flatpak' : /\.steam|\.local\/share\/Steam/i.test(command) ? 'native' : 'unknown';
    if (!results.some((item) => item.type === type)) results.push({ type });
  }
  return results;
}

function unknownPath() { return 'UNKNOWN'; }

function redactProcessArgument(value, home = os.homedir()) {
  let output = String(value || '').replaceAll(path.resolve(home), '~');
  output = output.replace(/\b\d{17}\b/g, '<steam-id>');
  const equalIndex = output.indexOf('=');
  const option = equalIndex >= 0 ? output.slice(0, equalIndex) : output;
  if (/(?:token|password|passwd|secret|authkey|credential)/i.test(option)) return `${option}=<redacted>`;
  return output.length > 500 ? `${output.slice(0, 497)}...` : output;
}

function classifySteamProcess({ args, executable, cgroup, flatpakId, rootIsFlatpak }) {
  const all = `${executable || ''} ${args.join(' ')} ${cgroup || ''}`;
  if (flatpakId === 'com.valvesoftware.Steam' || rootIsFlatpak || /(?:app-flatpak|flatpak).*com\.valvesoftware\.Steam/i.test(all)) return 'flatpak';
  if (/\/(?:\.steam|\.local\/share\/Steam)\//i.test(all) || /\/Steam\/ubuntu\d+_\d+\/steam/i.test(all)) return 'native';
  return 'UNKNOWN';
}

function isDotaProcess({ comm, args, executable }) {
  const executableName = path.basename(String(executable || '').replace(/ \(deleted\)$/, '')).toLowerCase();
  if (['dota2', 'dota2.exe'].includes(executableName) || /^dota2(?:\.exe)?$/i.test(comm)) return true;
  return args.some((argument) => /(?:^|\/)dota2(?:\.exe)?$/i.test(argument));
}

function isSteamProcess({ comm, args, executable, flatpakId }) {
  if (/steamwebhelper|steamservice/i.test(comm || '')) return false;
  const executableName = path.basename(String(executable || '')).replace(/ \(deleted\)$/, '');
  if (/^steam(?:\.sh)?$/i.test(comm || '') || /^steam(?:\.sh)?$/i.test(executableName)) return true;
  if (flatpakId === 'com.valvesoftware.Steam') return /^steam(?:\.sh)?$/i.test(comm || '');
  return args.some((argument) => /(?:^|\/)steam\.sh$/i.test(argument) || /\/Steam\/ubuntu\d+_\d+\/steam$/i.test(argument));
}

async function inferSteamRootFromCandidates(type, candidates) {
  const matches = [];
  for (const candidate of candidates) {
    const normalized = await fs.realpath(candidate).catch(() => path.resolve(candidate));
    const isFlatpakPath = /\/\.var\/app\/com\.valvesoftware\.Steam\//i.test(normalized);
    if ((type === 'flatpak') !== isFlatpakPath) continue;
    const executableCandidates = [
      path.join(normalized, 'ubuntu12_32', 'steam'),
      path.join(normalized, 'ubuntu12_64', 'steam'),
      path.join(normalized, 'steam.sh'),
    ];
    if ((await Promise.all(executableCandidates.map((value) => fs.access(value).then(() => true, () => false)))).some(Boolean)) matches.push(normalized);
  }
  const uniqueMatches = [...new Set(matches)];
  return uniqueMatches.length === 1 ? uniqueMatches[0] : null;
}

function isPathWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

async function steamLibrariesForRoot(root) {
  if (!root) return [];
  const libraries = [root];
  for (const file of ['libraryfolders.vdf', 'libraryfolders.vdf.bak']) {
    const text = await safeReadText(path.join(root, 'steamapps', file));
    if (text) libraries.push(...parseLibraryPaths(text));
  }
  const normalized = [];
  for (const library of libraries) normalized.push(await fs.realpath(library).catch(() => path.resolve(library)));
  return [...new Set(normalized)];
}

async function associateSteamProcess(steamProcesses, gameRoot, steamRootCandidates) {
  if (!gameRoot) return null;
  const matches = [];
  for (const steam of steamProcesses) {
    const root = steam.steamPathNormalized || await inferSteamRootFromCandidates(steam.type, steamRootCandidates);
    if (!root) continue;
    const libraries = await steamLibrariesForRoot(root);
    if (libraries.some((library) => isPathWithin(library, gameRoot))) matches.push({ ...steam, steamPathNormalized: root, steamPath: displayPath(root) });
  }
  const uniqueRuntimes = new Map();
  for (const process of matches) {
    const key = process.steamPathNormalized ? `${process.type}\0${process.steamPathNormalized}` : `pid:${process.pid}`;
    if (!uniqueRuntimes.has(key)) uniqueRuntimes.set(key, process);
  }
  return uniqueRuntimes.size === 1 ? uniqueRuntimes.values().next().value : null;
}

function uniqueSteamRuntime(processes) {
  const unique = new Map();
  for (const process of processes) {
    const key = process.steamPathNormalized ? `${process.type}\0${process.steamPathNormalized}` : `pid:${process.pid}`;
    if (!unique.has(key)) unique.set(key, process);
  }
  return [...unique.values()];
}

async function safeReadText(filePath) {
  try { return await fs.readFile(filePath, 'utf8'); } catch { return null; }
}

async function resolveGameRootFromProcessPath(value, pid, procRoot) {
  if (!value || value === 'UNKNOWN') return null;
  const cleaned = String(value).replace(/ \(deleted\)$/, '');
  const start = path.resolve(path.extname(cleaned) ? path.dirname(cleaned) : cleaned);
  let current = start;
  for (let depth = 0; depth < 18; depth += 1) {
    const marker = path.join(current, 'dota', 'pak01_dir.vpk');
    try {
      await fs.access(marker);
      return await fs.realpath(current).catch(() => current);
    } catch {}
    // A Flatpak/pressure-vessel process may see an absolute path through its own root.
    if (pid && path.isAbsolute(cleaned)) {
      const processRootCandidate = path.join(procRoot, String(pid), 'root', cleaned.replace(/^\/+/, ''), 'dota', 'pak01_dir.vpk');
      try {
        await fs.access(processRootCandidate);
        const processRoot = path.join(procRoot, String(pid), 'root', cleaned.replace(/^\/+/, ''));
        return await fs.realpath(processRoot).catch(() => cleaned);
      } catch {}
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function containingSteamLibrary(gameRoot) {
  if (!gameRoot) return null;
  let current = path.resolve(gameRoot);
  while (true) {
    if (path.basename(current).toLowerCase() === 'steamapps') return path.dirname(current);
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function compareDotaInstallations(vantaPath, runningPath) {
  if (!vantaPath || !runningPath || vantaPath === 'UNKNOWN' || runningPath === 'UNKNOWN') return 'UNKNOWN';
  return path.resolve(vantaPath) === path.resolve(runningPath) ? 'YES' : 'NO';
}

function steamInstallRootFromExecutable(executable, args) {
  const candidates = [executable, ...args].filter(Boolean);
  for (const candidate of candidates) {
    const normalized = String(candidate).replace(/ \(deleted\)$/, '');
    const ubuntuRuntime = normalized.match(/^(.*)\/ubuntu\d+_\d+\/steam(?:\.sh)?$/i);
    if (ubuntuRuntime) return ubuntuRuntime[1];
    const script = normalized.match(/^(.*)\/steam\.sh$/i);
    if (script) return script[1];
    const flatpakDataRoot = normalized.match(/^(.*\/\.var\/app\/com\.valvesoftware\.Steam(?:\/\.local\/share)?\/Steam)(?:\/|$)/i);
    if (flatpakDataRoot) return flatpakDataRoot[1];
  }
  return null;
}

async function inspectLinuxProcesses({ procRoot = '/proc', home = os.homedir(), steamRootCandidates = [] } = {}) {
  let entries;
  try { entries = await fs.readdir(procRoot, { withFileTypes: true }); }
  catch (error) {
    return { available: false, error: error.code || error.message, runningDotaDetected: 'UNKNOWN', runningDotaProcesses: [], runningSteamProcesses: [], primaryDota: null, associatedSteam: null };
  }
  const dotaProcesses = [];
  const steamProcesses = [];
  let inaccessibleProcessCount = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    const base = path.join(procRoot, entry.name);
    const [comm, rawCommand, rawExecutable, rawWorkingDirectory, cgroup, environ, mountNamespace] = await Promise.all([
      safeReadText(path.join(base, 'comm')),
      fs.readFile(path.join(base, 'cmdline')).catch((error) => { if (!['ENOENT', 'ESRCH'].includes(error.code)) inaccessibleProcessCount += 1; return null; }),
      fs.readlink(path.join(base, 'exe')).catch(() => null),
      fs.readlink(path.join(base, 'cwd')).catch(() => null),
      safeReadText(path.join(base, 'cgroup')),
      fs.readFile(path.join(base, 'environ')).catch(() => null),
      fs.readlink(path.join(base, 'ns', 'mnt')).catch(() => null),
    ]);
    if (!rawCommand && !comm && !rawExecutable) continue;
    const args = rawCommand ? rawCommand.toString('utf8').split('\0').filter(Boolean) : [];
    const envEntries = environ ? environ.toString('utf8').split('\0') : [];
    const flatpakId = envEntries.find((item) => item.startsWith('FLATPAK_ID='))?.slice('FLATPAK_ID='.length) || null;
    const processRootIsFlatpak = await fs.access(path.join(base, 'root', '.flatpak-info')).then(() => true, () => false);
    const executable = rawExecutable ? rawExecutable.replace(/ \(deleted\)$/, '') : null;
    const workingDirectory = rawWorkingDirectory || null;
    const processInfo = {
      pid,
      comm: (comm || '').trim(),
      executable: executable ? displayPath(executable) : unknownPath(),
      workingDirectory: workingDirectory ? displayPath(workingDirectory) : unknownPath(),
      commandLine: args.length ? args.map((argument) => redactProcessArgument(argument, home)).join(' ') : unknownPath(),
      mountNamespace: mountNamespace || unknownPath(),
      sameMountNamespaceAsVanta: mountNamespace ? mountNamespace === await fs.readlink(path.join(procRoot, 'self', 'ns', 'mnt')).catch(() => null) : null,
      sandboxContext: processRootIsFlatpak || flatpakId === 'com.valvesoftware.Steam' ? 'flatpak'
        : /pressure-vessel/i.test(`${executable || ''} ${args.join(' ')} ${cgroup || ''}`) ? 'pressure-vessel'
          : mountNamespace && mountNamespace !== await fs.readlink(path.join(procRoot, 'self', 'ns', 'mnt')).catch(() => null) ? 'separate-mount-namespace'
            : 'host-or-runtime-not-identifiable',
    };
    if (isDotaProcess({ comm: processInfo.comm, args, executable })) {
      const gameRoots = [];
      for (const candidate of [executable, workingDirectory, ...args.filter((value) => path.isAbsolute(value))]) {
        const root = await resolveGameRootFromProcessPath(candidate, pid, procRoot);
        if (root && !gameRoots.includes(root)) gameRoots.push(root);
      }
      processInfo.gameRoot = gameRoots.length === 1 ? displayPath(gameRoots[0]) : unknownPath();
      processInfo.gameRootNormalized = gameRoots.length === 1 ? gameRoots[0] : null;
      const steamLibrary = gameRoots.length === 1 ? containingSteamLibrary(gameRoots[0]) : null;
      processInfo.steamLibrary = steamLibrary ? displayPath(steamLibrary) : unknownPath();
      dotaProcesses.push(processInfo);
    }
    if (isSteamProcess({ comm: processInfo.comm, args, executable, flatpakId })) {
      const steamRoot = steamInstallRootFromExecutable(executable, args);
      steamProcesses.push({
        pid,
        type: classifySteamProcess({ args, executable, cgroup, flatpakId, rootIsFlatpak: processRootIsFlatpak }),
        steamPath: steamRoot ? displayPath(steamRoot) : unknownPath(),
        steamPathNormalized: steamRoot ? await fs.realpath(steamRoot).catch(() => path.resolve(steamRoot)) : null,
        mountNamespace: mountNamespace || unknownPath(),
        sandboxContext: processInfo.sandboxContext,
      });
    }
  }

  const vantaMountNamespace = await fs.readlink(path.join(procRoot, 'self', 'ns', 'mnt')).catch(() => null);
  const knownDotaRoots = [...new Set(dotaProcesses.map((process) => process.gameRootNormalized).filter(Boolean))];
  const sameDotaInstall = knownDotaRoots.length === 1 && dotaProcesses.every((process) => process.gameRootNormalized === knownDotaRoots[0]);
  const primaryDota = dotaProcesses.length === 1 || sameDotaInstall ? dotaProcesses[0] : null;
  const gameRootForSteamMatch = primaryDota?.gameRootNormalized || null;
  const associatedSteam = await associateSteamProcess(steamProcesses, gameRootForSteamMatch, steamRootCandidates);
  const detection = dotaProcesses.length ? 'YES' : inaccessibleProcessCount ? 'UNKNOWN' : 'NO';
  const rootKnown = Boolean(primaryDota?.gameRootNormalized);
  return {
    available: true,
    runningDotaDetected: detection,
    runningDotaProcesses: dotaProcesses.map(({ gameRootNormalized, ...process }) => ({
      ...process,
      runningDotaPathNormalized: gameRootNormalized ? displayPath(gameRootNormalized) : unknownPath(),
    })),
    runningSteamProcesses: steamProcesses,
    primaryDota,
    associatedSteam,
    vantaMountNamespace: vantaMountNamespace || unknownPath(),
    inaccessibleProcessCount,
    runningDotaExecutable: primaryDota?.executable || unknownPath(),
    runningDotaWorkingDirectory: primaryDota?.workingDirectory || unknownPath(),
    runningDotaCommandLine: primaryDota?.commandLine || unknownPath(),
    runningDotaPathNormalized: rootKnown ? displayPath(primaryDota.gameRootNormalized) : unknownPath(),
    runningDotaSteamLibrary: rootKnown ? primaryDota.steamLibrary : unknownPath(),
    steamType: associatedSteam?.type || 'UNKNOWN',
    steamPath: associatedSteam?.steamPath || unknownPath(),
    steamLibrary: rootKnown ? primaryDota.steamLibrary : unknownPath(),
    sandboxContext: primaryDota?.sandboxContext || unknownPath(),
    multipleDotaInstallationsRunning: knownDotaRoots.length > 1,
  };
}

async function collectLogInventory(gameRoot, steamRoots) {
  const signatures = [
    ['vpk_read_or_crc_error', /(?:vpk|crc|checksum).{0,80}(?:error|fail|corrupt|invalid)|(?:error|fail|corrupt|invalid).{0,80}(?:vpk|crc|checksum)/i],
    ['gameinfo_or_searchpath_error', /gameinfo|searchpath|search path/i],
    ['signature_error', /signature/i],
    ['segmentation_fault_or_signal', /segmentation fault|sigsegv|sigbus|signal 11|core dumped/i],
    ['missing_resource_or_file', /missing resource|failed to open file|file not found|no such file/i],
    ['permission_denied', /permission denied|eacces|eperm/i],
    ['missing_module', /failed to dlopen|loadsystemanddependencies|requestmodule/i],
    ['content_marked_corrupt', /markcontentcorrupt|content being marked corrupt|content might be corrupt/i],
    ['steam_validation_or_reacquire', /validat(?:e|ing|ion)|reacquir(?:e|ing)|depot.*corrupt/i],
  ];
  const candidates = [
    { kind: 'dota-console', file: path.join(gameRoot, 'dota', 'console.log') },
    { kind: 'dota-console', file: path.join(gameRoot, 'DotaModdingCommunityMods', 'console.log') },
    ...steamRoots.flatMap((root) => ['content_log.txt', 'gameprocess_log.txt', 'console-linux.txt', 'compat_log.txt', 'stderr.txt'].map((name) => ({ kind: 'steam', file: path.join(root, 'logs', name) }))),
  ];
  const result = [];
  const seen = new Set();
  for (const item of candidates) {
    const file = path.resolve(item.file);
    if (seen.has(file)) continue;
    seen.add(file);
    const meta = await fileMetadata(file);
    if (meta.exists) {
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      const counts = signatures.map(([name, pattern]) => ({ name, count: (text.match(new RegExp(pattern.source, 'gim')) || []).length })).filter((signal) => signal.count);
      result.push({ kind: item.kind, ...meta, signalCounts: counts });
    }
  }
  for (const root of steamRoots) {
    const dumpDirectory = path.join(root, 'dumps');
    let names = [];
    try { names = await fs.readdir(dumpDirectory); } catch {}
    for (const name of names.filter((item) => /(?:\.dmp$|crash|\.mdmp$)/i.test(item)).slice(0, 100)) {
      const file = path.join(dumpDirectory, name);
      const meta = await fileMetadata(file, { includeHash: false, includeTextMetadata: false });
      if (meta.exists) result.push({ kind: 'steam-crash-dump', ...meta });
    }
  }
  return result;
}

async function inspectTempFiles(paths, signaturesPath, stateDirectory) {
  const dirs = [paths.modDirectory, path.dirname(paths.gameinfo), signaturesPath && path.dirname(signaturesPath), stateDirectory];
  const result = [];
  for (const directory of [...new Set(dirs.filter(Boolean))]) {
    let names;
    try { names = await fs.readdir(directory); } catch { continue; }
    for (const name of names) {
      if (!/(?:\.tmp$|\.original$|\.restore$|^\.work-|operation\.lock$|transaction\.json$)/i.test(name)) continue;
      const file = path.join(directory, name);
      const info = await fileMetadata(file);
      if (info.exists) result.push({ ...info, name });
    }
  }
  return result;
}

async function listVpkMetadata(directory) {
  const names = await fs.readdir(directory).catch(() => []);
  return Promise.all(names.filter((name) => VPK_NAME.test(name)).sort((left, right) => left.localeCompare(right)).map(async (name) => ({
    name,
    ...(await fileMetadata(path.join(directory, name), { includeHash: false, includeTextMetadata: false })),
  })));
}

async function findBackupDirectoryReadOnly(special, gameRoot, manifest) {
  const backupRoot = path.join(special.stateDirectory, 'backups');
  const canonical = await fs.realpath(gameRoot).catch(() => path.resolve(gameRoot));
  const candidates = [...new Set([canonical, gameRoot, manifest?.gamePath].filter(Boolean).map((value) => path.resolve(value)))];
  for (const candidate of candidates) {
    const directory = path.join(backupRoot, sha256(Buffer.from(candidate)));
    try {
      const names = await fs.readdir(directory);
      if (names.some((name) => /^(?:gameinfo_branchspecific\.gi|dota\.signatures(?:-|$))/i.test(name))) return directory;
    } catch {}
  }
  return null;
}

async function collectLinuxDiagnostic({ service, appVersion = null, generatedAt = new Date().toISOString(), home = os.homedir(), env = process.env, steamRootsOverride = null, runningSteamClientsOverride = null, processDiagnosticsOverride = null }) {
  if (process.platform !== 'linux' || service.platform && service.platform !== 'linux') throw new Error('The VANTA Linux diagnostic report is available only on Linux.');
  const paths = service.specialPatches?.getDotaPaths?.() || service.getDotaPaths();
  const signaturesPath = await (service.specialPatches || service).findSignaturesPath(paths).catch(() => null);
  const special = service.specialPatches || service;
  const signatureCandidates = ['bin/linuxsteamrt64/dota.signatures', 'bin/win64/dota.signatures'].map((relativePath) => path.join(paths.root, relativePath));
  const signatureInventory = await Promise.all(signatureCandidates.map(async (file) => ({ relativePath: path.relative(paths.root, file).split(path.sep).join('/'), ...(await fileMetadata(file)) })));
  const signaturesFile = signaturesPath ? await fs.readFile(signaturesPath).catch(() => null) : null;
  const gameinfoFile = await fs.readFile(paths.gameinfo).catch(() => null);
  const installedRecordsForMetadata = Object.values(service.storage?.state?.installedMods || {}).filter((record) => record?.modType === 'special_patch');
  const manifest = await special.readSpecialManifest().catch(() => null) || installedRecordsForMetadata.find((record) => record.patchMetadata)?.patchMetadata || null;
  const backupDirectory = await findBackupDirectoryReadOnly(special, paths.root, manifest);
  const backupGameinfoPath = backupDirectory && path.join(backupDirectory, 'gameinfo_branchspecific.gi');
  const backupSignaturePath = backupDirectory && signaturesPath ? await special.findSignatureBackup(backupDirectory, signaturesPath).catch(() => null) : null;
  const backupGameinfo = backupGameinfoPath ? await fs.readFile(backupGameinfoPath).catch(() => null) : null;
  const backupSignatures = backupSignaturePath ? await fs.readFile(backupSignaturePath).catch(() => null) : null;
  const primaryPath = paths.modVpk;
  const aliasPath = paths.modVpkRuntimeAlias;
  const vpkReports = [];
  for (const vpkPath of [primaryPath, aliasPath]) vpkReports.push(await inspectVpk(vpkPath));
  const allDirectoryVpkMetadata = await listVpkMetadata(paths.modDirectory);
  const baseDotaVpkMetadata = await listVpkMetadata(path.dirname(paths.pak01));
  const legacyModsPath = path.join(paths.root, 'dota_mods');
  const legacyModsVpkMetadata = await listVpkMetadata(legacyModsPath);
  const primaryStat = await fs.stat(primaryPath).catch(() => null);
  const aliasStat = await fs.stat(aliasPath).catch(() => null);
  const primaryHash = vpkReports[0]?.sha256 || null;
  const aliasHash = vpkReports[1]?.sha256 || null;
  const steamRoots = steamRootsOverride || await discoverSteamRoots({ gamePath: paths.root, platform: 'linux', home, env }).catch(() => []);
  const realGameRoot = await fs.realpath(paths.root).catch(() => path.resolve(paths.root));
  const owningSteamRoots = [];
  for (const steamRoot of steamRoots) {
    const realSteamRoot = await fs.realpath(steamRoot).catch(() => path.resolve(steamRoot));
    if (realGameRoot === realSteamRoot || realGameRoot.startsWith(`${realSteamRoot}${path.sep}`)) owningSteamRoots.push(displayPath(realSteamRoot));
  }
  const runningSteamClients = runningSteamClientsOverride || await detectRunningSteamClients();
  const processDiagnostics = processDiagnosticsOverride || await inspectLinuxProcesses({ steamRootCandidates: steamRoots, home });
  const vantaSteamLibrary = containingSteamLibrary(realGameRoot);
  const runningRoot = processDiagnostics.primaryDota?.gameRootNormalized || null;
  const sameDotaInstallation = compareDotaInstallations(realGameRoot, runningRoot);
  const uniqueRunningSteamProcesses = uniqueSteamRuntime(processDiagnostics.runningSteamProcesses || []);
  const activeSteamProcess = processDiagnostics.associatedSteam
    || (uniqueRunningSteamProcesses.length === 1 ? uniqueRunningSteamProcesses[0] : null);
  const selectedRootIsFlatpak = owningSteamRoots.some((root) => root.includes('/.var/app/com.valvesoftware.Steam/'));
  const selectedSteamType = selectedRootIsFlatpak ? 'flatpak'
    : runningSteamClients.length === 1 && ['native', 'flatpak'].includes(runningSteamClients[0].type) ? runningSteamClients[0].type
      : owningSteamRoots.length ? 'native-or-library-mounted' : 'unknown';
  const steamTypeConfidence = selectedRootIsFlatpak ? 'game-library-path'
    : runningSteamClients.length === 1 && ['native', 'flatpak'].includes(runningSteamClients[0].type) ? 'single-running-steam-process-type'
      : owningSteamRoots.length ? 'library-path-ambiguous' : 'not-detected';
  const currentGameinfo = gameinfoFile || Buffer.alloc(0);
  const isInstalled = Boolean(manifest || Object.values(service.storage?.state?.installedMods || {}).some((record) => record?.modType === 'special_patch'));
  const packageVersion = require('../../package.json').version;
  const signatureExpectedHash = manifest?.originalSignaturesHash || null;
  const baselineGameinfoSummary = backupGameinfo ? parseGameinfo(backupGameinfo, paths.root) : null;
  const installedRecords = Object.values(service.storage?.state?.installedMods || {}).filter((record) => record?.modType === 'special_patch').map((record) => ({ id: record.id, specialType: record.specialType, currentVersion: record.currentVersion || record.version, state: record.specialPatchState || null }));
  return {
    schemaVersion: 2,
    generatedAt,
    vantaVersion: appVersion || service.appVersion || packageVersion,
    platform: 'linux',
    os: { type: os.type(), release: os.release(), kernelVersion: os.version(), architecture: os.arch(), nodeArchitecture: process.arch, distro: await fs.readFile('/etc/os-release', 'utf8').then((text) => ({ id: text.match(/^ID=(.*)$/m)?.[1]?.replace(/^"|"$/g, '') || null, versionId: text.match(/^VERSION_ID=(.*)$/m)?.[1]?.replace(/^"|"$/g, '') || null }), () => null) },
    runtime: {
      steamType: activeSteamProcess?.type || 'UNKNOWN',
      steamPath: activeSteamProcess?.steamPath || unknownPath(),
      steamLibrary: processDiagnostics.runningDotaDetected === 'YES' ? processDiagnostics.runningDotaSteamLibrary : unknownPath(),
      vantaSteamLibrary: vantaSteamLibrary ? displayPath(vantaSteamLibrary) : unknownPath(),
      steamTypeForGameLibrary: selectedSteamType,
      steamTypeConfidence,
      gameLibrarySteamRoots: owningSteamRoots,
      runningSteamClients,
      runningSteamProcesses: (processDiagnostics.runningSteamProcesses || []).map(({ steamPathNormalized, ...process }) => ({
        ...process,
        steamPathNormalized: steamPathNormalized ? displayPath(steamPathNormalized) : unknownPath(),
      })),
      steamRootCandidates: steamRoots.map(displayPath),
    },
    vantaDotaPath: displayPath(paths.root),
    vantaDotaPathNormalized: displayPath(realGameRoot),
    runningDotaDetected: processDiagnostics.runningDotaDetected,
    runningDotaProcessPid: processDiagnostics.primaryDota?.pid ?? 'UNKNOWN',
    runningDotaExecutable: processDiagnostics.runningDotaExecutable,
    runningDotaWorkingDirectory: processDiagnostics.runningDotaWorkingDirectory,
    runningDotaCommandLine: processDiagnostics.runningDotaCommandLine,
    runningDotaPathNormalized: processDiagnostics.runningDotaPathNormalized,
    sameDotaInstallation,
    runningDotaProcesses: processDiagnostics.runningDotaProcesses,
    processDiagnostics: {
      available: processDiagnostics.available,
      error: processDiagnostics.error || null,
      sandboxContext: processDiagnostics.sandboxContext || unknownPath(),
      vantaMountNamespace: processDiagnostics.vantaMountNamespace || unknownPath(),
      runningDotaMountNamespace: processDiagnostics.primaryDota?.mountNamespace || unknownPath(),
      runningDotaSharesVantaMountNamespace: processDiagnostics.primaryDota?.sameMountNamespaceAsVanta ?? 'UNKNOWN',
      multipleDotaInstallationsRunning: Boolean(processDiagnostics.multipleDotaInstallationsRunning),
      inaccessibleProcessCount: processDiagnostics.inaccessibleProcessCount ?? null,
    },
    game: {
      gamePath: displayPath(paths.root),
      gamePathIsSymlink: (await fs.lstat(paths.root).catch(() => null))?.isSymbolicLink() || false,
      realGamePath: displayPath(realGameRoot),
      filesystem: getFilesystemType(paths.root),
      buildId: await special.currentBuildId(paths.root).catch(() => null),
      vantaSpecialPatchInstalled: isInstalled,
      installedPatches: installedRecords,
      files: {
        basePak01Dir: await fileMetadata(paths.pak01),
        gameinfo: await fileMetadata(paths.gameinfo),
        selectedSignaturesPath: signaturesPath ? displayPath(signaturesPath) : null,
        signaturesCandidates: signatureInventory,
        modDirectory: await fileMetadata(paths.modDirectory),
        pak01DirExists: vpkReports[0].exists,
        pak01AliasExists: vpkReports[1].exists,
        vpkDirectoryFiles: allDirectoryVpkMetadata,
        baseDotaVpkFiles: baseDotaVpkMetadata,
        legacyDotaModsDirectory: await fileMetadata(legacyModsPath),
        legacyDotaModsVpkFiles: legacyModsVpkMetadata,
      },
      writeSemantics: {
        vpk: 'VpkWriter creates a temporary pak01_dir.vpk; each target is copyFile to a same-directory temporary file followed by rename. Linux alias is an independent file copy, not a symlink or hardlink.',
        gameinfoAndSignatures: 'Files are written to same-directory temporary files and renamed over targets; no explicit chmod/chown/fsync is performed by the patch service.',
        transaction: 'The service records prior bytes in a transaction journal and restores them on caught failures/startup recovery.',
      },
      weatherTowersVpk: {
        primaryRelativeName: 'DotaModdingCommunityMods/pak01_dir.vpk',
        linuxRuntimeAliasRelativeName: 'DotaModdingCommunityMods/pak01.vpk',
        primaryAndAliasSha256Match: Boolean(primaryHash && aliasHash && primaryHash === aliasHash),
        primaryAndAliasSameInode: Boolean(primaryStat && aliasStat && primaryStat.dev === aliasStat.dev && primaryStat.ino === aliasStat.ino),
        primaryVpk: vpkReports[0],
        linuxAliasVpk: vpkReports[1],
      },
      gameinfoValidation: {
        baseline: backupGameinfo ? { file: displayPath(backupGameinfoPath), metadata: await fileMetadata(backupGameinfoPath), sha256: sha256(backupGameinfo), matchesManifestOriginalHash: manifest?.originalGameinfoHash ? sha256(backupGameinfo) === manifest.originalGameinfoHash : null, ...baselineGameinfoSummary } : null,
        current: gameinfoFile ? { file: displayPath(paths.gameinfo), sha256: sha256(gameinfoFile), matchesManifestInstalledHash: manifest?.gameinfoHash ? sha256(gameinfoFile) === manifest.gameinfoHash : null, signatureHashMatches: signaturesFile ? signaturesMatch(signaturesFile.toString('utf8'), gameinfoFile) : false, ...parseGameinfo(gameinfoFile, paths.root) } : null,
        postUninstallBaselineAvailable: !isInstalled && Boolean(gameinfoFile && backupGameinfo && gameinfoFile.equals(backupGameinfo)),
      },
      signaturesValidation: {
        baseline: { ...signatureSummary(backupSignatures, backupGameinfo || currentGameinfo, signatureExpectedHash), ...(backupSignaturePath ? { metadata: await fileMetadata(backupSignaturePath) } : {}) },
        current: signatureSummary(signaturesFile, gameinfoFile || currentGameinfo, manifest?.signaturesHash || null),
        preDigestRecordsPreserved: Boolean(backupSignatures && signaturesFile && (() => {
          const before = backupSignatures.toString('utf8').split(/\r?\n/);
          const after = signaturesFile.toString('utf8').split(/\r?\n/);
          const beforeDigest = before.findIndex((line) => line.startsWith('DIGEST:'));
          const afterDigest = after.findIndex((line) => line.startsWith('DIGEST:'));
          return beforeDigest >= 0 && afterDigest >= 0 && JSON.stringify(before.slice(0, beforeDigest + 1)) === JSON.stringify(after.slice(0, afterDigest + 1));
        })()),
        backupPath: displayPath(backupSignaturePath),
        backupMatchesManifestOriginalHash: Boolean(backupSignatures && manifest?.originalSignaturesHash && sha256(backupSignatures) === manifest.originalSignaturesHash),
        postUninstallBaselineAvailable: !isInstalled && Boolean(signaturesFile && backupSignatures && signaturesFile.equals(backupSignatures)),
      },
      temporaryOrTransactionFiles: await inspectTempFiles(paths, signaturesPath, special.stateDirectory),
    },
    logs: {
      inventory: await collectLogInventory(paths.root, steamRoots),
      note: 'Log contents are intentionally omitted to avoid exporting account identifiers, tokens, IP addresses, or private paths. Share the relevant log locally after reviewing/redacting it.',
    },
    privacy: { homeDirectoryRedacted: true, sanitizedDotaCommandLineIncluded: true, environmentValuesIncluded: false, signaturesContentsIncluded: false, logContentsIncluded: false },
  };
}

module.exports = { collectLinuxDiagnostic, compareDotaInstallations, displayPath, inspectLinuxProcesses, inspectVpk, parseGameinfo, signatureSummary };
