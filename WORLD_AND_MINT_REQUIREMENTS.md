# Blockcassone World And Mint Requirements

This document captures the current product direction for the dev pipeline, mint
site, world model, and contract architecture.

## Product Shape

The dev pipeline website is no longer only a technical preview. It should evolve
into the project home and canonical mint source.

The project has two linked surfaces:

- **Individual cube NFT**: fully onchain after mint, with self-contained
  metadata, static `image`, and interactive `animation_url`.
- **Project home / Big Cube viewer**: offchain website for discovery, minting,
  wallet exploration, world navigation, community movement, and richer visual
  iteration.

The offchain website may use OpenSea, indexers, proxies, and richer rendering.
The individual token must not depend on those systems after mint.

The project home should ultimately have two tabs:

- **Current Block**: indexed view of the minted 4096-cube world, with wallet
  focus, whole-block exploration, current owner lookup, and cube detail panels.
- **Update Cube**: owner flow for validating cube ownership, loading allowable
  owned/CC0 assets, picking an update source, and submitting onchain update
  payloads.

The dev viewer has an intermediate contract-read mode for the Current Block
tab. When `data/chain-config.json` is enabled, it reads `CubeNFT` state through
JSON-RPC and uses that as the minted-cube source. When disabled, it falls back
to `viewer/data/dev-mints.json`. This does not replace the eventual indexer,
but it proves the viewer can be driven by contract state.

Production copyright policy, Normie-only genesis minting, and the later
CC0/owned-art update direction live in `PRODUCTION_MINT_AND_CC0_PLAN.md`. In
production, arbitrary third-party NFT media ingestion is retired from the
genesis mint unless explicitly reintroduced after legal review.

## Mint UX Direction

The mint website should make the newly minted world position immediately legible.

Production genesis mint source policy:

1. Allowlist phase: Normie holders mint only their snapshot Normies.
2. Public phase: anyone can mint any unclaimed snapshot Normie source.
3. The hard genesis supply cap is `4096`.
4. No paid genesis mint produces a placeholder cube.

Normie owners should receive cubes tied to their exact snapshot Normie token
IDs during the allowlist phase. This is a product requirement, not only a
visual preference. Public-phase cubes are still Normie-sourced; they are simply
drawn from the unclaimed global snapshot pool.

After a successful mint:

- the main world view should return to `region` scale
- owner focus should activate for the loaded wallet
- all cubes owned by that wallet should be highlighted at any visible scale
- the first newly minted cube should become the active selection
- the active cube should open in the 3D detail panel
- the camera/orbit target should look at the first newly minted cube
- the project UI should expose a compact owner inventory list for the focused
  wallet

When owner focus is active:

- clicks in the main world should prioritize, and may be restricted to, cubes
  owned by the focused wallet
- if the user deliberately navigates to an empty plot, the UI should label it as
  `empty slot`
- if the user navigates to another owner's cube, owner focus may pivot to that
  owner and show all cubes owned by them
- the minimap should show the focused owner's cube locations across the entire
  4096-plot block

This is a UI and discovery feature. Ownership and placement remain contract
state; any indexer used by the UI is only a read cache.

## Art Refinements

### Post-Mint Updated Cubes

The genesis mint is Normie-only. After launch, the project website should offer
an owner update flow for people who acquired cubes and want to change the art.

Allowed update sources may include:

- owned wallet assets that pass source validation
- approved CC0 project assets

Updated cubes may gain awakened or source-specific behaviors:

- moving RGB lights
- higher movement or animation intensity
- possible forest strands
- possible particle systems
- special material or glow treatment to show awakened status

These visual treatments should be prototyped in the update tab of the dev
viewer first. The onchain renderer should later receive only the distilled
payload, behavior flags, and compact rendering logic needed to reproduce the
final result.

### Natural Neighbourhoods

The Big Cube is a new world to be conquered, not a blank Hilbert scaffold.

Before slots are occupied, each neighbourhood should have a simple natural
environment shader or visual identity. Initial environment types may include:

- desert
- water
- grass
- forest
- stone or mountain
- ice or snow
- void or night

Each neighbourhood should expose:

- `neighbourhood`: 0-based local 3rd-order Hilbert block index.
- `Environment`: natural environment type.

The dev viewer should render these environments for vacant neighbourhoods and
show how minted cubes overwrite, inhabit, or transform them.

## World State

The final world supply remains a 5th-order Hilbert cube:

```text
4096 plots
8 regions
64 neighbourhoods
512 streets
```

Traits already required:

- `plot`: 0-based Hilbert slot, `0..4095`.
- `region`: 0-based 4th-order Hilbert block, `0..7`; 512 plots each.
- `neighbourhood`: 0-based neighbourhood, `0..63`.
- `street`: 0-based 8-cube Hilbert subset, `0..511`.
- `Agentic`: `Y` / `N`.
- `Agent ID`: numeric agent binding ID, `0` when not agentic.
- `Source Contract`.
- `Source Token ID`.

New dynamic or world-derived traits under consideration:

- `Environment`
- `Neighbourhood Population`
- `Street Population`
- `Region Population`
- `Neighbourhood Agents`
- `Street Agents`
- `Region Agents`

Population traits are dynamic. They may change when new cubes mint, move, or
consolidate. That is acceptable if the behavior is fully onchain, but
marketplace refresh behavior must be considered.

## Placement Rules

Initial placement is more than “is this plot vacant?”

The contract architecture should allow placement policies such as:

- one cube per plot
- source uniqueness
- maximum agentic cubes per neighbourhood
- maximum agentic cubes per street
- maximum agentic cubes per region
- possible environment-specific placement rules
- possible community or wallet preference rules

The dev simulator should model these rules before they are committed to
Solidity.

## Movement

Post-mint movement is expected.

Owners should eventually be able to move a cube to a vacant plot elsewhere in
the Big Cube, subject to placement policy. This lets users choose or change
communities.

Movement means:

- `plot`, `street`, `neighbourhood`, and `region` are mutable world-state facts.
- source identity remains permanent.
- slot occupancy must update atomically.
- population counters must update atomically.
- token metadata may change after movement.

The current contracts should therefore be treated as an early boundary, not the
final world-state design.

## Neighbourhood Consolidation

If one wallet owns an entire neighbourhood, it should eventually be able to
consolidate that neighbourhood.

Expected behavior:

- owner proves ownership of every cube in the neighbourhood
- owner consolidates the set
- the other cubes are burned, locked, or marked consumed
- one surviving or newly minted super-rare NFT represents the neighbourhood

Open design decisions:

- keep one existing token as the survivor or mint a new consolidated token
- whether burned cubes remain visible as historical ruins in the Big Cube
- whether source identities of consumed cubes remain referenced by the
  consolidated token
- how consolidation affects population traits

## Contract Direction

The project likely needs a dedicated world-state layer rather than keeping all
placement logic inside `CubeNFT`.

Recommended future module:

- `CubeWorld` or `WorldState`

Responsibilities:

- plot occupancy
- movement
- neighbourhood and region derivation
- street derivation
- environment assignment
- population counters
- agentic population counters
- placement-policy hooks
- consolidation eligibility

`CubeNFT` should remain the ERC-721 identity and source-provenance contract.
`CubeWorld` should become the mutable map/state contract.

## Indexer Boundary

The contracts must be the source of truth for minting, placement, ownership,
payloads, movement, and consolidation. An indexer is not allowed to be required
for token validity or renderer correctness.

For the project home / Big Cube website, an indexer is strongly recommended for
performance and ergonomics:

- wallet-owned cube lists
- owner-focus highlighting
- current owner lookup for secondary sales
- current source/update status
- movement history
- population and agent counts
- consolidation eligibility
- cross-chain source/provenance summaries

The UI should be designed so indexer data can be rebuilt from contract state and
events. Direct contract reads should remain possible for correctness checks and
small views, but the full city-scale experience may rely on indexed reads for
speed.

## Dev Pipeline Priorities

Before adding more Solidity, prototype in the dev viewer:

1. Natural neighbourhood environments.
2. Agentic non-Normie awakened visuals.
3. Placement-policy simulator.
4. Population counters and UI labels.
5. Movement UX for vacant slots.
6. Update-cube UX for owned/approved CC0 assets.
7. Consolidation UX for full-neighbourhood ownership.

Once the behavior feels right, move only the hard invariants and compact state
into contracts.
