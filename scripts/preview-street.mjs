// Assemble a street-view test HTML from real Normie art — no merge contract
// needed. Reads each Normie's raw bitmap from the (forked) NormiesStorage, puts
// them on consecutive plots of one street, leaves the rest vacant, and inlines
// the built token-renderer bundle. Distinct cubes + environment placeholders.
//
//   anvil --fork-url $ETH_RPC_URL        # storage reads come from the fork
//   npm run build:token-renderer
//   npm run preview:street -- --normies=1250,1252,5025
//   cd <out> && python3 -m http.server 8000  ->  http://localhost:8000/street.html

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_SELECTOR = '0x6985bf3c'; // getTokenRawImageData(uint256)

function argValue(name, fallback = '') {
  const p = `--${name}=`;
  const a = process.argv.find(x => x.startsWith(p));
  return a ? a.slice(p.length) : fallback;
}

const hexWord = (v) => BigInt(v).toString(16).padStart(64, '0');

async function ethCall(rpc, to, data) {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`eth_call ${to}: ${j.error.message}`);
  return j.result;
}

function decodeBytes(hex) {
  const clean = String(hex || '').replace(/^0x/, '');
  if (clean.length < 128) return new Uint8Array(0);
  const offset = Number(BigInt('0x' + clean.slice(0, 64)));
  const lenStart = offset * 2;
  const len = Number(BigInt('0x' + clean.slice(lenStart, lenStart + 64)));
  const dataStart = lenStart + 64;
  const data = clean.slice(dataStart, dataStart + len * 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(data.slice(i * 2, i * 2 + 2) || '00', 16);
  return out;
}

async function main() {
  const ids = argValue('normies', '1250,1252,5025').split(',').map(s => Number(s.trim())).filter(Boolean).slice(0, 8);
  const config = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'chain-config.json'), 'utf8'));
  const rpc = argValue('rpc-url', config.rpcUrl || 'http://127.0.0.1:8545');
  const storage = argValue('storage', config.normieStorage);
  const street = Number(argValue('street', '0'));
  const base = street * 8;

  const bundle = await fs.readFile(path.join(ROOT, 'dist', 'token-renderer', 'token-renderer.bundle.js'), 'utf8');

  const occupied = [];
  for (const id of ids) {
    const raw = decodeBytes(await ethCall(rpc, storage, RAW_SELECTOR + hexWord(id)));
    if (!raw.length) throw new Error(`Normie ${id}: storage returned no raw image data (is the fork up?)`);
    occupied.push({ sourceTokenId: id, raw: Buffer.from(raw).toString('base64'), seed: '0x' + hexWord(id) });
  }

  const plots = [];
  for (let k = 0; k < 8; k++) {
    const o = occupied[k];
    plots.push(o
      ? { occupied: true, slot: base + k, sourceTokenId: o.sourceTokenId, seed: o.seed, raw: o.raw, agentic: false, agentId: '' }
      : { occupied: false, slot: base + k });
  }

  const token = { kind: 'street', tokenId: 0, street, population: occupied.length, plots };
  const html =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>html,body{margin:0;height:100%;background:#020203;overflow:hidden}' +
    '#c{width:100vw;height:100vh;display:block}' +
    '#h{position:fixed;left:10px;bottom:8px;color:#9adf9a;font:12px monospace;opacity:.85}</style></head>' +
    '<body><canvas id="c"></canvas><div id="h"></div>' +
    `<script>window.BLOCKCASSONE_TOKEN=${JSON.stringify(token)};</script>` +
    `<script>${bundle}</script></body></html>`;

  const outDir = path.resolve(argValue('out-dir', path.join(os.tmpdir(), 'blockcassone-token-previews', 'street')));
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'street.html');
  await fs.writeFile(outPath, html);

  console.log(`street #${street}: ${occupied.length} cubes (${ids.join(', ')}) + ${8 - occupied.length} biome plots`);
  console.log(`wrote ${outPath}`);
  console.log(`serve: cd ${outDir} && python3 -m http.server 8000  ->  http://localhost:8000/street.html`);
}

main().catch(e => { console.error(e?.stack || e?.message || String(e)); process.exit(1); });
