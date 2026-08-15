// Quick shape/tally of the downloaded allowlist submissions (no verification —
// reserve.mjs is the verifier; this just counts what people asked for).
import fs from 'node:fs';
const path = process.argv[2] || 'allowlist-submissions.jsonl';
const rows = fs.readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const byWallet = new Map();
for (const r of rows) byWallet.set(r.wallet.toLowerCase(), r); // last submission wins
const gtd = [...byWallet.values()].filter(r => r.kind === 'gtd');
const interest = [...byWallet.values()].filter(r => r.kind === 'interest');
const perCollection = {};
let totalPicks = 0;
for (const g of gtd) for (const s of g.sources || []) {
  perCollection[s.collectionId] = (perCollection[s.collectionId] || 0) + 1;
  totalPicks++;
}
console.log(`rows ${rows.length}, unique wallets ${byWallet.size}`);
console.log(`gtd ${gtd.length} wallets / ${totalPicks} picked sources; interest ${interest.length} wallets`);
console.log('picks by collectionId (0=Normie,1=Runners,2=Skulls,3=Pepes,4=Nouns,5=Kevin):', JSON.stringify(perCollection));
