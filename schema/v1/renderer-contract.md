# Renderer Contract v1

A conformant Blockcassone renderer accepts canonical plane data and produces a visual output. It may be a WebGL viewer, an SVG generator, a print renderer, or anything else.

## Input

A renderer must accept either:

- A full `composition` object (matching `composition.json`), OR  
- A pre-computed array of `plane` objects (matching `plane.json`)

Both representations carry the same structural information. The composition form also includes the seed and token placement data.

## Required behaviour

1. **Plane positions** — each plane is rendered at its correct 3D lattice position derived from `vertices.positions`
2. **Axis identity** — planes on each axis (`x` / `y` / `z`) are visually distinct (colour, tint, or other signal)
3. **Material identity** — the three material tags (`water` / `stone` / `forest`) are rendered distinctly
4. **Edge activity** — only positions where `edgePatterns[i][j] === 1` generate line/particle output; inactive positions (0) are silent
5. **Hierarchy** — planes with the same `hierarchy.motifIndex` form one cube; the renderer must be able to group and address them as a unit

## Free choices

A renderer may freely decide:

- Output format (WebGL, SVG, Canvas, PDF, etc.)
- Colour palette and visual style
- Exact pattern rendering (how `water` looks vs `stone`)
- Line weight, glow, animation, interactivity
- How normie pixels and trait data are visualised
- Coordinate normalisation and projection

## Must not

- Alter vertex positions or edge activity patterns
- Introduce non-determinism not derived from the composition seed
- Ignore `isNormie` — normie and non-normie cubes have different visual treatments

## Normie rendering

When `token.isNormie === true`, the renderer has access to:

- `token.normie.pixels` — 40×40 binary grid for the silhouette
- `token.normie.traitsHash` — raw hash for the traits banner
- `token.normie.category` — 0–4 status affecting visual style (burned/base/edited/awakened)

## Renderer metadata

Each renderer implementation should declare:

```json
{
  "rendererId": "string",
  "rendererVersion": "string",
  "schemaVersion": 1,
  "outputFormat": "webgl | svg | canvas | other",
  "capabilities": ["normie-voxels", "stone-walker", "traits-banner", "orbit-camera"]
}
```
