const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const REPOSITORY = 'artem-prime42/dota2-media';
const OUTPUT = path.join(__dirname, '..', 'src', 'data', 'cosmetic-media-index.json.gz');
const IMAGE_FILE = /^images\/.*\.(?:avif|gif|jpe?g|png|webp)$/i;

async function main() {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'VANTA-cosmetic-media-index' };
  const commitResponse = await fetch(`https://api.github.com/repos/${REPOSITORY}/commits/main`, { headers });
  if (!commitResponse.ok) throw new Error(`Could not read media repository commit: HTTP ${commitResponse.status}`);
  const commit = await commitResponse.json();
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/git/trees/${commit.sha}?recursive=1`, {
    headers,
  });
  if (!response.ok) throw new Error(`Could not read media repository tree: HTTP ${response.status}`);
  const tree = await response.json();
  if (tree.truncated) throw new Error('GitHub returned a truncated media index; refusing to write a partial set.');
  const paths = (tree.tree || []).map((entry) => entry.path).filter((entry) => IMAGE_FILE.test(entry)).sort();
  if (!paths.length) throw new Error('No image files found in the media repository.');
  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  const payload = { repository: REPOSITORY, commit: commit.sha, paths };
  const bytes = zlib.gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9, mtime: 0 });
  await fs.writeFile(OUTPUT, bytes);
  console.log(`Indexed ${paths.length} images from ${REPOSITORY}@${commit.sha.slice(0, 12)} (${bytes.length} bytes).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
