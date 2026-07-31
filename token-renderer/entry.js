import { CONFIG } from '../core/config.js';
import { generateHilbert3D } from '../core/hilbert.js';
import { Random } from '../core/random.js';
import { assignPlaneProperties, buildPlaneEdges } from '../core/planes.js';
import { assignMotifEdgePoints } from '../core/cube-edge-points.js';
import { buildBlocks } from '../core/blocks.js';
import { serializeAllPlaced } from '../core/serialize.js';
import { createBox, createWireframeBox, createMeshGL } from '../renderer/src/geometry.js';
import {
  identity,
  invert,
  lookAt,
  mat4,
  multiply,
  perspective,
  v3Normalize,
  vec3,
} from '../renderer/src/math.js';
import { loadMaterialFromSource } from '../renderer/src/materials.js';
import { buildCubeDetailScene } from '../viewer/detail-scene-builder.js';
import { setNonNormieResolvers, gridFromTonal } from '../viewer/non-normie-art-plane.js';
import { buildEmptySlotItems } from '../viewer/crystal-biome.js';
import { buildHilbertPathRange } from '../viewer/hilbert-lines.js';
import { buildImpostorCloud } from '../viewer/impostor-cloud.js';
import { buildRainbowSpine, recolorSpineItems } from '../viewer/rainbow-spine.js';
import { buildCoreLineMesh, buildGlowLineMesh, worldPerp } from '../viewer/materials/line-mesh.js';
import { applyDim } from '../viewer/scene/styling.js';
import { buildEdgePointDebug } from '../viewer/materials/debug-edge-points.js';
import { setCubeAssignmentResolver } from '../viewer/assignment.js';
import { hydrateNormieRawBytes, initNormiesManager } from '../viewer/normies-manager.js';
import { grayscaleColor } from '../viewer/scene/styling.js';

import linesVert from '../renderer/shaders/lines.vert.glsl?raw';
import linesFrag from '../renderer/shaders/lines.frag.glsl?raw';
import stoneGlassVert from '../renderer/shaders/stone-glass.vert.glsl?raw';
import stoneGlassFrag from '../renderer/shaders/stone-glass.frag.glsl?raw';
import normieGlowVert from '../renderer/shaders/normie-glow.vert.glsl?raw';
import normieGlowFrag from '../renderer/shaders/normie-glow.frag.glsl?raw';
import plantParticleVert from '../renderer/shaders/plant-particle.vert.glsl?raw';
import plantParticleFrag from '../renderer/shaders/plant-particle.frag.glsl?raw';
import edgeGlowVert from '../renderer/shaders/edge-glow.vert.glsl?raw';
import edgeGlowFrag from '../renderer/shaders/edge-glow.frag.glsl?raw';
import normieVoxelVert from '../renderer/shaders/normie-voxel.vert.glsl?raw';
import normieVoxelFrag from '../renderer/shaders/normie-voxel.frag.glsl?raw';
import featherGlassVert from '../renderer/shaders/feather-glass.vert.glsl?raw';
import featherGlassFrag from '../renderer/shaders/feather-glass.frag.glsl?raw';
import textBannerVert from '../renderer/shaders/text-banner.vert.glsl?raw';
import textBannerFrag from '../renderer/shaders/text-banner.frag.glsl?raw';

globalThis.CONFIG = CONFIG;

const TOKEN = globalThis.BLOCKCASSONE_TOKEN || {};
const ORDER = 5;
const MAX_POINT_LIGHTS = 3;

function rawBytesFromBase64(value) {
  const s = atob(String(value || ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function cubeAABB(hilbert, motifIdx) {
  const base = motifIdx * 8;
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const v = hilbert.rawVertices[base + i];
    if (v.x < mn[0]) mn[0] = v.x; if (v.x > mx[0]) mx[0] = v.x;
    if (v.y < mn[1]) mn[1] = v.y; if (v.y > mx[1]) mx[1] = v.y;
    if (v.z < mn[2]) mn[2] = v.z; if (v.z > mx[2]) mx[2] = v.z;
  }
  return { mn, mx };
}

function centerOfAABB({ mn, mx }) {
  return [(mn[0] + mx[0]) * 0.5, (mn[1] + mx[1]) * 0.5, (mn[2] + mx[2]) * 0.5];
}

function sizeOfAABB({ mn, mx }) {
  return Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
}

function setUniformByName(gl, loc, name, value) {
  if (loc === null || loc === undefined) return;
  if (typeof value === 'number') { gl.uniform1f(loc, value); return; }
  if (!(value instanceof Float32Array || Array.isArray(value))) return;
  const arr = value instanceof Float32Array ? value : new Float32Array(value);
  if (arr.length > 4) {
    if (name === 'uEdgeActive') gl.uniform1fv(loc, arr);
    else gl.uniform3fv(loc, arr);
    return;
  }
  if (arr.length === 2) gl.uniform2fv(loc, arr);
  else if (arr.length === 3) gl.uniform3fv(loc, arr);
  else if (arr.length === 4) gl.uniform4fv(loc, arr);
}

function createOrbit(canvas, target0, distance0) {
  let yaw = Math.PI * 0.22;
  let pitch = Math.PI * 0.12;
  let target = Array.from(target0);
  let baseDist = distance0;
  let dist = distance0;
  let drag = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    drag = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', (e) => {
    drag = false;
    canvas.releasePointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    yaw += (e.clientX - lastX) * 0.006;
    pitch = Math.max(-1.35, Math.min(1.35, pitch + (e.clientY - lastY) * 0.005));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    dist = Math.max(baseDist * 0.45, Math.min(baseDist * 3.0, dist * Math.exp(e.deltaY * 0.001)));
  }, { passive: false });

  return {
    // Recentre on a new target/distance (used to toggle street overview vs a
    // focused cube). Keeps the current yaw/pitch.
    retarget(newTarget, newDist) {
      target = Array.from(newTarget);
      baseDist = newDist;
      dist = newDist;
    },
    camera(aspect) {
      const pos = new Float32Array([
        target[0] + Math.sin(yaw) * Math.cos(pitch) * dist,
        target[1] + Math.sin(pitch) * dist,
        target[2] + Math.cos(yaw) * Math.cos(pitch) * dist,
      ]);
      const view = mat4();
      const proj = mat4();
      lookAt(view, pos, new Float32Array(target), vec3(0, 1, 0));
      perspective(proj, Math.PI / 4.4, aspect, 0.03, 200);
      return { pos, view, proj };
    },
  };
}

function makeMaterials(gl) {
  const defs = [
    ['lines', 'ADDITIVE', linesVert, linesFrag],
    ['stone-glass', 'TRANSPARENT', stoneGlassVert, stoneGlassFrag],
    ['normie-glow', 'TRANSPARENT', normieGlowVert, normieGlowFrag],
    ['plant-particle', 'ADDITIVE', plantParticleVert, plantParticleFrag],
    ['edge-glow', 'ADDITIVE', edgeGlowVert, edgeGlowFrag],
    ['normie-voxel', 'TRANSPARENT', normieVoxelVert, normieVoxelFrag],
    ['feather-glass', 'TRANSPARENT', featherGlassVert, featherGlassFrag],
    ['text-banner', 'ADDITIVE', textBannerVert, textBannerFrag],
  ];
  const out = {};
  for (const [name, phase, vertSource, fragSource] of defs) {
    out[name] = loadMaterialFromSource(gl, { name, phase, vertSource, fragSource, uniforms: {} });
  }
  return out;
}

function makePlaceholderTexture(gl, rgba) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function buildAwakenedLightBuffers(item, t, basePositions, baseColors, posOut, colOut) {
  posOut.fill(0);
  colOut.fill(0);
  const c = item.uniforms?.uCubeCenter;
  const seed = c ? c[0] * 0.73 + c[1] * 1.91 + c[2] * 2.37 : 0.0;
  const tEff = t * (item.lightSpeedMult || 1.0);
  for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
    const phase = seed + i * 2.094;
    const speed = 0.45 + i * 0.17;
    const a = tEff * speed + phase;
    const b = tEff * (speed * 0.63 + 0.11) + phase * 1.7;
    const radius = 1.22 + i * 0.18;
    const wobble = 0.30 + i * 0.06;
    posOut[i * 3 + 0] = Math.cos(a) * radius + basePositions[i * 3 + 0] * 0.05;
    posOut[i * 3 + 1] = Math.sin(b) * wobble + basePositions[i * 3 + 1] * 0.05;
    posOut[i * 3 + 2] = Math.sin(a) * radius + basePositions[i * 3 + 2] * 0.05;
    const pulse = 0.18 + 1.05 * Math.pow(0.5 + 0.5 * Math.sin(tEff * (1.25 + i * 0.31) + phase * 2.3), 2.0);
    colOut[i * 3 + 0] = baseColors[i * 3 + 0] * pulse;
    colOut[i * 3 + 1] = baseColors[i * 3 + 1] * pulse;
    colOut[i * 3 + 2] = baseColors[i * 3 + 2] * pulse;
  }
}

function drawScene({ gl, items, cam, materials, meshes, envTex, t }) {
  const lightDir = v3Normalize(vec3(), vec3(1.0, 2.0, 0.8));
  const lightCol = new Float32Array([0.12, 0.11, 0.10]);
  const grayLightCol = grayscaleColor(lightCol);
  const lightPos = new Float32Array([0.7, 0.5, 0.7, -0.7, 0.3, 0.5, 0.2, 0.9, -0.7]);
  const lightColors = new Float32Array([1.7, 0.12, 0.9, 0.35, 1.9, 0.22, 1.8, 1.6, 0.2]);
  const grayLightColors = new Float32Array(lightColors.length);
  for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
    const g = lightColors[i*3] * 0.299 + lightColors[i*3+1] * 0.587 + lightColors[i*3+2] * 0.114;
    grayLightColors[i*3] = g; grayLightColors[i*3+1] = g; grayLightColors[i*3+2] = g;
  }
  const awakenedPos = new Float32Array(MAX_POINT_LIGHTS * 3);
  const awakenedCol = new Float32Array(MAX_POINT_LIGHTS * 3);
  const camRight = new Float32Array([cam.view[0], cam.view[4], cam.view[8]]);
  const camUp = new Float32Array([cam.view[1], cam.view[5], cam.view[9]]);
  const groups = [
    ['opaque', items.filter(it => !it.blend || it.blend === 'opaque')],
    ['alpha', items.filter(it => it.blend === 'alpha' && !it.transparentLayer)],
    ['alpha', items.filter(it => it.blend === 'alpha' && it.transparentLayer)],
    ['additive', items.filter(it => it.blend === 'additive')],
  ];

  for (const [blendMode, drawList] of groups) {
    if (blendMode === 'additive') {
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
      gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    } else if (blendMode === 'alpha') {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false); gl.disable(gl.CULL_FACE);
    } else {
      gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    }
    gl.enable(gl.DEPTH_TEST);

    let currentProg = null;
    let L = null;
    let cullEnabled = blendMode === 'opaque';
    for (const item of drawList) {
      const mat = materials[item.material];
      const mesh = meshes[item.mesh];
      if (!mat || !mesh) continue;
      const wantCull = blendMode === 'opaque' && !item.noCull;
      if (wantCull !== cullEnabled) {
        if (wantCull) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
        else gl.disable(gl.CULL_FACE);
        cullEnabled = wantCull;
      }
      if (mat.program !== currentProg) {
        gl.useProgram(mat.program);
        currentProg = mat.program;
        L = mat.locations;
        if (L.uView) gl.uniformMatrix4fv(L.uView, false, cam.view);
        if (L.uProj) gl.uniformMatrix4fv(L.uProj, false, cam.proj);
        if (L.uCamPos) gl.uniform3fv(L.uCamPos, cam.pos);
        if (L.uCamRight) gl.uniform3fv(L.uCamRight, camRight);
        if (L.uCamUp) gl.uniform3fv(L.uCamUp, camUp);
        if (L.uLightDir) gl.uniform3fv(L.uLightDir, lightDir);
        if (L.uTime) gl.uniform1f(L.uTime, t);
        if (L.uEnvTex) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, envTex);
          gl.uniform1i(L.uEnvTex, 0);
        }
        if (L.uEnvLayout) gl.uniform1i(L.uEnvLayout, 0);
        if (L.uPointLightCount) gl.uniform1i(L.uPointLightCount, MAX_POINT_LIGHTS);
      }
      if (L.uM) gl.uniformMatrix4fv(L.uM, false, item.transform);
      const ptPosLoc = L.uPointLightPos || L['uPointLightPos[0]'];
      const ptColLoc = L.uPointLightCol || L['uPointLightCol[0]'];
      let pointPosBuf = lightPos;
      let pointColBuf = item.desaturate ? grayLightColors : lightColors;
      if (item.awakenedLights) {
        buildAwakenedLightBuffers(item, t, lightPos, lightColors, awakenedPos, awakenedCol);
        pointPosBuf = awakenedPos;
        pointColBuf = awakenedCol;
      }
      const lightScale = item.lightIntensityScale ?? 1.0;
      if (L.uLightCol) {
        const baseLight = item.desaturate ? grayLightCol : lightCol;
        gl.uniform3f(L.uLightCol, baseLight[0] * lightScale, baseLight[1] * lightScale, baseLight[2] * lightScale);
      }
      if (ptPosLoc) gl.uniform3fv(ptPosLoc, pointPosBuf);
      if (ptColLoc) gl.uniform3fv(ptColLoc, pointColBuf);
      for (const [name, value] of Object.entries(item.uniforms || {})) {
        setUniformByName(gl, L[name], name, value);
      }
      if (item.samplers) {
        let unit = 0;
        for (const [name, src] of Object.entries(item.samplers)) {
          const tex = typeof src === 'function' ? src() : src;
          if (!tex || !L[name]) continue;
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1i(L[name], unit);
          unit++;
        }
      }
      gl.bindVertexArray(mesh.vao);
      if (mesh.mode === gl.LINES) gl.lineWidth(item.lineWidth || 1);
      if (mesh.mode === 'INSTANCED') {
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, mesh.instanceCount);
      } else if (mesh.indexCount > 0) {
        gl.drawElements(mesh.mode, mesh.indexCount, mesh.indexType || gl.UNSIGNED_SHORT, 0);
      } else {
        gl.drawArrays(mesh.mode, 0, mesh.vertexCount);
      }
    }
  }
  gl.bindVertexArray(null);
}

// A single cube renders one occupied plot; a merged-street token renders the
// street's 8 plots (occupied cubes + vacant biome placeholders). For local
// testing without the merge contract, append #street to the URL to synthesize a
// mock street (this cube on plots 0-2, the rest vacant).
function readPlots() {
  const plotFrom = (p, motifIdx) => ({
    motifIdx,
    occupied: Boolean(p && (p.raw || p.tonal)),
    normieId: Number((p && p.sourceTokenId) || 0),
    sourceTokenId: Number((p && p.sourceTokenId) || 0),
    sourceContract: (p && p.sourceContract) || '',
    seed: p && p.seed,
    raw: p && p.raw,
    tonal: (p && p.tonal) || '',
    traits: (p && p.traits) || null,
    agentic: Boolean(p && p.agentic),
    agentId: p && p.agentId ? String(p.agentId) : '',
  });

  // Street view ONLY for a merged-street token (the merge contract injects
  // TOKEN.plots). A normal cube has no .plots and renders as a single cube.
  if (Array.isArray(TOKEN.plots) && TOKEN.plots.length) {
    const base = Number(TOKEN.plots[0].slot != null ? TOKEN.plots[0].slot : (TOKEN.street != null ? Number(TOKEN.street) * 8 : 0));
    // Any contiguous span (street=8, neighbourhood=64, region=512): one continuous scene.
    return { mode: 'street', base, plots: TOKEN.plots.map((p, k) => plotFrom(p, Number(p.slot != null ? p.slot : base + k))) };
  }

  // Non-Normie preview (Update Cube dev page only): an art URL to flatten into a
  // tonal cube. Requires deps.nonNormie (passed by the dev preview entry); the
  // production bundle never sees TOKEN.artUrl, so it stays network-free.
  if (TOKEN.artUrl) {
    const motifIdx = Number(TOKEN.slot || 0);
    return {
      mode: 'cube',
      base: motifIdx,
      plots: [{
        motifIdx,
        occupied: true,
        nonNormie: true,
        artUrl: String(TOKEN.artUrl),
        seed: TOKEN.seed,
        sourceTokenId: Number(TOKEN.sourceTokenId || 0),
        sourceContract: TOKEN.sourceContract || '',
        normieId: 0,
        raw: null,
        traits: null,
        agentic: false,
        agentId: '',
      }],
    };
  }

  const motifIdx = Number(TOKEN.slot || 0);
  return { mode: 'cube', base: motifIdx, plots: [plotFrom(TOKEN, motifIdx)] };
}

function unionAABB(hilbert, motifs) {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const m of motifs) {
    const b = cubeAABB(hilbert, m);
    for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], b.mn[i]); mx[i] = Math.max(mx[i], b.mx[i]); }
  }
  return { mn, mx };
}

// The banded Hilbert spine + recolour helpers now live in the shared viewer module
// (viewer/rainbow-spine.js) so the Big Cube viewer uses the same RGB spine.

// Biomes read too hot in the cinematic hero — knock their glow back.
function _dimBiome(items) { if (TOKEN.cinematic) applyDim(items, 0.5); return items; }

export async function main(deps = {}) {
  // Non-Normie rendering is injected by the dev preview entry only, so the
  // production bundle imports no network code and stays forbiddenPatterns-clean.
  const nonNormie = deps.nonNormie || null;
  const canvas = document.getElementById('c');
  const label = document.getElementById('h');
  const fpsEl = typeof document !== 'undefined' ? document.getElementById('fps') : null;
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) {
    label.textContent = 'WebGL 2 unavailable';
    return;
  }

  const scene = readPlots();
  const occupied = scene.plots.filter(p => p.occupied);

  // One nft per occupied plot (resolved by motif). Normie plots hydrate raw bytes;
  // a non-Normie preview plot flattens its art URL into the cached grid (dev only).
  const nftByMotif = new Map();
  const tonalGridByMotif = new Map();
  for (const p of occupied) {
    if (p.tonal) {
      // Network-free non-Normie: build the grid straight from the embedded 2-bit
      // tonal payload (no fetch/flatten) and render band contours + voxels like the
      // dev path. This is what makes the on-chain animation match the thumbnail.
      const grid = gridFromTonal(p.tonal);
      if (grid) {
        tonalGridByMotif.set(p.motifIdx, grid);
        nftByMotif.set(p.motifIdx, {
          isNormie: false,
          contract: p.sourceContract || '',
          tokenId: String(p.sourceTokenId || 0),
          agentic: p.agentic,
          agentId: p.agentId,
        });
        continue;
      }
    }
    if (p.nonNormie && nonNormie) {
      const nft = {
        isNormie: false,
        contract: p.sourceContract || 'preview',
        tokenId: String(p.sourceTokenId),
        chain: 'preview',
        name: 'preview',
        imageUrl: p.artUrl,
        agentic: false,
        agentId: '',
      };
      nftByMotif.set(p.motifIdx, nft);
      await nonNormie.prepareGrid(nft); // flatten + cache (dev preview only)
    } else {
      nftByMotif.set(p.motifIdx, { isNormie: true, normieId: p.normieId, contract: p.sourceContract, agentic: p.agentic, agentId: p.agentId });
      hydrateNormieRawBytes({ id: p.normieId, raw: rawBytesFromBase64(p.raw), traits: p.traits, agentic: p.agentic, agentId: p.agentId });
    }
  }
  setCubeAssignmentResolver(idx => nftByMotif.get(Number(idx)) || null);
  // Non-Normie art plane resolvers: tonal-derived grid (production, network-free)
  // first, else the dev wallet accessors (injected via deps.nonNormie).
  setNonNormieResolvers({
    getAssignment: idx => nftByMotif.get(Number(idx)) || (nonNormie && nonNormie.getAssignment ? nonNormie.getAssignment(idx) : null),
    getGrid: idx => tonalGridByMotif.get(Number(idx)) || (nonNormie && nonNormie.getGrid ? nonNormie.getGrid(idx) : null),
  });
  if (nonNormie) {
    globalThis.__PIPELINE_MINT_SOURCE_FOR_SLOT__ = idx => nftByMotif.get(Number(idx)) || null;
  }

  // Preload the banner font (baked @font-face in the head) BEFORE the one-shot
  // render, so ensureBannerFont() short-circuits to ready and the contract/traits
  // banners actually draw. Without this the async font load never gets a re-render.
  if (typeof document !== 'undefined' && document.fonts) {
    try { await document.fonts.load('64px NormiesFont'); } catch (e) { /* fall back to system */ }
  }

  const hilbert = generateHilbert3D(ORDER);
  assignPlaneProperties(hilbert, new Random('0x' + '12345678'.repeat(8)));
  // Per-cube edge points (sidePlan) keyed on each plot's on-chain seed, so the
  // 3D cubes' owned edge points match their 2D thumbnails.
  for (const p of occupied) {
    if (p.seed) assignMotifEdgePoints(hilbert.planes.slice(p.motifIdx * 3, p.motifIdx * 3 + 3), p.seed);
  }
  buildPlaneEdges(hilbert);
  const blocks = buildBlocks(hilbert);
  const serializedPlanes = serializeAllPlaced(hilbert, hilbert.planes, blocks)
    .filter(p => p.type !== 'boundary');
  const planesByMotif = new Map();
  for (const plane of serializedPlanes) {
    const idx = plane.hierarchy?.motifIndex;
    if (idx === null || idx === undefined) continue;
    if (!planesByMotif.has(idx)) planesByMotif.set(idx, []);
    planesByMotif.get(idx).push(plane);
  }
  const planesForMotif = idx => planesByMotif.get(idx) || [];

  initNormiesManager(gl, serializedPlanes);
  const materials = makeMaterials(gl);
  const meshes = {
    wireBox: createMeshGL(gl, createWireframeBox(1, 1, 1)),
    solidBox: createMeshGL(gl, createBox(1, 1, 1)),
  };
  const envTex = makePlaceholderTexture(gl, [8, 8, 10, 255]);

  // Build a plot: occupied -> full cube detail; vacant -> biome.
  const buildPlotItems = (p, hilbertLines = false) => p.occupied
    ? buildCubeDetailScene({
        motifIdx: p.motifIdx, hilbert, serializedPlanes, planesForMotif, gl, meshes,
        cubeCtx: { motifIdx: p.motifIdx, focused: true },
        showCubeGlass: false, showEdgePoints: true, showStoneWalker: true, showVoxels: true,
        showHilbertLines: hilbertLines || scene.mode === 'cube', showCardioid: true, showForest: true,
        showNonNormieArtwork: true, showNormieOutline: true, showNormieIdLabel: true,
        showNormieTraitsBanner: scene.mode === 'cube' && !p.nonNormie, showPlaneOutline: false,
        buildEdgePointDebug,
        buildNonNormieArtworkPlane: nonNormie?.buildArtworkPlane || null,
        buildNonNormieWalker: nonNormie?.buildWalker || null,
        buildNonNormieBanner: nonNormie?.buildBanner || null,
        buildNonNormieIdLabel: nonNormie?.buildIdLabel || null,
        isAgenticNonNormieCube: () => false,
        categoryForMotif: () => p.agentic ? 3 : 1,
      })
    : _dimBiome(buildEmptySlotItems(p.motifIdx, planesForMotif(p.motifIdx), cubeAABB(hilbert, p.motifIdx), gl, meshes));

  // Build the FOCUS cube first — its items alone are the cheap static-fallback scene —
  // then the rest of the span. Time it: a slow build signals a weak device => fallback.
  const buildStart = performance.now();
  const items = [];
  const spineItems = [];    // rainbow Hilbert spine — dimmed when the camera is up close
  const revealedSlots = []; // {items, grid, applied} per built slot — graded per frame by (shell from the CURRENT focus) × zoom
  const gridPos = (m) => { const b = cubeAABB(hilbert, m); return [b.mn[0] >> 1, b.mn[1] >> 1, b.mn[2] >> 1]; };
  const cheb = (a, c) => Math.max(Math.abs(a[0] - c[0]), Math.abs(a[1] - c[1]), Math.abs(a[2] - c[2]));
  const focusPlot = scene.plots.find(p => p.occupied) || scene.plots[0];
  const focusBuilt = buildPlotItems(focusPlot, true); // focus keeps its Hilbert lines → shown in lite fallback
  for (const it of focusBuilt) items.push(it);
  const focusItemCount = items.length;

  // SPIRAL mode: build ONLY the focus cube up front, then reveal its neighbours OUTWARD
  // over time (see frame()) so there's no multi-second freeze and never more than a
  // bounded number of live biomes on screen. Otherwise build the whole span up front.
  const spiral = scene.mode === 'street' && !!TOKEN.cinematic && !!TOKEN.spiral && !!(focusPlot && focusPlot.occupied);
  const buildQueue = [];  // plots pending incremental build, nearest-shell first
  if (spiral) {
    revealedSlots.push({ items: focusBuilt, grid: gridPos(focusPlot.motifIdx), applied: 1 });
    const cg = gridPos(focusPlot.motifIdx);
    const rest = scene.plots.filter(p => p !== focusPlot);
    for (const p of rest) p._shell = cheb(gridPos(p.motifIdx), cg);
    rest.sort((a, b) => a._shell - b._shell);
    const cap = Number(TOKEN.revealCap) || 620; // bound live detail for frame-rate
    for (const p of rest.slice(0, cap)) buildQueue.push(p);
  } else {
    for (const p of scene.plots) { if (p === focusPlot) continue; for (const it of buildPlotItems(p)) items.push(it); }
  }
  const buildMs = performance.now() - buildStart;
  const focusItems = items.slice(0, focusItemCount);

  // Street: one continuous Hilbert spine through all 8 plots, so the line
  // connects the cubes and runs across the vacant (biome) plots too.
  // Continuous Hilbert spine across the FULL span (region/world) — the real structure
  // the camera reveals when it pulls back past the detailed neighbourhood.
  const worldSpan = Number(TOKEN.worldSpan) || scene.plots.length;
  if (scene.mode === 'street') {
    // scene.base is the first PLOT's slot (e.g. 256 in a world-tour where the cubes are
    // spread across the Block). The spine spans `worldSpan` motifs, so clamp the start
    // into [0, totalMotifs - worldSpan]: a full-world spine must start at motif 0, not
    // 256 — otherwise it drops motifs 0..255 (half a corner region) and overruns the end.
    const totalMotifs = Math.floor(hilbert.rawVertices.length / 8);
    const spineBase = Math.max(0, Math.min(scene.base, totalMotifs - worldSpan));
    let spine;
    try {
      spine = buildRainbowSpine(hilbert, spineBase, worldSpan, gl, meshes); // banded → recolourable live
    } catch (e) {
      console.error('[spine] rainbow build failed, falling back to green:', e);
      spine = buildHilbertPathRange(hilbert, spineBase, worldSpan, gl, meshes);
    }
    for (const it of spine) { items.push(it); spineItems.push(it); }
    recolorSpineItems(spineItems, 'rgb'); // repeating R,G,B spine — the chosen aesthetic
  }

  // LOD tier A — world-filling impostor cloud: a biome-tinted glow dot per slot so
  // the whole Block reads as inhabited at range (not just the detailed foci). Faded
  // by camera distance each frame (see frame()) so it yields to the full cube/biome
  // detail as we dive in. Cinematic hero only for now.
  let cloudItems = [];
  if (scene.mode === 'street' && TOKEN.cinematic) {
    const totalMotifs = Math.floor(hilbert.rawVertices.length / 8);
    const occSet = new Set(scene.plots.filter(p => p.occupied).map(p => p.motifIdx));
    try {
      cloudItems = buildImpostorCloud(gl, hilbert, meshes, {
        motifStart: 0,
        motifCount: Math.min(worldSpan, totalMotifs),
        occupiedSlots: occSet,
      });
      for (const it of cloudItems) items.push(it);
    } catch (e) { console.error('[cloud] impostor build failed:', e); }
  }

  // Camera: street overview frames all 8 plots; focus frames one cube. 'V'
  // toggles street<->cube; arrows / 1-8 cycle the occupied cubes.
  const cubeView = (m) => { const b = cubeAABB(hilbert, m); return { target: centerOfAABB(b), dist: sizeOfAABB(b) * 2.35 }; };
  const overBox = unionAABB(hilbert, scene.plots.map(p => p.motifIdx));
  const overview = { target: centerOfAABB(overBox), dist: sizeOfAABB(overBox) * 1.7 };
  const focusable = occupied.map(p => p.motifIdx);

  // Spiral-reveal camera state: sits tight on the focus cube, then eases outward (zoom +
  // continuous orbit) in step with the incremental build, so the neighbourhood assembles
  // around you. Aim stays fixed on the focus centre.
  const spiralCentre = spiral ? cubeView(focusPlot.motifIdx) : null;
  // Full-Block apex: frame the whole world (+ cloud) at the top of the pull-back.
  const spiralWorld = spiral ? (() => {
    const n = Math.min(worldSpan, Math.floor(hilbert.rawVertices.length / 8));
    const b = unionAABB(hilbert, Array.from({ length: n }, (_, i) => i));
    return { target: centerOfAABB(b), dist: sizeOfAABB(b) * 1.75 * 1.6 };
  })() : null;
  const spiralDist0 = spiral ? spiralCentre.dist * 0.95 : 4;
  const spiralYaw0 = Math.PI * 0.22;
  // Loop: spiral OUT (cube → whole Block, reveal builds here) → HOLD on the Block →
  // spiral back IN to the NEXT tour cube → repeat.
  const S_OUT = 9.0, S_HOLD = 2.0, S_IN = 5.0, S_CYCLE = S_OUT + S_HOLD + S_IN;
  // Dive into a different cube each loop: spread occupied cubes near the centre (all with
  // built surroundings). Different motifs ⇒ different unique-axis plane colours (incl. reds).
  const spiralTourMotifs = spiral ? (() => {
    const cg = gridPos(focusPlot.motifIdx);
    const near = focusable.map(m => ({ m, sh: cheb(gridPos(m), cg) })).filter(c => c.sh <= 4).sort((a, b) => a.sh - b.sh);
    const N = Math.min(6, near.length) || 1;
    const pick = [];
    for (let i = 0; i < N; i++) pick.push(near[Math.floor(i * near.length / N)].m);
    pick[0] = focusPlot.motifIdx; // start on the centre
    return pick;
  })() : [];
  const spiralTour = spiralTourMotifs.map(m => cubeView(m));
  const spiralTourGrids = spiralTourMotifs.map(m => gridPos(m)); // grid pos of each tour cube, for focus-relative dimming

  const startView = scene.mode === 'cube' ? cubeView(focusable[0]) : overview;
  const orbit = createOrbit(canvas, startView.target, startView.dist);

  let viewMode = scene.mode === 'cube' ? 'cube' : 'street';
  let focusIdx = 0;
  function applyView() {
    if (viewMode === 'cube' && focusable.length) { const v = cubeView(focusable[focusIdx]); orbit.retarget(v.target, v.dist); }
    else orbit.retarget(overview.target, overview.dist);
  }
  if (scene.mode === 'street') {
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'v') { if (focusable.length) { viewMode = viewMode === 'street' ? 'cube' : 'street'; applyView(); } }
      else if (viewMode === 'cube' && (k === 'arrowright' || k === ' ')) { focusIdx = (focusIdx + 1) % focusable.length; applyView(); }
      else if (viewMode === 'cube' && k === 'arrowleft') { focusIdx = (focusIdx - 1 + focusable.length) % focusable.length; applyView(); }
      else if (/^[1-8]$/.test(k) && Number(k) <= focusable.length) { viewMode = 'cube'; focusIdx = Number(k) - 1; applyView(); }
    });
  }

  // Cinematic auto-flight (hero): one continuous parabolic motion that glides from a
  // close orbit of a real cube out to the whole Block and back into a cube on the far
  // side. Keyframes alternate cube <-> world; velocity is near-zero at each cube (so we
  // slow to a dwell + orbit) and maximal at the world apex (so the zoom never stops
  // mid-flight). Bypasses the manual orbit (drag still works when not cinematic).
  const cinematic = scene.mode === 'street' && !!TOKEN.cinematic && focusable.length > 0;
  const KF = [];   // {target, dist, isCube}
  if (cinematic && !spiral) {
    const groupView = (motifs) => { const b = unionAABB(hilbert, motifs); return { target: centerOfAABB(b), dist: sizeOfAABB(b) * 1.75 }; };
    const rangeView = (rbase, size) => { const m = []; for (let i = 0; i < size; i++) m.push(rbase + i); return groupView(m); };
    const world = rangeView(0, worldSpan);
    const cubeKf = (M) => { const v = cubeView(M); return { target: v.target, dist: v.dist * 1.15, isCube: true }; };
    // rangeView frames on the max-axis extent (×1.75), which crops the Block's diagonal
    // CORNERS — the extreme regions — out of the vertical FOV at world scale. Pull back
    // enough to fit the full half-diagonal (~2.3×E) plus margin so every region is in shot.
    const worldKf = () => ({ target: world.target, dist: world.dist * 1.6, isCube: false });
    const tour = [];
    if (worldSpan <= 64 || focusable.length < 2) tour.push(focusable[0]);
    else {
      const step = Math.max(1, Math.floor(focusable.length / 3));
      for (let i = 0; i < focusable.length && tour.length < 3; i += step) tour.push(focusable[i]);
    }
    tour.forEach((M) => { KF.push(cubeKf(M)); KF.push(worldKf()); });
    KF.push(cubeKf(tour[0])); // loop back into the first cube (seamless: last === first)
  }
  // Timeline: dwell + orbit at every keyframe (cube AND world), with a smooth glide-to-rest
  // zoom between them. Both endpoints are intentional pauses, so each leg eases in and out.
  const HOLD_CUBE = 3.8;  // long orbit close on a cube — sweeps the glass-voxel shimmer
  const HOLD_WORLD = 2.4; // linger on the whole Block before diving back in
  const TRANSIT = 3.2;    // seconds for a cube<->world zoom (unhurried)
  const cineEvents = [];
  for (let i = 0; i < KF.length - 1; i++) {
    cineEvents.push({ kind: 'hold', kf: i, dur: KF[i].isCube ? HOLD_CUBE : HOLD_WORLD });
    cineEvents.push({ kind: 'seg', a: i, b: i + 1, dur: TRANSIT, fromCube: KF[i].isCube });
  }
  const CINE_CYCLE = Math.max(1, cineEvents.reduce((s, e) => s + e.dur, 0));
  let camDist = 50; // last camera→target distance, for the impostor-cloud LOD fade
  function cineCam(aspect, t) {
    let tt = t % CINE_CYCLE, ev = cineEvents[0];
    for (const e of cineEvents) { if (tt < e.dur) { ev = e; break; } tt -= e.dur; }
    let A, B, f, fT;
    if (ev.kind === 'hold') { A = B = KF[ev.kf]; f = fT = 0; }
    else {
      A = KF[ev.a]; B = KF[ev.b];
      const x = tt / ev.dur;
      // Distance glides to rest at both ends (smootherstep) — smooth zoom, no snap.
      f = x * x * x * (x * (x * 6 - 15) + 10);
      // Aim (target) is DECOUPLED from zoom so that "wide shot" always means "centred on
      // the whole Block": leaving a cube it races to world-centre (ease-out), approaching a
      // cube it stays centred until the final dive (ease-in). This keeps every pulled-back
      // frame framing the full cube — no off-centre wide shot that crops a corner region.
      fT = ev.fromCube ? 1 - (1 - x) * (1 - x) : x * x;
    }
    const tg = new Float32Array([
      A.target[0] + (B.target[0] - A.target[0]) * fT,
      A.target[1] + (B.target[1] - A.target[1]) * fT,
      A.target[2] + (B.target[2] - A.target[2]) * fT,
    ]);
    const d = A.dist * Math.pow(B.dist / A.dist, f);
    camDist = d;
    const yaw = Math.PI * 0.22 + t * 0.19;
    const pitch = 0.17 + 0.09 * Math.sin(t * 0.22);
    const pos = new Float32Array([
      tg[0] + Math.sin(yaw) * Math.cos(pitch) * d,
      tg[1] + Math.sin(pitch) * d,
      tg[2] + Math.cos(yaw) * Math.cos(pitch) * d,
    ]);
    const view = mat4(), proj = mat4();
    lookAt(view, pos, tg, vec3(0, 1, 0));
    perspective(proj, Math.PI / 4.4, aspect, 0.03, 200);
    return { pos, view, proj };
  }

  // Spiral-reveal camera: fixed aim on the focus centre; distance eases cube→region over
  // SPIRAL_DUR while yaw orbits continuously and pitch lifts — a spiral pull-back that
  // keeps pace with the shells being built around it, then settles into a gentle orbit.
  function spiralCam(aspect, t) {
    const tt = t % S_CYCLE;
    const N = Math.max(1, spiralTour.length);
    const cyc = Math.floor(t / S_CYCLE);
    const A = (spiralTour[cyc % N] || spiralCentre).target;        // this loop's cube (orbit out)
    const B = (spiralTour[(cyc + 1) % N] || spiralCentre).target;  // next loop's cube (dive in)
    const w = spiralWorld.target;
    const dNear = spiralDist0, dFar = spiralWorld.dist;
    const lerp3 = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    let d, tgt;
    if (tt < S_OUT) {                         // spiral out: this cube → whole Block
      const u = tt / S_OUT, e = u * u * (3 - 2 * u);
      d = dNear * Math.pow(dFar / dNear, e); tgt = lerp3(A, w, e);
    } else if (tt < S_OUT + S_HOLD) {         // hold on the whole Block
      d = dFar; tgt = w;
    } else {                                  // spiral back in to the NEXT cube
      const u = (tt - S_OUT - S_HOLD) / S_IN, e = u * u * (3 - 2 * u);
      d = dFar * Math.pow(dNear / dFar, e); tgt = lerp3(w, B, e);
    }
    camDist = d;
    const zf = Math.min(1, Math.max(0, Math.log(d / dNear) / Math.log(dFar / dNear)));
    const yaw = spiralYaw0 + t * 0.30;        // continuous orbit across all phases
    const pitch = 0.10 + 0.30 * zf;           // lift when pulled back, low at the cube
    const pos = new Float32Array([
      tgt[0] + Math.sin(yaw) * Math.cos(pitch) * d,
      tgt[1] + Math.sin(pitch) * d,
      tgt[2] + Math.cos(yaw) * Math.cos(pitch) * d,
    ]);
    const view = mat4(), proj = mat4();
    lookAt(view, pos, new Float32Array(tgt), vec3(0, 1, 0));
    perspective(proj, Math.PI / 4.4, aspect, 0.03, 200);
    return { pos, view, proj };
  }
  // Per-slot brightness = SHELL × ZOOM. SHELL (baked at build): focus cube full, each ring
  // outward dimmer. ZOOM (dynamic per frame): everything scales down as the camera pulls
  // back, so the bloom roughly halves at the whole-Block view.
  const shellBright = (shell) => Math.max(0.28, 1.0 - shell * 0.19);
  // Dimmer when pulled back: floor lowered so the whole-Block view is calmer.
  const zoomDim = (dist) => { const u = Math.min(1, Math.max(0, (dist - 15) / 45)); return 1 - 0.65 * (u * u * (3 - 2 * u)); };
  // The rainbow spine reads as structure when far but drowns the focus cube up close, so
  // dim it right down when the camera is near and restore it as we pull back.
  const spineFade = (dist) => { const u = Math.min(1, Math.max(0, (dist - 8) / 32)); return 0.22 + 0.78 * (u * u * (3 - 2 * u)); };
  let appliedSpineDim = 1;

  const start = performance.now();
  // ---- perf gate: slow build OR sustained low FPS => static close-up fallback ----
  const BUILD_BUDGET_MS = 1400;  // building the span slower than this = weak device
  const FPS_MIN = 22;            // sustained FPS below this after warmup = fall back
  let fallback = cinematic && !TOKEN.noFallback && (buildMs > BUILD_BUDGET_MS || !!TOKEN.forceLite);
  let frames = 0, fpsLast = start, fps = 60, lowStreak = 0;
  // Reset the FPS window when the tab returns to foreground, so the throttled gap
  // while it was backgrounded isn't mistaken for a slow device.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { fpsLast = performance.now(); frames = 0; } });
  }
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function frame() {
    resize();
    const now = performance.now();
    const t = (now - start) * 0.001;
    frames++;
    const sampleMs = now - fpsLast;
    if (sampleMs >= 500) {
      // Only judge a "clean" sample — skip background-throttled gaps (tab blurred),
      // which read as fake low FPS and would wrongly drop to lite mode.
      if (sampleMs < 1500 && !(typeof document !== 'undefined' && document.hidden)) {
        fps = Math.round((frames * 1000) / sampleMs);
        if (cinematic && !fallback && !TOKEN.noFallback && t > 1.6) {
          if (fps < FPS_MIN) { lowStreak++; if (lowStreak >= 3) fallback = true; } else lowStreak = 0; // need ~1.5s sustained
        }
        if (fpsEl) {
          fpsEl.textContent = `${fps} FPS${fallback ? ' · LITE' : ''}`;
          fpsEl.style.color = fps >= 45 ? '#7CFFB2' : fps >= 25 ? '#ffd166' : '#ff6b6b';
          fpsEl.style.borderColor = fpsEl.style.color;
        }
      }
      frames = 0; fpsLast = now;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.002, 0.002, 0.004, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const aspect = canvas.width / Math.max(1, canvas.height);

    // Incremental reveal: build a few queued neighbour slots per frame (nearest shell
    // first) so the neighbourhood grows outward with no up-front freeze. Biomes are
    // dimmed by shell so the far rings stay quiet.
    if (spiral && buildQueue.length) {
      for (let n = 0; n < 4 && buildQueue.length; n++) {
        const p = buildQueue.shift();
        let built;
        try { built = buildPlotItems(p); } catch (e) { continue; } // one bad slot must not halt the reveal
        for (const it of built) items.push(it);
        revealedSlots.push({ items: built, grid: gridPos(p.motifIdx), applied: 1 });
      }
    }

    let cam, drawItems;
    if (fallback) {
      // Static-ish close-up: only the focus cube drawn (cheap), gentle idle spin.
      const fv = cubeView(focusPlot.motifIdx);
      const yaw = Math.PI * 0.22 + t * 0.12, pitch = 0.16, d = fv.dist * 1.05;
      const pos = new Float32Array([
        fv.target[0] + Math.sin(yaw) * Math.cos(pitch) * d,
        fv.target[1] + Math.sin(pitch) * d,
        fv.target[2] + Math.cos(yaw) * Math.cos(pitch) * d,
      ]);
      const view = mat4(), proj = mat4();
      lookAt(view, pos, new Float32Array(fv.target), vec3(0, 1, 0));
      perspective(proj, Math.PI / 4.4, aspect, 0.03, 200);
      cam = { pos, view, proj }; drawItems = focusItems;
    } else {
      cam = spiral ? spiralCam(aspect, t) : (cinematic ? cineCam(aspect, t) : orbit.camera(aspect)); drawItems = items;
      // Distance LOD: fade the impostor cloud up as the camera pulls back (structure at
      // a glance) and down as it dives into a cube (full detail takes over). smoothstep
      // over 10..46 world units — off at the cube dwell, full at region/world scale.
      if (cloudItems.length && cinematic) {
        const u = Math.min(1, Math.max(0, (camDist - 10) / 36));
        const fade = u * u * (3 - 2 * u);
        for (const it of cloudItems) it.uniforms.uOpacity = it._baseOpacity * fade;
      }
      // Focus-relative brightness: each slot = shell(from the CURRENT tour cube) × zoom.
      // So whichever cube we're on is full, its neighbours step down, and everything dims
      // as we pull back — the current cube is never the dim one. Applied per slot as a
      // delta (drift-free). spine dims separately when close so it can't drown the cube.
      if (spiral) {
        const N = Math.max(1, spiralTourGrids.length);
        const cyc = Math.floor(t / S_CYCLE), ph = t % S_CYCLE;
        // after the world hold we're diving to the NEXT cube, so grade around it
        const fg = spiralTourGrids[(ph < S_OUT + S_HOLD ? cyc : cyc + 1) % N] || spiralTourGrids[0];
        const zf = zoomDim(camDist);
        for (const s of revealedSlots) {
          const target = shellBright(cheb(s.grid, fg)) * zf;
          if (Math.abs(target - s.applied) > 0.004) { applyDim(s.items, target / s.applied); s.applied = target; }
        }
        const sf = spineFade(camDist);
        if (Math.abs(sf - appliedSpineDim) > 0.002) { applyDim(spineItems, sf / appliedSpineDim); appliedSpineDim = sf; }
      }
    }
    drawScene({ gl, items: drawItems, cam, materials, meshes, envTex, t });

    if (fallback) {
      label.textContent = `THE BLOCK  ·  cube · Normie #${occupied[0]?.normieId || ''}  ·  lite mode`;
    } else if (cinematic) {
      label.textContent = `THE BLOCK  ·  ${occupied.length} cubes + ${scene.plots.length - occupied.length} biomes  ·  ${scene.plots.length} plots  ·  ${fps} fps`;
    } else if (scene.mode === 'street') {
      const street = scene.base >> 3;
      label.textContent = viewMode === 'street'
        ? `Street #${street}  ·  ${occupied.length}/8 cubes  ·  press V for cube view`
        : `Street #${street}  ·  cube ${focusIdx + 1}/${focusable.length} (Normie #${nftByMotif.get(focusable[focusIdx])?.normieId})  ·  V street  ←→ cycle`;
    } else {
      label.textContent = `Cube #${TOKEN.tokenId} / Normie #${occupied[0]?.normieId} / plot ${scene.base}`;
    }
    requestAnimationFrame(frame);
  }
  frame();
}
