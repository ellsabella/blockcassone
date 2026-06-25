// Per-side edge-point plan — the JS twin of CubeThumbnailRendererV1._sidePlan /
// CubeFrameLayer._sidePlan. MUST stay byte-for-byte identical to the Solidity, or
// the 3D viewer and the on-chain 2D thumbnail disagree on which points exist and
// who owns them.
//
//   h = keccak256(abi.encodePacked(bytes32 seed, uint256 canon))
//   count   = 2 + h[0]%5            -> 2..6 orbs on this side
//   select exactly `count` of 7 sub-slots via exact sequential selection
//   ownerBit per placed sub         -> resolves shared-edge ownership
//
// canon is the edge's CANONICAL identity (the motif-local vertex pair: 2-3 -> 23,
// 3-4 -> 34, 4-5 -> 45, etc.), NOT a per-plane index, so the two faces sharing an
// edge derive the same plan and a sub is owned by exactly one plane, never both.

import { keccak256 } from './keccak.js';

function packedSeedCanon(seedHex, canon) {
  const hex = seedHex.replace(/^0x/, '').padStart(64, '0');
  const input = new Uint8Array(64);
  for (let i = 0; i < 32; i++) input[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  let c = BigInt(canon);
  for (let i = 31; i >= 0; i--) { input[32 + i] = Number(c & 0xffn); c >>= 8n; }
  return input;
}

/**
 * Returns the raw plan for one side.
 * @returns {{count:number, orbMask:number, ownerBits:number}}
 *   orbMask   bit i set => sub i has an orb (point present)
 *   ownerBits bit i set => that placed sub is owned by the "bit-1" side
 *             (the middle / unique plane). Only meaningful for placed subs.
 */
export function sidePlan(seedHex, canon) {
  const h = BigInt('0x' + keccak256(packedSeedCanon(seedHex, canon)));
  const count = 2 + Number((h & 0xffn) % 5n);
  let placed = 0, orbMask = 0, ownerBits = 0;
  for (let i = 0; i < 7; i++) {
    const needed = count - placed;
    const r = Number((h >> BigInt(8 + i * 8)) & 0xffn);
    if (r % (7 - i) < needed) {
      orbMask |= (1 << i);
      placed++;
      if (((h >> BigInt(72 + i)) & 1n) === 1n) ownerBits |= (1 << i);
    }
  }
  return { count, orbMask, ownerBits };
}

/**
 * Strand mask for a plane on a given side.
 * @param ownsBit1  true if THIS plane is the "bit-1" owner of a shared edge
 *                  (always the middle/unique plane). Ignored when `shared` false.
 * @param shared    true for the two internal shared edges (2-3, 4-5); false for
 *                  sole-owned edges (the plane grows every placed orb).
 */
export function strandMask(plan, shared, ownsBit1) {
  if (!shared) return plan.orbMask;                 // sole edge: grow all orbs
  return ownsBit1 ? plan.ownerBits                  // bit-1 side
                  : (plan.orbMask & ~plan.ownerBits); // bit-0 side
}
