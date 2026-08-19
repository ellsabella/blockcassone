import fs from 'node:fs';
import { createPublicClient, http, getAddress, isAddress } from 'viem';
import { mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';

const ROOT = '/mnt/c/Users/ellag/Desktop/blockcassone';
const D = ROOT + '/bot-analysis';
const OUT = ROOT + '/GTD2.txt';

function envVal(k) { try { const m = new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm').exec(fs.readFileSync('/home/elsabella/blockcassone/.env', 'utf8')); return m ? m[1].replace(/^['"]|['"]$/g, '').trim() : ''; } catch { return ''; } }
const RPC = envVal('ETH_RPC_URL') || envVal('BLOCKCASSONE_RPC_URL');
const client = createPublicClient({ chain: mainnet, transport: http(RPC) });

// 1) the 100 verified humans (address <tab> @handle)
const humans = fs.readFileSync(D + '/definitely-not-bot.txt', 'utf8').split('\n').filter(l => l.startsWith('0x'))
  .map(l => { const p = l.split('\t'); return { addr: p[0].toLowerCase(), nick: (p[1] || '').replace('@', '').trim() }; });

// 2) curated VIP list (mint-count dropped)
const MANUAL = `5,0xd8C77A29DdA47EEDBd5f56cC67F3B44570467941,Pax
5,0xe1ed598ddfa43672671b3ce4226e32002091bd33,BB
5,0x1bc4ad32e29a0b728755ac727e0961f910c55506,Dpoxley
5,0x0dc3615b60f3afc8b0a003fe82d8dd7845e00d34,crazyDog
5,0xcdf527c6099d4a3df3382756651535f5d950d5f1,ritchie
5,0x3804c03d09d8749033a742b013ad8e9b9790b3c3,persy
5,0x686adbfcaa75f7491bba9f8d035613671c11b507,CLOD
5,0xd6599331b6b48fa6bf8cbd4d7daa4bce4d4ea337,808
5,felixfelixfelix.eth,felix
5,burcin.eth,burcin
5,0x78086Ad810f8F99A0B6c92a9A6c8857d3c665622,ol1y
5,0x6718C0b9061159823440Abf4635707B2ed8E5CA8,darko
5,0xcEFBdCFb977b1f40F0CE434831705705A072e69A,0x8bit
5,stephensantoro.eth,stephen
5,0x3a6372B2013f9876a84761187d933DEe0653E377,backseats
5,0x16e23099cca4092C6c7ea3a56506aF6DCc58383A,marka
5,0xD8d61deF1Cf1367B614537AA5FA62C9243a77EA7,ordimusprime
5,germyjohn.eth,nftygify
5,web3ronin.eth,LukeGrindhouse
5,0xb86588647d5781ec3d0439e1076e797d685df0f2,matriona
5,along7.eth,pengwinpants
5,Efdot.eth,efdot
5,0x748909a5984a02C24BE962AD0E32340969bA9CAA,camcrypto
5,etovass.eth,eto
5,0x1423d7BA74817a2617Fa3E69b609a54E4DaF6f79,wildalps
5,azertybetamax.eth,azerty`;

const manual = MANUAL.trim().split('\n').map(l => { const p = l.split(','); return { idOrEns: p[1].trim(), nick: p.slice(2).join(',').trim() }; });

async function resolve(x) {
  if (isAddress(x)) return x.toLowerCase();
  if (/\.eth$/i.test(x)) { try { const a = await client.getEnsAddress({ name: normalize(x) }); return a ? a.toLowerCase() : null; } catch { return null; } }
  return null;
}

const unresolved = [];
const resolved = [];
for (const m of manual) {
  const a = await resolve(m.idOrEns);
  if (a) { resolved.push({ addr: a, nick: m.nick, ens: /\.eth$/i.test(m.idOrEns) ? m.idOrEns : '' }); }
  else { unresolved.push(m); console.log('  ⚠ UNRESOLVED:', m.idOrEns, '(' + m.nick + ')'); }
}

// merge + dedupe by address; VIP nickname wins over auto handle
const map = new Map();
for (const h of humans) if (h.addr) map.set(h.addr, { addr: h.addr, nick: h.nick });
let overlaps = 0;
for (const r of resolved) { if (map.has(r.addr)) overlaps++; map.set(r.addr, { addr: r.addr, nick: r.nick }); }

const lines = [...map.values()].map(e => `${getAddress(e.addr)},${e.nick}`);
fs.writeFileSync(OUT, lines.join('\n') + '\n');

console.log(`\nENS resolved:`);
for (const r of resolved.filter(r => r.ens)) console.log(`  ${r.ens}  →  ${getAddress(r.addr)}  (${r.nick})`);
console.log(`\nGTD2 written → ${OUT}`);
console.log(`  verified humans: ${humans.length}`);
console.log(`  VIP entries: ${manual.length} (resolved ${resolved.length}, unresolved ${unresolved.length})`);
console.log(`  overlaps merged (VIP already in the 100): ${overlaps}`);
console.log(`  TOTAL unique GTD2 addresses: ${lines.length}`);
