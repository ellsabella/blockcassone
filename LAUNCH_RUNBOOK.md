# TheBLOCK Genesis — Launch Runbook

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
3. **Close the allowlist funnel + verify submissions.** Run `allowlist/reserve.mjs`
   (dry-run) against the landing-page submissions: it re-verifies live ownership
   (incl. delegate.xyz), dedupes, caps at 5/wallet, and writes `reserve-plan.json`
   (the single source of truth for GTD — it feeds `reserveSources`, the merkle
   generator, AND the release keeper). Export the FCFS list (registered-interest
   wallets that hold a qualifying asset) to `fcfs-wallets.json`.
4. **Select the CC0 pool token IDs** — exactly the caps above (901/655/410/328/123 =
   2417 tokens). Decision pending: curated vs algorithmic. See
   `dev/cc0-proof/select-pools.mjs` (writes `data/cc0/pool-<collection>.json`).
5. **Flatten the CC0 pools** to 400-byte 2-bit tonal payloads (needs a mainnet fork/RPC
   to read the source art):
   ```bash
   anvil --fork-url <mainnet> &                    # or use a hosted archive RPC
   node dev/cc0-proof/flatten-pools.mjs            # -> data/cc0/payloads-<collection>.json
   ```
6. **Build + verify the token renderer — the bundle MUST be provably network-free.**
   The whole point of the project is that token art depends on nothing off-chain; a
   bundle that even *attempts* an API call fails this requirement.
   ```bash
   node scripts/build-token-renderer.mjs           # -> dist/token-renderer/renderer-chunks.json (8 script chunks <= 18KB)
   ```
   - The build hard-stubs the normies-api dynamic-import fallback and then FAILS if
     the bundle matches any forbidden pattern (`fetch(`, `XMLHttpRequest`,
     `WebSocket`, `EventSource`, `sendBeacon`, **`import(`**, `http(s)://`, `/api/`,
     `ipfs://`). Do not weaken the pattern list; do not upload a bundle from a build
     that errored. The dev `preview.bundle.js` is exempt and must NEVER go on-chain.
   - Chunk layout (enforced by `upload-renderer-chunks.mjs` — use it, don't hand-roll):
     store chunk 0 = HTML head slot, left EMPTY so `CubeRendererV2`'s baked-in
     on-chain head is used; script chunks at ids 1..N; `chunkCount = N + 1`.
   - `tokenURI` returns `data:application/json;base64,…` (all three data URIs —
     metadata, image, animation — are base64; raw-JSON envelopes trip strict
     marketplace URI validators with "unescaped characters").
   - After upload, pull `tokenURI` for one Normie cube, one CC0 cube, and (post any
     test merge) a street token via `scripts/extract-anim.mjs` and confirm: base64
     scheme, zero URI-unsafe chars, `has normies-api import: false`, head starts
     `<!doctype html>`, tail ends `</body></html>`.

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
     chosen artworks, ≤5/wallet, via `allowlist/reserve.mjs --execute`). Each reserved
     source is pulled from its draw pool so the public draw can't collide, and is
     assigned to that wallet when they mint on OpenSea.
   - optional `setSnapshotAgentBindings` for awakened Normies.
4. **Verify pools are fully art-backed, then `finalizeSnapshot()`.** `finalizeSnapshot`
   only checks pool length (+ reserved) == cap and Σcaps == 4096 — it does NOT check every
   pool token has a committed payload (a missing one causes intermittent
   `MissingSourcePayload` reverts). Before finalize, call
   `genesis.firstUncommittedPoolToken(collectionId)` for **each** STORED collection (1..5)
   and confirm `(false, 0)`. **All GTD reservations must be baked before finalize.**
5. **Build the ONE allowlist merkle tree (ALL gated phases together).** SeaDrop stores
   a SINGLE merkle root per token — never plan a mid-mint root swap. The drop runs
   FOUR phases; the first three are gated leaves in one tree, the fourth is the open
   public drop:
   | # | Phase | Stage | Who | Art | Cap |
   |---|---|---|---|---|---|
   | 1 | GTD | 1 | landing-page winners w/ qualifying art | THEIR CHOSEN art | = reservation count (≤5) |
   | 2 | Guaranteed slot | 2 | site registrants w/o qualifying art + manual adds + ALL GTD winners | random | per-wallet (`{wallet,count}`); GTD winners flat 5 TOTAL |
   | 3 | FCFS | 3 | partner-project holders, snapshot day before mint | random | 8 |
   | 4 | Public | — | open (`updatePublicDrop`) | random | 8 |
   ```bash
   # day before mint: snapshot the partner collections' holders for phase 3
   ALCHEMY_KEY=<key> node allowlist/snapshot-holders.mjs \
     --contract 0xPROJ1,0xPROJ2 [--top N] [--exclude exclude.json] --out-prefix fcfs

   node allowlist/merkle.mjs --in reserve-plan.json --start <gtdStart> --end <gtdEnd> \
     --fcfs-config stages.json --gtd-rollover guaranteed-random \
     --verify-rpc <mainnet> --minter <MultiSourceGenesisMinter>
   ```
   **GTD release policy = STRICT + random rollover (locked 2026-08-12):** picks release
   at `gtdEndTime` (keeper, permissionless — a grace period is NOT enforceable, anyone
   can trigger release). `--gtd-rollover` gives every GTD winner a phase-2 leaf at cap
   **5 TOTAL** (cumulative with their GTD mints): 5/5 chosen minted → 0 in phase 2;
   minted 3 → 2 random top-up; no-show → 5 random. Communicate exactly this on the
   landing page. (Corner: a no-show minting in the first moments of phase 2, before
   the keeper's release tx lands, still receives their picks — harmless.)
   `stages.json` (phases 2 + 3; a `{wallet,count}` entry overrides the group cap):
   ```json
   [
     { "name": "guaranteed-random", "wallets": "guaranteed-wallets.json",
       "start": <p2Start>, "end": <p2End>, "cap": 1, "stage": 2 },
     { "name": "fcfs", "wallets": "fcfs-wallets.json",
       "start": <p3Start>, "end": <p3End>, "cap": 8, "stage": 3 }
   ]
   ```
   - **GTD leaves**: `--verify-rpc` asserts every leaf cap equals the baked on-chain
     `reservationCount` — do NOT skip it.
   - **Phase 2's "guaranteed" is a supply promise**: its window is exclusive (only
     stage-2 leaves mint then), so every wallet gets its slots as long as
     Σ(phase-2 caps) ≤ 4096 − mintedSoFar − unminted reservations. CHECK that sum
     before setting the windows.
   - SeaDrop's per-wallet counter is global, so caps are CUMULATIVE across stages: a
     GTD winner who minted 5 has 3 left under an 8-cap later stage (intended), and
     phase-2 cap 1 + phase-3 cap 8 means 8 lifetime, not 9.
6. **Configure the SeaDrop drop + token metadata** via the token forwarders:
   - **Price 0.0069 ETH** (~$12, same across phases for now); fee recipient + creator payout.
   - `updateAllowList` with the combined root; `updatePublicDrop` for the public stage
     (open, cap 8, random art, window AFTER phase 3 ends); `updateDropURI`.
   - **Token metadata for the drop page:** `setContractURI(...)`, `setDefaultRoyalty(receiver, bps)`
     (ERC-2981), and `setProvenanceHash(...)` (commit to the pool ordering; freezes at
     the first mint, so set it BEFORE opening). `maxSupply()`/`totalSupply()`/`baseURI()`
     are exposed for indexers; nothing to configure.
7. **Arm the on-chain GTD window + open the drop.**
   - `genesis.setGtdEndTime(<gtdEnd>)` — the SAME timestamp as the GTD stage's endTime.
     While it's open, the contract serves **reservations only**: a mis-capped leaf or
     mis-windowed stage can NOT leak a random draw; nobody (owner included) can release
     reservations. It closes itself — no mid-mint owner tx.
   - `genesis.setPhase(Public)`: the mint hook assigns **reservations first** (for GTD
     wallets) then, once `gtdEndTime` passes, the random weighted draw for everyone else;
     SeaDrop's stages/windows gate who mints when + at what price. (The legacy `Allowlist`
     phase is retained in the contract but unused by this drop.) Mint UX is the
     **OpenSea drop page** — we host no mint button.
8. **Start the release keeper (before the GTD window ends).** After `gtdEndTime`,
   `releaseReservations` is **permissionless** — the keeper returns every no-show's
   unminted reservations to the draw pool with any funded key, no owner involvement:
   ```bash
   KEEPER_PRIVATE_KEY=<any funded key> node allowlist/release-keeper.mjs \
     --minter <MultiSourceGenesisMinter> --rpc <mainnet> --in reserve-plan.json --execute
   ```
   Why it matters: unreleased no-show reservations aren't in the pool, so near sellout
   the public tail reverts `IncompletePublicFill` (funds safe, but mints blocked) until
   the release lands. The keeper is idempotent — re-run freely.

## Phase 3 — Verify

- `cubes.tokenURI(id)` renders (image SVG + animation_url WebGL) for a Normie AND a CC0
  test mint on a testnet fork first.
- Confirm `getMintStats` reports cap=4096 and `cubes.maxSupply()` == 4096.
- Confirm `genesis.gtdEndTime()` == the GTD stage endTime configured on SeaDrop.
- Dress-rehearse the **OpenSea drop-page listing on testnet** end-to-end (the token is
  SeaDrop-compatible but not ERC721SeaDrop; confirm the hosted page renders supply,
  royalties, stages) BEFORE committing to no self-hosted mint button.
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
