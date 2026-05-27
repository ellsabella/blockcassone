# WebGL shader pipeline — architecture setup brief

## Context

This document is a directive for Claude Code. The goal is to scaffold a local WebGL rendering pipeline that can be used to experiment with real-time visual effects. No build tooling, no frameworks, no contract deliverables at this stage — just a clean, hackable dev environment running in a localhost browser.

The pipeline architecture has been designed through interactive prototyping. This document translates those decisions into a concrete file structure and implementation brief.

---

## What to build

A multi-pass WebGL 2 forward renderer with:

- A dev server (Node, no dependencies beyond `http` stdlib)
- Hot-reloading of shader source files without page refresh
- A scene with multiple material types rendered in the correct pass order
- A shared uniform system so all programs read the same per-frame state
- All shader source kept in separate `.glsl` files (not inline strings)

---

## File structure to create

```
pipeline/
├── server.js              # Dev server with shader hot-reload via SSE
├── index.html             # Canvas + bootstrap script
├── src/
│   ├── main.js            # Entry point — GL context, render loop
│   ├── renderer.js        # Pass orchestration (see pass order below)
│   ├── materials.js       # Material registry — maps name → {program, phase, uniforms}
│   ├── scene.js           # Scene graph — objects, transforms, material refs
│   ├── math.js            # mat4, mat3, vec3 utilities (no external deps)
│   ├── geometry.js        # Box, sphere, plane, quad generators
│   └── textures.js        # FBO setup, procedural texture generators
├── shaders/
│   ├── depth.vert.glsl
│   ├── depth.frag.glsl
│   ├── opaque.vert.glsl
│   ├── opaque.frag.glsl
│   ├── glass.vert.glsl
│   ├── glass.frag.glsl
│   ├── liquid.vert.glsl
│   ├── liquid.frag.glsl
│   └── post.vert.glsl
│       post.frag.glsl
└── PIPELINE_SETUP.md      # This file
```

---

## Dev server (`server.js`)

Use Node's `http` and `fs` modules only — no Express, no Vite.

Serve files from the `pipeline/` directory with correct MIME types (`text/javascript` for `.js`, `x-glsl` or `text/plain` for `.glsl`).

Implement shader hot-reload via **Server-Sent Events**:

- Watch the `shaders/` directory with `fs.watch`
- When any `.glsl` file changes, push an SSE event: `data: { "file": "shaders/opaque.frag.glsl" }\n\n`
- In `main.js`, listen on `new EventSource('/shader-changes')` and recompile only the affected program without clearing scene state

Start with: `node server.js` → `http://localhost:3000`

---

## Render pass order

This is the core architecture. Passes must execute in this order every frame. Do not merge them.

### Pass 1 — shadow depth

- Bind: `shadowFBO` (depth texture attachment, 512×512)
- Program: `depth.vert` / `depth.frag`
- Draw: all shadow-casting objects (opaque + alpha-tested)
- Output: `shadowTex` — depth from light POV
- Light matrix: orthographic for directional light, perspective for spot/point

Key details:
- Clear only `DEPTH_BUFFER_BIT`
- No colour attachment needed on this FBO
- Depth textures are core in WebGL 2 — attach `DEPTH_COMPONENT24` via `texImage2D` + `framebufferTexture2D`
- Requires `uLightMVP = lightProj * lightView * model` per object

### Pass 2 — opaque + alpha-tested geometry

- Bind: `sceneFBO` (RGBA colour texture + depth renderbuffer, 512×512)
- Program: `opaque.vert` / `opaque.frag`
- Draw: all opaque meshes, then alpha-tested meshes (leaves — use `discard` on alpha < 0.5)
- Output: `sceneTex` — the full lit opaque scene as a texture
- Sort: by program to minimise `gl.useProgram()` calls

Key details:
- `sceneTex` is the `COLOR_ATTACHMENT0` of `sceneFBO` — it is the colour buffer, no copy needed
- The depth renderbuffer on `sceneFBO` is write-only — we don't sample it
- Bind `shadowTex` on `TEXTURE0` so opaque fragments can receive shadows
- Shadow lookup: PCF 3×3 kernel, slope-scale bias via `gl.polygonOffset(1, 1)`

### Pass 3 — scene capture (zero-cost)

There is no explicit pass here. When Pass 2 finishes and we unbind `sceneFBO`, `sceneTex` is already populated and ready to sample. **Do not call `copyTexImage2D` or `blitFramebuffer` — this would be a redundant copy.**

The one rule: `sceneFBO` must be unbound before any draw call that samples `sceneTex`. Violating this creates a read/write feedback loop — undefined behaviour in WebGL.

### Pass 4 — transparent geometry (glass, liquid)

- Bind: default framebuffer (`null`)
- Draw opaque scene to screen first (re-draw Pass 2 objects, or blit if WebGL 2)
- Then draw transparent objects back-to-front (painter's algorithm sort by camera depth)
- `gl.enable(gl.BLEND)` with `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`
- `gl.depthMask(false)` — read depth for occlusion, do not write it
- Restore `gl.depthMask(true)` after this pass

Glass shader reads:
- `uSceneTex` (TEXTURE0) — scene behind glass
- `uNormalMap` (TEXTURE1) — animated surface normals
- `uShadowTex` (TEXTURE2) — glass should receive shadows too

Liquid shader reads same inputs plus:
- Second UV set scrolling at a different rate for complex ripple
- Foam mask (height threshold on normal map intensity)

### Pass 5 — post-process

- Bind: default framebuffer
- Program: fullscreen quad (`post.vert` is trivially `gl_Position = vec4(aPos, 0, 1)`)
- Input: the completed screen as a texture (requires a second FBO if you want post-processing — add `screenFBO` + `screenTex` and redirect Pass 4 output there)
- Apply: tone mapping (ACES or Reinhard), gamma correction (`pow(col, vec3(1.0/2.2))`)
- Optional: bloom (blur bright regions, additive blend)

If post-processing is not needed immediately, skip the `screenFBO` and apply tone mapping + gamma inline at the end of the glass fragment shader.

---

## Shared uniform system (`renderer.js`)

Set these once per frame before any draw call. Every program reads from the same locations by convention — use consistent uniform names across all shaders.

```javascript
// Set once per frame
const frameUniforms = {
  uView:       mat4,   // camera view matrix
  uProj:       mat4,   // camera projection matrix
  uCamPos:     vec3,   // world-space camera position
  uLightDir:   vec3,   // normalised world-space light direction
  uLightCol:   vec3,   // light colour (HDR values allowed)
  uLightMVP:   mat4,   // light-space matrix for shadow projection
  uTime:       float,  // seconds since start
  uShadowMap:  int,    // texture unit 0
  uSceneTex:   int,    // texture unit 1 (only meaningful in Pass 4)
};
```

Implement `setFrameUniforms(prog)` in `renderer.js` — iterates the above, calls the appropriate `gl.uniformXxx` for each program. Call it after every `gl.useProgram()`.

Per-object uniforms (`uM`, `uMVP`, `uNM`, `uBaseCol`) are set inside the draw call per object.

---

## Material system (`materials.js`)

Each material is a plain object:

```javascript
{
  name:     'glass',
  phase:    'TRANSPARENT',     // 'DEPTH' | 'OPAQUE' | 'TRANSPARENT' | 'POST'
  program:  WebGLProgram,
  textures: [                  // bound in order before draw
    { unit: 0, name: 'uSceneTex',  tex: sceneTex  },
    { unit: 1, name: 'uNormalMap', tex: normalTex },
  ],
  uniforms: {                  // per-material overrides
    uIOR:        0.03,
    uFresnelPow: 3.0,
    uTint:       [0.55, 0.88, 1.0],
    uTintStr:    0.4,
  },
  blend:     true,
  depthWrite: false,
}
```

`renderer.js` calls `bindMaterial(mat)` before each draw — binds textures, sets per-material uniforms, configures blend state.

---

## Geometry (`geometry.js`)

Generate and cache these at startup. Each returns `{ positions, normals, tangents, uvs, indices }` as typed arrays.

- `createBox(sx, sy, sz)` — 24 verts (4 per face), correct normals and tangents per face
- `createSphere(radius, stacks, slices)` — tangents computed as `(-sin(theta), 0, cos(theta))`
- `createPlane(w, d, segW, segD)` — tangents along +X
- `createQuad()` — 2 triangles, positions only, for fullscreen passes

Buffer layout: each attribute in its own VBO (not interleaved). This makes it trivial to bind only positions for the depth pass without touching normals/UVs.

---

## Shader loading (`main.js`)

Fetch all `.glsl` files at startup over HTTP. Do not inline shader strings in JS.

```javascript
async function loadShader(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load shader: ${path}`);
  return res.text();
}

// Compile a program from two paths
async function loadProgram(gl, vertPath, fragPath) {
  const [vs, fs] = await Promise.all([
    loadShader(vertPath),
    loadShader(fragPath),
  ]);
  return compileProgram(gl, vs, fs);  // standard compile + link + error log
}
```

On SSE hot-reload event, re-fetch only the changed file, recompile only the affected program, swap it into the material registry without resetting the render loop.

Every shader starts with `#version 300 es` (GLSL ES 3.00). Use `in`/`out` qualifiers instead of `attribute`/`varying`, `texture()` instead of `texture2D()`, and declare your own `out vec4 fragColor` instead of `gl_FragColor`.

---

## Procedural textures to generate at startup (`textures.js`)

These are used immediately — no file loading needed.

| Name | Description | Size |
|---|---|---|
| `normalTex` | Ripple normal map — two octaves of sin/cos, derivative-computed normals | 256×256 |
| `brickNormalTex` | Brick layout normal map — row offset, mortar gaps, derivative normals | 256×256 |
| `brickHeightTex` | Same brick pattern, greyscale height field for bump mapping | 256×256 |
| `noiseTex` | 2D value noise — useful for foam masks, leaf alpha, cloud density | 256×256 |

All textures: `REPEAT` wrap, `LINEAR_MIPMAP_LINEAR` min filter, `generateMipmap()` after upload.

---

## Initial scene to render

Three opaque objects + glass pane + ground plane, lit by one directional light, with shadow casting.

```javascript
const scene = [
  { mesh: 'box',    material: 'opaque-red',   transform: translate(-1.2, 0.4, -0.5) },
  { mesh: 'box',    material: 'opaque-blue',  transform: translate(1.1, 0.4, 0.3) },
  { mesh: 'box',    material: 'opaque-green', transform: translate(0, 0.4, -1.2) },
  { mesh: 'plane',  material: 'opaque-stone', transform: translate(0, 0, 0) },
  { mesh: 'plane',  material: 'glass',        transform: compose(translate(0, 0.65, 0.2), rotateX(-0.15)) },
];
```

Camera: `lookAt([0, 3, 5], [0, 0.2, 0])`, 60° FOV, aspect 1.0 initially.

Light direction: `normalize([1, 2, 0.8])` — upper right, slight forward tilt.

---

## What to implement first vs defer

**Implement now:**

- Dev server with SSE hot-reload
- `math.js` — mat4 multiply, lookAt, perspective, ortho, inverse-transpose for normals
- Geometry generators for box, plane, quad
- FBO creation for `shadowFBO` (depth tex) and `sceneFBO` (colour tex + depth RB)
- Pass 1 (shadow) and Pass 2 (opaque) fully wired
- `setFrameUniforms()` and `bindMaterial()` in renderer
- Scene capture — verify `sceneTex` is populated by reading a pixel after Pass 2

**Implement after the above is stable:**

- Glass shader (Pass 4) — depends on `sceneTex` being correct
- Liquid shader — animated normal map, foam mask
- Post-process pass (add `screenFBO` when needed)
- Alpha-tested leaves — `discard` in opaque fragment shader, two-sided normals
- Bloom — blur bright fragments from `screenTex`, additive blend

---

## Verification checklist

Before moving to visual effects, confirm each of the following:

- [ ] WebGL 2 context acquired (`canvas.getContext('webgl2')` non-null)
- [ ] Shadow map renders correctly — visualise `shadowTex` by sampling it in a fullscreen quad and checking silhouettes match scene geometry from light POV
- [ ] `sceneFBO` framebuffer complete — `gl.checkFramebufferStatus()` returns `FRAMEBUFFER_COMPLETE`
- [ ] `sceneTex` is populated — `gl.readPixels()` from `sceneFBO` after Pass 2 returns non-zero data
- [ ] Glass pass samples `sceneTex` without a feedback loop — `sceneFBO` must be unbound before `gl.bindTexture` on `sceneTex`
- [ ] `gl.depthMask(false)` active during transparent pass — verify by checking no Z-fighting between overlapping glass and objects behind it
- [ ] Hot-reload: change a uniform value in `opaque.frag.glsl`, save, verify the browser updates within 1s without page reload
- [ ] Gamma correction applied — a mid-grey surface (`uBaseCol = [0.5, 0.5, 0.5]`) should render at approximately 0.73 linear brightness on screen

---

## Notes for experimentation phase

Once the above is stable, the pipeline is ready for visual effects work. The intended experiments (in rough dependency order) are:

1. PCF shadow softness — vary kernel size, compare hard vs soft penumbra
2. Normal map strength — blend between geometric and mapped normals
3. Bump mapping — finite-difference height gradient, compare with normal maps
4. Environment mapping — spherical lat-long vs cubemap, Fresnel blending
5. Glass refraction quality — screen-space UV offset vs ray-marched exact refraction
6. Liquid surface — dual-scroll normal maps, foam mask at wave crests
7. Subsurface scattering approximation on leaves — back-face transmitted light tint
8. Ray marching in a fragment shader — SDF scene in a fullscreen quad pass, composited over rasterised scene

Each experiment should be a new material entry in `materials.js` and a new shader pair in `shaders/` — the pass architecture stays fixed.
