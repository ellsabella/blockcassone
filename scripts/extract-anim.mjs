// Pull tokenURI for a rehearsal cube, decode it, and dump animation_url to an HTML
// file for inspection — plus quick static sanity checks (URI scheme, decode, tail).
import fs from 'node:fs';
import { createPublicClient, http } from 'viem';

const [id = '6'] = process.argv.slice(2);
const RPC = process.env.BLOCKCASSONE_RPC_URL;
const { cubeNft } = JSON.parse(fs.readFileSync('data/rehearsal/contracts.json', 'utf8'));
const pub = createPublicClient({ transport: http(RPC) });

const uri = await pub.readContract({
  address: cubeNft,
  abi: [{ type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'string' }] }],
  functionName: 'tokenURI', args: [BigInt(id)],
});
console.log('tokenURI scheme:', uri.slice(0, 40));

let json;
if (uri.startsWith('data:application/json;base64,')) json = JSON.parse(Buffer.from(uri.slice(29), 'base64').toString('utf8'));
else if (uri.startsWith('data:application/json;utf8,')) json = JSON.parse(uri.slice(27));
else if (uri.startsWith('data:application/json,')) json = JSON.parse(decodeURIComponent(uri.slice(22)));
else if (uri.trimStart().startsWith('{')) json = JSON.parse(uri);
else { console.log('UNRECOGNIZED tokenURI prefix:', JSON.stringify(uri.slice(0, 80))); process.exit(1); }

console.log('metadata keys:', Object.keys(json).join(','));
console.log('name:', json.name);
console.log('image scheme:', String(json.image || '').slice(0, 40));
// Strict data-URI hygiene: characters that are invalid unescaped in a URI.
const bad = (uri.match(/[^A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]/g) || []);
const counts = {};
for (const c of bad) counts[JSON.stringify(c)] = (counts[JSON.stringify(c)] || 0) + 1;
console.log('URI-unsafe chars in tokenURI:', Object.entries(counts).slice(0, 12).map(([c, n]) => `${c}x${n}`).join(' ') || 'none');
const anim = json.animation_url || '';
console.log('animation_url scheme:', anim.slice(0, 40));
console.log('animation_url length:', anim.length);

let html;
if (anim.startsWith('data:text/html;base64,')) html = Buffer.from(anim.slice(22), 'base64').toString('utf8');
else if (anim.startsWith('data:text/html;utf8,')) html = anim.slice(20);
else if (anim.startsWith('data:text/html,')) html = decodeURIComponent(anim.slice(15));
else { console.log('UNEXPECTED animation_url prefix:', JSON.stringify(anim.slice(0, 80))); process.exit(1); }

fs.writeFileSync(`data/rehearsal/anim-${id}.html`, html);
console.log('html length:', html.length);
console.log('head:', JSON.stringify(html.slice(0, 120)));
console.log('tail:', JSON.stringify(html.slice(-120)));
console.log('script tags:', (html.match(/<script/g) || []).length, '/ closers:', (html.match(/<\/script>/g) || []).length);
console.log('has normies-api import:', html.includes('normies-api'));
console.log('wrote data/rehearsal/anim-' + id + '.html');
