# Blockcassonne Onchain Implementation Plan

This document sketches the contract and renderer architecture for turning the
current dev pipeline into an onchain NFT collection. It is intentionally concise
but detailed enough to guide the first contract templates.

## Goals

- Each minted cube is an ERC721 token with an interactive single-cube HTML view.
- Each cube can orbit and zoom in/out in-wallet, like the current 3D viewer.
- Cube identity is permanent: source token, Hilbert slot, seed, and provenance do
  not change.
- Cube behavior/rendering may evolve over time through versioned renderers and
  small onchain behavior state.
- A separate full-world viewer can show the complete Hilbert curve and all
  minted cubes. This can be hosted as a web app and optionally minted as a 1/1.
- The dev viewer should evolve into the project home and canonical mint source.
- The Big Cube is a world with natural neighbourhood environments, population,
  movement, and consolidation, not only a blank Hilbert scaffold.

Note: the original plan treated Hilbert slot as immutable. The current product
direction expects source identity to stay permanent while plot placement becomes
mutable world state after mint.

## Size Constraints

Current dev code is far too large to store as one contract or per token:

- `viewer + renderer/shaders + renderer/src`: larger than can fit in one
  production renderer contract
- `viewer/main.js`: too large to ship directly onchain
- several individual files exceed 20 KB

Ethereum contract runtime size is about 24 KB, so the production renderer must be
split into small shared contracts/chunks and distilled from the dev viewer.

Important principle:

```text
Per-token mint storage must be tiny.
Shared renderer/runtime assets can be larger, but deployed once.
```

## Core Invariants

These must be enforced by contracts, not only the UI.

```text
One Normie tokenId -> at most one cube.
One Hilbert slot -> at most one cube.
Minting wallet must own the source NFT at mint time.
```

The official mint UI should prioritize uncubed Normies before non-Normies. Fully
enforcing that priority onchain is awkward because a contract cannot cheaply
scan a wallet's entire NFT inventory. The hard uniqueness rules should be
onchain; source ordering can be enforced in the mint controller/UI.

## Contract Architecture

### CubeNFT

Primary ERC721 contract and source of truth for cube identity.

Responsibilities:

- mint cube tokens
- store immutable cube facts
- enforce Normie uniqueness
- enforce Hilbert slot uniqueness
- expose read helpers for renderers and world viewer
- delegate `tokenURI` to a renderer registry/current renderer

Core state:

```solidity
struct CubeData {
    uint256 slot;
    uint8 sourceKind; // 1 Normie, 2 External ERC721, 3 External ERC1155 later
    uint256 sourceChainId;
    address sourceContract;
    uint256 sourceTokenId;
    uint256 seed;
    uint64 mintedAt;
}

mapping(uint256 => CubeData) public cubeData;
mapping(uint256 => bool) public slotOccupied;
mapping(uint256 => uint256) public normieToCubeId;
mapping(uint256 => uint256) public cubeIdToNormie;
```

Normie mint invariant:

```solidity
require(NORMIES.ownerOf(normieId) == msg.sender, "Not Normie owner");
require(normieToCubeId[normieId] == 0, "Normie already cubed");
```

Slot invariant:

```solidity
require(!slotOccupied[slot], "Slot occupied");
```

Use a nonzero cube id offset or a separate boolean if cube id `0` is valid.

### Mint Controller

May be merged into `CubeNFT` for v1, but conceptually separate.

Responsibilities:

- check source NFT ownership
- handle price/payment
- select/request randomness for Hilbert slot placement
- call internal mint function
- emit clear mint events

Mint flow:

1. Load wallet inventory offchain.
2. Identify held Normies.
3. Query `normieToCubeId`/batch helper for uncubed Normies.
4. Mint uncubed Normies first.
5. If user wants more and has no uncubed Normies, select external NFTs.
6. Mint external source cubes.

### Mint Path Options

Working assumption for now: build the custom path first. This preserves exact
source-token identity and keeps the one-Normie-one-cube invariant directly under
our control. Revisit OpenSea/SeaDrop once aesthetics and source data formats are
settled.

#### Option A: Custom Mint UI + Custom Mint Controller

This is the cleanest canonical path.

Flow:

1. User connects wallet.
2. UI loads wallet inventory through an indexer/API.
3. UI identifies Normies and external NFTs.
4. UI queries contract state for already-cubed Normies and occupied slots.
5. UI proposes the mint batch:
   - uncubed Normies first
   - external NFTs only after no uncubed Normies remain, or in a later phase
6. User submits exact source token ids to the mint controller.
7. Contract checks current ownership and uniqueness.
8. Contract assigns Hilbert slot(s), mints cube(s), and stores source identity.

Advantages:

- exact Normie token id is known during mint
- `normieToCubeId` can be enforced atomically
- source token, cube id, and slot are finalized in one transaction
- external NFT handling can use the same source-aware flow
- simplest mental model for collectors and future contract audits

Tradeoffs:

- requires our own mint UI
- does not use the OpenSea Drops page as the primary mint surface
- wallet inventory loading remains partly offchain, although final ownership
  checks stay onchain

#### Option B: OpenSea/SeaDrop Token-Gated Stage

This can work for eligibility, but not as the canonical source assignment path.

SeaDrop can run a token-gated stage for Normie holders. It can verify ownership
of allowed source token ids and prevent those token ids from being redeemed
twice inside that SeaDrop stage. However, the downstream NFT contract receives
only the minter and quantity via the SeaDrop mint callback, not the exact Normie
token ids.

Result:

```text
SeaDrop knows which Normie ids were redeemed.
CubeNFT only sees minter + quantity.
```

That means `CubeNFT` cannot atomically bind `normieId -> cubeId` during the
OpenSea mint transaction unless the flow is extended outside standard SeaDrop.

Possible use:

- OpenSea token-gated mint creates pending cube tickets.
- A later custom redeem/assign step binds each pending cube to an exact Normie.
- Backend/indexer watches SeaDrop events or uses a prior snapshot to guide
  assignment.

Risks:

- pending cubes exist before canonical source assignment
- snapshot data can become stale if Normies move before mint
- wallet-level matching is ambiguous when a wallet owns many Normies but mints
  fewer than all
- a backend/operator assignment step becomes part of the trust surface unless
  followed by an onchain proof/redeem mechanism

This option is useful for OpenSea discovery and gating, but weaker than the
custom path for source identity.

#### Option C: Snapshot + Backend Assignment

This is the lightest hybrid, but the least canonical.

Flow:

1. Take wallet-to-Normie snapshot shortly before mint.
2. Let wallets mint by quantity through a simple gated sale.
3. Backend assigns minted cube ids to Normie ids from the snapshot.
4. Contract accepts assignment from an authorized signer/admin or from Merkle
   proofs generated from the snapshot.

Advantages:

- can support a simpler mint surface
- can be combined with OpenSea eligibility tools
- operationally fast for a short presale window

Risks:

- not live ownership based unless rechecked at assignment time
- ambiguous when users own multiple eligible Normies
- weaker collector confidence than passing exact source ids into the mint
  transaction
- requires careful failure handling for unassigned/pending cubes

Recommendation:

```text
Use Option A for the canonical mint.
Keep Option B/C as possible marketing or presale wrappers only if they mint
pending tickets that must later be source-assigned through our custom contract.
```

### Placement Module

Can be a library/internal module initially, but the final project likely needs a
dedicated `CubeWorld` or `WorldState` contract.

Responsibilities:

- track occupied Hilbert slots
- assign one random available slot per minted cube
- expose occupancy for the world viewer
- derive neighbourhood and region indices
- store neighbourhood environment type
- track neighbourhood and region population
- track neighbourhood and region agentic population
- support owner movement to vacant plots
- support consolidation checks for full-neighbourhood ownership

Randomness options:

- production: Chainlink VRF or another credible randomness source
- simpler early testnet: commit/reveal
- avoid relying only on block data if placement has market value

Placement policy should be developed first in the dev simulator. Candidate
rules include maximum agentic cubes per neighbourhood, maximum agentic cubes per
region, and environment-specific restrictions.

### Renderer Registry

Allows renderers to evolve while preserving immutable cube identity.

Possible policy:

- V1 renderer remains permanently available.
- New renderers can be added.
- Default renderer can change behind owner/DAO/timelock control.
- Token owners may optionally pin a cube to an older renderer.

Suggested state:

```solidity
address public defaultRenderer;
mapping(uint256 => address) public rendererForToken; // optional owner pin
```

`CubeNFT.tokenURI(tokenId)` calls the selected renderer.

### CubeRenderer

Builds metadata and interactive HTML for one cube.

Responsibilities:

- read `CubeData` from `CubeNFT`
- read behavior state
- read shared renderer/runtime chunks
- return base64 JSON with `animation_url` containing HTML

The token HTML should be a compact production renderer, not the full dev viewer.

It should include:

- minimal WebGL setup
- compact orbit/zoom controls
- compact shaders
- one-cube geometry/render pipeline
- source-specific visual reconstruction
- small behavior interpreter

### RendererAssetStore / Chunk Contracts

Stores shared HTML, JS, shader, and maybe lookup-table chunks once.

Potential approaches:

- SSTORE2-style bytecode storage
- small asset contracts that return bytes/string chunks
- compressed chunks where decompression cost and JS size are worthwhile

Do not store the complete renderer per token.

### Behavior Registry

Stores small mutable/evolving state.

Example:

```solidity
struct BehaviorState {
    uint32 epoch;
    uint32 lastInteraction;
    uint16 energy;
    uint8 mode;
    uint8 flags;
}

mapping(uint256 => BehaviorState) public behavior;
```

Renderer turns these small values into rich behavior:

- pulse speed
- light orbit radius
- shader phase
- vortex density
- neighbour/world influence

## Token Data Strategy

### Normie Cubes

Store only:

- Normie token id
- assigned Hilbert slot
- seed

Normie visual data should be derived from existing Normies onchain storage where
possible. This keeps mint storage extremely low.

### Non-Normie Pixel Art

Prefer compressed cell data:

- native grid size
- normalized/cropped 40x40 data
- palette
- indexed cells
- RLE or packed bit/byte runs

Avoid raw uncompressed arrays where possible.

### Non-Normie Smooth Art

Current dev path uses 120x120 grayscale/cluster grids and 40 depth bands. Raw
storage would be too expensive:

```text
120 * 120 = 14,400 cells
1 byte per cell = 14.4 KB before overhead
```

For onchain production, investigate:

- lower resolution for token renderer
- palette/cluster maps
- RLE
- sparse/thresholded layers
- deterministic feature extraction from stored smaller data

Target per-token external art payload should ideally be around 1-5 KB
compressed, not 14-50 KB.

## World Viewer

Separate from individual cube NFT rendering.

Purpose:

- show the full Hilbert curve
- show all minted slots
- navigate/filter by source type, wallet, category, slot, etc.
- evolve as a richer web app
- serve as the project home and canonical mint UI
- render natural neighbourhood environments before they are occupied
- preview movement to vacant plots
- show neighbourhood and region population
- show consolidation eligibility

Deployment:

- normal hosted static site for usability
- same build pinned to IPFS and/or Arweave
- optional ENS name pointing to permanent content
- optional 1/1 NFT representing the canonical world viewer

The world viewer can query:

- `CubeNFT`
- renderer/behavior registries
- source token contracts
- event logs/indexer

The current dev viewer should prototype:

- agentic non-Normies with awakened Normie-style lights, motion, forest strands,
  and particles
- natural environments such as desert, water, grass, forest, stone, ice, and
  void
- dynamic population traits
- movement UX
- consolidation UX

## Evolution Model

Immutable:

- cube id
- source NFT reference
- Normie uniqueness link
- seed/randomness
- mint timestamp/block

Evolvable:

- Hilbert plot / neighbourhood / region after movement
- renderer version
- global collection epoch
- cube behavior params
- world viewer behavior
- optional owner-selected renderer pin

Evolution sources:

- block time/number
- total minted count
- occupied slot count
- global epoch set by timelock/DAO/owner
- per-cube interaction state
- neighbouring slot state in the world viewer

Recommended policy:

```text
V1 renderer is permanent.
New renderers may be added.
Default renderer may evolve with timelock/governance.
Owners can pin old renderers if desired.
```

## First Contract Templates To Build

1. `CubeNFT.sol`
   - OpenZeppelin ERC721
   - cube data storage
   - Normie uniqueness mapping
   - slot occupancy mapping
   - basic owner/admin controls

2. `CubeRendererV1.sol`
   - simple metadata JSON
   - simple HTML renderer placeholder
   - reads `CubeNFT.cubeData`

3. `RendererAssetStore.sol`
   - chunk storage prototype
   - returns concatenated renderer pieces

4. `MintController` or integrated mint functions
   - `mintNormieCube(uint256 normieId)`
   - `mintExternalCube(address contract, uint256 tokenId)`
   - ownership checks
   - placeholder random slot assignment

5. `BehaviorRegistry.sol`
   - small state struct
   - update methods/events
   - renderer read helpers

## Open Questions

- Randomness provider: VRF, commit/reveal, or delayed reveal?
- Should external NFTs also be one-source-token-to-one-cube?
- How much non-Normie visual data is acceptable to store per token?
- Should owners be allowed to pin renderer versions?
- Who controls global renderer/default behavior changes?
- Which permanent hosting path for world viewer: IPFS, Arweave, ENS, or all?
