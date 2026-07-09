# Blockcassone Genesis — Launch Runbook

The exact ordered steps to take the genesis mint live on mainnet. Genesis is a
**multi-source SeaDrop drop** across 6 source collections with a locked allocation of
the 4096 supply:

| Collection | Model | Cap |
|---|---|---|
| Normie | live art (read on-chain) | 1679 |
| Chain Runners | stored tonal payload | 901 |
| 1337 skulls | stored tonal payload | 655 |
| Baby Pepes | stored tonal payload | 410 |
| Nouns | stored tonal payload | 328 |
| OnChainKevin | stored tonal payload | 123 |

Contracts: `MultiSourceGenesisMinter` (weighted draw + per-collection caps + plot
allocation, 5 plots/wallet/street), `NonNormieArtStore` (source-keyed CC0 art pool +
per-cube customize overrides), `CubeNFT` (ERC-721 + SeaDrop hook), `CubeRendererV2` +
`CubeThumbnailRendererV1` (+ `CubeForestLib`), `CubeMintController` + `FlatteningAttestation`
(post-mint update flow), `AgentStatusRegistry`.

---

## Phase 0 — Pre-deploy prep (off-chain, no gas)

1. **Legal sign-off** on all 5 CC0 collections (Runners / Skulls / Pepes / Nouns /
   Kevin). CC0 status is an *approved-list* decision, not a marketplace claim.
2. **Choose the Normie snapshot block.** Everything downstream is derived from it.
3. **Generate the Normie snapshot + Merkle root:**
   ```bash
   ETH_RPC_URL=<mainnet> SNAPSHOT_BLOCK=<block> npm run snapshot:normies   # -> data/normie-snapshot.json
   npm run snapshot:merkle                                                 # -> data/normie-merkle.json (root)
   ```
   Leaf = `keccak256(abi.encode(wallet, keccak256(abi.encode(normieIds))))`, sorted-pairs
   tree (matches `GenesisMinterBase._hashSnapshot`).
4. **Select the CC0 pool token IDs** — exactly the caps above (901/655/410/328/123 =
   2417 tokens). Decision pending: curated vs algorithmic. See
   `dev/cc0-proof/select-pools.mjs` (writes `data/cc0/pool-<collection>.json`).
5. **Flatten the CC0 pools** to 400-byte 2-bit tonal payloads (needs a mainnet fork/RPC
   to read the source art):
   ```bash
   anvil --fork-url <mainnet> &                    # or use a hosted archive RPC
   node dev/cc0-proof/flatten-pools.mjs            # -> data/cc0/payloads-<collection>.json
   ```
6. **Build + verify the token renderer** (must be network-free):
   ```bash
   node scripts/build-token-renderer.mjs           # -> dist/token-renderer/renderer-chunks.json (7 chunks <= 18KB)
   ```

## Phase 1 — Deploy contracts

`DeployGenesis.s.sol` deploys + wires the full stack against the REAL Normie contract +
REAL SeaDrop singleton, with the locked caps. Ownership stays with the admin (decoupled
minter role). It does NOT mint, populate pools, snapshot, or configure the drop.

```bash
BLOCKCASSONE_OWNER=<admin> \
BLOCKCASSONE_ATTESTATION_SIGNER=<signer> \
forge script contracts/script/DeployGenesis.s.sol:DeployGenesis \
  --rpc-url <mainnet> --sender <admin> --broadcast --verify
```
Defaults: SeaDrop = OpenSea SeaDrop 1.0 `0x00005EA0…24bf5`; CC0 addresses + caps are
built in (env-overridable). **~20.25M gas** for the contract deploy (excludes chunks).
Record all deployed addresses from the console output.

## Phase 2 — Post-deploy owner ops (admin, in order)

1. **Upload renderer chunks** to `RendererAssetStore` (7 chunks, ~25M gas total):
   ```bash
   node scripts/upload-renderer-chunks.mjs --store <RendererAssetStore> --rpc <mainnet>
   ```
2. **Commit the CC0 pools** — for each collection, `addSourcePool(tokenIds)` then
   `setSourcePayloadBatch(collectionId, ids, payloads)` (~60 payloads/blob, ~40 blobs
   total, **~210M gas ≈ 0.021 ETH @ 0.1 gwei**). The minter forwards to the art store
   (source-keyed). Must precede `finalizeSnapshot`.
3. **Populate the Normie draw pool + bake GTD reservations.**
   - `addSnapshotNormies(wallet, ids)` in batches — this defines the Normie **candidate
     pool** the public phase draws from (the id space; the cap 1679 bounds how many are
     actually drawn; `wallet` is vestigial, the pool is wallet-agnostic). The old
     Merkle-snapshot "mint your Normies" allowlist has been **removed from the contract**
     (GTD uses reservations; FCFS gating uses SeaDrop's own allowlist stage).
   - **Bake GTD reservations** — from the verified allowlist attestations (landing-page
     opt-in + backend ownership check, incl. delegation), call
     `reserveSources(wallet, collectionIds, sourceIds)` for each guaranteed holder (their
     chosen artworks, ≤3/wallet). Each reserved source is pulled from its draw pool so the
     public draw can't collide, and is assigned to that wallet when they mint on OpenSea.
   - optional `setSnapshotAgentBindings` for awakened Normies.
4. **Verify pools are fully art-backed, then `finalizeSnapshot()`.** `finalizeSnapshot`
   only checks pool length (+ reserved) == cap and Σcaps == 4096 — it does NOT check every
   pool token has a committed payload (a missing one causes intermittent
   `MissingSourcePayload` reverts). Before finalize, call
   `genesis.firstUncommittedPoolToken(collectionId)` for **each** STORED collection (1..5)
   and confirm `(false, 0)`. **All GTD reservations must be baked before finalize.**
5. **Configure the SeaDrop drop** via the token forwarders (`updateAllowList` for the
   allowlist stages, `updatePublicDrop` for public):
   - **Price 0.0069 ETH** (~$12, same across phases for now); fee recipient + creator payout.
   - **Per-wallet cap 8** (`maxTotalMintableByWallet`) for FCFS + public.
   - **GTD stage** — allowlist merkle of guaranteed wallets, per-wallet limit = their
     reserved count (≤3); the mint hook honours their reservations (chosen art) on-chain.
   - **FCFS stage** — allowlist merkle of the wider token-gated community (holds a
     qualifying source asset), cap 8, art assigned randomly.
   - **Public stage** — open, cap 8, art assigned randomly.
6. **Open the drop.** Set the contract phase to `Public` (`genesis.setPhase(Public)`): the
   mint hook assigns **reservations first** (for GTD wallets) then the random weighted draw
   for everyone else, and SeaDrop's stages/windows gate who mints when + at what price.
   (The legacy `Allowlist` phase / "mint your snapshot Normies" path is retained in the
   contract but unused by this drop.) Mint UX is the **OpenSea drop page** — we host no
   mint button.

## Phase 3 — Verify

- `cubes.tokenURI(id)` renders (image SVG + animation_url WebGL) for a Normie AND a CC0
  test mint on a testnet fork first.
- Confirm `getMintStats` reports cap=4096.
- Confirm a CC0 cube's art resolves (`artStore.payloadForCube` via source facts) with NO
  per-cube storage written at mint.

---

## Cost summary (@ 0.1 gwei)

| Step | Gas | ETH |
|---|---|---|
| Contract deploy | ~20.25M | ~0.002 |
| Renderer chunks (7) | ~25M | ~0.0025 |
| CC0 pool commit (2417 payloads) | ~210M | ~0.021 |
| Normie snapshot commit | ∝ holder count | (batched) |
| **Owner setup subtotal** | | **~0.026 ETH + snapshot** |

Per-mint: CC0 mints now ≈ Normie mint gas (the per-cube art duplication was removed —
the pool is stored once, cubes reference it by source facts).

## Open pre-launch items (not code)
- Security audit of the mint stack (holds real ETH).
- Final CC0 legal clearance.
- Big Cube viewer virtualisation (perf on 200+ NFT wallets) — UI track.
