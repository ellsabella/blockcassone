// Reset rehearsal state for a re-run, keeping the already-funded ephemeral wallets.
import fs from 'node:fs';
const p = new URL('../data/rehearsal/state.json', import.meta.url);
const s = JSON.parse(fs.readFileSync(p, 'utf8'));
fs.writeFileSync(p, JSON.stringify({ done: {}, results: {}, wallets: s.wallets }, null, 2));
console.log('state reset, wallets kept:', Object.keys(s.wallets || {}).join(','));
