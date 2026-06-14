# Token Renderer Parity Plan

The production token renderer must reproduce the dev-viewer cube detail output. A simplified SVG, simplified WebGL scene, or hand-redrawn approximation is not acceptable for production.

## Requirement

Each minted token must expose:

- `image`: a static thumbnail generated from onchain data.
- `animation_url`: an interactive HTML/WebGL artifact generated entirely from contract-returned data URIs.
- No fetches, remote URLs, gateway URLs, API calls, or offchain assets inside the token artifact after mint.

The buyer-facing `animation_url` should match the visual language of the current dev viewer's 3D cube detail panel: voxel body, forest strands/particles, Hilbert neon lines, cardioid edge effects, outlines, labels/banners, moving lights, glass treatment, and orbit controls.

## Exact Source Of Truth

The token artifact must be built from the same source modules used by the dev viewer detail scene, rather than reimplemented separately.

Current detail stack to extract/share:

- `viewer/normie/voxels.js`: 3D voxel mesh from Normie raw bitmap data.
- `viewer/materials/forest.js`, `forest-lines.js`, `forest-particles.js`, `forest-grow.js`: forest strands and particles.
- `viewer/normie/outlines.js`: 2D outline/glow treatment.
- `viewer/normie/label.js`: Normie ID label.
- `viewer/normie/banner.js`: trait banner.
- `viewer/hilbert-lines.js`: neon Hilbert lines.
- `viewer/cube-cardioid.js`: pink cardioid/edge effects.
- `viewer/cube-glass.js`: glass cube shell.
- `viewer/scene/styling.js`: category styling, agentic awakening, dimming.
- `renderer/src/geometry.js`, `renderer/src/math.js`, `renderer/src/materials.js`: GL helpers and material lifecycle.
- `renderer/shaders/*.glsl`: the exact shader programs used by the above modules.

## Token Data

The renderer config injected by `CubeRendererV2` must include all facts required by the shared dev-viewer scene code:

- token ID
- plot, region, neighbourhood, street
- source contract
- source token ID
- owner/source ownership facts where needed for labels
- Normie raw image data
- Normie trait bytes/hash needed by the banner/style system
- agentic flag and agent ID
- renderer/payload version

If a dev-viewer module currently relies on browser fetches, local JSON, the dev server, or wallet APIs, production token mode must replace that dependency with data injected by the contract.

## Onchain Chunking

The production HTML renderer is expected to be too large for a single small string. `RendererAssetStore` therefore supports ordered chunks:

- chunk `0`: HTML head/opening shell
- chunks `1..chunkCount-1`: bundled script/style/shader payload

`CubeRendererV2.animationHTML()` injects `window.BLOCKCASSONE_TOKEN` between the head and script chunks. The deployment process must upload the bundled renderer chunks before final mint.

## Build Strategy

1. Extract the cube detail scene builder out of `viewer/main.js` into a shared module.
2. Update the dev viewer to import that shared module so parity remains automatic.
3. Add a token entrypoint that imports the same shared module and supplies only one token/cube context.
4. Bundle the token entrypoint with all JS modules and GLSL shader text inlined.
5. Split the bundle into deterministic chunks for `RendererAssetStore`.
6. Deploy/upload chunks locally, export a token HTML file, and compare it visually against the dev viewer detail panel for the same cube.

## Acceptance Checks

Before calling the renderer production-ready:

- Exported `animation_url` contains no `fetch(`, `XMLHttpRequest`, remote URL, `/api/`, `ipfs://`, or gateway dependency.
- Exported HTML runs by opening the file directly from the temp preview folder.
- Exported HTML uses WebGL2 and the same shader stack as the dev viewer.
- Exported cube visually matches the dev viewer detail panel for the same token/source Normie.
- Static `image` is clearly derived from the same onchain source data and not a placeholder.
- Foundry tests prove multi-chunk assembly and metadata traits.
- A local deployment script uploads the actual bundled renderer chunks, not the fallback script.

## Non-Goals

- The fallback renderer in `CubeRendererV2` is not a production visual target.
- The current token preview is not acceptable as final art.
- Offchain website/indexer data may help the project UI, but it must not be required by token `image` or `animation_url`.
