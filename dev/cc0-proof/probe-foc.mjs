import sha3 from 'js-sha3';
const { keccak_256 } = sha3;
const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
const COLLECTIONS = [
  ['Onchain Kevin', '0x17B19C70bfcA098da3f2eFeF6e7FA3a1C42F5429'],
  ['Baby Pepes', '0x9131d8c7a411d90c6b164d296440701a0e5b3178'],
  ['CrypToadz', '0x1cb1a5e65610aeff2551a50f76a87a7d3fb649c6'],
  ['Nouns', '0x9c8ff314c9bc7f6e59a9d9225fb22946427edc03'],
];
const sel = s => '0x' + keccak_256(s).slice(0, 8);
const word = v => BigInt(v).toString(16).padStart(64, '0');
async function ethCall(to, data) {
  const res = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data, gas: '0x5f5e100' }, 'latest'] }) });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
async function codesize(to) {
  const res = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [to, 'latest'] }) });
  return ((await res.json()).result.length - 2) / 2;
}
function decodeString(hex) {
  const clean = hex.replace(/^0x/, ''); const rows = [];
  for (let i = 0; i + 64 <= clean.length; i += 64) rows.push(clean.slice(i, i + 64));
  const off = Number(BigInt('0x' + rows[0])) / 32;
  const len = Number(BigInt('0x' + rows[off]));
  return Buffer.from(rows.slice(off + 1).join('').slice(0, len * 2), 'hex').toString('utf8');
}
const dataBody = uri => { const c = uri.indexOf(','); return /;base64/i.test(uri.slice(0, c)) ? Buffer.from(uri.slice(c + 1), 'base64').toString('utf8') : decodeURIComponent(uri.slice(c + 1)); };

for (const [name, addr] of COLLECTIONS) {
  console.log(`\n===== ${name}  ${addr} =====`);
  try {
    console.log('codesize:', await codesize(addr));
    try { console.log('name:', decodeString(await ethCall(addr, sel('name()')))); } catch {}
    try { console.log('totalSupply:', Number(BigInt(await ethCall(addr, sel('totalSupply()'))))); } catch (e) { console.log('totalSupply: n/a'); }
    let uri, tid;
    for (const t of [1, 0, 100]) {
      try { uri = decodeString(await ethCall(addr, sel('tokenURI(uint256)') + word(t))); tid = t; break; } catch {}
    }
    if (!uri) { console.log('tokenURI: reverted for 1/0/100'); continue; }
    console.log(`tokenURI(${tid}) head:`, uri.slice(0, 80));
    if (uri.startsWith('data:application/json')) {
      const meta = JSON.parse(dataBody(uri));
      console.log('  json keys:', Object.keys(meta));
      const img = meta.image || meta.image_data || meta.svg_image_data || '';
      console.log('  image head:', String(img).slice(0, 70));
      if (String(img).startsWith('data:image/svg') || String(img).startsWith('<svg')) {
        const svg = String(img).startsWith('data:') ? dataBody(img) : img;
        console.log('  SVG bytes:', svg.length, '| <rect:', (svg.match(/<rect/g) || []).length, '| <image:', (svg.match(/<image/g) || []).length, '| viewBox:', (svg.match(/viewBox=['"][^'"]*/) || [''])[0]);
        console.log('  SVG head:', svg.slice(0, 200).replace(/\n/g, ' '));
      } else if (String(img).startsWith('data:image/png') || String(img).includes('image/png')) {
        console.log('  PNG image (raster)');
      } else if (String(img).startsWith('http') || String(img).startsWith('ipfs')) {
        console.log('  OFF-CHAIN image URL');
      }
    } else if (uri.startsWith('http') || uri.startsWith('ipfs')) {
      console.log('  OFF-CHAIN tokenURI');
    }
  } catch (e) { console.log('error:', e.message); }
}
