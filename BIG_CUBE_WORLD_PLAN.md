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
- 4096 cubes ÷ 512 streets = 8/street; with **≤3 per wallet per street**, a full
  street draws from ~3 wallets → **streets are shared**.
- A wallet's holdings are kept **together** (a contiguous run of streets), ≤3 per
  street. Example: 4 cubes → 3 on street A + 1 on street B.
- Vacancy appears only in the **unminted tail** if the 4096 cap isn't filled.
- Replaces today's `slot = mintedCount`. Candidate algorithm: per-street fill
  cursor + per-(wallet,street) ≤3 cap. *(allocation algorithm still to finalize)*

### 2. Environment (biome) — street-level, rarity-weighted
- One environment per **street**; all 8 plots share it.
- Deterministic + permanent: `id = weightedPick(keccak(WORLD_SEED, street))`.
- 6 biomes (`desert, water, grass, forest, mountain, ice`), weights (out of 100):
  grass 34, forest 30, water 20, desert 12, mountain 3, ice 1.
- `Environment` metadata trait + renderer biome visuals. JS viewer must mirror
  the same WORLD_SEED + weights (sidePlan-style parity).
- **Status: on-chain `CubeEnv` lib + `Environment` trait done; weights confirmed;
  JS parity pending.**

### 3. Move
- Holder moves a cube they own from its plot to **any vacant plot** via the UI.
- `moveCube(cubeId, newSlot)`: verify ownership + newSlot vacant; update the
  cube's slot + slot→cube mapping. Colour/environment/street follow the new slot.
- Purpose: drive post-mint activity, consolidate streets for merging, chase
  scarcer environments, negotiate between holders.

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
4. **Plot allocation** — clustering allocator (≤3/wallet/street) replacing
   sequential slots. *(next launch-critical; allocation algorithm to finalize)*
5. **Move** — `moveCube(cubeId, vacantSlot)` + UI.
6. **Merge** — kind flag, 8→1 burn, street-record store, street SVG + HTML,
   placeholders. *(produces the `TOKEN.plots` the street view consumes)*
7. **Customization** — flatten + store + UI; CC0 review.
8. **WebUI** — explore tab, customize tab, move/merge flows.

### Biome placeholders (to revisit)
- They don't currently render on vacant plots in the street preview — needs a
  look (likely the empty-slot floor/accent setup in the token render context).
- The biome visuals themselves need an **aesthetic pass** (not happy with them).
- Ties to the environment model (#1) and the merged-street render (#6).

## Status snapshot (already built)

- Genesis mint: SeaDrop hook, allowlist (Merkle), public pull, claim tracking,
  phases. Snapshot + Merkle tooling with real artifacts.
- Renderer: cube SVG (`image`) + interactive 3D HTML (`animation_url`), edge-point
  trait 2D/3D parity, agent-status registry, chunked asset store.
- Shared `StrBuf` string builder.

## Open decisions

- Finalize the **plot-allocation algorithm** (≤3/wallet/street, keep-together).
- Merge **"leader" rule** + whether merge is reversible.
- Customization **flatten format** + the source allow-list policy.
