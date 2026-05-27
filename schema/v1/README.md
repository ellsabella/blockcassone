# Blockcassone Canonical Schema v1

This directory defines the **canonical data model** — what a Blockcassone artwork *is*, independent of how it looks or where it runs.

## Two-layer model

```
┌─────────────────────────────────────────┐
│  CANONICAL DATA  (this schema)          │
│  — lives onchain or derived from it     │
│  — deterministic, permanent, versioned  │
│  — composition.json / plane.json / etc. │
└────────────────────┬────────────────────┘
                     │ renderer reads
┌────────────────────▼────────────────────┐
│  RENDERER CONFIG   (not in schema)      │
│  — colours, glow, animation params      │
│  — can be swapped, upgraded, minified   │
│  — lives in core/config.js + shaders    │
└─────────────────────────────────────────┘
```

The key principle: **the canonical data never changes once minted. Renderers can evolve.**

## Files

| File | What it defines |
|---|---|
| `composition.json` | Top-level artwork: seed hash, Hilbert order, placement strategy, placed tokens |
| `plane.json` | One plane: 4 vertex positions, axis, material tag, edge activity patterns, hierarchy path |
| `token.json` | One placed NFT: contract address, token ID, normie pixels/traits/category |
| `hierarchy.json` | Reference: how planes group into cubes and super-cubes (derivable from order, not stored) |
| `renderer-contract.md` | What any conformant renderer must accept and produce |

## What belongs in the schema

- Vertex positions (integer lattice coordinates)
- Material assignments (`water` / `stone` / `forest` — semantic tags, not colours)
- Edge activity patterns (binary arrays seeded from the hash)
- Token placements (which NFT occupies which cube slot)
- Normie pixel grids and trait hashes (onchain data)
- Normie category (burned / base / edited / awakened)

## What does NOT belong in the schema

- Colours, palettes, glow widths, opacity values
- Shader parameters (noise scale, animation speed, etc.)
- Pattern rendering details (density, reach, amplitude, fade curves)
- WebGL / canvas specifics
- UI layout

These live in `core/config.js` and the viewer's material definitions.

## Versioning

Increment `schemaVersion` in `composition.json` only on breaking structural changes
(e.g. changing vertex coordinate encoding, renaming required fields). Visual changes
to the renderer never require a schema bump.
