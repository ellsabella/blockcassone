import fs from 'node:fs';
import { getAddress, isAddress } from 'viem';
const ROOT = '/mnt/c/Users/ellag/Desktop/blockcassone';

const RAW = `0x5fC13C5A541041f8fa12fab492D064435eB8d2F5 @deltasauce
0x4cfd427ac7217ab1768f410efc33a37132b8f3c9 @vincentdemarco_
0x8ecc6cdd9c8120911f0e126ad7d6a674125a8aa4 @aloungkot
0xddb9ab1421e6f1d864c01ba63fb05b183d5ea4d4 zumbah.eth @zumbah
0xda035d4e5dfa3defa9cd5a57d5c2e41b1546a1d2 @0xaq_
0x518b1cf3f887b35c606a9333b5ef013565ff9b64 ammar7.eth @ipaperhand
0xdca95d7f7533548a9124edc6959fcdb2e56f0b07 pulao.eth @makhimaar16
0xbac44851587e68495f6bf2f91bd8260234d6bcbb acrophase.eth @jibraatka666
0x53f95f79fc93cfde0a4942afda17a814d41ce33b @Rohailshahzad01
0x4c2317be9d0f3a9034db2fec8d4fd4372a25ba8b @khizer_eth
0xb6bf40819b35df323b6376a29f5d467b97c9adf9 @ZunairaUsman84
0x3a661a18cb0258119636dfdde098648c6ad5ba62 @mrc_arte`;

const entries = RAW.trim().split('\n').map(l => {
  const t = l.trim().split(/\s+/);
  const h = t.find(x => x.startsWith('@')) || '';
  return { addr: t[0].toLowerCase(), nick: h.replace(/^@/, '') };
}).filter(e => isAddress(e.addr));

// --- append to GTD2 (dedupe vs existing) ---
const gtdLines = fs.readFileSync(ROOT + '/GTD2.txt', 'utf8').split('\n').filter(Boolean);
const existing = new Set(gtdLines.map(l => l.split(',')[0].toLowerCase()));
const toAdd = entries.filter(e => !existing.has(e.addr));
const dupes = entries.filter(e => existing.has(e.addr));
if (toAdd.length) fs.appendFileSync(ROOT + '/GTD2.txt', toAdd.map(e => `${getAddress(e.addr)},${e.nick}`).join('\n') + '\n');

// --- remove these from FCFS (now guaranteed) ---
const addSet = new Set(entries.map(e => e.addr));
const fcfs = JSON.parse(fs.readFileSync(ROOT + '/fcfs-wallets.json', 'utf8'));
const fcfsKept = fcfs.filter(a => !addSet.has(a.toLowerCase()));
fs.writeFileSync(ROOT + '/fcfs-wallets.json', JSON.stringify(fcfsKept, null, 2));
const csv = fs.readFileSync(ROOT + '/fcfs-holders.csv', 'utf8').split('\n');
const body = csv.slice(1).filter(l => l.startsWith('0x') && !addSet.has(l.split(',')[0].toLowerCase()));
fs.writeFileSync(ROOT + '/fcfs-holders.csv', csv[0] + '\n' + body.join('\n') + '\n');

console.log(`GTD2: +${toAdd.length} added${dupes.length ? ` (${dupes.length} already present: ${dupes.map(d => d.nick).join(', ')})` : ''} → total ${gtdLines.length + toAdd.length}`);
console.log(`FCFS: removed ${fcfs.length - fcfsKept.length} now-guaranteed wallet(s) → ${fcfsKept.length}`);
