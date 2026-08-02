// Client mirror of contracts/src/lib/CubeEnv.sol — the biome (environment) of a street,
// derived deterministically so the viewer agrees with the chain without an RPC call.
//   id = weightedPick(keccak256(abi.encodePacked(WORLD_SEED, street)) % 100)
// Biome fee weights mirror CubeNFT's biomeWeight defaults (owner-tunable on-chain; used
// only for DISPLAY + rough fee hints here — real fees come from quoteMove/quoteMerge).
import { keccak256 } from '../core/keccak.js';

const utf8 = s => { const o = unescape(encodeURIComponent(s)); const b = new Uint8Array(o.length); for (let i = 0; i < o.length; i++) b[i] = o.charCodeAt(i); return b; };
const hexToBytes = h => { h = String(h).replace(/^0x/, ''); const a = new Uint8Array(h.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; };

export const WORLD_SEED = keccak256(utf8('blockcassone-environments-v1')); // hex, no 0x

// id: 0 desert · 1 water · 2 grass · 3 forest · 4 mountain · 5 ice
export const BIOMES = [
  { id: 0, key: 'desert',   name: 'desert',   emoji: '🏜️', weight: 3  },
  { id: 1, key: 'water',    name: 'water',    emoji: '🌊', weight: 1  },
  { id: 2, key: 'grass',    name: 'grass',    emoji: '🌿', weight: 1  },
  { id: 3, key: 'forest',   name: 'forest',   emoji: '🌲', weight: 1  },
  { id: 4, key: 'mountain', name: 'mountain', emoji: '🏔️', weight: 8  },
  { id: 5, key: 'ice',      name: 'ice',      emoji: '🧊', weight: 12 },
];

export function biomeIdForStreet(street) {
  const streetHex = BigInt(street).toString(16).padStart(64, '0');
  const r = BigInt('0x' + keccak256(hexToBytes(WORLD_SEED + streetHex))) % 100n;
  if (r < 34n) return 2; // grass 34
  if (r < 64n) return 3; // forest 30
  if (r < 84n) return 1; // water 20
  if (r < 96n) return 0; // desert 12
  if (r < 99n) return 4; // mountain 3
  return 5;              // ice 1
}

export const biomeForStreet = street => BIOMES[biomeIdForStreet(street)];
