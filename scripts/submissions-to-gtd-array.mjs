// allowlist-submissions.jsonl -> gtd-final.json: the GTD records only, deduped by
// wallet (last submission wins), as the JSON array reserve.mjs --in expects.
import fs from 'node:fs';
const rows = fs.readFileSync('allowlist-submissions.jsonl', 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const byWallet = new Map();
for (const r of rows) if (r.kind === 'gtd') byWallet.set(r.wallet.toLowerCase(), r);
const out = [...byWallet.values()];
fs.writeFileSync('gtd-final.json', JSON.stringify(out, null, 2));
console.log(`gtd-final.json: ${out.length} gtd wallets, ${out.reduce((a, r) => a + (r.sources || []).length, 0)} sources`);
