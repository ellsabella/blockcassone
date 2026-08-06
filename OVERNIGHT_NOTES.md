# Overnight batch — notes

---

## 2026-08-02 — AFK session: deployability fix + local E2E + signer service

You asked me to crack on while AFK so you could test on return. Committed on WSL branch
`nonnormie-store-sstore2` (not pushed — that's yours):

- **`f3b7b68` EIP-170 fix (the deploy blocker).** CubeNFT (24,701) and
  CubeThumbnailRendererV1 (26,592) were both over the 24,576-byte contract-size limit, so
  a real broadcast reverted even though `forge test` (no EIP-170) was green. Fixed:
  `NormieHexGlyphs.path` internal→public (its ~3.4KB deploys as its own DELEGATECALL-linked
  contract → renderer 26,535→**23,438**, +1,138), and `optimizer_runs` 200→1 (CubeNFT→
  **24,230**, +346). Both now deployable. Suite **197 green**.
- **`2b518e0` Attestation signer service (Sepolia Update wallet path).** `POST /api/attest`
  in renderer/server.js signs the EIP-712 attestation server-side (viem, lazy-required).
  preview-chain.js branches on `directRpc`: local Anvil keeps the unlocked signer, Sepolia
  POSTs to /api/attest. Proven byte-identical to the working dev signature
  (`scripts/check-attest-signer.mjs`). viem added as a root dep; env var
  `BLOCKCASSONE_ATTESTATION_SIGNER_PK`.

### Local E2E is LIVE right now — test it
- **Anvil** on :8545 (chainId 31337) with the full stack deployed; **8 sample cubes** minted
  (token 1 → acct#1 `0x7099…`, tokens 2–8 → acct#0 `0xf39F…`). `data/chain-config.json` written.
- **Site** on **http://localhost:3000** (renderer/server.js) — landing, /viewer/,
  /viewer/update.html, /viewer/streets.html all serve; /api/chain-rpc proxies to Anvil.
- `tokenURI(1)` renders an 85KB on-chain SVG (proves the glyph delegatecall link resolves).
- To SEE your cubes: import an Anvil key into MetaMask — acct#0
  `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (pk `0xac09…ff80`) holds 7 cubes — add a
  network for `http://127.0.0.1:8545` chainId 31337, connect.
- Both Update paths work locally (CC0 spin = rebaseToPoolSource; wallet upload = customizeCube
  via the Anvil unlocked signer). Streets: fill/evict/merge wired to the payable quotes.
- 3D `animation_url` shows the honest "asset chunks not installed" fallback until you upload
  renderer chunks (Sepolia runbook Phase 2) — expected, not a bug.

### Caveat / open decision
- `optimizer_runs=1` minimises code but raises runtime gas system-wide. CubeNFT margin is
  tight (**+346 B**) — any future CubeNFT growth needs logic moved to a library before you
  can raise runs back up for gas. Flag for the real launch.
- If :3000 or Anvil isn't up when you return, restart: `anvil --gas-limit 100000000` then
  from repo root `forge script contracts/script/DeployLocalGenesis.s.sol --tc
  DeployLocalGenesis --rpc-url http://localhost:8545 --broadcast --private-key 0xac09…ff80`,
  then `node renderer/server.js`.

---

## 2026-07-07 — pre-launch technical prerequisites (autonomous)

Nothing deployed, broadcast, pushed, or sent to any network. `forge test` after every
change. **Tests: 194 → 195 passing** (0 failing). Only code + docs + local sims + a
read-only mainnet-fork simulation.

### Done tonight
1. **Production deploy script — `contracts/script/DeployGenesis.s.sol` (NEW).** Full
   mainnet-shaped stack: real Normie contract (`NormieAddresses.NORMIES`), real OpenSea
   SeaDrop 1.0 singleton, the 5 real CC0 addresses, locked caps 1679/901/655/410/328/123
   = 4096. Decoupled ownership (admin stays token owner). Deploys + wires only — no mint,
   no pool/snapshot commit, no drop config (those are owner ops). **Validated end-to-end
   against a real mainnet fork** (publicnode): `Script ran successfully`, **~20.25M gas**
   for the contract deploy (excl. renderer chunks). Requires env `BLOCKCASSONE_OWNER` +
   `BLOCKCASSONE_ATTESTATION_SIGNER`; `--sender` must == owner.
2. **`LAUNCH_RUNBOOK.md` (NEW)** — the exact ordered launch ops: Phase 0 prep (Normie
   snapshot+merkle, CC0 pool select+flatten, renderer build), Phase 1 deploy, Phase 2
   owner ops (upload chunks → commit CC0 pools → commit Normie snapshot+root → verify
   pools art-backed → finalize → configure SeaDrop → open phases), Phase 3 verify, +
   cost table.
3. **`PRODUCTION_MINT_AND_CC0_PLAN.md`** — added a STATUS banner: the old "Normie-only
   genesis, CC0 deferred" premise is superseded by the multi-source drop; corrected the
   Objective; pointed to the runbook.
4. **Audit finding + fix.** `_beforeFinalize` checks pool length == cap but NOT per-token
   payloads → a pool token missing its payload would cause intermittent
   `MissingSourcePayload` reverts in the public phase. Added
   `MultiSourceGenesisMinter.firstUncommittedPoolToken(collectionId)` view (ops run it
   per STORED collection before finalize) + a test + a runbook step. Other review notes
   below.
5. **Token-renderer bundle** rebuilt + **network-free** (117KB, **7 chunks ≤ 18KB** for
   RendererAssetStore; chunk upload ≈ 25M gas ≈ 0.0025 ETH @ 0.1 gwei).
6. **CC0 pool-selection scaffold — `dev/cc0-proof/select-pools.mjs` (NEW).** Evenly-
   spaced algorithmic default → `data/cc0/pool-<key>.json` (2417 ids matching the
   allocation). Fork-free. Clearly marked NOT final (needs supply confirmation + the
   curated-vs-algorithmic decision).

### Cost recap (@ 0.1 gwei)
Deploy ~20.25M (~0.002 ETH) · renderer chunks ~25M (~0.0025) · CC0 pool commit ~210M
(~0.021, one-time, dedup means it's the ONLY copy) · CC0 mints now ≈ Normie mint gas.

### NEEDS YOUR INPUT (blocks the pool step)
- **CC0 selection method**: currently algorithmic (evenly spaced across each supply);
  confirm that's final vs hand-curated hero ids.
- Attestation signer + owner/admin addresses for the real deploy.

_Resolved 2026-07-08:_ Legal — all 5 are CC0, nothing to validate. All supplies confirmed
(Runners 10k / Skulls 7k / Pepes 20k / Nouns 1.9k / Kevin 1.9k) → 2417 pool ids generated
(`data/cc0/pool-*.json`). Normie = live-art collection: no art pool to preselect/store
(renderer reads Normie art live on-chain); the snapshot only supplies allowlist
eligibility + the public pull list, and the 1679 stays as the allocation cap.

### Still open (technical, not started / needs external)
- Flatten the CC0 pools (needs a mainnet fork/archive RPC — none was running tonight).
- `flatten-pools.mjs` wrapper (referenced by the runbook) not yet written — flatten.mjs
  currently takes env id-lists; a pool-file reader is a small add once IDs are locked.
- Renderer chunk upload not run against a live deploy.
- Security audit; Big Cube virtualisation (UI track).

### Audit review notes (mint stack)
- **Predictable-random public draw** (`keccak(publicSeed,minter,mintedCount,mintedNow,total)`):
  a determined minter could revert-on-unwanted-outcome / time around others. Accepted per
  "move fast or miss out"; flag for the auditor. Not a fund-loss bug.
- **CEI ok**: `_consumeAndMint` updates all state (caps, counters, pool swap-pop) BEFORE
  the external mint; `mintSeaDrop` is `onlySeaDrop`. Reentrancy via `onERC721Received`
  can't double-spend.
- **Short-fill** already handled: base `mintSeaDrop` reverts `IncompletePublicFill` when
  available < quantity (all-or-nothing for the paid path).
- Source-payload double-commit is unguarded (owner op; last write wins) — acceptable.

---

## 2026-06 — earlier batch

Branch: `overnight-seadrop-brainrot` (off `cube-thumbnail-colour-nonnormie`).
Nothing pushed, deployed, broadcast, or sent to any network. `forge test` run
after every change.

Test count: **164 baseline → 183 passing** (0 failing). +19 tests.
Forge runs via WSL (`forge` isn't on the Windows PATH; it lives at
`~/.foundry/bin/forge` inside the Ubuntu WSL distro — run from
`/mnt/c/Users/ellag/Desktop/blockcassone`).

One commit per task, all local:

| Commit | Task |
|--------|------|
| `1237453` | 1 — wire full SeaDrop + Brainrot stack in DeployLocalGenesis + end-to-end test |
| `f50312e` | 2 — batched-SSTORE2 commit path for BrainrotGenesisMinter + tests |
| `ca61b9b` | 3 — public-phase `mintSeaDrop` all-or-nothing + tests |
| `7bd5436` | 4 — cross-mechanic verification tests for move / merge / customize |

> Note: this branch was created on top of your existing **uncommitted** WIP
> (the whole Brainrot/SeaDrop foundation — `BrainrotGenesisMinter.sol`,
> `GenesisMinterBase.sol`, `ISeaDrop.sol`, `SSTORE2.sol`, `NonNormieArtStore`
> edits, etc. — was untracked/modified when I started). My commits stage only
> the files each task touches, so a couple of them include foundation files
> that were previously untracked (e.g. Task 2 commits the whole
> `BrainrotGenesisMinter.sol`, Task 3 the whole `GenesisMinterBase.sol`). The
> working tree as a whole compiles and is green; individual commits are progress
> markers on top of your WIP, not independently-checkoutable snapshots. Your
> other pre-existing modified files (renderer, viewer, plan docs, etc.) were
> left untouched and uncommitted.

---

## Task 1 — DeployLocalGenesis full SeaDrop + Brainrot wiring

`contracts/script/DeployLocalGenesis.s.sol`, `contracts/test/DeployLocalGenesisWiring.t.sol`

- Switched the local deploy from `cubes.transferOwnership(genesis)` to the
  **decoupled SeaDrop pattern**: admin stays the token owner; the Normie genesis
  is the `genesisMinter`; `updateAllowedSeaDrop([seaDrop])`; each minter's
  authorized caller is the **token** (`minter.setSeaDrop(address(cubes))`), since
  the real SeaDrop singleton calls `CubeNFT.mintSeaDrop`, which routes to the
  minter. Admin keeps `setMovesEnabled` / `setCustomizer` / minter-flip powers
  (this also resolves the old code comment "Production needs a real post-mint
  enable path" for the local case).
- Deploy + wire a **Brainrot** genesis stack: a `LocalMockBrainrot` source, a
  `BrainrotGenesisMinter`, authorized as a `NonNormieArtStore` recorder **before**
  art-store ownership moves to the customizer, sample tonal payloads committed,
  and its snapshot finalized to Public. Addresses added to the viewer
  chain-config JSON.
- New test drives a mock SeaDrop end-to-end for **both** stacks (Normie mints
  Normie-sourced cubes; Brainrot, once made the `genesisMinter`, mints external
  cubes with 400-byte art recorded) and asserts ownership never moves to a minter.
- Verified `forge script … DeployLocalGenesis` **simulates** cleanly (no
  `--broadcast`, no RPC — no network touched); the tmp config it writes was
  deleted.

**Needs your judgment (see "Open questions" below):** `CubeNFT` has a single
`genesisMinter` slot, so only one genesis minter is the SeaDrop-driven minter at
a time. I kept **Normie** as the persistent active minter (matches the viewer
config + sample mints) and left **Brainrot** fully wired-and-ready — activate it
by `cubes.setGenesisMinter(brainrotMinter)`. I did **not** change CubeNFT's
authorization model to allow two live minters, because how "Brainrot-in-genesis"
should actually run (one shared pool? phase-switched? two SeaDrop drops?) is a
design/product decision.

## Task 2 — batched-SSTORE2 commit path

`contracts/src/BrainrotGenesisMinter.sol`, `contracts/src/lib/SSTORE2.sol`, `contracts/test/BrainrotGenesis.t.sol`

- `setBrainrotPayloadBatch(sourceIds, payloads)` packs up to
  `MAX_BATCH_BLOB_BYTES = 24_000` bytes (~60 × 400-byte payloads, under the
  EIP-170 24576 runtime-code limit) into **one** SSTORE2 blob and points each
  source token at its `[offset, length)` slice — one `create` for the whole batch
  instead of one per token.
- Replaced the per-token whole-blob `payloadPointer` with a unified
  `PayloadLoc { blob, offset, length }` used by both the single and batched paths;
  `_mintSourceCube` slices its window with a new ranged
  `SSTORE2.read(pointer, start, size)` (extcodecopy of just the needed bytes).
  No external/test callers referenced the old `payloadPointer`/`brainrotPayloadLength`
  getters, so this is safe.
- Tests: shared-blob offsets (0/400/800…), **byte-exact** sliced art after mint
  (distinct fully-filled payloads prove correct slicing), length-mismatch / empty /
  over-capacity (61×400) reverts, and the exact 60×400 == cap boundary succeeding.

## Task 3 — public `mintSeaDrop` all-or-nothing

`contracts/src/GenesisMinterBase.sol`, `contracts/test/NormieGenesisMinter.t.sol`

- SeaDrop charges the buyer for the full quantity up front, so the Public branch
  of `mintSeaDrop` now reverts `IncompletePublicFill(requested, available)` when
  the pool (or the supply cap) can't cover the full quantity — nothing is minted.
- **Scope decision:** this applies only to the paid `mintSeaDrop` path. The
  direct `mintPublic` / `mintPublicFor` paths keep their best-effort partial-drain
  behavior, because existing tests
  (`testPublicMintConsumesRemainingUnclaimedNormies`, `testMintClosesAtCubeSupplyCap`)
  intentionally rely on partial fills there. Added a contrast test asserting that
  divergence explicitly.
- Note on plot allocation: a single wallet can hold at most
  `MAX_PER_WALLET_PER_STREET (3)` plots per street and spills to the next, so
  minting >3 to one wallet needs ≥2 streets — the new "fills exactly available 5"
  test uses a fresh 16-slot (2-street) minter for that reason.

## Task 4 — move / merge / customize verification

`contracts/test/PostMintMechanicsVerification.t.sol`

Per-mechanic unit tests already exist (CubeNFT.t.sol, CubeMintController.t.sol),
so this suite adds the **cross-mechanic / full-lifecycle** invariants they don't
chain:

- move **releases** the old slot back to the world (a new mint can reuse it);
- **seed** (edge-point identity) is permanent across multiple move hops, **slot**
  (location → colour/geometry/street) is mutable;
- merge population counts only plots **still on** the street (a moved-away plot is
  excluded and stays independent);
- customize preserves seed + slot, re-bases the source, and makes the cube
  store-renderable (200-byte bitmap — never a placeholder);
- a re-based source **survives a later move**;
- a customized cube can be **merged** and its store art is retained for the street.

---

## Open questions / items I deliberately skipped (need your judgment)

1. **Two genesis minters, one `genesisMinter` slot (product/architecture).**
   Decide how the Brainrot collection joins genesis: a single shared pool, a
   phase-switched hand-off (flip `genesisMinter` between drops), or two separate
   SeaDrop drops. If they must be live simultaneously, `CubeNFT` would need a
   multi-minter authorization model (e.g. `mapping(address => bool) minters`)
   instead of the single `genesisMinter` — I did not change the access model.
2. **Pool curation / which Brainrot token ids + real flattened payloads.** The
   deploy uses placeholder ids (5001…) and deterministic dummy payloads. Real
   pool composition and off-chain `nft-art-grid` flattening are yours to curate.
3. **Mainnet / broadcast / wallets / legal (CC0).** Untouched by request — no
   mainnet scripts changed, nothing broadcast, no keys used.
4. **Aesthetics** (thumbnail/renderer look) — untouched; not part of this batch.

## How to re-verify

```bash
# from WSL Ubuntu:
cd /mnt/c/Users/ellag/Desktop/blockcassone
forge test                 # 183 passing
# optional: dry (no-network) deploy simulation
BLOCKCASSONE_CHAIN_CONFIG_OUT=data/tmp-chain-config.json \
  forge script contracts/script/DeployLocalGenesis.s.sol:DeployLocalGenesis
```
