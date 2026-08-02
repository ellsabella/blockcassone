# Sepolia E2E Runbook

Goal: exercise the whole thing end-to-end on **Sepolia**, on the **real site** (VPS +
Cloudflare), with a **MockSeaDrop faucet** for the mint and **both Update paths** live.

Decisions locked: MockSeaDrop + faucet · VPS+Cloudflare hosting · both customize paths
(so the attestation signer service runs on Sepolia).

Legend: **[build]** = code I produce · **[run]** = you run (needs your keys / SSH / broadcast).

---

## Phase 0 — prerequisites (you)
- A funded **deployer** wallet on Sepolia (a little test ETH).
- A dedicated **attestation signer** keypair (its address goes into the deploy; its private
  key goes into the signer service — NOT the deployer key).
- A **Sepolia RPC** URL (Alchemy/Infura) for the deployer + the VPS proxy.
- Test wallets (MetaMask) with a little Sepolia ETH for fees.

## Phase 1 — contracts on Sepolia  **[build] + [run]**
- **[build]** Sepolia-capable deploy: `DeployLocalGenesis` extended with a **MockSeaDrop**
  faucet + env-driven **attestation signer** + env-driven **rpcUrl/directRpc** in the emitted
  `chain-config.json`. It already: deploys the stack + mock Normie + 5 mock CC0, commits a
  small Normie snapshot + CC0 pools/payloads, enables moves/merges/customizes, sample-mints,
  and writes the viewer config.
- **[run]** Broadcast it:
  ```
  export SEPOLIA_RPC=... DEPLOYER_PK=... ATTEST_SIGNER=0x...
  BLOCKCASSONE_ATTESTATION_SIGNER=$ATTEST_SIGNER \
  BLOCKCASSONE_RPC_URL=$SEPOLIA_RPC BLOCKCASSONE_DIRECT_RPC=false \
  forge script contracts/script/DeployLocalGenesis.s.sol --rpc-url $SEPOLIA_RPC \
    --private-key $DEPLOYER_PK --broadcast
  ```
  Save the printed addresses + the written `data/chain-config.json`.

## Phase 2 — renderer chunks  **[run]**
- Upload the WebGL engine chunks so the 3D `animation_url` renders (else it shows the
  "asset chunks not installed" fallback):
  ```
  node scripts/upload-renderer-chunks.mjs   # against the Sepolia RendererAssetStore + deployer key
  ```

## Phase 3 — attestation signer service  **[build] + [run]**
Needed only for the Update **wallet-upload** path (the CC0 spin doesn't use it).
- **[build]** An `/api/attest` endpoint (in the VPS Node app) that takes the attestation
  params and returns an EIP-712 signature signed with the signer key **server-side**, plus a
  small `preview-chain.js` change so it calls `/api/attest` on Sepolia instead of the
  dev-only `eth_signTypedData_v4` (which only works against unlocked Anvil).
- **[run]** Set `ATTEST_SIGNER_PK` in the VPS env; restart the service.

## Phase 4 — the site, pointed at Sepolia  **[build] + [run]**
- **[build]** A Sepolia `chain-config.json` (from Phase 1) with `chainId: 11155111`,
  `directRpc: false`, and the RPC routed through the proxy. Wallet-connect already switches
  networks from `chain-config`.
- **[run]** Deploy the `viewer/` app + the `/api/chain-rpc` proxy (+ `/api/attest`) to the
  Lightsail VPS behind Cloudflare (keys stay server-side). Point a subdomain at it.

## Phase 5 — the E2E test pass  **[run]**
1. **Faucet-mint**: from a couple of test wallets, mint via MockSeaDrop → cubes appear
   (exercises the real allocation + reservation path).
2. **Big Cube**: connect wallet, see your cubes; UPDATE + STREETS nav links appear (gated on).
3. **Update**: CC0 **spin** (rebaseToPoolSource) + **wallet upload** (customizeCube via the
   signer) → 2D + 3D update.
4. **Streets**: fill a vacant, **evict** a rival (displacement fee + payout + cooldown), and
   **merge** a ≥5-filled street → golden cube.
5. Verify ERC-4906 refresh (our explorer / OpenSea testnet).

---

## What can't be tested without more setup
- Real OpenSea allowlist/public mint UI (we're stubbing with MockSeaDrop by choice — the real
  SeaDrop path is already proven by `test/SeaDropForkE2E.t.sol`).
- The indexer is optional; the pages live-scan a fresh, small Sepolia world.
