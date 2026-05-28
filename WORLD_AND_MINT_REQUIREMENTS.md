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

## Art Refinements

### Agentic Non-Normies

Agentic non-Normie NFTs should gain some awakened Normie behaviors:

- moving RGB lights
- higher movement or animation intensity
- possible forest strands
- possible particle systems
- special material or glow treatment to show awakened status

These visual treatments should be prototyped in the dev viewer first. The
onchain renderer should later receive only the distilled behavior flags and
compact rendering logic needed to reproduce the final result.

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
64 neighbourhoods
512 regions
```

Traits already required:

- `plot`: 0-based Hilbert slot, `0..4095`.
- `neighbourhood`: 0-based neighbourhood, `0..63`.
- `region`: 0-based region, `0..511`.
- `Agentic`: `Y` / `N`.
- `Agent ID`: numeric agent binding ID, `0` when not agentic.
- `Source Contract`.
- `Source Token ID`.

New dynamic or world-derived traits under consideration:

- `Environment`
- `Neighbourhood Population`
- `Region Population`
- `Neighbourhood Agents`
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

- `plot`, `neighbourhood`, and `region` are mutable world-state facts.
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
- environment assignment
- population counters
- agentic population counters
- placement-policy hooks
- consolidation eligibility

`CubeNFT` should remain the ERC-721 identity and source-provenance contract.
`CubeWorld` should become the mutable map/state contract.

## Dev Pipeline Priorities

Before adding more Solidity, prototype in the dev viewer:

1. Natural neighbourhood environments.
2. Agentic non-Normie awakened visuals.
3. Placement-policy simulator.
4. Population counters and UI labels.
5. Movement UX for vacant slots.
6. Consolidation UX for full-neighbourhood ownership.

Once the behavior feels right, move only the hard invariants and compact state
into contracts.
