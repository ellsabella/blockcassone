// Visual verification for the Chain Runners DNA fix: for sample pool ids, put the
// OFFICIAL on-chain render (renderer.tokenSVG(getDna(id))) next to our corrected
// 400-byte flattened payload (decoded to a 40x40 tonal grid). Output is a single
// self-contained HTML file — open it and compare against OpenSea if desired.
import fs from 'node:fs';
import sha3 from 'js-sha3';
const { keccak_256 } = sha3;

const RPC = process.env.ETH_RPC_URL;
const CR = '0x97597002980134bea46250aa0510c9b90d87a587';
const REND = '0xfdac77881ff861ff76a83cc43a1be3c317c6a1cc';
const sel = sig => '0x' + keccak_256(sig).slice(0, 8);
const word = v => BigInt(v).toString(16).padStart(64, '0');

async function ethCall(to, data) {
  const res = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data, gas: '0xf000000' }, 'latest'] }) });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
function decodeString(hex) {
  const clean = hex.replace(/^0x/, ''); const rows = [];
  for (let i = 0; i + 64 <= clean.length; i += 64) rows.push(clean.slice(i, i + 64));
  const off = Number(BigInt('0x' + rows[0])) / 32;
  const len = Number(BigInt('0x' + rows[off]));
  return Buffer.from(rows.slice(off + 1).join('').slice(0, len * 2), 'hex').toString('utf8');
}

// 400-byte 2-bit payload -> 40x40 svg (band 0 = background/dark ... 3 = brightest).
function payloadSvg(hex) {
  const bytes = Buffer.from(hex.replace(/^0x/, ''), 'hex');
  const shade = ['#000', '#4a4a4a', '#9a9a9a', '#f2f2f2'];
  let rects = '';
  for (let i = 0; i < 1600; i++) {
    const band = (bytes[i >> 2] >> ((i & 3) * 2)) & 3;
    if (band === 0) continue;
    rects += `<rect x="${i % 40}" y="${(i / 40) | 0}" width="1" height="1" fill="${shade[band]}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="240" height="240" style="background:#000;image-rendering:pixelated">${rects}</svg>`;
}

const pool = JSON.parse(fs.readFileSync('data/cc0/pool-runner.json', 'utf8')).tokenIds;
const sample = [pool[0], pool[100], pool[300], pool[500], pool[700], pool[900]];
let html = '<meta charset=utf-8><title>CR verify</title><body style="background:#111;color:#eee;font-family:monospace"><h2>Chain Runners — official render vs corrected flattened payload</h2>';
for (const id of sample) {
  const dna = (await ethCall(CR, sel('getDna(uint256)') + word(id))).replace(/^0x/, '');
  const svg = Buffer.from(decodeString(await ethCall(REND, sel('tokenSVG(uint256)') + dna)), 'base64').toString('utf8');
  const ours = payloadSvg(fs.readFileSync(`data/cc0-full/runner/${id}.hex`, 'utf8').trim());
  html += `<div style="margin:16px"><b>Chain Runner #${id}</b><br><div style="display:flex;gap:12px;align-items:flex-start">
    <div><div>official (dna render)</div><img width="240" height="240" style="image-rendering:pixelated" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></div>
    <div><div>our 2-bit tonal payload</div>${ours}</div></div></div>`;
}
fs.writeFileSync('data/cc0-full/cr-verify.html', html);
console.log(`wrote data/cc0-full/cr-verify.html (${sample.join(', ')})`);
