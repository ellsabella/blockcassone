# Production Mint And Update Plan

## Objective

Blockcassone's genesis mint should be simple, scarce, and copyright-clean:

- genesis supply is capped at `4096` cubes
- every paid genesis cube is backed by a real Normie source
- no arbitrary third-party NFT media is ingested at mint
- no placeholder/environment-only cube is sold in the genesis mint
- CC0 and owner-supplied art updates are deferred to a post-mint website flow

This keeps the primary mint compatible with OpenSea/SeaDrop-style quantity
minting while preserving the fully-onchain requirement for each token after
mint.

## Genesis Scarcity Model

The Normies contract currently has more live Normies than the Big Cube has
plots. That mismatch becomes part of the launch mechanic.

```text
snapshot Normie pool: all live Normies at the declared snapshot block
genesis cube supply: 4096
eligibility: Normie holders first, then public access to remaining Normie sources
scarcity rule: move fast or miss out
```

Only `4096` Normie sources can become genesis cubes. Normies that remain
unclaimed after the supply cap is reached do not receive genesis cubes.

## Normie Snapshot Allowlist

Normie owners should receive first access to the exact Normies they held at the
snapshot block. Each snapshot Normie creates one allowlist mint slot for that
wallet, subject to the global `4096` supply cap.

Required snapshot artifacts:

- snapshot block number
- Normies contract address
- wallet address
- ordered Normie token IDs held at snapshot time
- per-wallet allowance/count
- Merkle proof data or equivalent commitment

Current dev snapshot artifact:

```text
data/normie-snapshot.json
```

Current dev Merkle artifact:

```text
data/normie-merkle.json
```

Current snapshot command:

```bash
ETH_RPC_URL=<mainnet-rpc> npm run snapshot:normies
```

Current Merkle build command:

```bash
npm run snapshot:merkle
```

Optional environment variables:

- `SNAPSHOT_BLOCK`: use a fixed block instead of latest.
- `NORMIE_TOKEN_START`: first token ID, default `0`.
- `NORMIE_TOKEN_END`: last token ID, default `9999`.
- `SNAPSHOT_CONCURRENCY`: concurrent JSON-RPC calls, default `8`.
- `SNAPSHOT_RETRIES`: retry attempts for transient RPC failures, default `4`.

The snapshot output is deterministic: holders are sorted by wallet and token IDs
are sorted ascending. The script also reads `totalSupply` and fails if the
number of discovered owners does not match that supply.

The Merkle artifact uses:

```text
leaf = keccak256(abi.encode(wallet, keccak256(abi.encode(normieIds))))
tree = sorted-pairs
```

This matches the Solidity verification path in `NormieGenesisMinter`.

## Mint Phases

### Allowlist Phase

Allowlist means "mint your Normies only."

To keep "pick your own Normies" compatible with SeaDrop, selection happens
before the SeaDrop mint:

1. The website loads the wallet's snapshot Normie list.
2. The user chooses which of those Normies they want to mint.
3. The user submits a preselection transaction with:

```solidity
selectAllowlistNormies(snapshotNormies, selectedNormies, proof)
```

The contract verifies that `snapshotNormies` is committed by the Merkle snapshot
root and that every `selectedNormie` belongs to that proven list.

Then, for each SeaDrop quantity mint:

1. SeaDrop calls `mintSeaDrop(minter, quantity)`.
2. The contract consumes the next unclaimed Normie IDs from the minter's stored
   selection.
3. Each Normie token ID is marked claimed.
4. A cube is minted with `Source Type = Normie`.
5. The mint stops if the wallet has no sufficient selected snapshot Normies or the global
   `4096` supply cap is reached.

The holder does not pass arbitrary art data during the SeaDrop mint. Exact
source assignment is derived from committed snapshot state, the user's stored
selection, and contract consumption state.

### Public Phase

Public means "mint any unclaimed Normie that is left."

For each quantity mint:

1. The contract assigns an unclaimed Normie token ID from the global snapshot
   pool using a deterministic-random pull.
2. The Normie token ID is marked claimed.
3. A cube is minted with `Source Type = Normie`.
4. The mint stops at the global `4096` supply cap.

No paid public mint produces an empty placeholder cube.

The public pull should not simply take the lowest or next available Normie ID.
Use a committed project seed and swap-and-pop style unclaimed pool so the
assignment is deterministic, reproducible, and not visually biased toward early
token IDs. The public minter should not supply arbitrary salt; otherwise users
could grind source selection. This is not a substitute for high-security
randomness if the exact source order becomes economically sensitive, but it is
better than cursor order and fits the current "move fast or miss out" scarcity
model.

## SeaDrop Compatibility

SeaDrop can handle the primary mint rails:

- payment
- phases
- quantity mints
- allowlist or signed-mint validation
- per-wallet mint limits

SeaDrop does not natively track which exact Normie token IDs are consumed. The
NFT contract must own that logic.

The production-shaped entrypoint should look like:

```solidity
mintSeaDrop(address minter, uint256 quantity)
```

Only the configured SeaDrop contract should be allowed to call it. The genesis
minter should expose owner-controlled phase state:

```text
Closed
Allowlist
Public
```

If SeaDrop calls the token contract with only `minter` and `quantity`, source
assignment must be derivable from committed onchain state:

- wallet snapshot commitment
- allowlist preselection queue
- per-wallet claim cursor/count
- global Normie source pool
- claimed Normie bitmap or equivalent tracking
- deterministic-random public source selection from the unclaimed pool
- global cube supply cap

This keeps the mint compatible with SeaDrop while preserving exact Normie
matching.

## Contract Changes Needed

Add or adapt modules:

- `NormieSnapshotRegistry`: snapshot commitment, per-wallet allowance, ordered
  Normie lists or proof-verified list chunks, and consumption tracking.
- `SourceAssignment`: allowlist and public Normie source assignment.
- `CubeWorld`: plot assignment, occupancy, population counters, movement, and
  later consolidation.
- `CubeNFT`: ERC-721 identity, source facts, SeaDrop-compatible mint hook, and
  metadata entry point.
- `CubeRenderer`: HTML/WebGL token renderer.
- `RendererAssetStore`: shared HTML, JavaScript, shader, and lookup chunks.
- `NormieAdapter`: direct reads from Normie onchain data/font/rendering sources.

Production genesis source kinds should be:

```text
1 = NormieSnapshot
2 = ReservedForPostMintUpdate
```

The current arbitrary external ERC-721 flattening-attestation path should be
treated as a dev/prototype or future update path unless explicitly reintroduced
after legal review.

## Metadata Direction

Genesis Normie cube traits:

- `Source Type`: `Normie`
- `Source Contract`
- `Source Token ID`
- `Agentic`
- `Agent ID`
- `plot`
- `street`
- `neighbourhood`
- `region`
- `Environment`

`Environment` remains useful world context even though the cube source is a
Normie. It describes where the cube lives in the Big Cube, not a placeholder art
source.

## Onchain Renderer Direction

The individual token should use self-contained HTML for `animation_url`.

SVG is useful for thumbnails and simple marketplace fallbacks, but it is not
the right primary renderer for the visual fidelity we are targeting. The cube
needs motion, orbit/zoom, raw WebGL, lights, particles, and spatial depth.

Recommended metadata:

- `image`: deterministic static thumbnail or compact SVG fallback.
- `animation_url`: base64 `data:text/html` document containing the interactive
  raw-WebGL cube.

The HTML must be assembled from onchain chunks and token-specific facts. The
token must not depend on the hosted Big Cube website after mint.

## Dev Viewer Direction

The project home / dev viewer should ultimately have two major tabs.

### Current Block

Reads the current minted block and lets users explore it.

Expected capabilities:

- navigate region, neighbourhood, street, and cube views
- show the whole block as currently minted
- focus on all cubes belonging to a wallet
- inspect individual cubes in the 3D detail panel
- use an indexer for fast wallet lists and Big Cube exploration
- fall back to contract reads for correctness checks and small views

The indexer is a read cache only. Contract state remains the source of truth.

### Update Cube

Post-mint update flow for owners who want to change a cube's art after acquiring
or owning a cube.

Expected flow:

1. Load wallet.
2. Validate cube ownership.
3. Load wallet assets.
4. Filter assets to allowed update sources:
   - owned source assets
   - approved CC0 projects
5. Present an asset picker.
6. Flatten or derive the update payload.
7. Submit the update payload/proof to the update contract.
8. Store the updated payload onchain so the token remains fully onchain.

This update flow is not a genesis mint dependency.

## CC0 / Owned-Art Update Registry

The approved CC0 project list lives at:

```text
data/cc0-projects.json
```

The registry is retained for the future update flow, not for genesis mint
assignment.

Expected project entries:

```json
{
  "name": "Project Name",
  "chainId": 1,
  "contract": "0x...",
  "tokenCount": 10000,
  "license": "CC0-1.0",
  "provenance": "URL or note for internal review"
}
```

Before production updates are enabled, every entry should be reviewed for
copyright, trademark, publicity, and project-specific license concerns. CC0
status should be treated as an approved-list decision, not as a blind claim
taken from marketplace metadata.

## Immediate Next Steps

1. Update the dev mint simulator so genesis mints are Normie-only.
2. Keep environment traits and visuals, but do not mint placeholder cubes.
3. Design `NormieSnapshotRegistry` and source-consumption storage.
4. Design the SeaDrop-compatible mint hook around `minter` and `quantity`.
5. Build the HTML/WebGL `animation_url` renderer path.
6. Keep CC0/owned-art update planning separate from genesis mint readiness.
