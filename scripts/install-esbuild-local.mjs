import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gunzip = promisify(zlib.gunzip);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const vendorDir = path.join(repoRoot, 'node_modules', '.blockcassone-tools', 'esbuild');
const esbuildVersion = '0.27.1';
const platformPackage = process.platform === 'win32'
  ? '@esbuild/win32-x64'
  : process.platform === 'linux'
    ? '@esbuild/linux-x64'
    : '';

if (!platformPackage) {
  throw new Error(`Unsupported esbuild install platform: ${process.platform}`);
}

function packageUrl(name, version) {
  const escaped = name.startsWith('@')
    ? name.replace('/', '%2f')
    : name;
  const tarName = name.split('/').pop();
  return `https://registry.npmjs.org/${escaped}/-/${tarName}-${version}.tgz`;
}

function tarEntries(buffer) {
  const entries = [];
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    offset += 512;
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const type = String.fromCharCode(header[156] || 48);
    const size = Number.parseInt(sizeText || '0', 8);
    const data = buffer.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    entries.push({ name, type, data });
  }
  return entries;
}

async function extractTarball(url, outDir) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to download ${url}: ${res.status}`);
  const compressed = Buffer.from(await res.arrayBuffer());
  const tar = await gunzip(compressed);
  await fs.mkdir(outDir, { recursive: true });
  for (const entry of tarEntries(tar)) {
    if (entry.type !== '0') continue;
    const relative = entry.name.replace(/^package\//, '');
    if (!relative || relative.includes('..')) continue;
    const target = path.join(outDir, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.data);
  }
}

async function main() {
  const binaryName = process.platform === 'win32' ? 'esbuild.exe' : 'esbuild';
  let binaryPath = path.join(vendorDir, 'platform', 'bin', binaryName);
  const rootBinaryPath = path.join(vendorDir, 'platform', binaryName);
  try {
    await fs.access(rootBinaryPath);
    binaryPath = rootBinaryPath;
  } catch (_) {}
  try {
    await fs.access(binaryPath);
    console.log(binaryPath);
    return;
  } catch (_) {}

  await fs.rm(vendorDir, { recursive: true, force: true });
  await extractTarball(packageUrl('esbuild', esbuildVersion), path.join(vendorDir, 'wrapper'));
  await extractTarball(packageUrl(platformPackage, esbuildVersion), path.join(vendorDir, 'platform'));
  try {
    await fs.access(rootBinaryPath);
    binaryPath = rootBinaryPath;
  } catch (_) {}
  if (process.platform !== 'win32') await fs.chmod(binaryPath, 0o755);

  const result = spawnSync(binaryPath, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`installed esbuild failed: ${result.stderr || result.stdout}`);
  console.log(binaryPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
