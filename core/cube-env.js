// Environment (biome) model — the JS twin of contracts/src/lib/CubeEnv.sol.
// Environment is a STREET property (street = slot/8); all 8 plots share it.
// Deterministic, rarity-weighted, and MUST stay byte-identical to the Solidity
// (same WORLD_SEED + weights) so the 3D biomes match the on-chain Environment
// trait — same parity discipline as side-plan.js.

import { keccak256 } from './keccak.js';

// keccak256("blockcassone-environments-v1") — must equal CubeEnv.WORLD_SEED.
const WORLD_SEED = keccak256(new TextEncoder().encode('blockcassone-environments-v1'));

// Biome ids match the ENVIRONMENTS array order in viewer/environments.js.
export const ENV_NAMES = ['desert', 'water', 'grass', 'forest', 'mountain', 'ice'];

function packedSeedStreet(street) {
  // abi.encodePacked(bytes32 WORLD_SEED, uint256 street) = 64 bytes
  const input = new Uint8Array(64);
  for (let i = 0; i < 32; i++) input[i] = parseInt(WORLD_SEED.slice(i * 2, i * 2 + 2), 16);
  let s = BigInt(street);
  for (let i = 31; i >= 0; i--) { input[32 + i] = Number(s & 0xffn); s >>= 8n; }
  return input;
}

// Weights out of 100: grass 34, forest 30, water 20, desert 12, mountain 3, ice 1.
export function environmentIdForStreet(street) {
  const r = Number(BigInt('0x' + keccak256(packedSeedStreet(street))) % 100n);
  if (r < 34) return 2; // grass
  if (r < 64) return 3; // forest
  if (r < 84) return 1; // water
  if (r < 96) return 0; // desert
  if (r < 99) return 4; // mountain
  return 5; // ice
}

export function environmentNameForStreet(street) {
  return ENV_NAMES[environmentIdForStreet(street)];
}
