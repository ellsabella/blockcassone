# TheBLOCK Canonical Schema v1

This directory defines the canonical data model: what a TheBLOCK artwork is,
independent of how it looks or where it runs.

## Two-Layer Model

```text
CANONICAL DATA
- lives onchain or is derived from onchain state
- deterministic, versioned, and recoverable
- includes composition, token, payload, source, and world-state facts

RENDERER CONFIG
- colours, glow, animation params, shaders, and UI
- may evolve while canonical token data remains recoverable
- lives in viewer/core code during development and renderer contracts later
```

The earlier schema assumed canonical data never changes once minted. The current
project direction is more precise:

- source identity should be permanent
- art payloads and agent provenance should be permanent
- plot placement may become mutable onchain world state
- population traits may be dynamic
- renderers may evolve through versioned contracts

## Files

| File | What it defines |
|---|---|
| `composition.json` | Top-level artwork: seed hash, Hilbert order, placement strategy, placed tokens |
| `plane.json` | One plane: 4 vertex positions, axis, material tag, edge activity patterns, hierarchy path |
| `token.json` | One placed NFT: contract address, token ID, Normie pixels/traits/category |
| `hierarchy.json` | Reference: how planes group into cubes and super-cubes |
| `renderer-contract.md` | What any conformant renderer must accept and produce |

## What Belongs In The Schema

- Vertex positions.
- Material assignments such as `water`, `stone`, and `forest`.
- Edge activity patterns.
- Token source identity.
- Token placement/world context.
- Normie pixel grids and trait hashes.
- Normie category.
- Agentic state and numeric agent ID.
- Neighbourhood environment type.
- Population counters when rendering the Big Cube.

## What Does Not Belong In The Schema

- Colours, palettes, glow widths, opacity values.
- Shader parameters.
- Pattern rendering details.
- WebGL or canvas specifics.
- UI layout.

These live in viewer material definitions during development and in renderer
asset contracts for production.

## Versioning

Increment `schemaVersion` only on breaking structural changes, such as changing
coordinate encoding, renaming required fields, or changing the shape of token
world context. Visual changes to the renderer do not require a schema bump.
