# Fees, Displacement & Merge Economics — Spec v1

Status: **BUILT** in `CubeNFT.sol` (tests: `test/CubeFees.t.sol`, full suite 191 green). The
payment layer for move / displace / merge. Fully on-chain, no oracle. All prices are
owner-tunable knobs; defaults ship in the `CubeNFT` constructor.

---

## 0. Intent

- Moving to an **empty** slot is a cheap, flat fee to the **house**.
- **Merging** a street you fully own is **free** (we want people to merge). Merging a street
  that still has vacant plots pays a flat fee per vacant slot locked, to the house.
- **Displacing** someone (the 5/8 street-majority force-swap) pays **the displaced person**,
  scaled by how badly their cube is downgraded in biome rarity. When the mover is grabbing a
  *higher-tier* slot (i.e. downgrading the victim), the house also takes a cut.
- Nobody can be displaced twice inside a **cooldown** window (anti-harassment).

## 1. Rarity basis — already on-chain, no oracle

Biome is a **street** property (all 8 plots share it), deterministic + permanent, from
`CubeEnv.idForStreet(street)` where `street = slot / 8`. Biome ids: `0 desert · 1 water ·
2 grass · 3 forest · 4 mountain · 5 ice`. Intrinsic world frequency: grass 34 · forest 30 ·
water 20 · desert 12 · mountain 3 · ice 1 (%).

Pricing uses a **separate, owner-settable `biomeWeight[6]`** (rarity *points* for fees), so
you can tune fee-rarity without touching the biome distribution. It is un-gameable: rarity
is a pure function of the slot, so no listing/wash-trade can move it. (This is why we do NOT
peg to OpenSea trait floors — thin traits like ice ≈ 40 cubes are trivially manipulable, and
an off-chain oracle breaks the fully-on-chain guarantee.)

## 2. The three priced actions

| Action | Payer → payee | Amount |
|---|---|---|
| Move → empty slot | mover → **house** | `baseFee` (flat) |
| Merge, fully-owned street (0 empties) | — | **free** |
| Merge locking vacant plots | merger → **house** | `emptyPlotsLocked × baseFee` |
| Move → displace (5/8 majority) | mover → **displaced person** (+ house cut on upgrades) | see §3 |

## 3. Displacement fee

The mover moves their cube from `slotOld` into the victim's `slotTarget`; the victim is
force-swapped into `slotOld`. Let:

```
wTarget = biomeWeight[ idForStreet(slotTarget / 8) ]   // rarity the victim is losing
wOld    = biomeWeight[ idForStreet(slotOld   / 8) ]     // rarity the victim is gaining
D       = max(0, wTarget - wOld)                        // victim's downgrade, in points
fee     = baseFee + D * premiumPerPoint
```

**Split:**
- If `D > 0` (mover moving *up* a tier ⇒ victim downgraded):
  `houseShare = fee * displaceHouseCutBps / 10000`, `victimShare = fee - houseShare`.
- If `D == 0` (lateral or victim upgraded): `houseShare = 0`, `victimShare = fee` (= baseFee).

**Cooldown:** revert if `block.timestamp < lastDisplacedAt[victimOwner] + displaceCooldown`.
On success set `lastDisplacedAt[victimOwner] = block.timestamp`. Cooldown is per **victim
address** — protects the person, does not block assembling a street from *different* owners.

Merged-street tokens still cannot be displaced (existing `CannotDisplaceStreet`), and the
existing 5/8 majority requirement (`NotStreetMajority`) is unchanged.

## 4. Owner-settable knobs (defaults)

| Knob | Type | Default | Meaning |
|---|---|---|---|
| `baseFee` | wei | **0.001 ETH** | flat move-to-empty, per-empty merge, and the base term of displacement |
| `premiumPerPoint` | wei | **0.01 ETH** | added per downgrade-point in a displacement |
| `biomeWeight[6]` | uint | **grass 1 · forest 1 · water 1 · desert 3 · mountain 8 · ice 12** | fee-rarity points per biome |
| `displaceHouseCutBps` | uint16 | **3333** (≈1/3) | house cut of a displacement fee, only when `D > 0` |
| `displaceCooldown` | uint | **900** (15 min) | min seconds between displacements of the same address |

Existing switches unchanged: `movesEnabled`, `mergesEnabled`, `customizesEnabled`.

## 5. Accounting & payout

- `houseBalance` (uint) — accrues all house fees. `withdrawHouse(to)` (onlyOwner) sends it.
- Victim compensation is **push with pull-fallback**: the move tx *tries* to send the victim
  their share directly (instant, good UX) with a capped gas stipend; if that transfer fails
  (e.g. a contract wallet that reverts on receive), the amount is credited to `owed[victim]`
  and they pull it via `withdrawOwed()`. Either way the displacement still succeeds, so a
  recipient can't make itself undisplaceable by refusing payment.
- Self-displacement (mover already owns the occupant) is a **free** swap — no fee, no
  compensation, no cooldown.
- Contract balance invariant: `address(this).balance >= houseBalance + Σ owed`.
- Overpayment: payable paths require `msg.value >= fee` and refund the excess to `msg.sender`
  last, under a reentrancy guard.

## 6. Function surface

```solidity
// --- payable actions (nonReentrant) ---
function moveCube(uint256 cubeId, uint32 newSlot) external payable;      // vacant OR displace
function mergeStreet(uint32 street) external payable;                    // + leader overload
function mergeStreet(uint32 street, uint256 leaderCubeId) external payable;

// --- quotes (frontend calls before sending value) ---
function quoteMove(uint256 cubeId, uint32 newSlot)
    external view returns (uint256 fee, address victim, uint256 victimShare, uint256 houseShare);
function quoteMerge(uint32 street) external view returns (uint256 fee, uint256 emptyPlots);

// --- admin knobs (onlyOwner) ---
function setBaseFee(uint256) external;
function setPremiumPerPoint(uint256) external;
function setBiomeWeight(uint8 biomeId, uint256 weight) external;   // 0..5
function setDisplaceHouseCutBps(uint16) external;                  // <= 10000
function setDisplaceCooldown(uint256) external;

// --- treasury ---
function withdrawHouse(address to) external;   // onlyOwner, sends houseBalance
function withdrawOwed() external;              // victim pulls owed[msg.sender]

// --- views ---
function houseBalance() external view returns (uint256);
function owed(address) external view returns (uint256);
function lastDisplacedAt(address) external view returns (uint256);
```

## 7. Events & errors

```
event MoveFeePaid(uint256 indexed cubeId, uint256 fee);
event DisplacementPaid(uint256 indexed cubeId, address indexed victim, uint256 victimShare, uint256 houseShare);
event MergeFeePaid(uint32 indexed street, uint256 emptyPlots, uint256 fee);
event HouseWithdrawn(address indexed to, uint256 amount);
event OwedWithdrawn(address indexed to, uint256 amount);
event FeeKnobUpdated(bytes32 indexed knob, uint256 value);   // generic for the 5 setters

error InsufficientFee(uint256 required, uint256 sent);
error DisplaceCooldownActive(address victim, uint256 readyAt);
error NothingOwed();
error BadBiomeId(uint8 biomeId);
error CutTooHigh(uint16 bps);
```

## 8. Worked examples (at the defaults above)

- **Grass move to a vacant grass slot:** `0.001 ETH` → house.
- **Merge a fully-owned street (8/8):** `0` — free.
- **Merge a street with 3 vacant plots:** `3 × 0.001 = 0.003 ETH` → house.
- **Displace lateral (grass → grass), victim same tier:** `D=0`, fee `0.001 ETH`, all to victim.
- **Displace grabbing mountain from a grass base (grass→mountain):** `wTarget 8 − wOld 1 = 7`,
  fee `0.001 + 7×0.01 = 0.071 ETH`. Victim `≈0.0473`, house `≈0.0237`.
- **Displace grabbing ICE from a grass base (grass→ice, low→top):** `D = 12 − 1 = 11`,
  fee `0.001 + 11×0.01 = 0.111 ETH`. Victim `≈0.074`, house `≈0.037`. ← the "painful" case.
- **Mover gives up ice to displace into a grass slot (ice→grass, victim upgraded):** `D=0`,
  fee `0.001 ETH`, all to the (now upgraded) victim.

To make the top-tier land-grab harsher, raise `premiumPerPoint` (e.g. 0.02 → grass→ice
`0.221 ETH`) or the `ice`/`mountain` weights.

## 9. Edge cases & security

- **Self-displacement** (mover already owns the occupant): treat as a plain swap — no
  compensation, no cooldown, charge `baseFee` to house. (You're just reshuffling your own cubes.)
- **Reentrancy:** payable paths are `nonReentrant`; effects (slot mutation, `houseBalance`,
  `owed`, `lastDisplacedAt`) happen before any external call; the only external call is the
  excess refund, done last.
- **Griefing:** victim comp is pull-payment (§5); cooldown caps harassment; one-directional
  majority rule (only 5/8 owner can displace) prevents ping-pong wars.
- **Knob race:** fee can change between `quoteMove` and the tx; we require `>=` not `==` and
  refund excess, so a small owner change mid-flight doesn't brick user txs.
- **Same person, two plots you need:** you can only displace them once per cooldown → you wait
  out the window for the second. Consistent with "don't harass the same person."
- **Compensation is a game fee, not a market make-whole** — calibrate `premiumPerPoint` /
  weights to roughly track the rare-vs-common ratio you observe; it will not literally equal a
  secondary floor delta.

## 10. Contract changes + test plan — DONE

`CubeNFT.sol`: imports `CubeEnv` + OZ `ReentrancyGuard`; adds the 5 knobs + `houseBalance` +
`owed` + `lastDisplacedAt`; `moveCube` and both `mergeStreet` overloads are `payable` +
`nonReentrant`; displacement fee/split/cooldown live in the `_displace` / `_displaceFee`
helpers (split out to keep the stack shallow); `quoteMove` / `quoteMerge`; the admin setters,
`withdrawHouse`, `withdrawOwed`; events/errors. Compensation is push-with-pull-fallback
(`_payout`, 30k-gas stipend → `owed`). Cooldown skips never-displaced victims
(`lastDisplacedAt == 0`).

Tests (`test/CubeFees.t.sol`, 14): move-to-empty charges baseFee; underpay reverts; overpay
refunds; merge 8/8 free; merge-with-empties per plot; displacement downgrade split + direct
victim payout; same-tier no-house-cut; push→owed fallback + `withdrawOwed`; self-swap free;
cooldown blocks + clears; `withdrawHouse` onlyOwner; knob setters onlyOwner + bounds. Legacy
move/merge suites set the fees to 0 so they stay behaviour-focused. Full suite 191 green.
```
