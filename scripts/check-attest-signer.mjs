// One-off: prove /api/attest (viem, server-side key) produces the SAME EIP-712
// signature as the working dev path (Anvil eth_signTypedData_v4 with the unlocked
// signer). Ethereum sigs are deterministic (RFC 6979), so byte-equality means the
// server signer is a drop-in for the dev signer that FlatteningAttestation accepts.
//
// Run against the local Anvil started for the E2E:
//   node scripts/check-attest-signer.mjs
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'node:fs';

const cfg = JSON.parse(readFileSync(new URL('../data/chain-config.json', import.meta.url)));
// Anvil account #1 = the dev attestationSigner (0x7099...). Its private key:
const SIGNER_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const account = privateKeyToAccount(SIGNER_PK);

if (account.address.toLowerCase() !== String(cfg.attestationSigner).toLowerCase()) {
  console.error(`signer mismatch: viem=${account.address} config=${cfg.attestationSigner}`);
  process.exit(1);
}

const types = {
  Attestation: [
    { name: 'minter', type: 'address' },
    { name: 'sourceContract', type: 'address' },
    { name: 'sourceTokenId', type: 'uint256' },
    { name: 'payloadVersion', type: 'uint8' },
    { name: 'agentic', type: 'bool' },
    { name: 'agentId', type: 'uint256' },
    { name: 'flatteningVersion', type: 'uint16' },
    { name: 'payloadHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};
const domain = {
  name: 'TheBLOCKFlattening',
  version: '1',
  chainId: Number(cfg.chainId || 31337),
  verifyingContract: cfg.flatteningAttestation,
};
const message = {
  minter: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  sourceContract: '0x0123456789abcDEF0123456789abCDef01234567',
  sourceTokenId: 7n,
  payloadVersion: 1,
  agentic: false,
  agentId: 0n,
  flatteningVersion: 1,
  payloadHash: '0x' + 'ab'.repeat(32),
  nonce: 123456789n,
  deadline: 9999999999n,
};

// (a) viem — exactly what /api/attest does server-side.
const viemSig = await account.signTypedData({ domain, types, primaryType: 'Attestation', message });

// (b) Anvil eth_signTypedData_v4 — the working dev path. Values as strings, EIP712Domain included.
const typedData = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Attestation: types.Attestation,
  },
  primaryType: 'Attestation',
  domain,
  message: {
    minter: message.minter,
    sourceContract: message.sourceContract,
    sourceTokenId: message.sourceTokenId.toString(),
    payloadVersion: message.payloadVersion,
    agentic: message.agentic,
    agentId: message.agentId.toString(),
    flatteningVersion: message.flatteningVersion,
    payloadHash: message.payloadHash,
    nonce: message.nonce.toString(),
    deadline: message.deadline.toString(),
  },
};
const rpc = cfg.rpcUrl || 'http://127.0.0.1:8545';
const res = await fetch(rpc, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_signTypedData_v4', params: [cfg.attestationSigner, typedData] }),
});
const j = await res.json();
if (j.error) { console.error('anvil sign error:', j.error); process.exit(1); }
const anvilSig = j.result;

console.log('signer  :', account.address);
console.log('viem sig:', viemSig);
console.log('anvil   :', anvilSig);
console.log(viemSig.toLowerCase() === anvilSig.toLowerCase() ? 'MATCH ✓ — server signer is a drop-in' : 'MISMATCH ✗');
process.exit(viemSig.toLowerCase() === anvilSig.toLowerCase() ? 0 : 1);
