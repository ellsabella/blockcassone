# TheBLOCK Genesis — Drop Phases

How the genesis mint works, phase by phase. This is the canonical spec for the
drop mechanics: the landing-page copy, the SeaDrop stage config, and the launch
ops (LAUNCH_RUNBOOK.md) must all agree with this document.

**The drop at a glance:** 4,096 cubes, each backed by a real source artwork from
one of six collections (Normie 1679 / Chain Runners 901 / 1337 Skulls 655 /
Baby Pepes 410 / Nouns 328 / OnChainKevin 123). Price **0.0069 ETH**, same in
every phase. Minting runs through OpenSea's SeaDrop 1.0 protocol; per-wallet
limits and phase windows are enforced by SeaDrop, and art assignment is enforced
by our minter contract on-chain.

---

## The four phases

| # | Phase | Who can mint | Art | Per-wallet cap |
|---|-------|--------------|-----|----------------|
| 1 | **GTD — chosen art** | Allowlist winners who own qualifying art and picked specific pieces | **Exactly the artworks they chose** | = their reservation count (≤ 5) |
| 2 | **Guaranteed slot — random art** | Site registrants without qualifying art, manually added wallets, **and every GTD winner** | Random draw | Per-wallet (default 1; GTD winners flat **5 total**) |
| 3 | **FCFS — community** | Holders of partner collections, snapshotted the day before mint | Random draw | 8 (cumulative) |
| 4 | **Public** | Anyone | Random draw | 8 (cumulative) |

Phases run back-to-back as SeaDrop stage windows. Phases 1–3 are gated by ONE
merkle tree (SeaDrop stores a single root per token — the root is set once,
before the drop opens, and never swapped mid-mint). Phase 4 is the open
`PublicDrop` config.

---

## Phase 1 — GTD (guaranteed, chosen art)

**Before the drop:**
1. Holder visits the allowlist site, connects (delegate.xyz vaults supported),
   sees their qualifying artworks, and **picks the specific pieces** they want
   turned into cubes (entitlement is weighted by collection; capped at 5/wallet).
2. They sign an EIP-712 ownership attestation; the backend re-verifies live
   ownership before approval (`allowlist/reserve.mjs`).
3. Approved picks are baked on-chain as **reservations**
   (`reserveSources(wallet, collectionIds, sourceIds)`). Each reserved artwork is
   **removed from the random pool** at that moment — nothing anyone else does can
   draw it.

**During the window:** the winner mints on the drop page (or directly against
SeaDrop). The mint hook serves their reservations **first, in order** — they
receive exactly the artworks they chose. The on-chain **GTD window**
(`gtdEndTime`) hard-blocks every random draw until it passes, so no
mis-configuration can leak pool art into this phase; the window closes itself by
timestamp with no admin action.

**Guarantee:** enforced by contract, not by convention. Reserved art is out of
the pool + assigned reservation-first + random draws revert during the window.

## The strict-release rule (what happens if a GTD winner doesn't mint)

**Chosen art does NOT survive the window.** At `gtdEndTime`:

- Unminted reservations are released back into the random pool (permissionless
  keeper — this is not discretionary and cannot be delayed for individuals).
- The winner's **spots survive as random-art slots**: every GTD winner also
  holds a Phase-2 leaf with a flat allowance of **5 total** (cumulative with
  their GTD mints):

| GTD winner behavior | Phase 1 | Phase 2 |
|---|---|---|
| Minted all 5 picks | 5 chosen | 0 (allowance fully used — on better terms) |
| Minted 3 of 5 picks | 3 chosen | 2 random top-up |
| Didn't mint | nothing (picks released) | 5 random |

Landing-page copy must state exactly this: *"Mint during your window to receive
the art you chose. After the window closes your spots remain, but the art is
assigned randomly."*

## Phase 2 — Guaranteed slot (random art)

Wallets that registered on the site without qualifying art, wallets collected
manually, and all GTD winners (above). Each wallet's leaf carries its own slot
count (`{wallet, count}`); the window is exclusive to this group.

**"Guaranteed" is a supply promise:** only Phase-2 leaves can mint in this
window, and the launch check requires Σ(phase-2 caps) ≤ remaining supply. As
long as that holds (it comfortably does at 4,096), every wallet in this phase
gets its slots.

## Phase 3 — FCFS (community snapshot)

The day before mint, we snapshot holders of the partner collections
(`allowlist/snapshot-holders.mjs` — all holders, or top-N by balance, burn/team
addresses excluded) and bake them into the tree as Phase-3 leaves. Cap 8,
first-come-first-served within the window, random art.

## Phase 4 — Public

Open mint, cap 8, random art, until sellout or close.

---

## Cross-cutting rules

- **Caps are cumulative, not per-phase.** SeaDrop counts each wallet's total
  genesis mints; every stage's cap is checked against that total. A GTD winner
  who minted 5 has 3 left under the cap-8 phases. Phase caps therefore form a
  ladder (5 → 8), never a sum.
- **Random art assignment** is one deterministic draw over the combined
  remaining allocation, weighted by each collection's unminted count — a sellout
  lands exactly on the locked per-collection split. One cube per source artwork,
  ever (enforced on-chain).
- **Seed is permanent, slot is mutable.** Each cube's generative seed is fixed
  at mint; its world position can change later (move/merge).
- **Plot allocation** spreads wallets across the world: a new wallet anchors an
  empty street; a wallet packs at most 5 plots per street, then spills forward —
  holdings stay contiguous, streets end up shared (~2 wallets per 8-plot street).
- **Payment/refund safety:** SeaDrop charges exact price × quantity. If the pool
  can't fill a request near sellout, the whole mint reverts — nobody pays for
  cubes they don't receive.
- **Fees/royalties:** primary fee split at protocol level (feeBps to the allowed
  fee recipient, remainder to creator payout); ERC-2981 royalties on secondary.

## Sequence of operations (ops summary)

1. Allowlist site closes → verify submissions → `reserve-plan.json`.
2. Bake reservations on-chain → finalize pools.
3. Day before mint: Phase-3 holder snapshot.
4. Build the single merkle tree (all gated phases + GTD rollover) with the
   on-chain cap verification. Set root, public drop, dropURI, contractURI,
   royalties, provenance hash.
5. `setGtdEndTime(<phase-1 end>)` → `setPhase(Public)` → drop opens.
6. At `gtdEndTime`: release keeper returns unminted picks to the pool.
7. Sellout or close → post-mint world opens per WORLD_MECHANICS.md (update art →
   move/merge phases enabled by owner flags).

Full command-level detail: LAUNCH_RUNBOOK.md.
