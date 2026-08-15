// Reset a driver run's state for a re-run, keeping the already-funded ephemeral
// wallets. Usage: node rehearsal-reset.mjs [rehearsal|sepolia-full]
import fs from 'node:fs';
const dir = process.argv[2] || 'rehearsal';
const p = new URL(`../data/${dir}/state.json`, import.meta.url);
const s = JSON.parse(fs.readFileSync(p, 'utf8'));
fs.writeFileSync(p, JSON.stringify({ done: {}, results: {}, wallets: s.wallets }, null, 2));
console.log('state reset, wallets kept:', Object.keys(s.wallets || {}).join(','));
