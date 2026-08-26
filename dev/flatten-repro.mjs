// Headless repro of the browser flattening pipeline for a wallet NFT.
// Shims fetch/Image/canvas so viewer/nft-art-grid.js runs verbatim in node,
// pulling the image through the SAME local server proxy the browser uses.
// Usage: node dev/flatten-repro.mjs <contract> <tokenId>   (IMG=<url> overrides the image; needs the dev server on :3000)
import { createRequire } from 'node:module';
const require = createRequire('/home/elsabella/blockcassone/');
const { PNG } = require('pngjs');

const BASE = 'http://localhost:3000';
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (url, opts) => realFetch(String(url).startsWith('/') ? BASE + url : url, opts);

const blobStore = new Map();
const _URL = globalThis.URL;
_URL.createObjectURL = (blob) => { const k = 'blob:' + Math.random().toString(36).slice(2); blobStore.set(k, blob); return k; };
_URL.revokeObjectURL = (k) => blobStore.delete(k);

class FakeImage {
  constructor() { this.width = 0; this.height = 0; this._rgba = null; this.decoding = ''; }
  async decode() {
    let buf;
    const src = this.src || '';
    if (src.startsWith('blob:')) buf = Buffer.from(await blobStore.get(src).arrayBuffer());
    else if (src.startsWith('data:')) buf = Buffer.from(src.slice(src.indexOf(',') + 1), src.includes(';base64,') ? 'base64' : 'utf8');
    else { const r = await realFetch(src); buf = Buffer.from(await r.arrayBuffer()); }
    if (!(buf[0] === 0x89 && buf[1] === 0x50)) {
      // Not PNG (seadn serves AVIF/WEBP) — bounce through ffmpeg, like the browser's native decode.
      const { execFileSync } = await import('node:child_process');
      const fs = await import('node:fs');
      const inF = `/tmp/repro-in-${process.pid}`, outF = `/tmp/repro-out-${process.pid}.png`;
      fs.writeFileSync(inF, buf);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', inF, '-frames:v', '1', outF]);
      buf = fs.readFileSync(outF);
    }
    const png = PNG.sync.read(buf);
    this.width = png.width; this.height = png.height; this._rgba = png.data;
  }
}
globalThis.Image = FakeImage;

function makeCanvas() {
  const c = { width: 0, height: 0, _data: null };
  const ctx = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    clearRect() { c._data = new Uint8ClampedArray(c.width * c.height * 4); },
    drawImage(img, dx, dy, dw, dh) {
      if (!c._data) c._data = new Uint8ClampedArray(c.width * c.height * 4);
      dw = Math.round(dw ?? img.width); dh = Math.round(dh ?? img.height);
      const sw = img.width, sh = img.height, src = img._rgba;
      for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
          const o = (y * c.width + x) * 4;
          if (!ctx.imageSmoothingEnabled) {
            // nearest (browser crisp-pixel path)
            const sx = Math.min(sw - 1, Math.floor((x + 0.5) * sw / dw));
            const sy = Math.min(sh - 1, Math.floor((y + 0.5) * sh / dh));
            const i = (sy * sw + sx) * 4;
            c._data[o] = src[i]; c._data[o + 1] = src[i + 1]; c._data[o + 2] = src[i + 2]; c._data[o + 3] = src[i + 3];
          } else {
            // box average (approximates high-quality downscale)
            const x0 = Math.floor(x * sw / dw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sw / dw));
            const y0 = Math.floor(y * sh / dh), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sh / dh));
            let r = 0, g = 0, b = 0, a = 0, n = 0;
            for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
              const i = (yy * sw + xx) * 4; const af = src[i + 3] / 255;
              r += src[i] * af; g += src[i + 1] * af; b += src[i + 2] * af; a += src[i + 3]; n++;
            }
            const am = a / n; const af = am ? am / 255 : 1;
            c._data[o] = r / n / af; c._data[o + 1] = g / n / af; c._data[o + 2] = b / n / af; c._data[o + 3] = am;
          }
        }
      }
    },
    getImageData() { return { data: c._data || new Uint8ClampedArray(c.width * c.height * 4) }; },
  };
  c.getContext = () => ctx;
  return c;
}
globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return makeCanvas();
    if (tag === 'textarea') { const t = { set innerHTML(v) { this.value = v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'); }, value: '' }; return t; }
    throw new Error('shim cannot create <' + tag + '>');
  },
};

const { imageUrlToBinaryGrid, gridToTonalPayload } = await import('/home/elsabella/blockcassone/viewer/nft-art-grid.js');

const [contract, tokenId] = process.argv.slice(2);
const meta = await (await realFetch(`${BASE}/api/opensea/chain/ethereum/contract/${contract}/nfts/${tokenId}`)).json();
const nft = meta.nft || meta;
const candidates = [nft.display_image_url, nft.image_url, nft.metadata?.image].filter(Boolean);
console.log('image candidates:', candidates);
const imageUrl = process.env.IMG || candidates[0];
console.log('using:', imageUrl);

const grid = await imageUrlToBinaryGrid(imageUrl);
console.log('\n--- flatten result ---');
console.log('kind:', grid.kind, ' gridSize:', grid.gridSize, ' ones:', grid.ones, ' depthMode:', grid.depthMode || '-');
console.log('pixelGrid:', JSON.stringify(grid.pixelGrid));
console.log('has bgBands40:', !!grid.bgBands40, grid.bgBands40 ? ('nonzero=' + Array.from(grid.bgBands40).filter(Boolean).length) : '');

const payload = gridToTonalPayload(grid);
let nonzero = 0; const hist = [0, 0, 0, 0];
const cells = new Uint8Array(1600);
for (let i = 0; i < 1600; i++) { const v = (payload[i >> 2] >> ((i & 3) << 1)) & 3; cells[i] = v; hist[v]++; if (v) nonzero++; }
console.log('\npayload: nonzero cells', nonzero, '/1600  band histogram', hist.join('/'));
const CH = [' ', '.', '+', '#'];
let art = '';
for (let y = 0; y < 40; y++) { let row = ''; for (let x = 0; x < 40; x++) row += CH[cells[y * 40 + x]]; art += row + '\n'; }
console.log('\n' + art);
