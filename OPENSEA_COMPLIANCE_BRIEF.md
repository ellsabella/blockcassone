# TheBLOCK × SeaDrop — Technical Compliance Brief

*A one-pager for OpenSea partner/engineering review of the TheBLOCK genesis drop
contracts. Prepared 2026-08-14.*

## What the drop is

TheBLOCK mints 4,096 fully on-chain "cube" NFTs, each backed by a real artwork
from one of six on-chain CC0 collections (Normies, Chain Runners, 1337 skulls,
Baby Pepes, Nouns, OnChainKevin) with a locked per-collection allocation.
Metadata, SVG image, and interactive WebGL `animation_url` are all served from
chain (`data:` URIs) — no IPFS, no API, no server.

## SeaDrop integration — what is standard

- The drop is driven end-to-end by the **unmodified SeaDrop 1.0 singleton**
  (`0x00005EA00Ac477B1030CE78506496e8C2dE24bf5`). All payment, pricing, stage
  windows, per-wallet limits, supply caps, fee split, and allowlist merkle
  verification are SeaDrop's own code.
- The token implements `INonFungibleSeaDropToken` exactly (interface id,
  `mintSeaDrop`, `getMintStats`, all creator-config forwarders) plus the
  metadata surface (`maxSupply`, `totalSupply`, `baseURI`, `contractURI`,
  provenance hash, ERC-2981 royalties — honored via OpenSea creator earnings).
- Allowlist stages use the standard leaf format
  `keccak256(abi.encode(minter, MintParams))`; one root covers all gated
  stages. Token ids are sequential from 1. `tokenURI` returns
  `data:application/json;base64,…`.

## What is custom — and why

The token is **not** `ERC721SeaDrop` (not ERC-721A). `mintSeaDrop` routes to a
minter module that decides **which artwork each paid mint receives**:

1. Allowlist winners who pre-selected artworks receive exactly their chosen
   pieces (on-chain reservations, consumed first, protected by an on-chain
   guaranteed-window that hard-blocks random assignment until it lapses).
2. All other mints receive a deterministic weighted-random artwork from the
   remaining per-collection allocation.
3. Each cube is also assigned a placement in a 4,096-plot on-chain world.

This assignment step is the product; it is impossible with sequential-id
minting. **Every commercial invariant is preserved**: pay for N → receive
exactly N tokens or the entire transaction reverts (no partial fills, enforced
on-chain); SeaDrop's checks all run unmodified; the hook never touches funds.

## Evidence

- Fork E2E tests drive the real mainnet SeaDrop singleton through `mintPublic`
  and `mintAllowList` (multi-winner merkle) on every CI run.
- A full dress rehearsal ran on Sepolia against the real SeaDrop singleton
  deployed there: four phases (guaranteed chosen-art, guaranteed random, FCFS,
  public), payment/fee split, allowlist proofs, near-sellout, and post-mint
  mechanics — all green. Contract addresses and a full transaction trail are
  available on request.

## The ask

Confirm that a SeaDrop-compatible token with a custom source-assignment
`mintSeaDrop` (commercial invariants unmodified, as above) can be listed with a
hosted drop page, and whether our custom allowlist root + hosted
`allowListURI` proofs file integrates with the drop page's presale UI — or
whether allowlist stages must be uploaded through OpenSea Studio.
