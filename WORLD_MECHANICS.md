# World Mechanics — functional reference

Authoritative reference for the on-chain world mechanics that sit on top of the
genesis mint. This documents **what is built and how it behaves**; for roadmap,
open decisions, and rationale see [BIG_CUBE_WORLD_PLAN.md](BIG_CUBE_WORLD_PLAN.md).

Contracts:
[`CubeNFT.sol`](contracts/src/CubeNFT.sol),
[`NormieGenesisMinter.sol`](contracts/src/NormieGenesisMinter.sol),
[`lib/CubeEnv.sol`](contracts/src/lib/CubeEnv.sol),
[`CubeRendererV2.sol`](contracts/src/CubeRendererV2.sol),
[`CubeThumbnailRendererV1.sol`](contracts/src/CubeThumbnailRendererV1.sol).

---

## Identity model — permanent vs mutable

| Field | Drives | Permanence |
|---|---|---|
| `seed` | the edge-point fingerprint (`_sidePlan`) — the cube's identity | **permanent**, set once at mint |
| `sourceTokenId` + raw art | the Normie/artwork shown | permanent at mint (re-basable later via customization, not yet built) |
| `slot` (plot) | geometry, colour (unique axis), street, environment | **mutable** via `moveCube` |

A move changes a cube's colour/geometry/street/environment but **never its
`seed`** — the edge-point identity is invariant. This is what makes move and
merge coherent.

## Location derivation

Every `slot` (0 .. `totalSlots`-1, `totalSlots` = 4096) decomposes positionally;
there is no stored location beyond `slot`:

| Level | Derivation | Count |
|---|---|---|
| plot | `slot` | 4096 |
| street | `slot / 8` | 512 |
| neighbourhood | `slot / 64` | 64 |
| region | `slot / 512` | 8 |

Exposed by `CubeRendererV2.streetForSlot` / `neighbourhoodForSlot` /
`regionForSlot` and emitted as metadata traits.

---

## 1. Plot allocation (mint-time)

`NormieGenesisMinter._allocateSlot(wallet)` assigns each cube's slot at mint,
replacing the old `slot = mintedCount`. Rule:

- A **new wallet anchors the lowest street with zero mints** — spreading wallets
  one-per-street across the world.
- **Once every street has ≥ 1 mint, allocation "wraps"** and new wallets backfill
  the **lowest non-full street**.
- In both phases a wallet **packs ≤ 3 plots per street** and **spills forward** to
  the next street, so its holdings stay a **contiguous run** and a full street
  ends up **shared by ~3 wallets**.

Result: early mint is spread wide; later mint densifies; vacancy lands only at
the very start/tail.

**State** (all on `NormieGenesisMinter`):
- `PLOTS_PER_STREET = 8`, `MAX_PER_WALLET_PER_STREET = 3` (constants)
- `seedCursor` — lowest street that may still have zero mints (anchor phase)
- `frontierStreet` — lowest non-full street (wrap target)
- `streetFill(street) → uint8` — plots used per street
- `walletStreetPlusOne(wallet)`, `walletStreetCount(wallet)` — the wallet's
  current street in its run (1-based; 0 = unset) and its count there

**Properties / invariants:**
- ≤ 3 plots per (wallet, street); per-wallet holdings are a contiguous street run
  (within a single transaction — see caveat).
- O(1) amortized: seed/frontier cursors and the per-wallet pointer only move
  forward.
- `_streetCapacity` handles a final partial street if `totalSlots` is not a
  multiple of 8 (production 4096 is exactly 512 full streets).
- **Caveat:** togetherness is **per-transaction**. A wallet that mints again much
  later, after its origin streets have backfilled full, gets its new batch
  wherever the cursor then sits.
- `NoVacantPlot(wallet)` guards the degenerate case where a wallet is capped on
  every remaining street (only reachable above ~1536 plots for one wallet).

Slot assignment is decoupled from `mintedCount` (which still counts total mints
and drives the supply cap / `MintClosed`).

---

## 2. Environment (biome) — street-level, rarity-weighted

`lib/CubeEnv.sol`. One environment per **street** (all 8 plots share it),
deterministic and permanent:

```
id = weightedPick( keccak256(WORLD_SEED, street) % 100 )
WORLD_SEED = keccak256("blockcassone-environments-v1")
```

6 biomes and weights (out of 100): **grass 34, forest 30, water 20, desert 12,
mountain 3, ice 1**. `CubeEnv.idForStreet` / `nameForStreet`. Emitted as the
`Environment` metadata trait. The JS viewer mirrors the same seed + weights in
[`core/cube-env.js`](core/cube-env.js) for 2D/3D parity.

---

## 3. Population trait

On **every** token: `1` for a single cube; **N** (occupied-plot count) for a
merged street. Built in `CubeRendererV2._attributesJSON`.

---

## 4. Merge (8 → 1)

`CubeNFT.mergeStreet(uint32 street) payable` — a wallet that **solely owns every
occupied plot** of a street merges it into one **street token**.

**Fee:** free when you own the whole street (8/8); otherwise `baseFee` per vacant
plot locked up (`quoteMerge` returns it). In a sold-out world nearly every merge
is the free case — the cost of a contested street lives in the displacement fees
paid to assemble it. Underpayment reverts `InsufficientFee`; overpay is refunded.

**Behaviour:**
- Reverts unless the caller owns *every* occupied plot (`NotStreetOwner`), the
  street has ≥ 1 occupied plot (`EmptyStreet`), and it isn't already merged
  (`StreetAlreadyMerged`); out-of-range street → `InvalidSlot`.
- The occupied plot cubes are **burned**, but their `CubeData` and the
  `cubeForNormieId` / `cubeForSourceKey` mappings are **retained** — the street
  still renders and the source Normies stay "used".
- **All 8 slots lock** to the street token (`cubeForSlot[base+k] = streetTokenId`,
  including previously-vacant plots — the street owns its whole footprint).
- **Leader = lowest occupied plot.** The street token's `CubeData` carries the
  leader's slot/seed/Normie, which drives the SVG thumbnail.
- `sourceKind = SOURCE_KIND_MERGED_STREET (3)`. Irreversible in v1, but because
  plot data is preserved an un-merge could be added later.

**Storage / getters:**
- `StreetInfo { uint32 street; uint8 occupiedCount; uint256[8] plotCubeIds; }`
- `streetPlots(streetTokenId) → (street, occupiedCount, plotCubeIds[8])`
  (0 = vacant plot)
- `cubeDataUnchecked(cubeId) → CubeData` — reads a (possibly burned) plot cube's
  data with no ownership check, for the renderer

**Rendering (`CubeRendererV2`):**
- **image**: the leader's cube SVG (`CubeThumbnailRendererV1` treats kind 3 like
  its Normie leader — v1 assumes Normie leaders, true for genesis).
- **animation_url**: emits `window.BLOCKCASSONE_TOKEN = {kind:'street', street,
  population, plots:[…8…]}`, the exact shape the per-street view (`entry.js`,
  `npm run preview:street`) consumes — each plot carries `occupied`, `slot`,
  `sourceTokenId`, `seed`, `raw`, `agentic`; vacant plots carry only `slot`.
- **metadata**: `Merged = Y`, `Population = N`, `Source Kind = "Merged Street"`.

`event StreetMerged(streetTokenId, owner, street, occupiedCount)`.

---

## 5. Move (+ displacement)

`CubeNFT.moveCube(uint256 cubeId, uint32 newSlot) payable` — relocate a cube you
own to a vacant slot, **or** force-swap into an occupied slot in a street you
dominate. Keeps `seed`; colour/geometry/street/environment follow the new slot.

- **Owner-only** (`NotCubeOwner`); cube must exist (`NonexistentCube`);
  merged-street tokens are anchored and can neither move nor be displaced
  (`CannotMoveStreet` / `CannotDisplaceStreet`); target in range (`InvalidSlot`).
- **Vacant target:** plain move, flat `baseFee` to the house.
- **Occupied target = displacement:** allowed only if the mover owns
  `STREET_MOVE_MAJORITY` (5) of the target slot's 8-plot street
  (`NotStreetMajority`). The occupant is force-swapped into the mover's old slot.
  One-directional (only the majority owner can act) so there is no cascade.
  - **Fee** = `baseFee + D × premiumPerPoint`, where `D` = the rarity points the
    victim loses = `biomeWeight[targetStreet] − biomeWeight[oldStreet]` (0 if the
    victim isn't downgraded). The victim is paid directly (push, with a pull
    fallback to `owed[]` + `withdrawOwed()` if the transfer fails). When the mover
    grabs a higher tier (`D > 0`) the house takes `displaceHouseCutBps` (~1/3);
    otherwise the whole fee goes to the victim.
  - **Cooldown:** a victim address can't be displaced twice within
    `displaceCooldown` (15 min) — `DisplaceCooldownActive`.
- **Self-swap** (you own the occupant): free, no fee/compensation/cooldown.
- Underpayment reverts `InsufficientFee`; overpayment is refunded. `quoteMove`
  returns the live fee + split. **Gate:** `movesEnabled` (default `false`) — off
  during the mint, else `MovesDisabled`. See `FEES_AND_DISPLACEMENT_SPEC.md`.

`event CubeMoved(cubeId, fromSlot, toSlot, owner)` (twice on a swap),
`event MoveFeePaid`, `event DisplacementPaid`, `event MovesEnabledUpdated`, plus
**ERC-4906** `MetadataUpdate(cubeId)` for each cube whose slot changed (marketplace
refresh — also emitted by merge and re-base; `supportsInterface(0x49064906)` = true).

---

## 6. Customization (post-mint re-base)

A holder re-bases a cube they own onto a **new flattened artwork**. The cube
keeps its `seed` and `slot` but **adopts the new source** — number label, frame,
and glass detailing all re-derive. Re-basable **any number of times**.

**The source is always a wallet-held on-chain token** — an NFT the holder owns or
a token from an approved CC0 collection — *not* a freeform image upload. The UI
loads it via the connected wallet; the attestation binds `(sourceContract,
sourceTokenId)`, which is what gives the re-based cube its new identity (the label
is the new token's id). "Flatten any PNG/WEBP/JPEG" refers only to the off-chain
flattener accepting whatever format that token's art is in.

**Art format** (`lib/NonNormieArt.sol`): a 40×40 grid, 2 bits/cell (4 tonal
bands) = **400 bytes** (`tonalBands2Bit`), content-hashed. Renderers consume the
1-bit (on/off) **200-byte bitmap** via `NonNormieArt.toBinaryBitmap` (same format
as a Normie raw image).

**Flow** (`CubeMintController.customizeCube`):
1. Off-chain: flatten the artwork → 400-byte payload; the **flattening signer**
   issues an EIP-712 `Attestation { minter, sourceContract, sourceTokenId,
   payloadVersion, payloadHash, nonce, deadline, … }`. The signer is the trusted
   oracle that the source is **owned-by-minter or approved CC0** (CC0 registry:
   `data/cc0-projects.json`).
2. On-chain `customizeCube(cubeId, sourceContract, sourceTokenId, payload,
   attestation, signature)`: requires `cubes.ownerOf(cubeId) == msg.sender`
   (`CubeOwnerMismatch`); checks the attestation matches the source + payload
   hash; `FlatteningAttestation.consumeAttestation` (nonce burn; the controller is
   the `authorizedConsumer`); `artStore.updateTonalBands2Bit` (upsert);
   `cubes.customizeCubeSource` re-bases the cube.

**`CubeNFT.customizeCubeSource(cubeId, sourceContract, sourceTokenId,
payloadVersion)`** — `customizer`-only (set to the controller). Sets
`sourceKind = EXTERNAL_ERC721` + the new source + `payloadVersion`, **preserving
seed and slot**. Merged-street tokens can't be customized
(`CannotCustomizeStreet`). `event CubeCustomized(...)`.

**Store** (`NonNormieArtStore`, owner = controller): `recordTonalBands2Bit`
(record-once, mint path), `updateTonalBands2Bit` (upsert, re-base path),
`payloadForCube`, and `imageBytesForCube` (the 1-bit bitmap, empty if none).

**Rendering** — a recorded payload is the cube's render source. Both renderers
fetch it for non-Normie cubes: `CubeThumbnailRendererV1` (image) and
`CubeRendererV2` (`_rawImageBytes` → `nonNormieStore.imageBytesForCube`, closing
the prior 3D/animation gap where external/customized cubes showed no art). The
label/frame/glass follow the new `sourceTokenId`; colour/geometry stay slot-derived.

**Live preview** — `CubeThumbnailRendererV1.previewThumbnailSVG(seed, slot,
sourceTokenId, tonalPayload)` is a stateless `view` that renders the exact SVG a
re-base would store, with no stored cube. The customize UI calls it (eth_call)
with the target cube's seed + slot, the chosen source's tokenId, and the flattened
400-byte payload, to show a faithful "after" thumbnail before committing. It
shares the same internal `_renderSVG` core as `thumbnailSVG`, so preview and
stored output are byte-identical (covered by a parity test).

**Trust model:** on-chain verifies only the signature + payload hash; ownership /
CC0 eligibility is enforced **off-chain by the flattening signer**. Same model as
the mint-time `mintExternalERC721CubeWithPayload` path.

**Deployment wiring** (post-genesis; genesis deploys pass `nonNormieStore =
address(0)`): deploy `NonNormieArtStore` + `FlatteningAttestation` +
`CubeMintController`; then `cubes.setCustomizer(controller)`,
`artStore.transferOwnership(controller)`,
`attestation.setAuthorizedConsumer(controller)`, and deploy renderers pointing at
the store (`CubeThumbnailRendererV1` 3rd arg, `CubeRendererV2` 5th arg).

---

## Metadata traits (summary)

`CubeRendererV2._attributesJSON`: `plot`, `region`, `neighbourhood`, `street`,
`Environment`, `Population`, `Merged`, `Source Kind`, `Source Contract`,
`Source Token ID`, `Agentic`, `Agent ID`, `Renderer Version`, `Payload Version`.

## `window.BLOCKCASSONE_TOKEN` shapes

- **Cube** (default): `{tokenId, slot, sourceKind, sourceContract, sourceTokenId,
  normieStorage, agentic, agentId, seed, raw}`.
- **Street** (merged): `{kind:'street', tokenId, street, population,
  normieStorage, plots:[ {occupied, slot, sourceTokenId, seed, agentic, agentId,
  raw} | {occupied:false, slot} ]}`. `entry.js` selects street mode strictly on
  the presence of `TOKEN.plots`.

## Errors

`CubeNFT`: `EmptyStreet`, `NotStreetOwner`, `StreetAlreadyMerged`,
`MovesDisabled`, `MergesDisabled`, `CustomizesDisabled`, `NotCubeOwner`,
`CannotMoveStreet`, `CannotDisplaceStreet`, `NotStreetMajority`,
`DisplaceCooldownActive`, `InsufficientFee`, `NothingOwed`, `BadBiomeId`,
`CutTooHigh`, `WithdrawFailed`, `OnlyCustomizer`, `CannotCustomizeStreet`,
`SlotOccupied`, `InvalidSlot`, `NonexistentCube`.
`CubeMintController`: `CubeOwnerMismatch`, `AttestationMinterMismatch`,
`AttestationSourceMismatch`, `AttestationPayloadVersionMismatch`,
`PayloadHashMismatch`.
`NormieGenesisMinter`: `NoVacantPlot`.
