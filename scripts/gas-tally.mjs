// Tally actual gas used by the DeploySepoliaFull broadcast (receipts in run-latest).
import fs from 'node:fs';
const run = JSON.parse(fs.readFileSync('broadcast/DeploySepoliaFull.s.sol/11155111/run-latest.json', 'utf8'));
let total = 0n, n = 0;
const byKind = {};
for (const r of run.receipts || []) {
  const gas = BigInt(r.gasUsed);
  total += gas; n++;
}
for (const t of run.transactions || []) {
  const kind = t.contractName || t.function || 'other';
  byKind[kind] = (byKind[kind] || 0) + 1;
}
console.log(`receipts: ${n}, total gasUsed: ${total} (${(Number(total) / 1e6).toFixed(1)}M)`);
console.log('tx breakdown:', JSON.stringify(byKind));
