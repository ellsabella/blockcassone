// CC0 aesthetic proof — decode real Chain Runners + 1337 Skulls art from the
// mainnet fork, flatten each to the on-chain 400-byte 2-bit tonal payload using
// the REPO's own banding functions, and emit a manifest for the comparison page
// plus per-sample hex payloads for the forge thumbnail script.
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import sha3 from 'js-sha3';
import { otsuRecursiveBands, bandsFromBackgroundKey, packTonalPayload } from '../../viewer/nft-art-grid.js';
const { keccak_256 } = sha3;

const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
const CR = '0x97597002980134bea46250aa0510c9b90d87a587';
const CR_RENDER = '0xfdac77881ff861ff76a83cc43a1be3c317c6a1cc';
const SKULLS = '0x9251dec8df720c2adf3b6f46d968107cbbadf4d4';
const NOUNS = '0x9c8ff314c9bc7f6e59a9d9225fb22946427edc03';
const NOUNS_DESC = '0x33a9c445fb4fb21f2c030a6b2d3e2f12d017bfac';
const PEPES = '0x9131d8c7a411d90c6b164d296440701a0e5b3178';
const KEVIN = '0x17b19c70bfca098da3f2efef6e7fa3a1c42f5429';
const KEVIN_RENDER = '0xac3ae179bb3c0edf2ab2892a2b6a4644a71627b6';

// Source collection per kind — one place; the manifest carries it so build-page.mjs
// and inject-bigcube.mjs never re-hardcode an address.
const CONTRACT = {
  runner: { addr: CR, name: 'Chain Runners' },
  skull: { addr: SKULLS, name: '1337 skulls' },
  noun: { addr: NOUNS, name: 'Nouns' },
  pepe: { addr: PEPES, name: 'Baby Pepes' },
  kevin: { addr: KEVIN, name: 'OnChainKevin' },
};

const CR_IDS = (process.env.CR_IDS || '1,55,200,777,1500,3000,5000,9000').split(',').map(s => +s.trim());
const SKULL_IDS = (process.env.SKULL_IDS || '1,337,500,1000,1337,3000,5000,7000').split(',').map(s => +s.trim());
const NOUN_IDS = (process.env.NOUN_IDS || '1,42,100,250').split(',').map(s => +s.trim());
const PEPE_IDS = (process.env.PEPE_IDS || '1,7,33,111').split(',').map(s => +s.trim());
const KEVIN_IDS = (process.env.KEVIN_IDS || '1,42,100,500').split(',').map(s => +s.trim());

const REPO = new URL('../../', import.meta.url);
const OUT = new URL('./out/', import.meta.url);
const HEXDIR = new URL('./data/cc0/', REPO); // repo-root/data/cc0 for forge vm.readFile

const sel = sig => '0x' + keccak_256(sig).slice(0, 8);
const word = v => BigInt(v).toString(16).padStart(64, '0');

async function ethCall(to, data) {
  const res = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // Generous gas: Nouns' generateSVGImage is heavy (RLE expand of the full frame).
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data, gas: '0xf0000000' }, 'latest'] }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
// abi-encode a single dynamic string argument (for hashToSVG(string) etc.)
function encString(s) {
  const bytes = Buffer.from(s, 'utf8');
  const padded = Buffer.concat([bytes, Buffer.alloc((32 - (bytes.length % 32)) % 32)]);
  return word(32) + word(bytes.length) + padded.toString('hex');
}
function decodeString(hex) {
  const clean = hex.replace(/^0x/, ''); const rows = [];
  for (let i = 0; i + 64 <= clean.length; i += 64) rows.push(clean.slice(i, i + 64));
  const off = Number(BigInt('0x' + rows[0])) / 32;
  const len = Number(BigInt('0x' + rows[off]));
  return Buffer.from(rows.slice(off + 1).join('').slice(0, len * 2), 'hex').toString('utf8');
}
const dataUriBody = uri => { const c = uri.indexOf(','); return /;base64/i.test(uri.slice(0, c)) ? Buffer.from(uri.slice(c + 1), 'base64').toString('utf8') : decodeURIComponent(uri.slice(c + 1)); };

// ---- minimal PNG decoder (8-bit; colorType 0/2/3/4/6, PLTE+tRNS) ----
function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
function decodePng(buf) {
  let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, palette = null, trns = null; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8); const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const chan = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const bitsPP = chan * bitDepth; const filterBpp = Math.max(1, Math.ceil(bitsPP / 8)); const stride = Math.ceil(w * bitsPP / 8);
  const rawz = zlib.inflateSync(Buffer.concat(idat)); const out = Buffer.alloc(h * stride); let pos = 0;
  for (let y = 0; y < h; y++) {
    const f = rawz[pos++];
    for (let x = 0; x < stride; x++) {
      const rb = rawz[pos++];
      const a = x >= filterBpp ? out[y * stride + x - filterBpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= filterBpp && y > 0 ? out[(y - 1) * stride + x - filterBpp] : 0;
      let v; switch (f) { case 0: v = rb; break; case 1: v = rb + a; break; case 2: v = rb + b; break; case 3: v = rb + ((a + b) >> 1); break; case 4: v = rb + paeth(a, b, c); break; default: throw new Error('filter ' + f); }
      out[y * stride + x] = v & 0xff;
    }
  }
  const maxv = (1 << bitDepth) - 1;
  const sample = (y, x, ch) => {
    if (bitDepth === 8) return out[y * stride + x * chan + ch];
    const bit = (x * chan + ch) * bitDepth; const byte = out[y * stride + (bit >> 3)]; return (byte >> (8 - bitDepth - (bit & 7))) & maxv;
  };
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let r, g, b, al;
    if (colorType === 6) { r = sample(y, x, 0); g = sample(y, x, 1); b = sample(y, x, 2); al = sample(y, x, 3); }
    else if (colorType === 2) { r = sample(y, x, 0); g = sample(y, x, 1); b = sample(y, x, 2); al = 255; }
    else if (colorType === 4) { const gg = sample(y, x, 0); r = g = b = gg; al = sample(y, x, 1); }
    else if (colorType === 0) { const gg = Math.round(sample(y, x, 0) * 255 / maxv); r = g = b = gg; al = 255; }
    else { const idx = sample(y, x, 0); r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2]; al = trns && idx < trns.length ? trns[idx] : 255; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = al;
  }
  return { w, h, rgba };
}

// ---- source -> 32x32 colours [{r,g,b,a} in 0..1] ----
export async function crGrid(id) {
  // Chain Runners' renderer is keyed by DNA, not token id: the main contract maps
  // tokenId -> getDna(tokenId) (a 256-bit trait pack) and tokenSVG(dna) draws THAT.
  // Passing the raw id renders "the runner whose dna == id" — plausible-looking but
  // wrong art (caught 2026-08-15 comparing Sepolia mints against OpenSea).
  const dna = (await ethCall(CR, sel('getDna(uint256)') + word(id))).replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(dna)) throw new Error(`cr ${id}: bad getDna result`);
  const svg = Buffer.from(decodeString(await ethCall(CR_RENDER, sel('tokenSVG(uint256)') + dna)), 'base64').toString('utf8');
  const colors = new Array(32 * 32).fill(null).map(() => ({ r: 0, g: 0, b: 0, a: 0 }));
  for (const m of svg.matchAll(/<rect\s+fill='(#[0-9a-fA-F]{3,6})'\s+x='(\d+)'\s+y='(\d+)'/g)) {
    let hex = m[1].slice(1); if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const col = (+m[2]) / 10, row = (+m[3]) / 10;
    colors[row * 32 + col] = { r: parseInt(hex.slice(0, 2), 16) / 255, g: parseInt(hex.slice(2, 4), 16) / 255, b: parseInt(hex.slice(4, 6), 16) / 255, a: 1 };
  }
  return { colors, size: 32, svg };
}
// Composite PNG layers the way CSS background-image stacks them: the first URL
// listed paints on TOP, so blend last->first (bottom up). Layers may be sprite
// sheets wider than `size` (Baby Pepes) — we read frame 0 = the top-left size×size
// block by indexing with each layer's own stride and clipping to its bounds.
function compositeLayers(pngs, size) {
  const acc = new Array(size * size).fill(null).map(() => ({ r: 0, g: 0, b: 0, a: 0 }));
  for (let li = pngs.length - 1; li >= 0; li--) {
    const L = pngs[li], px = L.rgba;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (c >= L.w || r >= L.h) continue;
      const s = (r * L.w + c) * 4;
      const sr = px[s] / 255, sg = px[s + 1] / 255, sb = px[s + 2] / 255, sa = px[s + 3] / 255;
      const idx = r * size + c, d = acc[idx], oa = sa + d.a * (1 - sa);
      acc[idx] = oa <= 0 ? { r: 0, g: 0, b: 0, a: 0 }
        : { r: (sr * sa + d.r * d.a * (1 - sa)) / oa, g: (sg * sa + d.g * d.a * (1 - sa)) / oa, b: (sb * sa + d.b * d.a * (1 - sa)) / oa, a: oa };
    }
  }
  return acc;
}
const pngsIn = svg => (svg.match(/data:image\/png;base64,[A-Za-z0-9+/=]+/g) || []).map(u => decodePng(Buffer.from(u.split(',')[1], 'base64')));

export async function skullGrid(id) {
  const meta = JSON.parse(dataUriBody(decodeString(await ethCall(SKULLS, sel('tokenURI(uint256)') + word(id))).replace(/^"|"$/g, '')));
  const layers = pngsIn(dataUriBody(meta.svg_image_data));
  for (const L of layers) if (L.w !== 32 || L.h !== 32) throw new Error(`skull layer ${L.w}x${L.h} != 32`);
  return { colors: compositeLayers(layers, 32), size: 32, meta };
}

// Nouns — on-chain seed -> descriptor.generateSVGImage (RLE <rect> at viewBox 320,
// i.e. a 32×32 grid scaled ×10). First rect is the full-frame background fill.
function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: 1 }; }
export async function nounGrid(id) {
  const seedRaw = (await ethCall(NOUNS, sel('seeds(uint256)') + word(id))).replace(/^0x/, '');
  const svg = Buffer.from(decodeString(await ethCall(NOUNS_DESC, sel('generateSVGImage((uint48,uint48,uint48,uint48,uint48))') + seedRaw)), 'base64').toString('utf8');
  const colors = new Array(32 * 32).fill(null).map(() => ({ r: 0, g: 0, b: 0, a: 0 }));
  for (const m of svg.matchAll(/<rect\b([^>]*)\/?>/g)) {
    const a = m[1], at = k => (a.match(new RegExp(k + "=['\"]([^'\"]+)['\"]")) || [])[1];
    const fill = at('fill'); if (!fill || fill === 'none') continue;
    const col = hexToRgb(fill), wRaw = at('width'), xRaw = at('x');
    if (!xRaw || (wRaw && wRaw.includes('%'))) { for (let i = 0; i < 32 * 32; i++) colors[i] = { ...col }; continue; } // background
    const x = Math.round(+xRaw / 10), y = Math.round(+at('y') / 10);
    const w = Math.max(1, Math.round(+wRaw / 10)), h = Math.max(1, Math.round(+at('height') / 10));
    for (let ry = y; ry < y + h && ry < 32; ry++) for (let rx = x; rx < x + w && rx < 32; rx++) colors[ry * 32 + rx] = { ...col };
  }
  return { colors, size: 32, svg };
}

// Baby Pepes — tokenURI json -> SVG whose 4 <foreignObject> divs each background-image
// a PNG sprite sheet (1728×72 = 24 frames of 72×72); the CSS animation scrolls it, so
// frame 0 is the top-left 72×72. Unlike skulls/kevin these are separate stacked elements
// in DOCUMENT order (first = bottom, last = top), so reverse for the top-first compositor.
export async function pepeGrid(id) {
  const meta = JSON.parse(dataUriBody(decodeString(await ethCall(PEPES, sel('tokenURI(uint256)') + word(id))).replace(/^"|"$/g, '')));
  const pngs = pngsIn(dataUriBody(meta.image));
  if (!pngs.length) throw new Error('pepe: no PNG layers');
  const size = pngs[0].h; // frame is size×size at the top-left of the wide sheet
  return { colors: compositeLayers([...pngs].reverse(), size), size, meta };
}

// OnChainKevin — off-chain tokenURI carries the DNA in its URL; the on-chain renderer
// turns that DNA string into an SVG (data-URI wrapped) of layered 32×32 PNGs stacked
// via one CSS background-image list (first = top, same as skulls).
export async function kevinGrid(id) {
  const uri = decodeString(await ethCall(KEVIN, sel('tokenURI(uint256)') + word(id)));
  const dna = (uri.match(/dna=([0-9a-fA-Fx]+)/) || [])[1];
  if (!dna) throw new Error('kevin: no dna in tokenURI');
  let svg = decodeString(await ethCall(KEVIN_RENDER, sel('hashToSVG(string)') + encString(dna)));
  if (svg.startsWith('data:')) svg = dataUriBody(svg); // renderer wraps the SVG in a data URI
  const pngs = pngsIn(svg);
  if (!pngs.length) throw new Error('kevin: no PNG layers');
  const size = pngs[0].h;
  return { colors: compositeLayers(pngs, size), size, dna };
}

// Downscale a >40 source grid into the 40×40 working grid (area-average, premultiplied
// alpha) so fine sprite detail (72×72 Baby Pepes) collapses cleanly. Sources at or below
// 40 are handled in flatten() by BAND-THEN-PAD (no colour scaling → pixel-perfect shape).
function resampleTo40(colors, size) {
  if (size <= 40) return colors;
  const out = new Array(40 * 40);
  for (let r = 0; r < 40; r++) for (let c = 0; c < 40; c++) {
    const r0 = Math.floor(r * size / 40), r1 = Math.max(r0 + 1, Math.floor((r + 1) * size / 40));
    const c0 = Math.floor(c * size / 40), c1 = Math.max(c0 + 1, Math.floor((c + 1) * size / 40));
    let ar = 0, ag = 0, ab = 0, aa = 0, n = 0;
    for (let y = r0; y < r1; y++) for (let x = c0; x < c1; x++) { const p = colors[y * size + x]; if (!p) continue; ar += p.r * p.a; ag += p.g * p.a; ab += p.b * p.a; aa += p.a; n++; }
    out[r * 40 + c] = aa > 0 ? { r: ar / aa, g: ag / aa, b: ab / aa, a: aa / n } : { r: 0, g: 0, b: 0, a: 0 };
  }
  return out;
}
const grayRGB = c => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; // luminance (fallback only)

// Flatten via the SINGLE canonical separation + packing from the production
// flattener (viewer/nft-art-grid.js) — no duplicate here — so any tuning lands in
// every non-Normie import path at once. Only the source decoders above are
// proof-specific (the browser path rasterises via canvas instead).
// Subject/background separation at a given resolution: the canonical bg-key, else a
// 4-band Otsu fallback. Returns { bands: Uint8Array(size*size), keyed }.
function bandsOrOtsu(colors, size) {
  const bands = bandsFromBackgroundKey(colors, size, size); // native-resolution band map (no scaling)
  if (bands) return { bands, keyed: true };
  const n = size * size;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = grayRGB(colors[i]) * colors[i].a;
  const th = otsuRecursiveBands(lum, 4);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) { let b = 0; for (const t of th) if (lum[i] >= t) b++; out[i] = b; }
  return { bands: out, keyed: false };
}

// Centre a size×size band map into the 40×40 grid; the border stays band 0 (background).
function padBandsTo40(bands, size) {
  if (size === 40) return bands;
  const out = new Uint8Array(1600);
  const off = (40 - size) >> 1; // 4 for 32×32
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) out[(r + off) * 40 + (c + off)] = bands[r * size + c];
  return out;
}

export function flatten(srcColors, size) {
  if (size < 40) {
    // Band at NATIVE resolution — the art's own border IS its background, so the subject
    // separates correctly — THEN pad the band map into 40 with a band-0 border. No pixel
    // scaling, so the pixel-art shape is preserved exactly (just inset by the border).
    const { bands, keyed } = bandsOrOtsu(srcColors, size);
    const bands40 = padBandsTo40(bands, size);
    return { payload: packTonalPayload(bands40), bands: bands40, keyed };
  }
  const colors = resampleTo40(srcColors, size); // identity (==40) or area-average (>40)
  const { bands, keyed } = bandsOrOtsu(colors, 40);
  return { payload: packTonalPayload(bands), bands, keyed };
}

// 40x40 tonal grid -> a clean preview SVG (4 gray levels; band 0 transparent)
function bandsToSvg(bands, cell = 6) {
  const shade = ['transparent', '#5a5a5a', '#9a9a9a', '#e6e6e6'];
  let s = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${40 * cell} ${40 * cell}' width='100%' shape-rendering='crispEdges'><rect width='100%' height='100%' fill='#161616'/>`;
  for (let r = 0; r < 40; r++) for (let c = 0; c < 40; c++) { const b = bands[r * 40 + c]; if (b) s += `<rect x='${c * cell}' y='${r * cell}' width='${cell}' height='${cell}' fill='${shade[b]}'/>`; }
  return s + '</svg>';
}
// 32x32 colours -> a clean source-preview SVG (crisp pixels, transparent holes)
function colorsToSvg(colors, size, cell = 8) {
  let s = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${size * cell} ${size * cell}' width='100%' shape-rendering='crispEdges'>`;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) { const p = colors[r * size + c]; if (!p || p.a < 0.02) continue; s += `<rect x='${c * cell}' y='${r * cell}' width='${cell}' height='${cell}' fill='rgb(${Math.round(p.r * 255)},${Math.round(p.g * 255)},${Math.round(p.b * 255)})' fill-opacity='${p.a.toFixed(2)}'/>`; }
  return s + '</svg>';
}
const toHex = u8 => '0x' + Buffer.from(u8).toString('hex');
// 1-bit bitmap (200 bytes, band>0 -> on, MSB-first) as base64 — the `raw` the
// on-chain animation embeds (imageBytesForCube) and the bundle decodes.
function rawB64(bands) { const raw = new Uint8Array(200); for (let i = 0; i < 1600; i++) if (bands[i] > 0) raw[i >> 3] |= 1 << (7 - (i & 7)); return Buffer.from(raw).toString('base64'); }
const slotFor = i => (i * 691) % 4096;
// keccak256(abi.encode("cc0", i)) — matches PreviewCC0.s.sol so cube == thumbnail.
const seedFor = i => '0x' + keccak_256(Buffer.from(word(64) + word(i) + word(3) + Buffer.from('cc0').toString('hex').padEnd(64, '0'), 'hex'));
function ascii(bands) { const ch = [' ', '.', '+', '#']; let o = ''; for (let r = 0; r < 40; r++) { let line = ''; for (let c = 0; c < 40; c++) line += ch[bands[r * 40 + c]]; o += line + '\n'; } return o; }

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  await fs.mkdir(HEXDIR, { recursive: true });
  const samples = [];
  const DECODER = { runner: crGrid, skull: skullGrid, noun: nounGrid, pepe: pepeGrid, kevin: kevinGrid };
  const jobs = [
    ...CR_IDS.map(id => ({ kind: 'runner', id })),
    ...SKULL_IDS.map(id => ({ kind: 'skull', id })),
    ...NOUN_IDS.map(id => ({ kind: 'noun', id })),
    ...PEPE_IDS.map(id => ({ kind: 'pepe', id })),
    ...KEVIN_IDS.map(id => ({ kind: 'kevin', id })),
  ];
  for (const job of jobs) {
    const g = await DECODER[job.kind](job.id);
    const f = flatten(g.colors, g.size);
    const name = `${job.kind}-${job.id}`;
    const c = CONTRACT[job.kind];
    const i = samples.length;
    samples.push({ name, kind: job.kind, id: job.id, contract: c.addr, contractName: c.name, sourceSvg: colorsToSvg(g.colors, g.size), tonalSvg: bandsToSvg(f.bands), payloadHex: toHex(f.payload), keyed: f.keyed, slot: slotFor(i), seed: seedFor(i), rawBase64: rawB64(f.bands), lit: f.bands.filter(b => b > 0).length });
    console.log(`\n=== ${name}  (${g.size}×${g.size} → bg-keyed: ${f.keyed})  lit=${f.bands.filter(b => b > 0).length}/1600 ===`);
    console.log(ascii(f.bands));
  }
  await fs.writeFile(new URL('./manifest.json', OUT), JSON.stringify(samples, null, 2));
  await fs.writeFile(new URL('./order.json', HEXDIR), JSON.stringify(samples.map((s, i) => ({ i, name: s.name, id: s.id })), null, 2));
  for (let i = 0; i < samples.length; i++) {
    await fs.writeFile(new URL(`./${i}.hex`, HEXDIR), samples[i].payloadHex);
    await fs.writeFile(new URL(`./${i}.id`, HEXDIR), String(samples[i].id)); // real source id for the thumbnail label
  }
  // Samples for line-lab (loaded as window.CC0_SAMPLES): name + 2-bit tonal payload.
  await fs.writeFile(
    new URL('tmp/cc0-samples.js', REPO),
    'window.CC0_SAMPLES=' + JSON.stringify(samples.map(s => ({ name: s.name, kind: s.kind, id: s.id, payload: s.payloadHex }))) + ';\n'
  );
  console.log(`\nwrote ${samples.length} samples -> out/manifest.json + data/cc0/*.hex + tmp/cc0-samples.js`);
}
// Run the sample-proof main() only when invoked directly (node dev/cc0-proof/flatten.mjs);
// flatten-pools.mjs imports the decoders + flatten() above without triggering it.
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e.stack || e); process.exit(1); });
}
