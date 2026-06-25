// Minimal Keccak-256 (Ethereum variant: 0x01 pad start, 0x80 pad end).
// BigInt 64-bit lanes — not fast, but we only hash 64-byte inputs a few times
// per cube. Must match Solidity's keccak256(abi.encodePacked(...)) byte-for-byte.

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// rho rotation offsets, lane index = x + 5*y
const R = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

const MASK = (1n << 64n) - 1n;
const rotl = (x, n) => { const b = BigInt(n); return ((x << b) | (x >> (64n - b))) & MASK; };

function keccakF(s) {
  for (let round = 0; round < 24; round++) {
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    const D = new Array(5);
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] ^= D[x];

    const B = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], R[x + 5 * y]);
    }
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      s[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y] & MASK) & B[(x + 2) % 5 + 5 * y]);
    }
    s[0] ^= RC[round];
  }
}

/** keccak256 over a Uint8Array, returns 64-char lowercase hex (no 0x). */
export function keccak256(bytes) {
  const rate = 136; // 1088-bit rate for 256-bit output
  const s = new Array(25).fill(0n);

  const len = bytes.length;
  const padLen = rate - (len % rate);
  const padded = new Uint8Array(len + padLen);
  padded.set(bytes);
  padded[len] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;

  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 0; b < 8; b++) lane |= BigInt(padded[off + i * 8 + b]) << BigInt(8 * b);
      s[i] ^= lane;
    }
    keccakF(s);
  }

  let out = '';
  for (let i = 0; i < 4; i++) {
    for (let b = 0; b < 8; b++) {
      out += Number((s[i] >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, '0');
    }
  }
  return out;
}
