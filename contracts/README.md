# Blockcassone Contracts

This folder contains the Foundry Solidity project. It is intentionally separate from the existing JavaScript renderer and viewer pipeline, but the dev viewer is now the primary place to prototype project-home, mint, world, and art requirements before they are moved into contracts.

Planned layout:

```text
contracts/
  src/      Solidity contracts
  test/     Foundry tests
  script/   Deployment and maintenance scripts
  lib/      Foundry dependencies
  out/      Build output, ignored
  cache/    Foundry cache, ignored
```

The current dev pipeline remains the source for visual experimentation. Production contracts will be added one by one under `contracts/src`.

Current architectural direction:

- `CubeNFT` remains the ERC-721 identity and source-provenance contract.
- `CubeMintController` / source-aware mint code currently exists as prototype
  infrastructure and should not be treated as the genesis production path.
- `CubeRendererV1` is an early metadata boundary, not the final visual renderer.
- A future `CubeWorld` or `WorldState` contract should own mutable plot state, movement, neighbourhood environments, population counters, placement-policy checks, and consolidation mechanics.
- Genesis production minting is Normie-only: allowlist wallets mint their
  snapshot Normies, then the public phase mints any unclaimed snapshot Normie
  source until the `4096` cube supply cap is reached.
- Public-phase source selection should use a deterministic-random pull from the
  unclaimed Normie pool, not lowest-token-id cursor order.
- No paid genesis mint should produce a placeholder/environment-only cube.
- The current arbitrary external ERC-721 flattening path and CC0 registry are
  prototype/future-update infrastructure unless explicitly reintroduced after
  legal review.

Likely production mint contracts:

- `NormieSnapshotRegistry`: committed wallet-to-Normie snapshot and consumption.
- `SourceAssignment`: allowlist and public Normie-source assignment for
  quantity mints.
- `CubeWorld`: plot occupancy, placement, environments, movement, population,
  and consolidation.
- Future update contracts may add an approved CC0/owned-art payload registry,
  but that is not a genesis mint dependency.

Indexer / UI boundary:

- contract state and events are the source of truth
- an indexer is expected for the project-home Big Cube UX, wallet-owned lists,
  population views, movement history, and consolidation queries
- the indexer must remain a read cache only; token metadata, renderer assets,
  source identity, update payloads, and world-critical state must be stored or
  recoverable from contracts
- L2 source NFTs and OpenSea agent data require an attestation/proof path if
  they affect permanent token traits or art

See `../WORLD_AND_MINT_REQUIREMENTS.md` for the current world and mint requirements.
