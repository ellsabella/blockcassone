import fs from 'node:fs';
import zlib from 'node:zlib';
const i = process.argv[2] || '9';

// --- tiny PNG encoder (8-bit RGB) ---
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}
function png(w, h, rgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const stride = w * 3, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; Buffer.from(rgb.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1); }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const S = 10, W = 40 * S; // 400px
const px = () => new Uint8Array(W * W * 3);
const set = (buf, x, y, r, g, b) => { if (x < 0 || x >= W || y < 0 || y >= W) return; const o = (y * W + x) * 3; buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; };

// bands
const hex = fs.readFileSync(`data/cc0/${i}.hex`, 'utf8').trim().replace(/^0x/, '');
const bands = new Uint8Array(1600);
for (let k = 0; k < 1600; k++) { const byte = parseInt(hex.substr((k >> 2) * 2, 2), 16); bands[k] = (byte >> ((k & 3) * 2)) & 3; }

// tonal PNG: filled cells (band 0 black, 1..3 grays)
const shade = [10, 90, 150, 230];
const tonal = px();
for (let r = 0; r < 40; r++) for (let c = 0; c < 40; c++) { const v = shade[bands[r * 40 + c]]; for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) set(tonal, c * S + dx, r * S + dy, v, v, v); }
fs.writeFileSync(`dev/cc0-proof/out/tonal-${i}.png`, png(W, W, tonal));

// outline PNG from the on-chain SVG #o path (grid coords x10)
const svg = fs.readFileSync(`data/cc0/thumb-${i}.svg`, 'utf8');
const d = (svg.match(/<path id="o" d="([^"]*)"/) || ['', ''])[1];
const out = px();
const re = /M(\d+) (\d+)([vh])1/g; let m;
const line = (buf, x0, y0, x1, y1) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let t = 0; t <= n; t++) { const x = Math.round(x0 + (x1 - x0) * t / n), y = Math.round(y0 + (y1 - y0) * t / n); set(buf, x, y, 255, 60, 60); set(buf, x + 1, y, 255, 60, 60); } };
const svgSet = new Set();
while ((m = re.exec(d))) { const x = +m[1] * S, y = +m[2] * S; if (m[3] === 'v') line(out, x, y, x, y + S); else line(out, x, y, x + S, y); svgSet.add(`${m[3]}${m[1]},${m[2]}`); }
fs.writeFileSync(`dev/cc0-proof/out/outline-${i}.png`, png(W, W, out));

// --- cube's contour algorithm (findBandContourEdges) on the SAME bands ---
const at = (r, c) => (r < 0 || r >= 40 || c < 0 || c >= 40) ? 0 : bands[r * 40 + c];
const cubeSet = new Set();
for (let r = 0; r < 40; r++) for (let c = 1; c < 40; c++) if (at(r, c - 1) !== at(r, c)) cubeSet.add(`v${c},${r}`);
for (let r = 1; r < 40; r++) for (let c = 0; c < 40; c++) if (at(r - 1, c) !== at(r, c)) cubeSet.add(`h${c},${r}`);
const cube = px();
for (const e of cubeSet) { const [t, xy] = [e[0], e.slice(1).split(',')]; const x = +xy[0] * S, y = +xy[1] * S; if (t === 'v') line(cube, x, y, x, y + S); else line(cube, x, y, x + S, y); }
fs.writeFileSync(`dev/cc0-proof/out/cube-outline-${i}.png`, png(W, W, cube));

const onlyCube = [...cubeSet].filter(e => !svgSet.has(e));
const onlySvg = [...svgSet].filter(e => !cubeSet.has(e));
const rowOf = e => +e.slice(1).split(',')[1];
const eye = e => rowOf(e) >= 12 && rowOf(e) <= 27;
console.log(`SVG edges: ${svgSet.size} | cube edges: ${cubeSet.size}`);
console.log(`only-in-cube: ${onlyCube.length}  only-in-SVG: ${onlySvg.length}`);
console.log(`EYE region (rows 12-27) only-in-cube: ${onlyCube.filter(eye).join(' ') || 'none'}`);
console.log(`EYE region only-in-SVG: ${onlySvg.filter(eye).join(' ') || 'none'}`);
console.log(`all diffs by row: cube-only rows [${[...new Set(onlyCube.map(rowOf))].sort((a,b)=>a-b).join(',')}]  svg-only rows [${[...new Set(onlySvg.map(rowOf))].sort((a,b)=>a-b).join(',')}]`);
console.log(`wrote tonal-${i}.png + outline-${i}.png (svg) + cube-outline-${i}.png`);
