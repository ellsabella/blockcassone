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
import { buildEmptySlotItems } from '../viewer/crystal-biome.js';
import { buildHilbertPathRange } from '../viewer/hilbert-lines.js';
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
    occupied: Boolean(p && p.raw),
    normieId: Number((p && p.sourceTokenId) || 0),
    seed: p && p.seed,
    raw: p && p.raw,
    traits: (p && p.traits) || null,
    agentic: Boolean(p && p.agentic),
    agentId: p && p.agentId ? String(p.agentId) : '',
  });

  // Street view ONLY for a merged-street token (the merge contract injects
  // TOKEN.plots). A normal cube has no .plots and renders as a single cube.
  if (Array.isArray(TOKEN.plots) && TOKEN.plots.length) {
    const base = (TOKEN.street != null ? Number(TOKEN.street) : Number(TOKEN.plots[0].slot || 0) >> 3) * 8;
    return { mode: 'street', base, plots: TOKEN.plots.slice(0, 8).map((p, k) => plotFrom(p, base + k)) };
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

export async function main(deps = {}) {
  // Non-Normie rendering is injected by the dev preview entry only, so the
  // production bundle imports no network code and stays forbiddenPatterns-clean.
  const nonNormie = deps.nonNormie || null;
  const canvas = document.getElementById('c');
  const label = document.getElementById('h');
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
  for (const p of occupied) {
    if (p.nonNormie && nonNormie) {
      const nft = {
        isNormie: false,
        contract: 'preview',
        tokenId: String(p.sourceTokenId),
        chain: 'preview',
        name: 'preview',
        imageUrl: p.artUrl,
        agentic: false,
        agentId: '',
      };
      nftByMotif.set(p.motifIdx, nft);
      await nonNormie.prepareGrid(nft); // flatten + cache (getNonNormieGridForCube reads it)
    } else {
      nftByMotif.set(p.motifIdx, { isNormie: true, normieId: p.normieId, agentic: p.agentic, agentId: p.agentId });
      hydrateNormieRawBytes({ id: p.normieId, raw: rawBytesFromBase64(p.raw), traits: p.traits, agentic: p.agentic, agentId: p.agentId });
    }
  }
  setCubeAssignmentResolver(idx => nftByMotif.get(Number(idx)) || null);
  if (nonNormie) {
    // The non-Normie grid lookup (getNonNormieGridForCube -> getWalletAssignmentForCube)
    // reads this global rather than the assignment resolver, so mirror it here or the
    // flattened grid is never found (no plane art / voxels).
    globalThis.__PIPELINE_MINT_SOURCE_FOR_SLOT__ = idx => nftByMotif.get(Number(idx)) || null;
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

  // Build every plot: occupied -> full cube detail; vacant -> biome placeholder.
  const items = [];
  for (const p of scene.plots) {
    const built = p.occupied
      ? buildCubeDetailScene({
          motifIdx: p.motifIdx,
          hilbert,
          serializedPlanes,
          planesForMotif,
          gl,
          meshes,
          cubeCtx: { motifIdx: p.motifIdx, focused: true },
          showCubeGlass: false,
          showEdgePoints: true,
          showStoneWalker: true,
          showVoxels: true,
          showHilbertLines: scene.mode === 'cube',
          showCardioid: true,
          showForest: true,
          showNonNormieArtwork: true,
          showNormieOutline: true,
          showNormieIdLabel: true,
          showNormieTraitsBanner: scene.mode === 'cube' && !p.nonNormie,
          showPlaneOutline: false,
          buildEdgePointDebug,
          buildNonNormieArtworkPlane: nonNormie?.buildArtworkPlane || null,
          buildNonNormieWalker: nonNormie?.buildWalker || null,
          buildNonNormieBanner: nonNormie?.buildBanner || null,
          isAgenticNonNormieCube: () => false,
          categoryForMotif: () => p.agentic ? 3 : 1,
        })
      : buildEmptySlotItems(p.motifIdx, planesForMotif(p.motifIdx), cubeAABB(hilbert, p.motifIdx), gl, meshes);
    for (const it of built) items.push(it);
  }

  // Street: one continuous Hilbert spine through all 8 plots, so the line
  // connects the cubes and runs across the vacant (biome) plots too.
  if (scene.mode === 'street') {
    for (const it of buildHilbertPathRange(hilbert, scene.base, 8, gl, meshes)) items.push(it);
  }

  // Camera: street overview frames all 8 plots; focus frames one cube. 'V'
  // toggles street<->cube; arrows / 1-8 cycle the occupied cubes.
  const cubeView = (m) => { const b = cubeAABB(hilbert, m); return { target: centerOfAABB(b), dist: sizeOfAABB(b) * 2.35 }; };
  const overBox = unionAABB(hilbert, scene.plots.map(p => p.motifIdx));
  const overview = { target: centerOfAABB(overBox), dist: sizeOfAABB(overBox) * 1.7 };
  const focusable = occupied.map(p => p.motifIdx);

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

  const start = performance.now();
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
    const t = (performance.now() - start) * 0.001;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.002, 0.002, 0.004, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const cam = orbit.camera(canvas.width / Math.max(1, canvas.height));
    drawScene({ gl, items, cam, materials, meshes, envTex, t });
    if (scene.mode === 'street') {
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
