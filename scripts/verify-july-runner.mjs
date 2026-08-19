// Prove data/cc0/0.hex (art-check mock Runner #1000) is the DNA-CORRECT flatten of
// REAL Chain Runner #1: re-flatten #1 fresh through the fixed decoder and byte-compare.
import fs from 'node:fs';
process.env.RPC_URL = process.env.RPC_URL || process.env.ETH_RPC_URL;
const { crGrid, flatten } = await import('../dev/cc0-proof/flatten.mjs');
const g = await crGrid(1);
const f = flatten(g.colors, g.size);
const fresh = '0x' + Buffer.from(f.payload).toString('hex');
const july = fs.readFileSync('data/cc0/0.hex', 'utf8').trim();
console.log('fresh flatten of real Runner #1 == data/cc0/0.hex:', fresh === july);
