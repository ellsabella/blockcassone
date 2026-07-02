# Overnight batch — notes

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
