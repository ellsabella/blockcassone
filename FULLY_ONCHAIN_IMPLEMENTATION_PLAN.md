# Blockcassone Fully Onchain Implementation Plan

## Objective

Blockcassone will mint one ERC-721 cube per accepted source NFT. After mint, each cube must be fully onchain in the strict sense: the token metadata, HTML renderer, renderer assets, cube identity, source identity, placement, seed, and all art inputs needed to reconstruct the cube must be recoverable from Solidity contracts.

The mint UI and the big-cube exploration website may be offchain. They can use indexers, OpenSea, image proxies, browser canvas extraction, and richer hosted tools. The individual minted cube must not require any of those systems after mint.

Current product requirements for the project home, Big Cube world, movement, consolidation, agentic visuals, and neighbourhood environments live in `WORLD_AND_MINT_REQUIREMENTS.md`.

The production copyright-safe mint model lives in
`PRODUCTION_MINT_AND_CC0_PLAN.md`. Genesis minting is now Normie-only, with
CC0/owned-art ingestion deferred to a post-mint update flow.

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
- Post-mint update payload, if the cube has been updated away from its genesis
  Normie source.
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

For production public/general genesis mints, the contract should assign any
remaining unclaimed Normie source from the committed snapshot pool. No paid
genesis mint should produce a placeholder or non-Normie-derived cube.

The older arbitrary external NFT flattening path is retained as a dev/prototype
or future update path unless it is explicitly reapproved for production.

If arbitrary external ingestion is used in dev or a future reviewed mode, the UI
should:

- Discover wallet NFTs.
- Fetch and rasterize the source art offchain.
- Flatten the art into a canonical compact grid.
- Request or produce an attestation for the flattened payload.
- Submit source identity, flattened payload, and attestation to the mint contract.

The contract must validate source uniqueness and consume snapshot Normie IDs at
mint time. It cannot generally enumerate every NFT in a wallet, so the snapshot
artifact and proof system carry the allowlist ownership facts. Hard invariants
remain onchain.

Important boundary:

- Solidity cannot enumerate a wallet's NFTs.
- OpenSea agent data cannot be treated as available after mint unless captured
  and committed during mint.
- Ethereum contracts cannot directly verify ownership of source NFTs on L2
  chains such as Base or Shape without a bridge/proof/oracle/attestation model.
- Therefore, cross-chain and OpenSea-derived source facts must enter the mint as
  signed, versioned payload data if they affect permanent token art or traits.

## Core Onchain Invariants

These invariants must be enforced by Solidity:

- One Normie token ID can mint at most one cube.
- One update source key can be used according to the future update policy.
- One Hilbert slot can contain at most one cube.
- Allowlist minters may only consume their own snapshot Normie IDs.
- Public minters may only consume unclaimed snapshot Normie IDs after the public
  phase opens.
- Cube identity is immutable after mint.
- If a cube is updated after mint, the update payload is stored or recoverable
  onchain.

## Contract Layout

Contracts live under `contracts/src/`.

Recommended modules:

- `CubeNFT.sol`: ERC-721 token and canonical cube storage.
- `MintController.sol`: source-aware minting and payment logic, or merged into `CubeNFT` for v1.
- `CubeWorld.sol` or `WorldState.sol`: mutable plot occupancy, movement, environment, population, and consolidation state.
- `Placement.sol`: Hilbert slot assignment and occupancy helpers, if not folded into `CubeWorld`.
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
    uint32 slot; // early v1 stores this directly; final world state may move it to CubeWorld
    uint8 sourceKind;
    uint8 rendererVersion;
    uint8 payloadVersion;
    bool agentic;
    uint256 agentId;
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

The production renderer target is raw WebGL, not Three.js. This preserves long-term compatibility and lets the final onchain token port the visual language from the existing dev renderer with fewer third-party assumptions. Visual iteration should happen first in a standalone, self-contained browser prototype that accepts the same compact token data Solidity will emit. Once the constrained prototype feels correct, its HTML, JavaScript, shaders, and lookup tables can be minified and moved into renderer asset contracts.

Metadata should use `image` as the canonical static thumbnail field. `image_url` may be duplicated only as a compatibility alias. `animation_url` should contain the interactive self-contained HTML/WebGL cube viewer. The static image should be a deterministic default-view thumbnail of the cube, while `animation_url` should support orbit, zoom, and reset controls.

Current renderer prototypes:

- `viewer/onchain-token-prototype.html`: older standalone experiment for a
  future compact non-Normie / tonal payload.
- `viewer/onchain-normie-token-prototype.html`: genesis-focused standalone
  renderer prototype for the real Normie path. It accepts a 200-byte packed
  40x40 Normie bitmap, decodes it in browser JavaScript, and renders a raw
  WebGL cube without depending on `api.normies.art` unless explicitly launched
  with `?api` for dev comparison.

## Placement And Randomness

Initial slot assignment should be onchain and collision-free. The final project direction also expects post-mint movement, so placement should be treated as mutable world state rather than only immutable mint data.

Options:

- Chainlink VRF or equivalent for high-trust randomness.
- Commit-reveal for a simpler self-contained flow.
- Deterministic assignment from source identity and mint index for early testnets only.

Avoid relying only on block variables if slot placement has meaningful market value.

Future placement policy may include:

- maximum agentic cubes per neighbourhood.
- maximum agentic cubes per region.
- environment-specific placement rules.
- owner-initiated movement to vacant plots.
- neighbourhood consolidation eligibility.

## Big Cube Website

The big-cube viewer remains offchain and should evolve into the project home and canonical mint source. It may:

- Query contract events and state.
- Use an indexer.
- Use richer assets and UI.
- Explore all minted cubes and empty Hilbert slots.
- Offer filters, wallet views, and high-performance rendering.
- Prototype neighbourhood environments and population rules.
- Let users preview movement to vacant slots.
- Let users inspect consolidation eligibility.

The website is not part of the individual token's fully onchain guarantee.

The Big Cube website may eventually be distributed from contract-stored chunks,
IPFS, Arweave, ENS, or a conventional host, but those delivery mechanisms are
not the same as the fully-onchain token renderer. The individual cube renderer
is served by `tokenURI`/`animation_url`. The Big Cube app is a project-home
interface that reads contract state.

An indexer is not strictly required for correctness, but is likely required for
the intended UX. The UI should treat the indexer as a cache over contract state
and events, especially for:

- focused wallet inventories
- owner highlighting across all 4096 plots
- population and agent counters
- movement history
- consolidation eligibility
- cross-chain source summaries

If the indexer is unavailable, the app should still be able to fall back to
contract reads for the active region/neighbourhood and selected token.

The final world supply is a 5th-order Hilbert cube:

```text
8^(5 - 1) = 4096 cube slots
```

Each token should expose placement traits derived from its slot. Indices are 0-based because the Hilbert path and contract storage are 0-based:

- `plot`: the exact cube slot in the 5th-order path, `0..4095`.
- `neighbourhood`: the local 3rd-order Hilbert block containing the cube, `0..63`.
- `region`: the local 4th-order Hilbert block containing the cube, `0..7`.
- `street`: the 8-cube Hilbert subset containing the cube, `0..511`.

For an order-5 world, the block math is:

```text
region(order 4)        = floor(slot / 512)
neighbourhood(order 3) = floor(slot / 64)
street(order 2)        = floor(slot / 8)
```

These traits should be emitted in token metadata and used by the offchain big-cube viewer for filtering, navigation, local context, and possible neighbourhood/region-level visual systems. In the final movement-enabled architecture, `plot`, `neighbourhood`, and `region` may be read from `CubeWorld` rather than immutable `CubeNFT` storage.

Neighbourhoods should also have a natural environment type before they are occupied or transformed. Candidate environment types include desert, water, grass, forest, stone, ice, and void. The environment should first be prototyped in the dev viewer, then stored onchain as compact world metadata once the set feels right.

Population traits under consideration:

- `Neighbourhood Population`.
- `Region Population`.
- `Neighbourhood Agents`.
- `Region Agents`.

These traits are dynamic and may change when cubes mint, move, or consolidate.

The conceptual model is a city-like big block inhabited by the NFT entities that compose it. Source NFTs are not only visual inputs; they may represent agents, characters, tools, identities, or other entity-like contracts. At mint time, the offchain mint pipeline should capture any source-agent binding data exposed by OpenSea or source contracts and commit the observed fields onchain as a mint-time snapshot. Because Normies can become agentic after Blockcassone mint, current agent binding must also be updatable through onchain state.

Agentic metadata requirements:

- `Agentic`: binary `Y` / `N` trait.
- `Agent ID`: stable agent binding identifier when available.
- Agent data must be captured at mint time and stored or attested onchain if it affects token traits or art.
- Current agent status should be read from an onchain agent-status registry when available, with mint-time snapshot values used as fallback.
- Agentic status may affect the token renderer visually, especially in the city/big-block viewer.
- Agentic non-Normies may inherit awakened Normie-style visual behavior: moving lights, higher motion, forest strands, and particles.

OpenSea API data may be used by the mint UI to discover agentic details, but the token must not depend on OpenSea after mint. Any OpenSea-derived agent fields used by the final NFT must be included in the signed mint payload and stored onchain, written to an onchain current-status registry, or be independently recoverable from source contracts.

The current contract boundary stores the mint-time `agentic` boolean and numeric `agentId` in `CubeNFT.CubeData`, binds both fields into the non-Normie flattening attestation, and renders them as `Agentic` and `Agent ID` metadata traits. Production should add an `AgentStatusRegistry` so token metadata and the HTML renderer can prefer current onchain source-agent state over the mint-time snapshot.

Initial OpenSea API probing shows that the account NFT list response does not currently include agent data, while the single-NFT detail response includes an `agent_binding` field. A positive Normies sample returned `agent_binding.agent_id` as a numeric string, with matching `agent.token_id`, so the current onchain representation uses `uint256 agentId` and `0` as the non-agent sentinel. The mint UI should fetch per-token details for the selected source NFT before minting, preserve the raw `agent_binding` payload for inspection, and derive permanent `Agentic` / `Agent ID` values from that detail response.

If future non-Normies use a non-numeric binding ID, add a second versioned source-agent record rather than overloading `agentId`.

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
- Keep a standalone raw WebGL prototype in the viewer while visual fidelity is still evolving.

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

### Phase 9: Dev World Model

- Prototype neighbourhood environment shaders in the dev viewer.
- Add placement-policy simulation for agentic caps by neighbourhood and region.
- Add population counters and UI labels.
- Add movement preview to vacant plots.
- Add consolidation preview for full-neighbourhood ownership.

### Phase 10: World-State Contracts

- Add `CubeWorld` or equivalent mutable world-state contract.
- Move plot occupancy and population counters into world state.
- Add owner movement to vacant plots.
- Add environment metadata.
- Add placement-policy checks.
- Add consolidation eligibility and burn/merge mechanics.

## Open Decisions

- Whether external source uniqueness is mandatory for all non-Normie NFTs.
- Whether non-Normie v1 stores 2-bit bands only or allows grayscale payloads.
- Whether to also store agent contract, binding contract, and registering wallet from OpenSea `agent_binding`.
- Final neighbourhood environment taxonomy.
- Exact placement-policy caps for agentic cubes by neighbourhood and region.
- Whether movement has a fee, cooldown, or governance constraints.
- Whether consolidation keeps one survivor token or mints a new super-rare token.
- Attestation signer model: project signer, threshold signers, or owner-controlled signer.
- Randomness provider.
- Renderer governance and owner renderer pinning.
- Whether font data is stored as full font bytes or compact glyph geometry.

## Immediate Next Step

Start with Foundry scaffolding and contract skeletons. The first real contract should be `CubeNFT.sol` with immutable cube identity and uniqueness checks, before adding renderer complexity.
