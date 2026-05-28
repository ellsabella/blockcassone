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
- `CubeMintController` handles attested non-Normie mint payloads.
- `CubeRendererV1` is an early metadata boundary, not the final visual renderer.
- A future `CubeWorld` or `WorldState` contract should own mutable plot state, movement, neighbourhood environments, population counters, placement-policy checks, and consolidation mechanics.

See `../WORLD_AND_MINT_REQUIREMENTS.md` for the current world and mint requirements.
