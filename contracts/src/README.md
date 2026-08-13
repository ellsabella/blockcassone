# Contracts Source

Solidity contracts will be added here one by one.

Implemented / current contracts:

- `CubeNFT.sol`
- `NonNormieArt.sol`
- `NonNormieArtStore.sol`
- `FlatteningAttestation.sol`
- `CubeMintController.sol`
- `CubeRendererV1.sol`
- `CubeRendererV2.sol`
- `RendererAssetStore.sol`
- `AgentStatusRegistry.sol`
- `NormieAdapter.sol`
- `MainnetNormieAdapter.sol`

Important current direction:

- `CubeNFT` stores plot/source facts and the mint-time agent snapshot.
- `AgentStatusRegistry` stores current source-agent bindings so already-minted
  cubes can awaken after a source Normie becomes agentic.
- Renderer-facing data should resolve agent state as current registry value
  when present, otherwise mint-time snapshot.
- Non-Normie flattened art payloads are prototype/future-update infrastructure,
  not the genesis production mint path.
- Placement is **mutable world state**: slots are assigned at mint by the
  allocator in `GenesisMinterBase` (anchor-then-wrap, ≤5/wallet/street), and
  holders can relocate (`moveCube`) or merge whole streets (`mergeStreet`)
  post-mint. `moveCube` also **displaces** — into an occupied slot in a street the
  mover owns ≥5/8 of, force-swapping the occupant and paying them a biome-rarity
  fee. All three actions are `payable` (owner-tunable fees, biome weights from
  `lib/CubeEnv.sol`); see [`FEES_AND_DISPLACEMENT_SPEC.md`](../../FEES_AND_DISPLACEMENT_SPEC.md).
  Plot, street, neighbourhood, region, and environment are all derived from the
  slot. See [`WORLD_MECHANICS.md`](../../WORLD_MECHANICS.md) for the full reference.
- Production genesis is a **multi-source SeaDrop drop** (`MultiSourceGenesisMinter`):
  6 collections with a locked allocation of the 4096 supply. GTD holders get their
  CHOSEN art via on-chain reservations (consumed first by the SeaDrop hook, protected
  by the `gtdEndTime` window); FCFS + public mints draw randomly from the combined
  pool. The old Merkle-snapshot "mint your Normies" allowlist was removed.
- Brainrot and other owned-art sources are post-mint update flow only.

World mechanics (allocation, environment, population, merge, move) are **built
into `CubeNFT` + `GenesisMinterBase`/`MultiSourceGenesisMinter` + `lib/CubeEnv.sol`**,
not a separate world contract.
- `RendererRegistry.sol`: renderer versioning and optional owner pinning.
- `BehaviorRegistry.sol`: compact behavior state if visual evolution needs token-level state.
