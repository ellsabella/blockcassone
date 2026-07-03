// Regression guard for core/keccak.js — the byte-exact JS twin of Solidity's
// keccak256(abi.encodePacked(...)). It once mishandled inputs spanning more than
// one 136-byte sponge block (the ">136-byte multi-block bug"), which forced the
// viewer to hash large preimages over RPC (web3_sha3). It is now correct; this
// locks that in by fuzzing every length 0..600 (crossing several block boundaries)
// against an independent reference (js-sha3), plus asserting the real 400-byte
// tonal-payload preimage against a Foundry (`cast keccak`) constant so the on-chain
// customize/attestation hash can't silently drift. Run: `npm run check:keccak`.

import sha3 from 'js-sha3';
import { keccak256 } from '../core/keccak.js';

const ref = sha3.keccak256;

// Deterministic input of `len` bytes.
function vec(len, a = 131, c = 29) {
  const b = new Uint8Array(len);
  for (let i = 0; i < len; i++) b[i] = (i * a + len * 7 + c) & 0xff;
  return b;
}

let failures = 0;

// 1) Fuzz every length across ~4.5 sponge blocks against js-sha3.
let firstBad = -1;
for (let len = 0; len <= 600; len++) {
  if (keccak256(vec(len)) !== ref(vec(len))) {
    failures++;
    if (firstBad === -1) firstBad = len;
  }
}
console.log(
  firstBad === -1
    ? 'ok   fuzz 0..600 bytes == js-sha3'
    : `FAIL fuzz diverged from js-sha3 at len=${firstBad}`
);

// 2) A few large random lengths for good measure.
for (const len of [1000, 1361, 4096]) {
  const b = vec(len, 97, 3);
  if (keccak256(b) !== ref(b)) {
    failures++;
    console.log(`FAIL random len=${len}`);
  } else {
    console.log(`ok   random len=${len}`);
  }
}

// 3) The exact preimage the customize flow hashes: NonNormieArt.hashTonalBands2Bit
//    = keccak256(abi.encode(bytes32 DOMAIN, bytes payload)) for a 400-byte payload.
//    Expected constant produced by Foundry `cast keccak` (the actual EVM).
{
  const DOMAIN = '2424f34564746cf332e7899072209873d7b38b19d87170b49d20de18f6a251dd';
  const word = (n) => BigInt(n).toString(16).padStart(64, '0');
  const bytesToHex = (u8) => Array.from(u8, (x) => x.toString(16).padStart(2, '0')).join('');
  const padRight32 = (h) => (h.length % 64 === 0 ? h : h + '0'.repeat(64 - (h.length % 64)));
  const hexToBytes = (hex) => {
    const h = hex.replace(/^0x/, '');
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
  };

  const payload = new Uint8Array(400);
  for (let i = 0; i < 400; i++) payload[i] = (i * 13 + 7) & 0xff;
  const preimage = DOMAIN + word(64) + word(payload.length) + padRight32(bytesToHex(payload));
  const got = '0x' + keccak256(hexToBytes(preimage));
  const expected = '0x7cf2263ef8a105fa5945af5e71f6fc13d6f6151878c40f1de2159bff16d8ee94';
  if (got === expected) {
    console.log('ok   tonal-preimage(400B) == Foundry cast keccak');
  } else {
    failures++;
    console.log(`FAIL tonal-preimage(400B) got=${got}`);
  }
}

if (failures) {
  console.error(`\n${failures} keccak check(s) FAILED — core/keccak.js diverged from Solidity.`);
  process.exit(1);
}
console.log('\nAll keccak checks pass. ✔');
