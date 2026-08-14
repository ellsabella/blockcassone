# TheBLOCK World And Mint Requirements

This document captures the current product direction for the dev pipeline, mint
site, world model, and contract architecture.

## Product Shape

The dev pipeline website is no longer only a technical preview. It should evolve
into the project home and canonical mint source.

The project has two linked surfaces:

- **Individual cube NFT**: fully onchain after mint, with self-contained
  metadata, static `image`, and interactive `animation_url`.
- **Project home / Big Cube viewer**: offchain website for discovery, minting,
  wallet exploration, world navigation, community movement, and richer visual
  iteration.

The offchain website may use OpenSea, indexers, proxies, and richer rendering.
The individual token must not depend on those systems after mint.

Minting itself happens on **OpenSea via SeaDrop** (see Mint Model). Our offchain
surfaces are:

- **Allowlist landing page** (pre-mint): wallet connect + delegation, reads a
  wallet's qualifying source assets, captures a signed ownership attestation and
  — for guaranteed spots — the holder's chosen artworks; feeds the allowlist +
  artwork-reservation bake.
- **Big Cube explorer** ("Current Block"): indexed view of the minted world —
  wallet focus, whole-block exploration, current-owner lookup, cube detail. No
  mint controls.
- **Update Cube** (post-mint): owner flow to re-base a cube's art (owned assets
  or the unused CC0/Normie pool — "spin the wheel"), move, and merge.

The explorer reads minted state from the indexer snapshot
(`data/world-snapshot.json`) / direct `CubeNFT` JSON-RPC. The indexer is a read
cache only — never required for token validity or renderer correctness.
Production copyright policy is CC0-clean: only the six curated genesis
collections, committed on-chain before the drop; no arbitrary third-party media
is ingested at mint.

## Mint Model

**Minting happens on OpenSea via SeaDrop — not on our sites.** OpenSea's mint UI
and the SeaDrop contract handle the transaction; the only inputs at mint time are
the minter wallet and a quantity. Our sites carry **no mint button** (the Big Cube
mint/sim controls are removed). Everything TheBLOCK-specific — which source
art a cube gets and its plot placement — is assigned by our SeaDrop mint hook
(`MultiSourceGenesisMinter`) when the mint transaction runs.

Hard genesis supply cap: **4096** cubes, one per source NFT. No paid mint ever
produces a placeholder. Price: **0.0069 ETH** (~$12, same across all phases for
now). The mint may be closed before 4096 sell out (see "Partial mint").

### Phases

1. **Guaranteed allowlist (GTD)** — strictly opt-in, a marketing lever. A holder
   visits the allowlist landing page, connects a wallet (**delegation MUST be
   supported** — a hot wallet acting for a vault), and the page reads the
   qualifying source assets across the six genesis collections. It surfaces the
   entitlement, e.g. *"You own 3 Normies, 1 Chain Runner, 0 Nouns → 4 qualifying,
   capped at 5 GTD spots"*, and the holder signs an **ownership attestation** for
   that wallet.
   Crucially the page shows **thumbnails of the holder's qualifying artworks and
   lets them choose which specific artworks they want turned into cubes**. That
   selection is captured; a backend script verifies the attested wallet actually
   controls those assets (pass/fail); approved wallet→artwork reservations are
   baked on-chain before the drop. When a GTD holder mints their quantity on
   OpenSea, the hook assigns **their chosen artworks**. Entitlement is weighted
   by collection (see `allowlist/src/config.js` spotWeights), **capped at 5 per
   wallet**; total GTD size TBD. Reserved-but-unminted sources **release back to
   the pool** when the GTD window closes (on-chain `gtdEndTime`: releases are
   time-locked until then, permissionless after — see `allowlist/release-keeper.mjs`).

2. **FCFS allowlist** — the wider Normie + CC0 community, first-come-first-served
   via a **simple token-gate** allowlist (holds a qualifying asset ⇒ eligible).
   FCFS mints are assigned art **randomly from the remaining pool** (no
   pre-selection); per-wallet cap **8** (same as public).

3. **Public** — open mint, per-wallet cap **8**, art assigned **randomly from the
   remaining pool**.

### Artwork assignment

- **GTD:** the holder's chosen source token(s), reserved off-chain at attestation
  time and baked on-chain, honoured in order as they mint.
- **FCFS + Public:** a seeded-PRNG single-draw over the remaining per-collection
  allocation (the locked 1679/901/655/410/328/123 split) → collection + token.

Contract status (BUILT): the minter has the **reservation registry** (wallet →
ordered source tokens) consulted first by the SeaDrop hook, falling back to the
random pool draw, plus an **on-chain GTD window** (`gtdEndTime`): while it is
open only reserved art can mint (random draws revert) and reservations cannot be
released; after it passes, releases are permissionless. FCFS token-gating is a
SeaDrop allowlist stage — GTD and FCFS leaves live in ONE merkle tree
(`allowlist/merkle.mjs`) because SeaDrop stores a single root per token.

### Delegation + attestation (landing page)

- Wallet connect must resolve **delegated** holdings (delegate.xyz / delegate.cash
  style): a connected hot wallet can represent assets held by a vault that
  delegated to it.
- The holder signs an off-chain attestation (EIP-712) binding the wallet + the
  chosen artworks. A backend script re-verifies on-chain ownership before baking
  the reservation — no trust in the client. (Attestation format + delegation
  integration: build-phase detail.)

### Partial mint

The mint may be closed before 4096 sell out. Leftover plots stay empty and the
un-drawn pool sources stay **unused** — deliberately useful post-mint: empty
plots give movement room; unused Normie/CC0 sources remain available for the
post-mint "spin the wheel" re-base; a sparser world makes it easier for a wallet
to own a whole street for merge, and leaves more vacant targets for moves and
more slack for burns. (Post-mint burn / merge / move: see below.)

### Explorer owner-focus (post-mint, Big Cube)

When a holder connects/loads a wallet on the explorer:

- owner focus activates; all cubes owned by that wallet highlight at any scale;
  a compact owner-inventory list is shown.
- clicks may be restricted to the focused wallet's cubes; an empty plot is
  labelled `empty slot`; navigating to another owner's cube may pivot focus to
  them.
- the minimap shows the focused owner's cube locations across the 4096-plot block.

Ownership and placement remain contract state; the indexer is only a read cache.

## Art Refinements

### Post-Mint Updated Cubes

Genesis cubes are backed by one of the six source collections (or a GTD holder's
chosen artwork). After launch, the project website offers an owner update flow
for people who acquired cubes and want to change the art.

Allowed update sources may include:

- owned wallet assets that pass source validation
- approved CC0 project assets

Updated cubes may gain awakened or source-specific behaviors:

- moving RGB lights
- higher movement or animation intensity
- possible forest strands
- possible particle systems
- special material or glow treatment to show awakened status

These visual treatments should be prototyped in the update tab of the dev
viewer first. The onchain renderer should later receive only the distilled
payload, behavior flags, and compact rendering logic needed to reproduce the
final result.

### Natural Neighbourhoods

The Big Cube is a new world to be conquered, not a blank Hilbert scaffold.

Before slots are occupied, each neighbourhood should have a simple natural
environment shader or visual identity. Initial environment types may include:

- desert
- water
- grass
- forest
- stone or mountain
- ice or snow
- void or night

Each neighbourhood should expose:

- `neighbourhood`: 0-based local 3rd-order Hilbert block index.
- `Environment`: natural environment type.

The dev viewer should render these environments for vacant neighbourhoods and
show how minted cubes overwrite, inhabit, or transform them.

## World State

The final world supply remains a 5th-order Hilbert cube:

```text
4096 plots
8 regions
64 neighbourhoods
512 streets
```

Traits already required:

- `plot`: 0-based Hilbert slot, `0..4095`.
- `region`: 0-based 4th-order Hilbert block, `0..7`; 512 plots each.
- `neighbourhood`: 0-based neighbourhood, `0..63`.
- `street`: 0-based 8-cube Hilbert subset, `0..511`.
- `Agentic`: `Y` / `N`.
- `Agent ID`: numeric agent binding ID, `0` when not agentic.
- `Source Contract`.
- `Source Token ID`.

`Agentic` and `Agent ID` are dynamic source-derived traits. They are captured at
mint but may change if the source Normie later receives an agent binding. The
token renderer must read the current onchain agent-status registry when
available, falling back to the mint-time snapshot only when no current status
has been set.

New dynamic or world-derived traits under consideration:

- `Environment`
- `Neighbourhood Population`
- `Street Population`
- `Region Population`
- `Neighbourhood Agents`
- `Street Agents`
- `Region Agents`

Population traits are dynamic. They may change when new cubes mint, move, or
consolidate. That is acceptable if the behavior is fully onchain, but
marketplace refresh behavior must be considered.

## Placement Rules

Initial placement is more than “is this plot vacant?”

The contract architecture should allow placement policies such as:

- one cube per plot
- source uniqueness
- maximum agentic cubes per neighbourhood
- maximum agentic cubes per street
- maximum agentic cubes per region
- possible environment-specific placement rules
- possible community or wallet preference rules

The dev simulator should model these rules before they are committed to
Solidity.

## Movement

Owners can move a cube to **any vacant plot** in the 4096 block (not restricted to
region/neighbourhood) for a **small fee** (~$2 equivalent — exact price TBD; build
the fee, tune later). Movement is the assembly tool for merge: scatter at mint →
move cubes together → merge a street.

- **No per-street cap on move** — a wallet may stack any number of its cubes into
  one street (merge needs ≥5). The max-5-per-wallet-per-street cap applies at
  **mint only**.
- Only regular cubes move; **merged / golden street tokens are locked in place**.
- Vacant plots only (one cube per plot).
- `plot` / `street` / `neighbourhood` / `region` / `Environment` **and the cube's
  colour** (a function of slot) change on move; source identity stays permanent;
  slot occupancy + population counters update atomically.
- Moving changes the token's metadata + image + animation → the contract must emit
  an **ERC-4906** metadata-update event so marketplaces re-fetch (see below).

### Displacement / force-move (BUILT — territorial, with guardrails)

Holding **≥5 of a street's 8 plots gives you control of it.** A controller may
**force-move** any other wallet's cube out of that street via `moveCube` — an
involuntary change to the displaced token's location, colour, and world-traits.
It is still a conquest mechanic, but **priced and rate-limited** rather than
free-for-all. (This supersedes the earlier "no cooldown, no compensation,
controversy" framing — we chose to compensate the victim and add a cooldown; see
`FEES_AND_DISPLACEMENT_SPEC.md`.)

- **Mechanic (1:1 swap):** the controller moves one of their own cubes into the
  contested plot; the displaced cube takes the controller's now-vacated slot. So
  clearing a street with M minority cubes takes M such swaps, each needing a cube
  the controller holds elsewhere.
- **Compensation + fee:** `fee = baseFee + D × premiumPerPoint`, where `D` is the
  biome-rarity the victim *loses* (their new slot vs the slot taken from them). The
  fee is **paid to the displaced victim** (direct transfer, pull-fallback). When the
  controller grabs a **higher-tier** slot (`D > 0`) the house takes ~1/3; a lateral
  or upgrade move pays the victim the full baseFee. Move-to-vacant is a flat baseFee
  to the house.
- **Cooldown:** the same victim address cannot be displaced twice within 15 minutes.
- **Merge is a SEPARATE step, not auto-displacement:** `mergeStreet` still requires
  you own **every occupied plot** of the street. To consolidate a contested street
  you first **displace** each minority holder (the paid swaps above), which makes you
  sole owner of the occupied plots, **then** merge. Merge itself is free when you own
  the whole street (else baseFee per vacant plot locked).
- **Immunity:** golden / merged street tokens cannot be displaced and cannot
  displace — they're locked in place (`CannotDisplaceStreet`).
- **Marketplace refresh (BUILT):** displaced/moved/merged/re-based tokens emit
  **ERC-4906** (`MetadataUpdate`) so OpenSea et al. re-fetch the new
  colour/traits/image. OpenSea refresh is best-effort + laggy; our own explorer
  reflects chain state instantly.

The world is contested territory; majority control is power — but the displaced are
paid for the land taken from them, and can't be harassed on a loop.

## Street Merge (Burn / Consolidation)

Merge is **street-level** — an 8-plot Hilbert street (neighbourhood/region merge
is out of scope for now). Merge *is* the burn mechanism; there is no standalone
"destroy one cube."

**Eligibility.** `mergeStreet` requires the caller to **solely own every occupied
plot** of the street **and hold ≥5 filled plots** (`MERGE_MIN_FILLED`). Vacant plots
are fine — you merge *with* them (they lock into the street), you don't fill them —
but a near-empty street can't mint a golden cube (fewer than 5 filled reverts).
Majority (≥5/8) does not by itself permit a merge — it grants the right to
**displace** the minority holders first
(see Displacement above): you evict each other-wallet cube via a paid swap until you
hold every occupied plot, **then** merge. This two-step model (displace, then merge)
keeps merge simple and avoids unbounded cascades, and still works in a sold-out
world where you can't just buy or vacate the remaining plots.

**Outcome — the street collapses into ONE survivor.**

- The owner's other cubes are **burned** and the vacant plots **consumed**: **7 of
  the 8 slots are destroyed**, and the 8th holds one **hyper-rare** consolidated
  NFT representing the whole street.
- The survivor carries a merged **Population** trait — occupancy + source
  composition, e.g. *"5/8 occupied · 3 Runners · 2 Normies"* (exact detail TBC) —
  plus `Merged: Y`.
- **Visual:** the survivor's static `image` gets a special **"golden"** treatment
  (e.g. figure lines → golden glow — exact look TBC), and its `animation_url`
  switches from a single cube to a **street view** (the 8 plots rendered as a
  street, not one cube). *(The renderer already has a merged-street animation path
  + Population/Merged metadata; the golden thumbnail is the new visual work.)*
- The indexer records the merge in the cube's history.

Open / TBC: exact golden aesthetic; exact Population composition detail; which
plot the survivor occupies; whether burned source identities stay referenced by
the consolidated token.

## Contract Direction

The project likely needs a dedicated world-state layer rather than keeping all
placement logic inside `CubeNFT`.

Recommended future module:

- `CubeWorld` or `WorldState`

Responsibilities:

- plot occupancy
- movement
- neighbourhood and region derivation
- street derivation
- environment assignment
- population counters
- agentic population counters
- placement-policy hooks
- consolidation eligibility

`CubeNFT` should remain the ERC-721 identity and source-provenance contract.
`CubeWorld` should become the mutable map/state contract.

## Indexer Boundary

The contracts must be the source of truth for minting, placement, ownership,
payloads, movement, and consolidation. An indexer is not allowed to be required
for token validity or renderer correctness.

For the project home / Big Cube website, an indexer is strongly recommended for
performance and ergonomics:

- wallet-owned cube lists
- owner-focus highlighting
- current owner lookup for secondary sales
- current source/update status
- movement history
- population and agent counts
- consolidation eligibility
- cross-chain source/provenance summaries
- post-mint Normie agent-binding checks

The UI should be designed so indexer data can be rebuilt from contract state and
events. Direct contract reads should remain possible for correctness checks and
small views, but the full city-scale experience may rely on indexed reads for
speed.

For agentic status specifically, the indexer should watch the upstream
Normie/OpenSea/agent-binding source and submit updates to an onchain
agent-status registry. Once the update transaction is mined, token metadata and
the token HTML renderer read the new state from contracts. The indexer can help
discover the change, but it must not be a runtime dependency of the token.

The Current Block tab should expose agent-status freshness so we can see:

- mint-time agent status
- current onchain agent status
- last registry update block or timestamp
- any detected offchain change waiting to be written onchain

## Dev Pipeline Priorities

Before adding more Solidity, prototype in the dev viewer:

1. Natural neighbourhood environments.
2. Agentic non-Normie awakened visuals.
3. Placement-policy simulator.
4. Population counters and UI labels.
5. Movement UX for vacant slots.
6. Update-cube UX for owned/approved CC0 assets.
7. Consolidation UX for full-neighbourhood ownership.

Once the behavior feels right, move only the hard invariants and compact state
into contracts.
