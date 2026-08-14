# Renderer Contract v1

A conformant TheBLOCK renderer accepts canonical plane, token, and optional
world-context data and produces a visual output. It may be a WebGL viewer, an
SVG generator, a print renderer, or anything else.

## Input

A renderer must accept either:

- A full `composition` object matching `composition.json`, or
- A pre-computed array of `plane` objects matching `plane.json`.

Both representations carry the same structural information. The composition
form also includes seed and token placement data.

## Required Behaviour

1. **Plane positions**: each plane is rendered at its correct 3D lattice position
   derived from `vertices.positions`.
2. **Axis identity**: planes on each axis (`x`, `y`, `z`) are visually distinct.
3. **Material identity**: material tags such as `water`, `stone`, and `forest`
   are rendered distinctly.
4. **Edge activity**: only positions where `edgePatterns[i][j] === 1` generate
   line or particle output; inactive positions are silent.
5. **Hierarchy**: planes with the same `hierarchy.motifIndex` form one cube; the
   renderer must be able to group and address them as a unit.
6. **Agentic state**: `token.agentic` and `token.agentId` must be available to
   visual systems that distinguish awakened/agentic cubes.
7. **World context**: Big Cube renderers should accept neighbourhood environment
   and population context when available.

## Free Choices

A renderer may freely decide:

- output format
- colour palette and visual style
- exact pattern rendering
- line weight, glow, animation, and interactivity
- how Normie pixels and trait data are visualised
- how agentic non-Normies borrow awakened Normie behaviours
- how vacant neighbourhood environments are displayed in the Big Cube
- coordinate normalisation and projection

## Must Not

- Alter vertex positions or edge activity patterns.
- Introduce non-determinism not derived from the composition seed or onchain
  state.
- Ignore `isNormie`; Normie and non-Normie cubes have different visual
  treatments.
- Ignore `agentic` when a renderer advertises agentic visual capabilities.

## Normie Rendering

When `token.isNormie === true`, the renderer has access to:

- `token.normie.pixels`: 40x40 binary grid for the silhouette.
- `token.normie.traitsHash`: raw hash for the traits banner.
- `token.normie.category`: 0-4 status affecting visual style
  (burned/base/edited/awakened).

## Agentic Rendering

When `token.agentic === true`, the renderer has access to:

- `token.agentId`: numeric OpenSea/source binding ID, `0` only for non-agentic
  cubes.
- source identity fields for provenance.

Agentic non-Normies may use awakened Normie-style treatments such as moving
lights, stronger animation, forest strands, and particles.

## Big Cube World Context

When rendering the world rather than one token, the renderer may receive:

- `plot`
- `neighbourhood`
- `region`
- `environment`
- `neighbourhoodPopulation`
- `regionPopulation`
- `neighbourhoodAgents`
- `regionAgents`

These values may be dynamic once movement and consolidation are implemented.

## Renderer Metadata

Each renderer implementation should declare:

```json
{
  "rendererId": "string",
  "rendererVersion": "string",
  "schemaVersion": 1,
  "outputFormat": "webgl | svg | canvas | other",
  "capabilities": [
    "normie-voxels",
    "stone-walker",
    "traits-banner",
    "orbit-camera",
    "agentic-behaviour",
    "world-environments"
  ]
}
```
