# Blockcassone Fully Onchain Implementation Plan

## Objective

Blockcassone will mint one ERC-721 cube per accepted source NFT. After mint, each cube must be fully onchain in the strict sense: the token metadata, HTML renderer, renderer assets, cube identity, source identity, placement, seed, and all art inputs needed to reconstruct the cube must be recoverable from Solidity contracts.

The mint UI and the big-cube exploration website may be offchain. They can use indexers, OpenSea, image proxies, browser canvas extraction, and richer hosted tools. The individual minted cube must not require any of those systems after mint.

## Current State

The current repository is a JavaScript/WebGL prototype. It has:

- A local dev server in `renderer/`.
- A single-cube and big-cube viewer in `viewer/`.
- Shared geometry and rendering helpers in `renderer/src/`.
- Schema notes in `schema/v1/`.
- An onchain architecture sketch in `viewer/ONCHAIN_IMPLEMENTATION_PLAN.md`.

There are currently no Solidity contracts in the repository. Foundry will be added beside the existing pipeline, with contracts isolated under `contracts/`.

## Definition Of Fully Onchain

A cube is fully onchain after mint if the following can be recovered from contracts without offchain dependencies:

- ERC-721 metadata JSON.
- `animation_url` HTML.
- Renderer JavaScript, CSS, shader strings, and compact assets.
- Cube source identity.
- Cube Hilbert slot.
- Cube seed and placement facts.
- Normie data references and font/glyph data.
- Non-Normie flattened art payload.
- Renderer version and payload schema version.

The token must not need:

- OpenSea metadata.
- IPFS or Arweave media.
- `api.normies.art`.
- The hosted big-cube website.
- The local dev image proxy.
- Any project backend after mint.

## Mint-Time Model

The mint UI is allowed to be offchain and may perform discovery and preprocessing.

For Normies, the UI should:

- Discover held Normies.
- Query onchain project state for already-cubed Normies.
- Submit exact Normie token IDs to the mint contract.

For non-Normies, the UI should:

- Discover wallet NFTs.
- Fetch and rasterize the source art offchain.
- Flatten the art into a canonical compact grid.
- Request or produce an attestation for the flattened payload.
- Submit source identity, flattened payload, and attestation to the mint contract.

The contract must validate source ownership and uniqueness at mint time. It cannot generally enumerate every NFT in a wallet, so wallet scanning and normie-first ordering are UI responsibilities. Hard invariants remain onchain.

## Core Onchain Invariants

These invariants must be enforced by Solidity:

- One Normie token ID can mint at most one cube.
- One external source key can mint at most one cube, if external uniqueness is enabled.
- One Hilbert slot can contain at most one cube.
- The minter must own the submitted source NFT at mint time.
- Cube identity is immutable after mint.
- The flattened non-Normie payload is stored or recoverable onchain.

## Contract Layout

Contracts live under `contracts/src/`.

Recommended modules:

- `CubeNFT.sol`: ERC-721 token and canonical cube storage.
- `MintController.sol`: source-aware minting and payment logic, or merged into `CubeNFT` for v1.
- `Placement.sol`: Hilbert slot assignment and occupancy helpers.
- `CubeRendererV1.sol`: metadata and HTML assembly.
- `RendererAssetStore.sol`: shared renderer chunks and assets.
- `NonNormieArt.sol`: flattened payload storage and decoding helpers.
- `AttestationVerifier.sol`: EIP-712 or ECDSA payload verification.
- `NormieAdapter.sol`: reads Normie contract data and font/glyph contracts.
- `RendererRegistry.sol`: version selection and optional token-level renderer pinning.

Foundry paths:

```toml
src = "contracts/src"
test = "contracts/test"
script = "contracts/script"
out = "contracts/out"
cache_path = "contracts/cache"
libs = ["contracts/lib"]
```

## Cube Storage

Suggested canonical data:

```solidity
struct CubeData {
    uint32 slot;
    uint8 sourceKind;
    uint8 rendererVersion;
    uint8 payloadVersion;
    uint64 mintedAt;
    uint256 sourceChainId;
    address sourceContract;
    uint256 sourceTokenId;
    bytes32 seed;
}
```

Suggested mappings:

```solidity
mapping(uint256 => CubeData) public cubeData;
mapping(uint32 => uint256) public cubeForSlot;
mapping(uint256 => uint256) public cubeForNormieId;
mapping(bytes32 => uint256) public cubeForSourceKey;
```

Use nonzero cube IDs or separate booleans so ID `0` ambiguity does not leak into uniqueness checks.

## Non-Normie Flattened Payload

The current renderer ultimately consumes a compact art field rather than the original source image. The active non-Normie path uses the flattened grid to derive:

- 40 by 40 contour lines.
- A foreground or tonal mask for walkers.
- A reduced voxel volume built in browser-side JavaScript.
- Source contract text for the banner.

Recommended payload options:

### Binary Mask

```text
40 * 40 * 1 bit = 200 bytes
```

Pros:

- Cheapest.
- Good for silhouettes and simple walkers.

Cons:

- Less expressive.
- Loses tonal contour behavior.

### Two-Bit Tonal Bands

```text
40 * 40 * 2 bits = 400 bytes
```

Pros:

- Best default.
- Supports contour edges between tonal bands.
- Small enough for routine per-token storage.

Cons:

- Less faithful than grayscale.

### Eight-Bit Grayscale

```text
40 * 40 * 8 bits = 1600 bytes
```

Pros:

- Most flexible.
- Browser renderer can recompute thresholds and masks.

Cons:

- Higher storage cost.

Recommendation: start with the 2-bit tonal-band payload. Keep the schema versioned so a later grayscale payload can be supported without invalidating v1 cubes.

## Non-Normie Attestation

To strengthen provenance, the mint transaction should include an attestation tying the source NFT to the flattened payload.

The signed message should cover:

- Chain ID.
- Cube contract address.
- Minter.
- Source contract.
- Source token ID.
- Source token standard.
- Payload version.
- Flattening algorithm version.
- Payload hash.
- Deadline or nonce.

The contract verifies the signature during mint. The signature does not need to be stored permanently unless we want direct historical inspection onchain.

Expected overhead:

- Permanent storage: usually only `payloadVersion` and the payload itself.
- Mint calldata: about 65 bytes for the signature plus small typed-data fields.
- Optional permanent signature storage: about 65 bytes.

## Normie Path

Normie cubes should not use the current `api.normies.art` dependency after mint.

The production renderer should read:

- Normie ownership via the Normie ERC-721 contract.
- Normie pixels and traits from Normie onchain contracts or adapter contracts.
- Burned/awakened/edited status from onchain sources where available.
- Font or glyph data from a contract-stored font/glyph source.

If a Normie datum is not directly available onchain, add an adapter or mirror contract before treating it as required by the NFT renderer.

## Renderer Strategy

Do not store full renderer HTML per token.

Use shared contracts for:

- HTML shell chunks.
- Minified JavaScript chunks.
- Shader strings, if WebGL remains the v1 renderer.
- Small lookup tables.
- Font/glyph assets.

`tokenURI(tokenId)` should:

1. Read `CubeData`.
2. Read or reference the flattened art payload.
3. Read the current renderer address from a registry.
4. Return base64 JSON.
5. Include a base64 HTML `animation_url` assembled from shared chunks and token-specific data.

Browser-side JavaScript should decode the payload and build the voxel mesh. Solidity should not attempt to generate large meshes during `tokenURI`.

## Placement And Randomness

Slot assignment should be onchain and collision-free.

Options:

- Chainlink VRF or equivalent for high-trust randomness.
- Commit-reveal for a simpler self-contained flow.
- Deterministic assignment from source identity and mint index for early testnets only.

Avoid relying only on block variables if slot placement has meaningful market value.

## Big Cube Website

The big-cube viewer remains offchain. It may:

- Query contract events and state.
- Use an indexer.
- Use richer assets and UI.
- Explore all minted cubes and empty Hilbert slots.
- Offer filters, wallet views, and high-performance rendering.

The website is not part of the individual token's fully onchain guarantee.

## Implementation Phases

### Phase 1: Foundry Scaffold

- Add `foundry.toml`.
- Create `contracts/src`, `contracts/test`, `contracts/script`, and `contracts/lib`.
- Keep existing JS pipeline untouched.
- Add placeholder docs for contract modules.

### Phase 2: Core NFT Storage

- Implement `CubeNFT`.
- Add `CubeData`.
- Add uniqueness mappings.
- Add source key helpers.
- Add basic minting for test-only fake sources.
- Add unit tests for invariants.

### Phase 3: Source-Aware Minting

- Add Normie mint path with `ownerOf` check.
- Add external ERC-721 mint path with `ownerOf` check.
- Add optional ERC-1155 support later.
- Add source uniqueness.
- Add batch minting.

### Phase 4: Flattened Payload Storage

- Add packed 2-bit grid payload format.
- Add payload versioning.
- Add payload hash helper.
- Add tests for packing, unpacking, and validation.

### Phase 5: Attestation Verification

- Add EIP-712 domain and typed-data struct.
- Verify signer authorization.
- Enforce deadline or nonce if needed.
- Avoid permanently storing signatures unless explicitly desired.

### Phase 6: Renderer Assets

- Implement a small asset store.
- Add first minimal HTML renderer.
- Confirm `tokenURI` is self-contained.
- Add base64 encoding and JSON escaping helpers.

### Phase 7: Production Renderer Port

- Distill the JS renderer to one-cube code.
- Decode 2-bit grid payload.
- Build contour lines, walkers, and voxel mesh in browser.
- Read Normie data through adapter calls.
- Store minified chunks onchain.

### Phase 8: World Viewer Integration

- Update offchain viewer to read real contract state.
- Replace mint simulator with contract event/state integration.
- Keep dev-only OpenSea/image parsing for mint preparation and previews.

## Open Decisions

- Exact Hilbert order and total cube supply.
- Whether external source uniqueness is mandatory for all non-Normie NFTs.
- Whether non-Normie v1 stores 2-bit bands only or allows grayscale payloads.
- Attestation signer model: project signer, threshold signers, or owner-controlled signer.
- Randomness provider.
- Renderer governance and owner renderer pinning.
- Whether font data is stored as full font bytes or compact glyph geometry.

## Immediate Next Step

Start with Foundry scaffolding and contract skeletons. The first real contract should be `CubeNFT.sol` with immutable cube identity and uniqueness checks, before adding renderer complexity.
