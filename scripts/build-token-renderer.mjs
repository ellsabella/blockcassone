import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'dist', 'token-renderer');
const entry = path.join(repoRoot, 'token-renderer', 'entry.js');
const bundlePath = path.join(outDir, 'token-renderer.bundle.js');
const chunksPath = path.join(outDir, 'renderer-chunks.json');
const chunkBytes = Number(process.env.BLOCKCASSONE_RENDERER_CHUNK_BYTES || 18_000);

const forbiddenPatterns = [
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /api\.normies\.art/,
  /api\.opensea\.io/,
  /\/api\//,
  /ipfs:\/\//,
  /https?:\/\//,
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
}

function utf8Chunks(value, maxBytes) {
  const chunks = [];
  let current = '';
  let currentBytes = 0;
  for (const char of value) {
    const bytes = Buffer.byteLength(char);
    if (current && currentBytes + bytes > maxBytes) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += bytes;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });

  const esbuildBin = capture(process.execPath, [path.join(repoRoot, 'scripts', 'install-esbuild-local.mjs')]);

  run(esbuildBin, [
    entry,
    '--bundle',
    '--format=iife',
    '--target=es2020',
    '--loader:.glsl=text',
    '--external:../normies-api.js',
    '--external:./normies-api.js',
    '--external:viewer/normies-api.js',
    '--outfile=' + bundlePath,
    '--log-level=info',
    '--legal-comments=none',
    '--minify',
    '--tree-shaking=true',
  ]);

  const bundle = await fs.readFile(bundlePath, 'utf8');
  const offenders = forbiddenPatterns.filter(pattern => pattern.test(bundle));
  if (offenders.length) {
    throw new Error(`token renderer bundle contains forbidden offchain patterns: ${offenders.map(String).join(', ')}`);
  }

  const script = `<script>${bundle}</script></body></html>`;
  const chunks = utf8Chunks(script, chunkBytes);
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    entry: path.relative(repoRoot, entry).replace(/\\/g, '/'),
    bundle: path.relative(repoRoot, bundlePath).replace(/\\/g, '/'),
    chunkBytes,
    headChunkId: 0,
    scriptStartChunkId: 1,
    chunkCount: chunks.length + 1,
    chunks,
  };
  await fs.writeFile(chunksPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`token renderer bundle: ${Buffer.byteLength(bundle)} bytes`);
  console.log(`renderer script chunks: ${chunks.length} x <= ${chunkBytes} bytes`);
  console.log(`wrote ${path.relative(repoRoot, chunksPath)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
