# Blockcassone - Project Overview

> Intended audience: a fresh coding/review agent. Read this before opening the
> implementation files.

Blockcassone is an interactive generative-art prototype built around a 3D
Hilbert curve. The current dev viewer is now modelling the eventual mint flow:
load a wallet, simulate minting source NFTs into Hilbert slots, and render each
minted cube according to whether its source is a Normie or a non-Normie NFT.

The production goal is one ERC721 cube per minted source, with permanent source
identity and a fully onchain token renderer. Hilbert placement is currently
stored in the early contracts, but the current product direction expects plot
placement to become mutable world state so owners can move to vacant slots and
neighbourhoods can later consolidate.

The dev viewer is becoming the project home and canonical mint source. It should
prototype the world model, aesthetic changes, placement rules, movement, and
consolidation before those mechanics are finalized in Solidity.

Contract and requirements notes live in:

- `FULLY_ONCHAIN_IMPLEMENTATION_PLAN.md`
- `WORLD_AND_MINT_REQUIREMENTS.md`
- `viewer/ONCHAIN_IMPLEMENTATION_PLAN.md`

## Repository Map

```text
blockcassone/
  Overview.md
  renderer/
    server.js                         local dev server, .env, OpenSea/image proxy
    src/                              shared WebGL helpers
    shaders/                          shared GLSL materials
  viewer/
    index.html                        dev UI shell
    main.js                           viewer entry, scene rebuild, render loop
    mint-simulator.js                 simulated source selection + slot placement
    wallet-nfts.js                    OpenSea wallet loading + source assignment
    nft-art-grid.js                   NFT image parsing and grid extraction
    non-normie-art-plane.js           non-Normie artwork volume renderer
    non-normie-elongated-cardioid.js  vortex/feather internal volume renderer
    normies-api.js                    Normies API wrapper
    normies-manager.js                Normie categories, pixels, voxels, status
    hilbert-lines.js                  per-cube and full Hilbert line rendering
    cube-glass.js                     glass shell/wireframe/corner sparkles
    cube-cardioid.js                  legacy edge-bit line art
    lights.js                         RGB point lights and debug controls
```

## Running The Dev Viewer

The viewer expects the local server because it uses `.env`, the OpenSea proxy,
and the image proxy:

```powershell
$env:PORT='3001'; node renderer/server.js
```

Open:

```text
http://localhost:3001/viewer/
```

Required environment:

```text
OPENSEA_API_KEY=...
```

The server exposes:

- `/dev-config` for safe dev config
- `/api/opensea/...` for OpenSea wallet fetches
- `/api/image?url=...` for CORS-safe image sampling

## Current Viewer Flow

The viewer starts in **Big Cube** mode with an empty Hilbert scaffold. It no
longer pre-populates every cube with a deterministic fake Normie. The current
workflow is:

1. Load a wallet from the left UI panel.
2. OpenSea NFTs are classified as Normies or non-Normies.
3. Use the mint simulation panel to mint a batch.
4. The simulator chooses sources in priority order and assigns random available
   Hilbert slots.
5. Only minted slots render cube contents. Empty slots remain part of the
   scaffold/world structure.

The bottom-right label prints the active slot/cube/source NFT. This is important
for debugging wallet imports and art parsing.

## Selection And Mint Simulation Logic

`mint-simulator.js` is the current dev stand-in for contract minting.

Hard simulated invariants:

```text
One source token -> at most one simulated cube.
One Normie tokenId -> at most one simulated cube.
One Hilbert slot -> at most one simulated cube.
```

Batch selection:

1. Take requested mint quantity.
2. Pick wallet Normies first, sorted by token id, skipping already minted Normies.
3. If quantity remains, pick non-Normie NFTs deterministically/randomly from the
   wallet, skipping already minted source keys.
4. For each picked source, choose a deterministic random open Hilbert slot.

The source assignment hook is:

```js
window.__PIPELINE_MINT_SOURCE_FOR_SLOT__ = sourceNftForSlot;
```

`wallet-nfts.js` uses that hook so unminted slots return no source and minted
slots return the exact simulated source NFT.

## Wallet Loading And Source Classification

`wallet-nfts.js` loads all wallet NFTs through the local OpenSea proxy.

Normies contract:

```text
0x9Eb6E2025B64f340691e424b7fe7022fFDE12438
```

Normalized NFT fields:

- `chain`
- `contract`
- `tokenId`
- `name`
- `collection`
- `imageUrl`
- `isNormie`
- `normieId`
- `isSvgArt`
- `agentic`
- `agentId`
- `agentBinding`

Normies use the Normies API path. Non-Normies use the image parser path.

## Modes And UI

Modes:

- **2D**: face-on plane view.
- **3D**: orbit view of the active cube.
- **Big Cube**: orbit view of the Hilbert scaffold/world.

Filters:

- Cube type: all, Normie, non-Normie.
- Normie category: all, 0 burned, 1 base, 2 edited, 3 awake, 4 elite.

The filters operate on minted slots only. Category counts ignore unminted slots.

Controls:

- Left-drag: orbit in 3D/Big mode.
- Right-drag: pan.
- Wheel: zoom.
- Click cube in Big mode: select/focus cube.
- `2`, `3`, `b`: switch modes.

## Normie Art Path

Normies are rendered from `api.normies.art` data, managed by
`normies-manager.js`.

Main endpoints:

- `/normie/{id}/pixels` - current composited 40x40 grid
- `/normie/{id}/original/pixels` - original 40x40 grid
- `/normie/{id}/canvas/pixels` - XOR transform layer
- `/normie/{id}/canvas/info` - edit/customization state
- `/normie/{id}/traits` - traits
- `/normie/{id}/history/burned/{id}` - burned/dead probe
- `/normie/{id}/agents/binding/{id}` - awakened/ERC8004 probe

Edited Normies:

- The main/unique-axis plane uses current composited pixels.
- The two side planes use original pixels and canvas XOR pixels.
- The 3D visual hull intersects those three layers into 40^3 voxels.

Categories:

```text
0 Burned/dead
1 Not burned, not awakened, never edited
2 Not burned, not awakened, edited
3 Not burned, awakened, not edited
4 Not burned, awakened, edited
```

Current visual treatments:

- Burned: saturation removed and brightness heavily reduced.
- Category 1 base: baseline voxel brightness reduced to soften whiteout.
- Edited: current/original/XOR planes create lower-density, more distinctive
  voxel intersections.
- Awakened: RGB lights pulse asynchronously and orbit farther from the cube on
  differing 3D axes.
- Awake random walks: fewer, thin, right-angle/straight paths with restrained
  glow.
- Per-voxel variation/glitching reduces large monolithic voxel blocks.

Agentic non-Normie NFTs should gain some awakened Normie behavior during the
next visual iteration: moving lights, stronger motion, possible forest strands,
and possible particles.

## Non-Normie Art Path

Non-Normies have two visual systems:

1. Source artwork converted into a red voxel volume.
2. Internal vortex/feather shapes generated from Hilbert geometry.

Only the cube's main plane receives the source artwork. Forest/Normie visuals do
not render on non-Normie planes.

### NFT Image Parsing

`nft-art-grid.js` converts wallet artwork to a sampling grid.

Media support:

- normal HTTP(S) images
- `ipfs://` through `https://ipfs.io/ipfs/...`
- `ar://` through `https://arweave.net/...`
- SVG rasterization through the image proxy
- embedded raster images inside SVGs when available

Pixel-art detection:

- Samples at up to 1024px for analysis.
- Uses edge profiles and transition profiles.
- Infers native grid size between 4 and 96 cells.
- Scores flatness, boundary alignment, transition counts, and common grid sizes.

Pixel art output:

- `kind: 'pixel'`
- normalized to 40x40
- if native grid is smaller than 40x40, it is centered and padded with inferred
  background color
- if native grid is larger than 40x40, the central 40x40 cells are used
- depth uses 8 layers

Smooth/non-pixel output:

- `kind: 'smooth'`
- sampled as 120x120
- depth uses 40 layers
- average grayscale controls depth by default
- if grayscale range/std is low, depth uses deterministic k-means-like color
  clustering into up to 40 bands (`depthMode: 'color-kmeans'`)

The parser logs image size, inferred grid, detector type, flatness, transition
counts, depth mode, and ones/zeros to the browser console.

### Non-Normie Artwork Rendering

`non-normie-art-plane.js` renders source art in red.

Pixel art:

- silhouette outline on the main plane
- glow outline using `normie-glow`
- 40x40 voxel field extruded backward from the main plane over 8 slices

Smooth art:

- no silhouette outline
- 120x120 voxel field extruded backward from the main plane over 40 slices

Depth rule:

```text
darkest/source-lowest depth value -> closest slice behind main plane
lighter/higher values -> progressively deeper slices
```

The volume uses the existing `normie-voxel` glass material with red tint,
transparency, RGB point-light response, and per-cell alpha.

## Non-Normie Vortex / Feather System

`non-normie-elongated-cardioid.js` builds internal translucent feather surfaces.
These evolved from experiments with helices, elongated circles, full circles,
and vortex-style partial cardioids.

Current shape families:

- half-circle feather
- bounded full-circle feather
- extended/out-of-bounds feather

For each non-Normie cube:

1. Valid launches are collected from Hilbert edge geometry.
2. A deterministic shape mask chooses any combination of the three shape
   families.
3. Multiple launches may be used per cube.
4. Each path is converted into partial-cardioid/vortex-style translucent
   triangles, filling some vertices rather than all vertices.

Rendering:

- material: `feather-glass`
- blend: alpha
- transparent overlay layer so feathers remain visible through artwork volume
- hue is in the yellow/purple family and responds to RGB lights through the
  feather shader
- old bright halo/line passes are currently disabled or near zero

Related legacy/disabled exploration files remain:

- `non-normie-helix.js`
- `non-normie-edge-lattice.js`

## Hilbert Rendering

`hilbert-lines.js` provides:

- `buildHilbertLines` - the 7 internal Hilbert segments for one cube.
- `buildFullHilbertPath` - the complete continuous scaffold path across all
  vertices.

The empty Big Cube view uses the full path so it shows the proper continuous
Hilbert structure rather than only partial connector fragments.

The next Big Cube direction is a world to be conquered rather than an empty
scaffold. Vacant neighbourhoods should have simple natural environment shaders
such as desert, water, grass, forest, stone, ice, or void. The viewer should
also show neighbourhood/region population and agent counts as the simulated
world fills.

## Scene Item System

All rendered objects are scene items:

```js
{
  mesh: 'mesh-key',
  material: 'material-key',
  transform: mat4,
  blend: 'opaque' | 'alpha' | 'additive',
  transparentLayer: 0 | 1,
  uniforms: {},
  samplers: {}
}
```

Meshes are cached in the persistent `meshes` object. Most builders use the
sentinel pattern:

```text
undefined -> build
null      -> known empty
object    -> cached mesh
```

`rebuildScene()` in `main.js` decides which minted slots/planes to render,
builds scene items, applies category treatments, then the render loop sorts and
draws them.

## Render Order

Per frame:

1. Resize canvas if needed.
2. Build view/projection matrix and cache inverse VP for picking.
3. Clear.
4. Draw opaque items.
5. Draw normal alpha items back-to-front.
6. Draw additive items.
7. Draw alpha overlay items (`transparentLayer`) after normal alpha.

The overlay alpha layer was added so non-Normie feathers can remain visible when
they pass through dense red source-art voxel fields.

## Materials

Current material keys:

| Key | Role |
|---|---|
| `lines` | flat emissive line quads |
| `plant-particle` | instanced forest/cloud particles |
| `edge-glow` | point/corner/light marker glow sprites |
| `stone-glass` | cube shell glass |
| `internal-glass` | mirror-slice glass |
| `normie-glow` | capsule glow tubes for outlines/walks |
| `normie-voxel` | transparent lit glass voxel cubes |
| `feather-glass` | translucent light-reactive feather surfaces |

Important: `pipeline/src/materials.js` only binds uniforms listed in
`STANDARD_UNIFORMS`. If a shader uniform is not in that list, setting it from a
scene item silently does nothing.

## Point Lights

`lights.js` exposes three RGB point lights with sliders. Their positions are
cube-relative:

```text
world position = uCubeCenter + uPointLightPos[i] * uCubeHalfSize
```

Normie voxels, non-Normie artwork voxels, and feather glass use these lights.
Awakened Normies animate the lights by pulsing brightness and orbiting them
around the active cube.

## Current Known Caveats

- Smooth non-Normie art can generate very heavy 120x120 voxel fields. This is
  fine for dev exploration but must be compressed/simplified for onchain output.
- SVG handling is improved but can still fail if an SVG depends on external
  resources that cannot be resolved safely through the proxy/rasterizer.
- Pixel-art detection is heuristic. It is strong on obvious cell-boundary art
  but may need more tuning for anti-aliased or scaled pixel art.
- The dev viewer is intentionally much larger than any onchain renderer. The
  production NFT renderer must be a distilled one-cube renderer.
- Mesh cache invalidation usually requires a hard reload after changing geometry
  builders.

## Onchain Direction

The current contract direction is:

- custom mint UI and custom mint controller are the canonical path
- OpenSea/SeaDrop may be useful for discovery or a gated/pending-ticket wrapper,
  but standard SeaDrop does not pass exact Normie source token ids into the NFT
  mint callback
- the core onchain invariant remains: one Normie token id can produce at most
  one cube
- source identity remains permanent, but plot placement is expected to become
  mutable through a future world-state contract
- neighbourhood environments, population counters, movement, and consolidation
  should be prototyped in the dev viewer first

The dev mint simulator mirrors this direction so the art pipeline can continue
evolving before contracts are finalized.
