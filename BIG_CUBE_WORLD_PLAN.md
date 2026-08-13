# Big Cube World Plan

Consolidated, current source of truth for the world mechanics on top of the
genesis mint. Supersedes the scattered notes in the older plan docs where they
conflict. Everything here is targeted to be **ready before launch**.

## Vision

- Genesis mint runs through **OpenSea SeaDrop** (trust + rails). SeaDrop only
  passes `(wallet, quantity)`, so all source assignment is derived on-chain.
- At mint, a cube's art basis is **on-chain Normie data only**.
- **Post-mint**, via the webUI, holders can re-base a cube on **any artwork**
  (PNG/WEBP/JPEG), move it, and merge streets.
- **Location is first-class** (street → neighbourhood → region) and drives the
  post-mint game: scatter, move, merge, negotiate.

## Identity model — what's permanent vs mutable

| | Derives | Permanence |
|---|---|---|
| `seed` | edge-point fingerprint (`sidePlan`) | **permanent** (the cube's soul) |
| `sourceTokenId` + raw art | the Normie/artwork shown | permanent at mint; **re-basable** post-mint via customization |
| `slot` (plot) | geometry, colour (axis), street, environment | **mutable** (move) |

Moving a cube changes its colour/environment/location-styling but keeps its
edge-point identity. This is the crux that makes move/merge coherent.

## World mechanics

### 1. Plot allocation (shared streets)
- 4096 cubes ÷ 512 streets = 8/street; with **≤5 per wallet per street**, a full
  street draws from ~2 wallets → **streets are shared**.
- A wallet's holdings are kept **together** (a contiguous run of streets), ≤5 per
  street. Example: 6 cubes → 5 on street A + 1 on street B.
- Vacancy appears only in the **unminted tail** if the 4096 cap isn't filled.
- BUILT: `GenesisMinterBase._allocateSlot` (anchor-then-wrap, per-street fill
  cursor + per-(wallet,street) ≤5 cap).

### 2. Environment (biome) — street-level, rarity-weighted
- One environment per **street**; all 8 plots share it.
- Deterministic + permanent: `id = weightedPick(keccak(WORLD_SEED, street))`.
- 6 biomes (`desert, water, grass, forest, mountain, ice`), weights (out of 100):
  grass 34, forest 30, water 20, desert 12, mountain 3, ice 1.
- `Environment` metadata trait + renderer biome visuals. JS viewer must mirror
  the same WORLD_SEED + weights (sidePlan-style parity).
- **Status: on-chain `CubeEnv` lib + `Environment` trait done; weights confirmed;
  JS parity pending.**

### 3. Move (+ displacement)
- Holder moves a cube they own to **any vacant plot** (cheap flat fee), or
  **displaces** an occupant in a street they own ≥5/8 of (force-swap + pay the
  victim), via the UI.
- `moveCube(cubeId, newSlot) payable`: verify ownership; if vacant, charge
  `baseFee`; if occupied, require 5/8 majority, swap the occupant into the mover's
  old slot, pay them a biome-rarity fee (house cut on upgrades), enforce cooldown.
  Colour/environment/street follow the new slot. See `FEES_AND_DISPLACEMENT_SPEC.md`.
- Purpose: drive post-mint activity, consolidate streets for merging (assemble a
  contested street by displacing minority holders), chase scarcer environments.

### 4. Merge (8→1 burn → street NFT)
- Eligibility: wallet is the **sole owner of every occupied plot** on a street
  (1–8 cubes; remaining plots vacant).
- One ERC-721 collection with a **cube vs merged-street kind flag**. Merge
  **captures the plots' data into a street record before burning** the cubes.
- Street token: SVG of the street "leader"; HTML toggling street↔cube (inspect
  each cube); `Merged` trait; vacant plots rendered as the street's environment
  placeholder.
- `Population` trait = occupied-plot count (single cube = 1).

### 5. Population trait
- On **all** tokens: `1` for a cube, `N` for a merged street. *(Done for cubes.)*

### 6. Customization (post-mint, any artwork)
- Re-base a cube on a **flattened bitmap** (the 40×40 source format) of any owned
  asset or **approved CC0** project. Off-chain flatten → on-chain store.
- CC0 approved list lives at `data/cc0-projects.json` (needs review).

## WebUI

- **Tab 1 — Explore:** the big cube world (region/neighbourhood/street/cube),
  wallet focus, 3D detail. Evolve the dev viewer; indexer as read cache only.
- **Tab 2 — Customize/Manage:** connect wallet → identify usable artworks (owned
  + approved CC0) → customization flow.
- **Move flow** + **Merge flow** UIs.

## Build sequence (all pre-launch)

1. **Environment model** — `CubeEnv` + `Environment` trait + weights + JS parity. **✅ DONE**
2. **Per-street view in the token HTML** — street view, continuous Hilbert spine,
   V/arrows toggle, gated strictly on `TOKEN.plots`; `preview:street` test tool. **✅ DONE**
   *(open: biome placeholders don't yet render in the street view, AND their
   aesthetics need a review — see Biome placeholders below.)*
3. **Population trait** — `1` cubes, `N` merged. **✅ DONE (cubes)**
4. **Plot allocation** — **🟡 BUILT, pending WSL test.** Replaces `slot =
   mintedCount` in `NormieGenesisMinter._consumeAndMint` with `_allocateSlot`:
   a **new wallet anchors the lowest street with zero mints** (spreads wallets
   one-per-street across the world); **once every street has ≥1 mint we wrap** and
   new wallets backfill the lowest non-full street. Either way a wallet packs
   **≤3 plots/street** and **spills forward** (contiguous run), so a full street
   ends up shared by ~3 wallets. O(1): `seedCursor` (anchor phase) + `frontierStreet`
   (wrap) + per-wallet `(street, count)`; `_streetCapacity` handles a non-multiple-
   of-8 final street. Caveat: togetherness is **per-transaction** (split mints far
   apart land wherever the cursor then sits). `NoVacantPlot` guards the >1536-per-
   wallet edge.
5. **Move (+ displacement + fees)** — **✅ BUILT + TESTED (contract); UI later.**
   `moveCube(cubeId, newSlot) payable` in `CubeNFT`: owner-only, cube keeps its
   `seed` but takes a new slot, so colour/geometry/street/environment follow. Gated
   behind owner-flipped `movesEnabled` (off during mint). Merged-street tokens are
   anchored (`CannotMoveStreet` / `CannotDisplaceStreet`). Target may be **vacant**
   (flat `baseFee` to the house) **or occupied** — a **displacement**: allowed only
   if the mover owns ≥5/8 of the target's street (`NotStreetMajority`), force-swaps
   the occupant into the mover's old slot, pays the victim a biome-rarity-scaled fee
   (house takes ~1/3 only on upgrades), and enforces a 15-min per-victim cooldown.
   See `FEES_AND_DISPLACEMENT_SPEC.md` + `test/CubeFees.t.sol`.
6. **Merge** — kind flag, 8→1 burn, street-record store, street SVG + HTML,
   placeholders. *(produces the `TOKEN.plots` the street view consumes)*
   **✅ BUILT + TESTED.** `mergeStreet(street) payable` in `CubeNFT`: caller must
   solely own every occupied plot; occupied plot cubes are burned (CubeData +
   source/normie mappings retained), all 8 slots lock to the new street token. Free
   when you own the whole street; `baseFee` per vacant plot locked otherwise.
   Leader = lowest occupied plot (drives the SVG thumbnail). Irreversible v1 (data
   preserved for a future un-merge). `SOURCE_KIND_MERGED_STREET = 3`; `StreetInfo`
   record + `streetPlots()` / `cubeDataUnchecked()` getters. `CubeRendererV2`:
   street tokens emit `{kind:'street', plots:[…8…]}` (matches `preview:street`),
   `Merged`/`Population`/`Source Kind = "Merged Street"` traits; thumbnail renderer
   treats kind 3 like its Normie leader. *(v1 assumes Normie leaders — true for
   genesis.)*
7. **Customization** — **🟡 BUILT (contract), pending WSL test; UI + CC0 review
   later.** `CubeMintController.customizeCube`: holder re-bases a cube they own
   onto a new flattened 40×40 artwork (400-byte 2-bit payload) via an EIP-712
   flattening attestation. Cube keeps seed + slot but **adopts the new source**
   (`CubeNFT.customizeCubeSource`, `customizer`-gated → `sourceKind=EXTERNAL`);
   re-basable any number of times (`NonNormieArtStore.updateTonalBands2Bit` upsert).
   Both renderers now serve the store art (closed V2's 3D non-Normie gap via
   `nonNormieStore.imageBytesForCube`). Trust: ownership/CC0 enforced off-chain by
   the flattening signer. *(Open: CC0 registry `data/cc0-projects.json` review;
   the off-chain flatten + signer service; customize UI.)*
8. **WebUI** — explore tab, customize tab, move/merge flows. **🟡 IN PROGRESS.**
   Customize/Update Cube as a **separate page** (`viewer/update.html` +
   `update-cube.js`), same aesthetic, nav-linked from the explore HUD. Enabler:
   `CubeThumbnailRendererV1.previewThumbnailSVG` (stateless on-chain SVG preview).
   Slices: (1) ✅ wallet art list — paginated 50-at-a-time, lazy images (only the
   visible page loads, sparing the OpenSea API), selection. (2) ✅ tonal encoder
   (`gridToTonalPayload` in nft-art-grid — same 2-level-Otsu bands as the cube
   outline) + **live on-chain SVG panel** via `preview-chain.js` eth_call to
   `previewThumbnailSVG` (derives the thumbnail renderer from the V2 `renderer` in
   chain-config.json). Cube panel = interim 2D banded preview. *(needs a local
   deploy of the updated contracts with chain-config.json `renderer` pointing at
   it.)* (2b) 🟡 real 3D cube panel via a **dev-only token-renderer preview bundle**:
   `entry.js` now exports a parameterized `main(deps)`; `entry-main.js` is the
   network-free production entry, `preview-entry.js` injects the non-Normie pipeline
   (`buildNonNormie*` + `wallet-nfts` fetch). Build emits `preview.bundle.js` (no
   forbiddenPatterns check); `cube-preview.html` iframes it; the cube panel sets its
   src per selection. ✅ (4) ✅ "cubes you own" row + target select + confirm
   (Cancel/LFG) → flatten→attestation→customizeCube, **working end-to-end on WSL**.
   Dev commit: `DeployLocalGenesis` deploys + wires the customize stack
   (NonNormieArtStore/FlatteningAttestation/CubeMintController, signer = Anvil acct
   #1); `preview-chain.customizeCube` builds the EIP-712 attestation, Anvil signs it
   (`eth_signTypedData_v4`) + sends the tx (unlocked owner), receipt-checked.
   payloadHash via `web3_sha3` of `abi.encode(DOMAIN, payload)` (matches
   `NonNormieArt.hashTonalBands2Bit`). On-chain SVGs rendered as `<img>` data-URIs
   to isolate shared element IDs. Anvil needs `--gas-limit 100000000` (Normie forest
   thumbnails exceed the 30M default eth_call cap). **Remaining for #8:** move +
   merge flow UIs; production off-chain signer service (dev uses Anvil); explore
   tab is the existing Big Cube page.

### Biome placeholders (to revisit)
- They don't currently render on vacant plots in the street preview — needs a
  look (likely the empty-slot floor/accent setup in the token render context).
- The biome visuals themselves need an **aesthetic pass** (not happy with them).
- Ties to the environment model (#1) and the merged-street render (#6).

## Status snapshot (already built)

- Genesis mint: **full OpenSea SeaDrop compliance** — `CubeNFT` implements
  `INonFungibleSeaDropToken` (mintSeaDrop/getMintStats/config forwarders), routing
  to the minter; allowlist (Merkle), public pull, claim tracking, phases; snapshot +
  Merkle tooling with real artifacts. Minting **decoupled from Ownable** (`genesisMinter`
  role) so a human/admin stays token owner. Genesis engine refactored to an abstract
  `GenesisMinterBase` + `NormieGenesisMinter` / `BrainrotGenesisMinter` subclasses
  (Brainrot = external-source cubes with SSTORE2-committed tonal payloads). Tests:
  `CubeSeaDrop.t.sol`, `BrainrotGenesis.t.sol`; suite 164/164.
- Renderer: cube SVG (`image`) + interactive 3D HTML (`animation_url`), edge-point
  trait 2D/3D parity, agent-status registry, chunked asset store.
- Shared `StrBuf` string builder.

## To-do / follow-ups

- **Wallet connect** — ✅ injected/EIP-1193 DONE (`viewer/wallet.js`). Streets
  (move/merge) + Update Cube (customize/move) have a Connect Wallet button; when
  connected the holder's account becomes "you are" / the tx `from` and signs+sends
  via their wallet (`preview-chain.js` `setTransactionSender` seam), replacing the
  Anvil-unlocked + "you are" perspective stand-in, which remains the no-wallet dev
  fallback. Works with MetaMask on local Anvil (chainId 31337). The EIP-712
  flattening attestation is unchanged (still the backend signer, not the wallet).
  **Follow-ups:** WalletConnect v2 for mobile/multi-wallet (needs a bundler +
  projectId); live click-through test with MetaMask on Anvil.
- **Move + merge UI flows** — ✅ DONE (Streets page: `viewer/streets.html` +
  `streets.js` + `street-preview.html`). Street-centric merge+move: merge preview
  (leader SVG + 3D street), drag-and-drop staged moves committed as a batch behind
  the irreversible confirm, selectable merge lead, green/red/orange/pink states.
  Uses a "you are" perspective field as a DEV STAND-IN until wallet-connect lands.
- **Big Cube page performance** — heavy wallet scenes (200+ NFTs) cause slow loads
  + rAF "handler took too long" violations; relies on the Reset button to recover.
  Needs profiling/virtualisation before launch (see memory `big_cube_performance`).
- **Chain indexer / off-chain cache (Big Cube data layer)** — the Big Cube's data
  hydration (`viewer/chain-cubes.js` `loadChainMintRecords`) **re-scans the whole
  world every load**: for `cubeId = 1 … nextCubeId` it issues `resolvedCubeData` +
  `ownerOf` + (Normies) `rawImageData` — ~3 eth_calls/cube, batched in chunks of
  100 but with **no caching between loads**, so a full 4096 world ≈ 12k calls each
  time, and on a mainnet-fork RPC key the Normie image-byte re-fetch burns quota.
  **Action item: build an indexer** that follows mint/move/merge/customize events
  incrementally and serves a compact cached snapshot (cubeId → slot/owner/seed/
  source/art), so Big Cube load is O(changed) not O(world) and rendering stops
  pulling from chain. Virtualisation decides *what* renders; the indexer decides
  *where the data comes from* — the two are complementary and should share the same
  record shape. Sits behind the `/api/chain-rpc` proxy seam (`renderer/server.js`).
  **Concurrency is the real driver, not just per-load cost:** `renderer/server.js`
  is an explicit single-threaded *dev* server, and every visitor re-scans the whole
  world (~12k eth_calls at 4096) through it to one RPC key — so N concurrent Big
  Cube visitors ≈ N×12k eth_calls (100 users ≈ 1.2M → rate-limit death + cost). The
  indexer must therefore be a **shared cached data service**: follow events once,
  serve every visitor one cacheable JSON snapshot (CDN-frontable) with ~0 per-user
  RPC. Client-side render virtualisation/chunking does nothing for this axis.
- **`movesEnabled` production gate** — ~RESOLVED by the SeaDrop ownership-decoupling:
  minting no longer requires transferring CubeNFT ownership to the minter (it's the
  `genesisMinter` role now), so a human/admin can stay owner and call `setMovesEnabled`
  post-mint. Just ensure the deploy keeps owner = admin (don't transferOwnership to
  the minter).
- Production off-chain **flatten + attestation signer** service (dev uses Anvil).
- **`core/keccak.js`** multi-block bug — ✅ RESOLVED. `core/keccak.js` is now
  byte-exact vs Solidity/Foundry for inputs of any length (verified against
  `cast keccak` and `js-sha3` across 0..600 B + the 400-byte tonal preimage). The
  `web3_sha3` RPC workaround in `viewer/preview-chain.js` is removed — the customize
  attestation `payloadHash` is hashed client-side. Guarded by `npm run check:keccak`
  (`scripts/check-keccak.mjs`); `core/package.json` (`type: module`) lets Node import
  the core ESM twins.
- **Brainrot genesis payloads** — generate the 400-byte flattened tonal payload for
  every pool Brainrot (off-chain via `nft-art-grid`, with the background-key fix),
  then commit them to `BrainrotGenesisMinter` before finalize (no paid mint may
  yield a placeholder → mint reverts `MissingSourcePayload` if absent). **Optimise
  the commit with batched SSTORE2**: pack ~60 payloads per 24 KB blob (one `CREATE`
  amortised across the batch) instead of the current one-blob-per-payload — ~30–40%
  cheaper on the full-collection upload. Also decide the pool size/curation (full
  10k vs a subset) since every pool token needs a committed payload.
- **Sequential genesis drops** — Normie + Brainrot cubes are the SAME CubeNFT token,
  so the two drops run one after the other: repoint `cubes.setGenesisMinter` +
  reconfigure the SeaDrop public/allowlist drop between them.
- **Deploy wiring for SeaDrop + Brainrot** — extend `DeployLocalGenesis` to set
  `genesisMinter`, `updateAllowedSeaDrop`, the minter's `seaDrop` (= the token), and
  authorize the Brainrot minter as a `NonNormieArtStore` recorder.

## Open decisions

- Merge **reversibility** — **RESOLVED: do NOT allow. Irreversible is final** (v1
  behaviour stands; CubeData is still retained for rendering, not for un-merge).
  Leader rule RESOLVED: default lowest occupied plot, owner can choose any owned
  occupied plot via `mergeStreet(uint32,uint256)`.
- **Empty-street policy** — **RESOLVED: allow fully-empty streets** (move everyone
  out → 0 occupied → reverts to biome; no ≥1 floor). Current `moveCube` behaviour is
  correct as-is.
- **Brainrot CC0 status** — **RESOLVED: confirmed CC0.** Brainrot-at-mint is cleared
  legally. (Still review any OTHER collections added to the customize CC0 registry.)
- **Brainrot pool size** — **PENDING an upstream burn**: the Brainrot supply will
  shrink before we deploy and the surviving ids aren't known yet. So the genesis
  Brainrot snapshot + payload commit must happen **after** the burn settles — snapshot
  the surviving ids (like the Normie snapshot) and commit payloads only for those.
  Don't pre-generate/upload the full 10k.
- Customization **source allow-list policy** (CC0 registry `data/cc0-projects.json`)
  — still open for collections beyond Brainrot.

## Indexer design (Big Cube data layer)

**Status:** spec only — build *after* the cube/biome rework (don't harden data infra
against a moving render target). No contract changes required to start.

### Core principle: fat events → log-follower + lazy art cache
Contracts cannot push to the indexer — the EVM has no network I/O; `emit` only writes
a log into the block. The indexer **pulls**: it backfills with `eth_getLogs` and
streams live logs over a WebSocket `eth_subscribe("logs", …)` (that subscription is
the practical "push" — the RPC node streams new logs as blocks mine). The win is that
our events are already **self-sufficient**: they carry the whole mutable record, so
the indexer needs **zero `eth_call`s** to reconstruct a cube. Heavy *immutable* art is
never emitted (gas + redundant); events carry a cheap pointer/hash and the indexer
materialises the bytes **once per unique id, cached forever**.

Replaces `viewer/chain-cubes.js` `loadChainMintRecords()` (today: full-world scan,
~3 eth_calls/cube, no cache) — see memory `indexer_action_item`.

### Event → indexed field mapping (all already emitted)
| Record field | Source event | Notes |
|---|---|---|
| owner | ERC-721 `Transfer(from,to,cubeId)` | current owner = last transfer; standard |
| slot, seed, sourceKind, sourceContract, sourceTokenId, agentic, agentId | `CubeNFT.CubeMinted` | near-full `CubeData` in one log |
| mintedAt, sourceChainId | (log block ts / known chain) | free, not emitted |
| slot change | `CubeNFT.CubeMoved(cubeId,fromSlot,toSlot,owner)` | mutable slot |
| merge | `CubeNFT.StreetMerged(streetTokenId,owner,street,occ)` | street collapse |
| re-base | `CubeNFT.CubeCustomized` + `CubeMintController.CubeCustomizedWithPayload(…,payloadHash)` | new source + payload hash |
| agentic binding | `AgentStatusRegistry.AgentBindingUpdated(srcContract,srcTokenId,agentic,agentId,updatedAt)` | follow logs |
| non-normie payload commit | `NonNormieArtStore.NonNormiePayloadRecorded`, `BrainrotGenesisMinter.SourcePayloadCommitted(sourceId,payloadHash)` | links id → art blob |
| **flattened tonal payload (400 B)** | *not emitted* — fetch once by hash/pointer, cache | immutable |
| **normie raw image bytes** | *not emitted* — fetch once per normieId from NormiesStorage, cache | immutable |
| **derived traits** (colour=axis, geometry=plane, edge-points) | *computed* from seed+slot via the JS twins | no contract read |

### Pipeline (Node/TS service on the VPS)
1. **Backfill** `eth_getLogs` from the deploy block for
   `[CubeNFT, CubeMintController, NonNormieArtStore, AgentStatusRegistry]`.
2. **Live** WebSocket `eth_subscribe("logs", {address, topics})`.
3. **Decode → upsert** one record per `cubeId` (owner, slot, source, seed, agentic,
   payloadHash). All from logs — no `eth_call`s for the record.
4. **Lazy art cache** — first sighting of a `payloadHash`/`normieId` → one fetch of the
   bytes → store on disk/blob permanently (immutable, so never re-fetch).
5. **Serve** a snapshot JSON (or tiny read API) behind a CDN. The viewer reads *that*
   instead of the chain → ~0 RPC per user (the concurrency fix: N viewers ≠ N×12k
   calls). Keep the record shape identical to `chain-cubes.js recordFromChain` so the
   viewer's existing consumers are unchanged.
6. **Reorg/finality** (mainnet): treat the last N blocks as tentative, re-read the
   affected range on reorg. Irrelevant on the dev anvil fork.

### Optional contract tweak (not required)
Include the SSTORE2 **pointer** (not just `payloadHash`) in the payload/customize
events so the indexer reads art bytes directly without a lookup call. Marginal — do
not gate the design on it.
