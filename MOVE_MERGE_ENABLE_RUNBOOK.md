# Runbook — Enable Move / Merge (post-mint, ~18 Sep 2026 22:00 UTC)

All actions are owner-only txs on **CubeNFT `0x1794d9119C2ceaDaa78D98e8330AD5395fa0C112`**,
signed from **`0xA2E8f8d26a6C1240b328Fc6F4f2d9bC3921D1f55`** (Rabby) via Etherscan **Write Contract**.
No redeploy, no `multiConfigure`. Each fee setter emits `FeeKnobUpdated`; effective immediately.

Etherscan: https://etherscan.io/address/0x1794d9119C2ceaDaa78D98e8330AD5395fa0C112#writeContract

## Pre-conditions (do NOT enable before these are true)
- [ ] **Mint has ended** — `publicDrop.endTime` = 1789768800 (**18 Sep 2026 22:00 UTC**) has passed. Public mints stop automatically at endTime (SeaDrop enforces it); no tx needed to "close" the mint.
- [ ] **No more mints will run.** After enabling moves, the genesis allocator's slot bookkeeping must not change under a pending mint. So once move/merge is on, do **NOT** call `mintPublicFor` or any mint again (a move/merge could then land on a slot a mint targets → revert/brick). Airdrops are done — leave minting alone from here.
- [ ] Confirm current state: `movesEnabled`/`mergesEnabled` both **false**.

## Step 1 — Set the fees FIRST (before flipping the switches)
So the very first mover pays the new rates.

1. **`setBaseFee`** → `500000000000000`   (0.0005 ETH — sets move-to-empty AND merge-per-empty-plot)
2. **`setPremiumPerPoint`** → `3000000000000000`   (0.003 ETH — displacement surcharge per biome-rarity point; ~a third of the old 0.01)

Leave unchanged: `displaceHouseCutBps` = 3333 (33.33%), `displaceCooldown` = 900 (15 min), all `biomeWeight`s (desert 3, water/grass/forest 1, mountain 8, ice 12).

## Step 2 — Verify the fees landed
Read Contract → confirm:
- `baseFee()` = `500000000000000`
- `premiumPerPoint()` = `3000000000000000`

## Step 3 — Enable the switches
3. **`setMovesEnabled`** → `true`
4. **`setMergesEnabled`** → `true`
(Independent switches; enabling both.)

## Step 4 — Verify enabled + spot-check quotes
- `movesEnabled()` = true, `mergesEnabled()` = true
- `quoteMove(<a cube you own>, <an empty slot>)` → fee `500000000000000` (0.0005), victim 0x0
- `quoteMerge(<a street you fully own>)` → fee = (8 − occupied) × 0.0005
- (Optional) do one real small move + one merge from a test wallet and confirm fees/behaviour before announcing.

---

## Fee schedule IN FORCE after this runbook (for UI + comms)

| Action | Fee | ≈ USD @ $2,500/ETH |
|---|---|---|
| Move a cube to an **empty** slot | **0.0005 ETH** | ~$1.25 |
| **Swap** two cubes you both own | **FREE** | $0 |
| **Merge** a street | **0.0005 × (empty plots)** — full 8/8 street **FREE**; 5/8 = 0.0015 | ~$1.25/empty |
| **Displace** a rival — lateral or into a lower/equal biome (d=0) | **0.0005** (100% paid to the victim) | ~$1.25 |
| Displace into **desert** (d=2 from a weight-1 biome) | 0.0065 | ~$16 |
| Displace into **mountain** (d=7) | 0.0215 | ~$54 |
| Displace into **ice** (d=11) | 0.0335 | ~$84 |

Displacement fee = `0.0005 + pointsGained × 0.003`, pointsGained = `max(0, targetBiomeWeight − yourOldBiomeWeight)`.
On an **upgrade** the house takes 33.33% and the **displaced victim gets ~66.67%**; on a lateral/downgrade the victim gets **100%**. It's mostly redistribution to the person bumped, not a burn.

## Rules & conditions a user faces (reference)
**Move** (needs `movesEnabled`): must own the cube; can't move a merged-street token; target slot 0–4095 and different. Empty target → `baseFee`. Your own cube in the target → free swap. Rival in the target → **displacement**: need **≥5 of 8 plots** in the target street, a **15-min per-victim cooldown**, can't displace a street token; fee & split as above. Overpay is refunded.

**Merge** (needs `mergesEnabled`): must **solely own every occupied plot** in the street, **≥5 filled**, none already merged. Fee = (8 − occupied) × baseFee (full street free). Burns the plots, mints **one anchored street token** (can't be moved/displaced/re-merged), locks all 8 slots. Leader = lowest occupied plot or one you nominate.

**Non-tunable** (would need a redeploy): `MERGE_MIN_FILLED = 5`, `STREET_MOVE_MAJORITY = 5`.

## Rollback / safety
- Fees are re-tunable anytime via the same setters (no redeploy).
- To pause the game: `setMovesEnabled(false)` / `setMergesEnabled(false)`.
- See [[FEES_AND_DISPLACEMENT_SPEC.md]] and [[WORLD_MECHANICS.md]] for the full mechanic.
