import fs from 'node:fs';
import { createPublicClient, http, getAddress } from 'viem';
import { mainnet } from 'viem/chains';
const ROOT = '/mnt/c/Users/ellag/Desktop/blockcassone';
const TAL = '0x724d5beffe9a84a87ad1af83713f80600e5f5774';
function envVal(k) { try { const m = new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'm').exec(fs.readFileSync('/home/elsabella/blockcassone/.env', 'utf8')); return m ? m[1].replace(/^['"]|['"]$/g, '').trim() : ''; } catch { return ''; } }
const RPC = envVal('ETH_RPC_URL');
const client = createPublicClient({ chain: mainnet, transport: http(RPC) });

// --- Talismans balances from the merged snapshot CSV ---
const csv = fs.readFileSync(ROOT + '/fcfs-source-holders-holders.csv', 'utf8').trim().split('\n');
const header = csv[0].split(',');
const ti = header.slice(1, -1).indexOf(TAL);
if (ti < 0) throw new Error('Talismans column not found');
const rows = csv.slice(1).filter(l => l.startsWith('0x')).map(l => { const p = l.split(','); return { w: p[0].toLowerCase(), tal: Number(p[1 + ti]) }; })
  .filter(r => r.tal > 0).sort((a, b) => b.tal - a.tal);

// --- code-check the top 40 (exclude contracts), keep top 20 EOAs ---
const cands = rows.slice(0, 40);
const body = cands.map((r, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_getCode', params: [r.w, 'latest'] }));
const res = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const isC = {}; for (const e of res) { const w = cands[e.id].w; isC[w] = typeof e.result === 'string' && e.result !== '0x' && e.result.length > 2; }
const contracts = cands.filter(r => isC[r.w]);
const top20 = cands.filter(r => !isC[r.w]).slice(0, 20);

// --- reverse-ENS for nicknames ---
for (const r of top20) { try { r.ens = await client.getEnsName({ address: getAddress(r.w) }); } catch { r.ens = null; } }

// --- dedupe vs existing GTD2, append ---
const gtdLines = fs.readFileSync(ROOT + '/GTD2.txt', 'utf8').split('\n').filter(Boolean);
const existing = new Set(gtdLines.map(l => l.split(',')[0].toLowerCase()));
const toAdd = top20.filter(r => !existing.has(r.w));
if (toAdd.length) fs.appendFileSync(ROOT + '/GTD2.txt', toAdd.map(r => `${getAddress(r.w)},${r.ens || ''}`).join('\n') + '\n');

// --- remove the added ones from FCFS ---
const addSet = new Set(toAdd.map(r => r.w));
const fcfs = JSON.parse(fs.readFileSync(ROOT + '/fcfs-wallets.json', 'utf8'));
const kept = fcfs.filter(a => !addSet.has(a.toLowerCase()));
fs.writeFileSync(ROOT + '/fcfs-wallets.json', JSON.stringify(kept, null, 2));
const fcsv = fs.readFileSync(ROOT + '/fcfs-holders.csv', 'utf8').split('\n');
fs.writeFileSync(ROOT + '/fcfs-holders.csv', fcsv[0] + '\n' + fcsv.slice(1).filter(l => l.startsWith('0x') && !addSet.has(l.split(',')[0].toLowerCase())).join('\n') + '\n');

console.log(`Talismans holders: ${rows.length} | contracts skipped in top-40: ${contracts.length}`);
console.log('\nTop 20 Talismans holders (EOA) added to GTD2:');
for (const r of top20) console.log(`  ${getAddress(r.w)}  ${String(r.tal).padStart(4)}  ${r.ens || ''}`);
console.log(`\nGTD2: +${toAdd.length} added (${top20.length - toAdd.length} already present) → total ${gtdLines.length + toAdd.length}`);
console.log(`FCFS: removed ${fcfs.length - kept.length} → ${kept.length}`);
