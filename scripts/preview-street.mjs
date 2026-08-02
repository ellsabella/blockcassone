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
import { generateHilbert3D } from '../core/hilbert.js';

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
  const ids = argValue('normies', '1250,1252,5025').split(',').map(s => Number(s.trim())).filter(Boolean).slice(0, 32);
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

  // span = how many contiguous plots to render (8 street, 64 neighbourhood, 512 region).
  const span = Math.max(8, Number(argValue('span', '8')) || 8);
  const worldTour = process.argv.includes('--world-tour');
  const fillAll = process.argv.includes('--fill-all'); // STRESS TEST: populate every slot
  const spiralMode = process.argv.includes('--spiral'); // incremental reveal from one cube
  const WORLD = 4096;
  const mkCube = (o, slot) => ({ occupied: true, slot, sourceTokenId: o.sourceTokenId, seed: o.seed, raw: o.raw, agentic: false, agentId: '' });

  // Motif ↔ 16×16×16 grid maps (each motif = one 2×2×2-point cell).
  const gridMaps = () => {
    const hil = generateHilbert3D(5);
    const gridToMotif = new Map(), motifG = new Array(WORLD);
    for (let m = 0; m < WORLD; m++) {
      let mnx = Infinity, mny = Infinity, mnz = Infinity;
      for (let i = 0; i < 8; i++) { const v = hil.rawVertices[m * 8 + i]; if (v.x < mnx) mnx = v.x; if (v.y < mny) mny = v.y; if (v.z < mnz) mnz = v.z; }
      const g = [mnx >> 1, mny >> 1, mnz >> 1];
      motifG[m] = g; gridToMotif.set(g.join(','), m);
    }
    return { gridToMotif, motifG };
  };

  let plots;
  if (spiralMode) {
    // Provide a bounded region around a centre cube; the renderer builds it OUTWARD over
    // time (incremental reveal), so all we do here is supply the region + scatter cubes.
    const { gridToMotif, motifG } = gridMaps();
    const CENTRE = [8, 8, 8];
    const RREVEAL = Math.max(2, Number(argValue('reveal-radius', '4')) || 4);
    const CUBE_EVERY = Math.max(2, Number(argValue('cube-every', '24')) || 24);
    const centreM = gridToMotif.get(CENTRE.join(','));
    const region = [];
    for (let m = 0; m < WORLD; m++) {
      const g = motifG[m];
      const sh = Math.max(Math.abs(g[0] - CENTRE[0]), Math.abs(g[1] - CENTRE[1]), Math.abs(g[2] - CENTRE[2]));
      if (sh <= RREVEAL) region.push([sh, m]);
    }
    region.sort((a, b) => a[0] - b[0]);
    plots = [mkCube(occupied[0], centreM)]; // centre FIRST → renderer's focus + spiral origin
    let ci = 1, idx = 0;
    for (const [, m] of region) {
      if (m === centreM) continue;
      if (idx % CUBE_EVERY === CUBE_EVERY - 1) { plots.push(mkCube(occupied[ci % occupied.length], m)); ci++; }
      else plots.push({ occupied: false, slot: m });
      idx++;
    }
  } else if (fillAll) {
    // Fill the ENTIRE Block: a cube every --cube-every slots (reusing the input art,
    // sparse so the JSON stays sane), a full crystal biome for every other slot. This
    // builds ~4000 biomes up front — expect a long freeze + a slideshow (or a GPU-context
    // loss). Paired with --no-fallback in the renderer so the result is actually shown.
    const CUBE_EVERY = Math.max(2, Number(argValue('cube-every', '96')) || 96);
    plots = [];
    let ci = 0;
    for (let m = 0; m < WORLD; m++) {
      if (m % CUBE_EVERY === (CUBE_EVERY >> 1)) { plots.push(mkCube(occupied[ci % occupied.length], m)); ci++; }
      else plots.push({ occupied: false, slot: m });
    }
  } else if (worldTour) {
    // 3 dense DISTRICTS on three different sides of the Block (for the opposite-sides
    // tour), each a SPATIALLY-COMPACT cube of motifs centred on a focus, populated with a
    // mix of cubes (reusing the input art — fine for a pre-launch representative seed) and
    // biomes. Because the world is a 16×16×16 grid of motifs (each a 2×2×2-point cell), we
    // select a real (2r+1)^3 spatial cube — NOT a contiguous index run, which snakes into
    // a thin slab and leaves a slot's spatial neighbours (scattered in index space) empty.
    // Focus sits at the block centre → all 26 neighbours filled → no gaps up close. The
    // rest of the Block is carried by the impostor cloud + spine. Tunable: --block-radius.
    const R = Math.max(1, Number(argValue('block-radius', '1')) || 1); // 1 → 3×3×3 = 27
    const CUBE_EVERY = Math.max(2, Number(argValue('cube-every', '4')) || 4); // 1 cube / N slots

    const hil = generateHilbert3D(5);
    const GRID = 16; // motifs per axis (16^3 = 4096)
    const gridToMotif = new Map();
    const motifGrid = new Array(WORLD);
    for (let m = 0; m < WORLD; m++) {
      let mnx = Infinity, mny = Infinity, mnz = Infinity;
      for (let i = 0; i < 8; i++) {
        const v = hil.rawVertices[m * 8 + i];
        if (v.x < mnx) mnx = v.x; if (v.y < mny) mny = v.y; if (v.z < mnz) mnz = v.z;
      }
      const g = [(mnx / 2) | 0, (mny / 2) | 0, (mnz / 2) | 0];
      motifGrid[m] = g;
      gridToMotif.set(g[0] + ',' + g[1] + ',' + g[2], m);
    }
    // Three interior grid centres on different sides (kept in [R, 15-R] so the full block exists).
    const centres = [[4, 8, 4], [11, 5, 12], [7, 12, 10]];
    plots = [];
    let ci = 0;
    for (const [cx, cy, cz] of centres) {
      const centreMotif = gridToMotif.get(cx + ',' + cy + ',' + cz);
      const block = [];
      for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
        const key = (cx + dx) + ',' + (cy + dy) + ',' + (cz + dz);
        const m = gridToMotif.get(key);
        if (m !== undefined && m !== centreMotif) block.push(m);
      }
      block.sort((a, b) => a - b);
      // Focus cube FIRST (so entry.js tours the block centre), then a sparse scatter of
      // more cubes, biomes for the rest — every slot in the block is filled.
      plots.push(mkCube(occupied[ci % occupied.length], centreMotif)); ci++;
      block.forEach((m, k) => {
        if (k % CUBE_EVERY === CUBE_EVERY - 1) { plots.push(mkCube(occupied[ci % occupied.length], m)); ci++; }
        else plots.push({ occupied: false, slot: m });
      });
    }
  } else {
    // Scatter the occupied cubes across a single contiguous span (a lived-in neighbourhood).
    const bySlot = new Map();
    occupied.forEach((o, k) => bySlot.set(Math.min(span - 1, Math.floor((k + 0.5) * span / occupied.length)), o));
    plots = [];
    for (let k = 0; k < span; k++) {
      const o = bySlot.get(k);
      plots.push(o ? mkCube(o, base + k) : { occupied: false, slot: base + k });
    }
  }

  const cinematic = process.argv.includes('--cinematic');
  const forceLite = process.argv.includes('--force-lite'); // test the static fallback
  const rainbow = process.argv.includes('--rainbow');      // hue-by-Hilbert-position spine
  // worldSpan = total plots for the Hilbert spine + camera zoom-out (512 region, 4096 world);
  // `plots` (span) stays the detailed neighbourhood so we keep 60fps.
  const world = (worldTour || fillAll || spiralMode) ? WORLD : Math.max(span, Number(argValue('world', String(span))) || span);
  const noFallback = fillAll || spiralMode || process.argv.includes('--no-fallback'); // never silently drop to lite
  const landing = process.argv.includes('--landing'); // full-screen site landing/loading page over the hero
  const token = { kind: 'street', tokenId: 0, street, population: occupied.length, cinematic, forceLite, rainbow, spiral: spiralMode, noFallback, worldSpan: world, plots };
  // Landing chrome in the Normies font: hero "THE BLOCK" + "ENTER" as hollow (transparent)
  // letters with a thin black outline and a green neon glow; pink subtitle. Font embedded
  // as a data URI so it renders both served and in the artifact preview.
  let fontFace = '';
  if (landing) {
    const fontB64 = (await fs.readFile(path.join(ROOT, 'viewer', 'assets', 'NormiesFont.otf'))).toString('base64');
    fontFace = "@font-face{font-family:'NormiesFont';src:url(data:font/otf;base64," + fontB64 + ") format('opentype');font-display:block}";
  }
  const landingCss = landing
    ? fontFace
      + '#h,#fps{display:none}'
      // White glyphs with a green neon glow.
      + "#title{position:fixed;top:8vh;left:0;right:0;text-align:center;font-family:'NormiesFont',ui-monospace,monospace;font-weight:400;font-size:clamp(58px,13vw,175px);line-height:1;letter-spacing:.04em;color:#fff;text-shadow:0 0 6px rgba(0,255,120,.9),0 0 28px rgba(0,255,120,.65),0 0 70px rgba(0,255,120,.35);opacity:0;animation:fadeUp 1.5s cubic-bezier(.2,.7,.2,1) .3s forwards;pointer-events:none}"
      + "#enter{position:fixed;bottom:9vh;left:50%;transform:translateX(-50%);font-family:'NormiesFont',monospace;font-weight:400;font-size:clamp(32px,6vw,66px);letter-spacing:.08em;color:#fff;text-shadow:0 0 5px rgba(0,255,120,.85),0 0 22px rgba(0,255,120,.5),0 0 50px rgba(0,255,120,.3);background:none;border:none;padding:10px 24px;cursor:pointer;opacity:0;animation:fadeOnly 1.2s ease 1.7s forwards;transition:text-shadow .2s,transform .15s}"
      + '#enter:hover{text-shadow:0 0 8px #fff,0 0 22px rgba(0,255,120,.9),0 0 50px rgba(0,255,120,.6),0 0 95px rgba(0,255,120,.4)}'
      + '#enter:active{transform:translateX(-50%) scale(.96)}'
      + '@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}'
      + '@keyframes fadeOnly{to{opacity:1}}'
    : '';
  const landingBody = landing
    ? '<div id="title">THE BLOCK</div>'
      + '<button id="enter">ENTER</button>'
      + '<script>document.getElementById("enter").addEventListener("click",function(){location.href="/about";});</script>'
    : '';
  const html =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>html,body{margin:0;height:100%;background:#020203;overflow:hidden}' +
    '#c{width:100vw;height:100vh;display:block}' +
    '#h{position:fixed;left:10px;bottom:8px;color:#9adf9a;font:12px monospace;opacity:.85}' +
    '#fps{position:fixed;top:12px;left:14px;z-index:9;font:700 15px monospace;letter-spacing:1px;color:#7CFFB2;background:rgba(5,5,7,.62);padding:6px 11px;border:1px solid #7CFFB2}' +
    landingCss + '</style></head>' +
    '<body><canvas id="c"></canvas><div id="h"></div><div id="fps">— FPS</div>' + landingBody +
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
