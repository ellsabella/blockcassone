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
- Non-Normie flattened art payloads are prototype/future-update infrastructure,
  not the genesis production mint path.
- Placement is currently simple slot occupancy, with plot, street, neighbourhood, and region derived from the slot. Final placement is expected to become mutable world state.
- Production source policy has shifted to a Normie-only genesis mint. Allowlist
  wallets mint their snapshot Normies, then the public phase mints unclaimed
  snapshot Normie sources until the `4096` cube supply cap is reached.
- CC0 and owned-art sources move to a post-mint update flow.

Likely future contracts:

- `CubeWorld.sol` or `WorldState.sol`: plot occupancy, movement, environments, population counters, placement-policy checks, and consolidation.
- `NormieSnapshotRegistry.sol`: snapshot-root and matched Normie consumption.
- `SourceAssignment.sol`: allowlist/public Normie source assignment helpers.
- Future update registry/contracts: approved CC0 and owner-verified update payloads.
- `RendererAssetStore.sol`: shared renderer chunks and assets.
- `RendererRegistry.sol`: renderer versioning and optional owner pinning.
- `BehaviorRegistry.sol`: compact behavior state if visual evolution needs token-level state.
