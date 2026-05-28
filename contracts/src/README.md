# Contracts Source

Solidity contracts will be added here one by one.

Implemented / current contracts:

- `CubeNFT.sol`
- `NonNormieArt.sol`
- `NonNormieArtStore.sol`
- `FlatteningAttestation.sol`
- `CubeMintController.sol`
- `CubeRendererV1.sol`
- `NormieAdapter.sol`
- `MainnetNormieAdapter.sol`

Important current direction:

- `CubeNFT` currently stores early plot/source/agent facts.
- `agentic` and numeric `agentId` are permanent metadata fields for now.
- Non-Normie flattened art payloads are attested before mint.
- Placement is currently simple slot occupancy, but final placement is expected to become mutable world state.

Likely future contracts:

- `CubeWorld.sol` or `WorldState.sol`: plot occupancy, movement, environments, population counters, placement-policy checks, and consolidation.
- `RendererAssetStore.sol`: shared renderer chunks and assets.
- `RendererRegistry.sol`: renderer versioning and optional owner pinning.
- `BehaviorRegistry.sol`: compact behavior state if visual evolution needs token-level state.
