// Blockcassone — Guaranteed Allowlist configuration + the delegate-registry ABI.

export const CONFIG = {
  // GTD entitlement: per-collection weighted spots (reflecting floor-price differences),
  // summed, floored, then hard-capped per wallet. Keyed by collectionId (see collections[]):
  //   Normie(0) / Noun(4) / OnChainKevin(5) = 1 spot
  //   Chain Runner(1) = ½ · 1337 Skull(2) = ½ · Baby Pepe(3) = ¼
  gtdCapPerWallet: 5,
  spotWeights: { 0: 1, 1: 0.5, 2: 0.5, 3: 0.25, 4: 1, 5: 1 },

  // WalletConnect Cloud project id (free at cloud.reown.com / walletconnect.com).
  // Injected wallets (MetaMask, Phantom, Rabby…) work without it; WalletConnect +
  // mobile need a real id.
  walletConnectProjectId: 'REPLACE_WITH_WALLETCONNECT_PROJECT_ID',

  // delegate.xyz / delegate.cash v2 registry (same address on mainnet).
  delegateRegistryV2: '0x00000000000000447e69651d841bD8D104Bed493',

  // The six genesis source collections. `collectionId` matches the on-chain minter's
  // collection order (0 = Normie, 1..5 = CC0) so a chosen (collectionId, tokenId) maps
  // straight into reserveSources.
  collections: [
    { collectionId: 0, id: 'normie',  name: 'Normies',       address: '0x9Eb6E2025B64f340691e424b7fe7022fFDE12438' },
    { collectionId: 1, id: 'runners', name: 'Chain Runners', address: '0x97597002980134bea46250aa0510c9b90d87a587' },
    { collectionId: 2, id: 'skulls',  name: '1337 Skulls',   address: '0x9251dec8df720c2adf3b6f46d968107cbbadf4d4' },
    { collectionId: 3, id: 'pepes',   name: 'Baby Pepes',    address: '0x9131d8c7a411d90c6b164d296440701a0e5b3178' },
    { collectionId: 4, id: 'nouns',   name: 'Nouns',         address: '0x9c8ff314c9bc7f6e59a9d9225fb22946427edc03' },
    { collectionId: 5, id: 'kevin',   name: 'OnChainKevin',  address: '0x17b19c70bfca098da3f2efef6e7fa3a1c42f5429' },
  ],

  // GTD spots cap the wider interest list too (informational).
  interestHandleMax: 32,

  // EIP-712 attestation (wagmi adds EIP712Domain). `sources` = the holder's chosen art.
  eip712Domain: { name: 'Blockcassone Allowlist', version: '1', chainId: 1 },
  eip712Types: {
    Attestation: [
      { name: 'wallet',   type: 'address' },
      { name: 'vaults',   type: 'address[]' },
      { name: 'sources',  type: 'Source[]' },
      { name: 'issuedAt', type: 'uint256' },
      { name: 'nonce',    type: 'bytes32' },
    ],
    Source: [
      { name: 'collectionId', type: 'uint8' },
      { name: 'tokenId',      type: 'uint256' },
      { name: 'contractAddr', type: 'address' },
    ],
  },

  // "Register interest" — a lighter signed opt-in for non-holders / sub-threshold holders
  // (FCFS + public updates). Signature proves the wallet + is bot friction; handle is optional.
  eip712InterestTypes: {
    Interest: [
      { name: 'wallet',   type: 'address' },
      { name: 'handle',   type: 'string' },
      { name: 'issuedAt', type: 'uint256' },
      { name: 'nonce',    type: 'bytes32' },
    ],
  },

  // Backend (dev/preview proxy in vite.config.js; the host's serverless fn in prod).
  submitUrl: '/api/allowlist-submit',   // POST signed request → appended to allowlist-submissions.jsonl
  statusUrl: '/api/allowlist-status',   // GET ?wallet=0x… → { registered }
};

// Per-collection weighted GTD entitlement from a holdings list ([{ collectionId }]).
export function entitlementFor(holdings) {
  let raw = 0, normies = 0, other = 0;
  for (const h of holdings) {
    raw += (CONFIG.spotWeights[h.collectionId] ?? 0.25);
    if (h.collectionId === 0) normies++; else other++;
  }
  // round to avoid 0.1+0.2 float drift before flooring
  raw = Math.round(raw * 100) / 100;
  return { normies, other, raw, spots: Math.min(CONFIG.gtdCapPerWallet, Math.floor(raw)) };
}

// delegate.xyz v2 IDelegateRegistry.getIncomingDelegations(address) → Delegation[].
export const DELEGATE_ABI = [
  {
    type: 'function',
    name: 'getIncomingDelegations',
    stateMutability: 'view',
    inputs: [{ name: 'to', type: 'address' }],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'type_', type: 'uint8' },
          { name: 'to', type: 'address' },
          { name: 'from', type: 'address' },
          { name: 'rights', type: 'bytes32' },
          { name: 'contract_', type: 'address' },
          { name: 'tokenId', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
        ],
      },
    ],
  },
];
