// What does 1337 skulls tokenURI(id) actually contain for a failing id?
import sha3 from 'js-sha3';
const { keccak_256 } = sha3;
const RPC = process.env.ETH_RPC_URL;
const SKULLS = '0x9251dec8df720c2adf3b6f46d968107cbbadf4d4';
const id = Number(process.argv[2] || 2847);
const sel = sig => '0x' + keccak_256(sig).slice(0, 8);
const word = v => BigInt(v).toString(16).padStart(64, '0');
const res = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: SKULLS, data: sel('tokenURI(uint256)') + word(id), gas: '0xf000000' }, 'latest'] }) });
const j = await res.json();
if (j.error) { console.log('ERROR:', j.error.message); process.exit(0); }
const clean = j.result.replace(/^0x/, '');
const rows = []; for (let i = 0; i + 64 <= clean.length; i += 64) rows.push(clean.slice(i, i + 64));
const off = Number(BigInt('0x' + rows[0])) / 32;
const len = Number(BigInt('0x' + rows[off]));
const uri = Buffer.from(rows.slice(off + 1).join('').slice(0, len * 2), 'hex').toString('utf8');
const comma = uri.indexOf(',');
const body = /;base64/i.test(uri.slice(0, comma)) ? Buffer.from(uri.slice(comma + 1), 'base64').toString('utf8') : decodeURIComponent(uri.slice(comma + 1));
const meta = JSON.parse(body.replace(/^"|"$/g, ''));
console.log('keys:', Object.keys(meta).join(','));
for (const k of ['svg_image_data', 'image', 'image_data']) if (meta[k]) console.log(`${k}: ${String(meta[k]).slice(0, 80)}`);
