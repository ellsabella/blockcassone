// Blockcassone viewer — dev tool for previewing artwork.

import { mat4, identity, v3Normalize, vec3, multiply, invert } from '/renderer/src/math.js';
import { createBox, createWireframeBox, createMeshGL }         from '/renderer/src/geometry.js';
import { loadMaterial }                                        from '/renderer/src/materials.js';
import { faceOnCamera }                                        from './camera.js';
import { createOrbitCamera }                                   from './orbit-camera.js';
import { createLights, MAX_POINT_LIGHTS }                      from './lights.js';
import { buildForestPlane }                                    from './materials/forest.js';
import { buildEdgePointDebug }                                 from './materials/debug-edge-points.js';
import { buildCubeGlass }                                      from './cube-glass.js';
import { computeMirrorSlices }                                 from './internal-planes.js';
import {
  initNormiesManager, setDataReadyCallback, setBannerDataReadyCallback,
  build2DOutline, build3DVoxels, buildPlaneOutline, buildNormieIdLabel,
  buildNormieTraitsBanner, isNormieCube,
} from './normies-manager.js';
import { buildHilbertLines, buildFullHilbertPath } from './hilbert-lines.js';
import { buildCubeCardioid }  from './cube-cardioid.js';
import { buildStoneWalker }   from './materials/stone-walker.js';
import { buildNonNormieArtworkPlane, buildNonNormieWalker, buildNonNormieBanner } from './non-normie-art-plane.js';
import { isAgenticNonNormieCube, loadWalletNftsAcrossChains, setWalletDataReadyCallback } from './wallet-nfts.js';
import { serializeAllPlaced } from '/core/serialize.js';
import {
  isMintedSlot,
  loadMintSimulation,
  mintSimulationLoaded,
  resetMintSimulation,
  setMintDataReadyCallback,
  simulateMintBatch,
  sourceNftForSlot,
} from './mint-simulator.js';
import {
  applyDim, applyMotifStyle, applyBurnedDesaturation, grayscaleColor, applyBannerGlitch,
  applyAgenticAwakening, applyAgenticBannerPulse,
} from './scene/styling.js';
import {
  ensureMotifCategory, visibleMotifs, visiblePlanes, categoryCounts,
  motifPassesCategory,
} from './scene/filtering.js';
import { updateCategoryButtons, updateCubeTypeButtons } from './ui/buttons.js';
import { updateNftLabel, updateLightsLabel }            from './ui/labels.js';
import {
  updateWalletStatus, updateMintStatus, mintCountValue, setMintCountValue,
} from './ui/wallet-mint.js';

const canvas = document.getElementById('gl');
const logEl  = document.getElementById('log');
const nftLabelEl = document.getElementById('nft-label');

const logLines = [];
function log(msg) {
  console.log(msg);
  logLines.push(msg);
  while (logLines.length > 10) logLines.shift();
  if (logEl) logEl.textContent = logLines.join('\n');
}

// ---------- WebGL 2 ----------
const gl = canvas.getContext('webgl2', {
  alpha: false, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: false,
});
if (!gl) {
  document.body.innerHTML = '<pre style="color:#f66;padding:2em">WebGL 2 not available.</pre>';
  throw new Error('WebGL 2 unavailable');
}
log(`WebGL 2 — ${gl.getParameter(gl.RENDERER)}`);

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
  }
}
window.addEventListener('resize', resize);
resize();
window.addEventListener('resize', () => {
  if (cubeDetailWidthPx && window.innerWidth > 860) applyCubeDetailWidth(cubeDetailWidthPx);
});

// ---------- Blockcassone data layer ----------
// These come from globals defined by the /public/*.js script tags.
const R = new Random();
const hilbert = generateHilbert3D(3);
assignPlaneProperties(hilbert, R);
buildPlaneEdges(hilbert);
const blocks = buildBlocks(hilbert);

const allPlanes = hilbert.planes.concat(hilbert.boundaryPlanes);
const placer    = createPlacement(hilbert);

// Place every plane so we have a full cube set to navigate. In the existing
// dev viewer the user steps placement with the spacebar; here we just fill it.
while (placer.placeNext(R) !== null) {}
const placedPlanes = placer.getPlaced();

log(`hilbert order ${hilbert.order}, planes placed ${placedPlanes.length}/${allPlanes.length}`);

// Serialize all placed planes — gives a clean shape with .axis, .center,
// .hierarchy.motifIndex, etc.
const serializedPlanes = serializeAllPlaced(hilbert, placedPlanes, blocks)
  .filter(p => p.type !== 'boundary');
log(`serialized (non-boundary) planes: ${serializedPlanes.length}`);

// Pick the initial selection — first non-boundary plane, and the cube it belongs to.
let currentPlaneIdx = 0;
const currentPlane  = () => serializedPlanes[currentPlaneIdx];

// `uniqueMotifs` is populated after `materials/*` imports — declared above
// with `let` so the navigation code can close over it; init below.

function cubeVertsFor(motifIdx) {
  const base = motifIdx * 8;
  const v = [];
  for (let i = 0; i < 8; i++) v.push(hilbert.rawVertices[base + i]);
  return v;
}
function currentCubeVerts() {
  return cubeVertsFor(currentPlane().hierarchy.motifIndex);
}

function cubeAABBFor(motifIdx) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const v of cubeVertsFor(motifIdx)) {
    if (v.x < mn[0]) mn[0]=v.x; if (v.x > mx[0]) mx[0]=v.x;
    if (v.y < mn[1]) mn[1]=v.y; if (v.y > mx[1]) mx[1]=v.y;
    if (v.z < mn[2]) mn[2]=v.z; if (v.z > mx[2]) mx[2]=v.z;
  }
  return { mn, mx };
}

function rayAABBIntersect(ro, rd, mn, mx) {
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(rd[i]) < 1e-10) {
      if (ro[i] < mn[i] || ro[i] > mx[i]) return Infinity;
    } else {
      const t1 = (mn[i] - ro[i]) / rd[i];
      const t2 = (mx[i] - ro[i]) / rd[i];
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
    }
  }
  return (tmax >= Math.max(tmin, 0)) ? tmin : Infinity;
}

// ---------- Mode + navigation ----------
let mode = 'BIG';
let selectedMotifIdx = null;   // BIG mode: which cube is focused (null = none)
const lightsSelectedEl = document.getElementById('lights-selected');

const btn2D  = document.getElementById('mode-2d');
const btn3D  = document.getElementById('mode-3d');
const btnBig = document.getElementById('mode-big');

const _updateLightsLabel = () => updateLightsLabel(lightsSelectedEl, mode, selectedMotifIdx);

function activeMotifIdx() {
  if (mode === 'BIG' && selectedMotifIdx !== null && selectedMotifIdx !== undefined) return selectedMotifIdx;
  return currentPlane()?.hierarchy?.motifIndex ?? null;
}

const _updateNftLabel = () => updateNftLabel(nftLabelEl, activeMotifIdx());

function setMode(next) {
  if (mode === next) return;
  mode = next;
  btn2D.classList.toggle('active',  mode === '2D');
  btn3D.classList.toggle('active',  mode === '3D');
  btnBig.classList.toggle('active', mode === 'BIG');
  if (mode === 'BIG') {
    selectedMotifIdx = currentPlane().hierarchy.motifIndex;
    recentreOrbit();
  } else {
    recentreOrbit();
  }
  _updateLightsLabel();
  _updateNftLabel();
  if (typeof rebuildScene === 'function') rebuildScene();
}
btn2D.addEventListener('click',  () => setMode('2D'));
btn3D.addEventListener('click',  () => setMode('3D'));
btnBig.addEventListener('click', () => setMode('BIG'));

// Unique cube indices (ordered) for 3D-mode stepping.
const uniqueMotifs = [...new Set(serializedPlanes.map(p => p.hierarchy.motifIndex))]
  .sort((a, b) => a - b);
log(`unique cubes: ${uniqueMotifs.length}`);

// Dev category filter:
// 0 burned, 1 base, 2 edited, 3 awakened, 4 awakened+edited.
let categoryFilter = null;
let cubeTypeFilter = 'all';
const categoryControls = document.getElementById('category-controls');
const cubeTypeControls = document.getElementById('cube-type-controls');
const walletAddressInput = document.getElementById('wallet-address');
const walletLoadBtn = document.getElementById('wallet-load');
const walletStatusEl = document.getElementById('wallet-status');
const mintMinusBtn = document.getElementById('mint-minus');
const mintPlusBtn = document.getElementById('mint-plus');
const mintCountInput = document.getElementById('mint-count');
const mintRunBtn = document.getElementById('mint-run');
const mintResetBtn = document.getElementById('mint-reset');
const mintStatusEl = document.getElementById('mint-status');
const mintSuccessEl = document.getElementById('mint-success');
const mintSuccessTextEl = document.getElementById('mint-success-text');
const mintSuccessCloseBtn = document.getElementById('mint-success-close');
const cubeDetailEl = document.getElementById('cube-detail');
const cubeDetailResizeEl = document.getElementById('cube-detail-resize');
const cubeDetailTitleEl = document.getElementById('cube-detail-title');
const cubeDetailCloseBtn = document.getElementById('cube-detail-close');
let cubeDetailOpen = false;
let cubeDetailWidthPx = 0;

window.__PIPELINE_MINT_SOURCE_FOR_SLOT__ = sourceNftForSlot;

// filtering.js imports bring ensureMotifCategory, visibleMotifs, visiblePlanes,
// categoryCounts, motifPassesCategory into scope — thin wrappers close over local state.
const _visibleMotifs    = () => visibleMotifs(uniqueMotifs, categoryFilter, cubeTypeFilter);
const _visiblePlanes    = () => visiblePlanes(serializedPlanes, categoryFilter, cubeTypeFilter);
const _categoryCounts   = () => categoryCounts(uniqueMotifs, categoryFilter, cubeTypeFilter);
const _passesCategory   = (m) => motifPassesCategory(m, categoryFilter, cubeTypeFilter);

function jumpToFirstVisibleForFilter() {
  if (!mintSimulationLoaded()) return true;
  if (categoryFilter === null) return true;
  const planes = _visiblePlanes();
  if (planes.length === 0) return false;
  const curMotif = currentPlane().hierarchy.motifIndex;
  if (_passesCategory(curMotif)) return true;
  currentPlaneIdx = serializedPlanes.indexOf(planes[0]);
  return true;
}

const _updateCategoryButtons = () => updateCategoryButtons(categoryControls, categoryFilter);
const _updateCubeTypeButtons = () => updateCubeTypeButtons(cubeTypeControls, cubeTypeFilter);

function setCategoryFilter(next) {
  categoryFilter = next;
  for (const motifIdx of uniqueMotifs) ensureMotifCategory(motifIdx);
  selectedMotifIdx = null;
  const hasVisible = jumpToFirstVisibleForFilter();
  _updateCategoryButtons();
  _updateCubeTypeButtons();
  recentreOrbit();
  rebuildScene();
  const { counts, pending, normie, nonNormie } = _categoryCounts();
  const label = categoryFilter === null ? 'all' : `category ${categoryFilter}`;
  log(`filter: ${cubeTypeFilter}/${label} | normie=${normie} non=${nonNormie} | counts 0=${counts[0]} 1=${counts[1]} 2=${counts[2]} 3=${counts[3]} 4=${counts[4]} | pending=${pending}${hasVisible ? '' : ' | no known matches yet'}`);
}

if (categoryControls) {
  categoryControls.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-category]');
    if (!btn) return;
    setCategoryFilter(btn.dataset.category === 'all' ? null : Number(btn.dataset.category));
  });
}

function setCubeTypeFilter(next) {
  cubeTypeFilter = next;
  if (cubeTypeFilter !== 'normie' && categoryFilter !== null) categoryFilter = null;
  selectedMotifIdx = null;
  const hasVisible = jumpToFirstVisibleForFilter();
  _updateCategoryButtons();
  _updateCubeTypeButtons();
  recentreOrbit();
  rebuildScene();
  const { normie, nonNormie } = _categoryCounts();
  log(`cube type: ${cubeTypeFilter} | normie=${normie} non=${nonNormie}${hasVisible ? '' : ' | no matches'}`);
}

if (cubeTypeControls) {
  cubeTypeControls.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cube-type]');
    if (!btn) return;
    setCubeTypeFilter(btn.dataset.cubeType);
  });
}

const _updateWalletStatus = () => updateWalletStatus(walletStatusEl);
const _updateMintStatus   = () => updateMintStatus(mintStatusEl, uniqueMotifs);
const _mintCountValue     = () => mintCountValue(mintCountInput);
const _setMintCountValue  = (v) => setMintCountValue(mintCountInput, v);

async function resetMintAndScene() {
  clearGeneratedMeshes();
  await resetMintSimulation();
  cubeDetailOpen = false;
  if (cubeDetailEl) {
    cubeDetailEl.classList.remove('open');
    cubeDetailEl.setAttribute('aria-hidden', 'true');
  }
  selectedMotifIdx = null;
  currentPlaneIdx = 0;
  _updateMintStatus();
  _updateNftLabel();
  recentreOrbit();
  rebuildScene();
}

function openMintSuccess(count) {
  if (mintSuccessTextEl) mintSuccessTextEl.textContent = `You have minted ${count} ${count === 1 ? 'cube' : 'cubes'}.`;
  if (mintSuccessEl) {
    mintSuccessEl.classList.add('open');
    mintSuccessEl.setAttribute('aria-hidden', 'false');
  }
}

function closeMintSuccess() {
  if (mintSuccessEl) {
    mintSuccessEl.classList.remove('open');
    mintSuccessEl.setAttribute('aria-hidden', 'true');
  }
}

function clampCubeDetailWidth(width) {
  const max = Math.max(280, window.innerWidth - 48);
  return Math.max(300, Math.min(max, width));
}

function applyCubeDetailWidth(width) {
  if (!cubeDetailEl) return;
  cubeDetailWidthPx = clampCubeDetailWidth(width);
  cubeDetailEl.style.width = `${cubeDetailWidthPx}px`;
}

function openCubeDetail(motifIdx) {
  const idx = serializedPlanes.findIndex(p => p.hierarchy.motifIndex === motifIdx);
  if (idx >= 0) currentPlaneIdx = idx;
  selectedMotifIdx = motifIdx;
  cubeDetailOpen = true;
  if (cubeDetailTitleEl) cubeDetailTitleEl.textContent = `Cube ${motifIdx}`;
  if (cubeDetailEl) {
    if (!cubeDetailWidthPx && window.innerWidth > 860) {
      const initial = Math.min(520, Math.max(360, window.innerWidth * 0.34));
      applyCubeDetailWidth(initial);
    }
    cubeDetailEl.classList.add('open');
    cubeDetailEl.setAttribute('aria-hidden', 'false');
  }
  recentreDetailOrbit();
  recentreOrbit();
  _updateNftLabel();
  rebuildScene();
}

function closeCubeDetail() {
  if (cubeDetailEl) {
    cubeDetailEl.classList.remove('open');
    cubeDetailEl.setAttribute('aria-hidden', 'true');
  }
  cubeDetailOpen = false;
  rebuildScene();
}

if (mintSuccessCloseBtn) mintSuccessCloseBtn.addEventListener('click', closeMintSuccess);
if (mintSuccessEl) mintSuccessEl.addEventListener('click', e => { if (e.target === mintSuccessEl) closeMintSuccess(); });
if (cubeDetailCloseBtn) cubeDetailCloseBtn.addEventListener('click', closeCubeDetail);
if (cubeDetailResizeEl && cubeDetailEl) {
  cubeDetailResizeEl.addEventListener('pointerdown', (e) => {
    if (window.innerWidth <= 860) return;
    e.preventDefault();
    cubeDetailResizeEl.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing-cube-detail');
  });
  cubeDetailResizeEl.addEventListener('pointermove', (e) => {
    if (!cubeDetailResizeEl.hasPointerCapture(e.pointerId)) return;
    const right = window.innerWidth - 12;
    applyCubeDetailWidth(right - e.clientX);
  });
  cubeDetailResizeEl.addEventListener('pointerup', (e) => {
    if (cubeDetailResizeEl.hasPointerCapture(e.pointerId)) cubeDetailResizeEl.releasePointerCapture(e.pointerId);
    document.body.classList.remove('resizing-cube-detail');
  });
  cubeDetailResizeEl.addEventListener('pointercancel', (e) => {
    if (cubeDetailResizeEl.hasPointerCapture(e.pointerId)) cubeDetailResizeEl.releasePointerCapture(e.pointerId);
    document.body.classList.remove('resizing-cube-detail');
  });
}

async function runMintSimulation() {
  if (mintRunBtn) mintRunBtn.disabled = true;
  try {
    const minted = await simulateMintBatch(_mintCountValue(), uniqueMotifs);
    clearGeneratedMeshes();
    if (minted.length > 0) {
      const first = minted[0].slot;
      const idx = serializedPlanes.findIndex(p => p.hierarchy.motifIndex === first);
      if (idx >= 0) currentPlaneIdx = idx;
      if (mode === 'BIG') selectedMotifIdx = first;
      log(`minted ${minted.length}: ${minted.map(c => `${c.sourceKind}@slot${c.slot}`).join(', ')}`);
      openMintSuccess(minted.length);
    } else {
      log('mint simulation: no eligible NFTs or no empty slots');
    }
    _updateMintStatus();
    _updateNftLabel();
    recentreOrbit();
    rebuildScene();
  } catch (err) {
    log(`mint failed: ${String(err?.message || err)}`);
  } finally {
    if (mintRunBtn) mintRunBtn.disabled = false;
  }
}

if (mintMinusBtn) mintMinusBtn.addEventListener('click', () => _setMintCountValue(_mintCountValue() - 1));
if (mintPlusBtn) mintPlusBtn.addEventListener('click', () => _setMintCountValue(_mintCountValue() + 1));
if (mintCountInput) mintCountInput.addEventListener('change', () => _setMintCountValue(_mintCountValue()));
if (mintRunBtn) mintRunBtn.addEventListener('click', runMintSimulation);
if (mintResetBtn) mintResetBtn.addEventListener('click', () => {
  resetMintAndScene().catch(err => log(`reset failed: ${String(err?.message || err)}`));
});

async function loadWalletFromInput() {
  const address = walletAddressInput?.value?.trim();
  if (!address) return;
  if (walletLoadBtn) walletLoadBtn.disabled = true;
  try {
    const state = await loadWalletNftsAcrossChains(address);
    const chainNote = state.chains?.join('+') || state.chain || 'unknown';
    const failed = Object.keys(state.chainErrors || {});
    log(`wallet loaded ${state.nfts.length} NFTs on ${chainNote} | normies=${state.normies.length} non=${state.nonNormies.length}${failed.length ? ` | failed ${failed.join(',')}` : ''}`);
    clearGeneratedMeshes();
    cubeDetailOpen = false;
    if (cubeDetailEl) {
      cubeDetailEl.classList.remove('open');
      cubeDetailEl.setAttribute('aria-hidden', 'true');
    }
    selectedMotifIdx = null;
    currentPlaneIdx = 0;
    _updateMintStatus();
    _updateCategoryButtons();
    _updateCubeTypeButtons();
    rebuildScene();
  } catch (err) {
    log(`wallet load failed: ${String(err?.message || err)}`);
  } finally {
    if (walletLoadBtn) walletLoadBtn.disabled = false;
    _updateWalletStatus();
  }
}

if (walletLoadBtn) walletLoadBtn.addEventListener('click', loadWalletFromInput);
fetch('/dev-config')
  .then(r => r.ok ? r.json() : null)
  .then(cfg => {
    if (cfg?.defaultWallet && walletAddressInput) walletAddressInput.value = cfg.defaultWallet;
    if (!cfg?.openseaConfigured) log('OpenSea: add OPENSEA_API_KEY to .env to load wallet NFTs');
    _updateWalletStatus();
  })
  .catch(() => _updateWalletStatus());

function navigate(dir) {
  if (serializedPlanes.length === 0) return;
  if (mode === 'BIG') return;
  if (mode === '3D') {
    const cur = currentPlane().hierarchy.motifIndex;
    const motifs = _visibleMotifs();
    if (motifs.length === 0) { log('no minted cubes yet'); return; }
    const curIdx = motifs.indexOf(cur);
    const i = curIdx >= 0 ? curIdx : 0;
    const nextMotif = motifs[(i + dir + motifs.length) % motifs.length];
    currentPlaneIdx = serializedPlanes.findIndex(p => p.hierarchy.motifIndex === nextMotif);
  } else {
    const planes = _visiblePlanes();
    if (planes.length === 0) { log('no minted planes yet'); return; }
    const curIdx = planes.indexOf(currentPlane());
    const i = curIdx >= 0 ? curIdx : 0;
    currentPlaneIdx = serializedPlanes.indexOf(planes[(i + dir + planes.length) % planes.length]);
  }
  rebuildScene();
  const p = currentPlane();
  _updateNftLabel();
  log(`plane ${currentPlaneIdx} | cube ${p.hierarchy.motifIndex} | ${p.material} | ${p.axis}-axis`);
}

// Dynamically create prev/next buttons inside #controls so we don't touch the HTML twice.
const controls = document.getElementById('controls');
const btnPrev = document.createElement('button'); btnPrev.textContent = '← prev';
const btnNext = document.createElement('button'); btnNext.textContent = 'next →';
controls.appendChild(btnPrev); controls.appendChild(btnNext);
btnPrev.addEventListener('click', () => navigate(-1));
btnNext.addEventListener('click', () => navigate(+1));

// Debug toggles.
let showCubeGlass = false;
let showLightMarkers = false;
let showEdgePoints = false;
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft')  navigate(-1);
  if (e.key === 'ArrowRight') navigate(+1);
  if (e.key === '2')          setMode('2D');
  if (e.key === '3')          setMode('3D');
  if (e.key === 'b' || e.key === 'B') setMode('BIG');
  if (e.key === 'g' || e.key === 'G') { showCubeGlass      = !showCubeGlass;      rebuildScene(); log(`cube-glass overlay: ${showCubeGlass ? 'on' : 'off'}`); }
  if (e.key === 'l' || e.key === 'L') { showLightMarkers   = !showLightMarkers;   rebuildScene(); log(`light markers: ${showLightMarkers ? 'on' : 'off'}`); }
  if (e.key === 'e' || e.key === 'E') { showEdgePoints     = !showEdgePoints;     rebuildScene(); log(`edge points: ${showEdgePoints ? 'on' : 'off'}`); }
});

// ---------- Meshes ----------
const meshes = {
  wireBox:  createMeshGL(gl, createWireframeBox(1, 1, 1)),
  solidBox: createMeshGL(gl, createBox(1, 1, 1)),
};

function clearGeneratedMeshes() {
  for (const key of Object.keys(meshes)) {
    if (key !== 'wireBox' && key !== 'solidBox') delete meshes[key];
  }
}

// ---------- Materials ----------
const plantParticleMat = await loadMaterial(gl, {
  name: 'plant-particle',
  phase: 'ADDITIVE',
  vertPath: '/renderer/shaders/plant-particle.vert.glsl',
  fragPath: '/renderer/shaders/plant-particle.frag.glsl',
  uniforms: {},
});
const linesMat = await loadMaterial(gl, {
  name: 'lines',
  phase: 'ADDITIVE',
  vertPath: '/renderer/shaders/lines.vert.glsl',
  fragPath: '/renderer/shaders/lines.frag.glsl',
  uniforms: {},
});
const stoneGlassMat = await loadMaterial(gl, {
  name: 'stone-glass',
  phase: 'TRANSPARENT',
  vertPath: '/renderer/shaders/stone-glass.vert.glsl',
  fragPath: '/renderer/shaders/stone-glass.frag.glsl',
  uniforms: {},
});
const edgeGlowMat = await loadMaterial(gl, {
  name: 'edge-glow',
  phase: 'ADDITIVE',
  vertPath: '/renderer/shaders/edge-glow.vert.glsl',
  fragPath: '/renderer/shaders/edge-glow.frag.glsl',
  uniforms: {},
});
const normieVoxelMat = await loadMaterial(gl, {
  name: 'normie-voxel',
  phase: 'TRANSPARENT',
  vertPath: '/renderer/shaders/normie-voxel.vert.glsl',
  fragPath: '/renderer/shaders/normie-voxel.frag.glsl',
  uniforms: {},
});
const normieGlowMat = await loadMaterial(gl, {
  name: 'normie-glow',
  phase: 'TRANSPARENT',
  vertPath: '/renderer/shaders/normie-glow.vert.glsl',
  fragPath: '/renderer/shaders/normie-glow.frag.glsl',
  uniforms: {},
});
const featherGlassMat = await loadMaterial(gl, {
  name: 'feather-glass',
  phase: 'TRANSPARENT',
  vertPath: '/renderer/shaders/feather-glass.vert.glsl',
  fragPath: '/renderer/shaders/feather-glass.frag.glsl',
  uniforms: {},
});
const textBannerMat = await loadMaterial(gl, {
  name: 'text-banner',
  phase: 'ADDITIVE',
  vertPath: '/renderer/shaders/text-banner.vert.glsl',
  fragPath: '/renderer/shaders/text-banner.frag.glsl',
  uniforms: {},
});

// Env texture for the glass shader. Re-loadable at runtime via drag-and-drop
// (any image dropped onto the page becomes the new env). Layout is auto-
// detected from aspect ratio and can be cycled manually with the `e` key.
//
//   layout 0 — square / arbitrary aspect: replicate onto every cube face
//   layout 1 — horizontal cross 4:3      : proper cubemap sampling
let envTex   = gl.createTexture();   // re-used across reloads
let envLayout = 0;
gl.bindTexture(gl.TEXTURE_2D, envTex);
// 1×1 placeholder so the texture is complete before the first image arrives.
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
              new Uint8Array([0, 0, 0, 255]));
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE);

function uploadEnvImage(img) {
  gl.bindTexture(gl.TEXTURE_2D, envTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  // Auto-detect layout: 4:3 (within a tolerance) → cross, else square.
  const ratio = img.width / Math.max(1, img.height);
  envLayout = (ratio > 1.25 && ratio < 1.45) ? 1 : 0;
  log(`env loaded ${img.width}×${img.height} → layout: ${envLayout === 1 ? 'cross 4:3' : 'square (replicated)'}`);
}

function loadEnvFromUrl(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload  = () => uploadEnvImage(img);
  img.onerror = () => log(`env failed: ${url}`);
  img.src = url;
}

function loadEnvFromFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload  = () => { uploadEnvImage(img); URL.revokeObjectURL(url); };
  img.onerror = () => { log(`env file failed: ${file.name}`); URL.revokeObjectURL(url); };
  img.src = url;
}

loadEnvFromUrl('/viewer/assets/dancer_street.png');

// Drag-and-drop anywhere on the document. Any image becomes the new env.
window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) { log(`drop rejected: not an image (${file.type || '?'})`); return; }
  loadEnvFromFile(file);
});

// Manual layout cycle (in case auto-detect picks wrong).
window.addEventListener('keydown', (e) => {
  if (e.key === 'e' || e.key === 'E') {
    envLayout = (envLayout + 1) % 2;
    log(`env layout: ${envLayout === 1 ? 'cross 4:3' : 'square (replicated)'}`);
  }
});

initNormiesManager(gl, serializedPlanes);
const materialsMap = {
  'plant-particle': plantParticleMat,
  'lines':          linesMat,
  'stone-glass':    stoneGlassMat,
  'edge-glow':      edgeGlowMat,
  'normie-voxel':   normieVoxelMat,
  'normie-glow':    normieGlowMat,
  'feather-glass':  featherGlassMat,
  'text-banner':    textBannerMat,
};
log(`materials: ${Object.keys(materialsMap).join(', ')}`);

// Plane-material → scene-item builders. First matching builder wins.
const BUILDERS = [buildForestPlane];

// ---------- Orbit camera + debug lights ----------
function eventInCubeDetail(e) {
  if (!cubeDetailOpen || !cubeDetailEl) return false;
  const r = cubeDetailEl.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

const orbit = createOrbitCamera(canvas, {
  distance: 3.5,
  shouldHandleEvent: e => !eventInCubeDetail(e),
});
const detailOrbit = createOrbitCamera(canvas, {
  distance: 3.5,
  shouldHandleEvent: eventInCubeDetail,
});
const lights = createLights();

// Wire light-position sliders to the lights object.
// Each slider carries data-light (0-2) and data-axis (0=X, 1=Y, 2=Z).
{
  const lightPositions = [
    [ 0.7,  0.5,  0.7],
    [-0.7,  0.3,  0.5],
    [ 0.2,  0.9, -0.7],
  ];
  document.querySelectorAll('#lights-panel input[type=range]').forEach(slider => {
    const li   = parseInt(slider.dataset.light, 10);
    const ax   = parseInt(slider.dataset.axis,  10);
    const valEl = slider.parentElement.querySelector('.val');
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      lightPositions[li][ax] = v;
      if (valEl) valEl.textContent = v.toFixed(2);
      lights.setLight(li, lightPositions[li], null);
      rebuildScene();
    });
  });
}

// Recentre orbit target on the active cube. Called once at startup and
// after every navigate() (see hook below).
function recentreOrbit() {
  if (mode === 'BIG') {
    if (selectedMotifIdx !== null && selectedMotifIdx !== undefined) {
      const { mn, mx } = cubeAABBFor(selectedMotifIdx);
      orbit.setTarget((mn[0]+mx[0])*0.5, (mn[1]+mx[1])*0.5, (mn[2]+mx[2])*0.5);
      orbit.setDistance(Math.max(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]) * 5.8);
      return;
    }
    let mnX=Infinity, mnY=Infinity, mnZ=Infinity, mxX=-Infinity, mxY=-Infinity, mxZ=-Infinity;
    for (const v of hilbert.rawVertices) {
      if (v.x < mnX) mnX=v.x; if (v.x > mxX) mxX=v.x;
      if (v.y < mnY) mnY=v.y; if (v.y > mxY) mxY=v.y;
      if (v.z < mnZ) mnZ=v.z; if (v.z > mxZ) mxZ=v.z;
    }
    orbit.setTarget((mnX+mxX)*0.5, (mnY+mxY)*0.5, (mnZ+mxZ)*0.5);
    orbit.setDistance(Math.max(mxX-mnX, mxY-mnY, mxZ-mnZ) * 1.5);
    return;
  }
  const verts = currentCubeVerts();
  let mnX=Infinity, mnY=Infinity, mnZ=Infinity, mxX=-Infinity, mxY=-Infinity, mxZ=-Infinity;
  for (const v of verts) {
    if (v.x < mnX) mnX = v.x; if (v.x > mxX) mxX = v.x;
    if (v.y < mnY) mnY = v.y; if (v.y > mxY) mxY = v.y;
    if (v.z < mnZ) mnZ = v.z; if (v.z > mxZ) mxZ = v.z;
  }
  orbit.setTarget((mnX+mxX)*0.5, (mnY+mxY)*0.5, (mnZ+mxZ)*0.5);
}
recentreOrbit();

function recentreDetailOrbit() {
  if (selectedMotifIdx === null || selectedMotifIdx === undefined) return;
  const { mn, mx } = cubeAABBFor(selectedMotifIdx);
  detailOrbit.setTarget((mn[0]+mx[0])*0.5, (mn[1]+mx[1])*0.5, (mn[2]+mx[2])*0.5);
  detailOrbit.setDistance(Math.max(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]) * 2.25);
}

// Wrap navigate so target follows the active cube. The previously-installed
// click + key handlers call `navigate` by reference in the closure; we can't
// easily reassign that, so instead we install one extra listener that fires
// after each handler-driven keypress.
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') recentreOrbit();
});
btnPrev.addEventListener('click', recentreOrbit);
btnNext.addEventListener('click', recentreOrbit);

// ---------- BIG-mode cube pick (click, not drag) ----------
{
  let downX = 0, downY = 0;
  canvas.addEventListener('mousedown', (e) => { downX = e.clientX; downY = e.clientY; });
  canvas.addEventListener('mouseup', (e) => {
    if (mode !== 'BIG') return;
    if (eventInCubeDetail(e)) return;
    if (!lastInvVP || !lastCamPos) return;
    const dx = e.clientX - downX, dy = e.clientY - downY;
    if (dx*dx + dy*dy > 25) return;  // was a drag, not a click

    const rect = canvas.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
    const ny = ((e.clientY - rect.top)  / rect.height) * -2 + 1;

    function unproject(nz) {
      const cx = nx, cy = ny, cz = nz, cw = 1;
      const M = lastInvVP;
      const x = M[0]*cx + M[4]*cy + M[8]*cz  + M[12]*cw;
      const y = M[1]*cx + M[5]*cy + M[9]*cz  + M[13]*cw;
      const z = M[2]*cx + M[6]*cy + M[10]*cz + M[14]*cw;
      const w = M[3]*cx + M[7]*cy + M[11]*cz + M[15]*cw;
      return [x/w, y/w, z/w];
    }

    const near = unproject(-1);
    const far  = unproject( 1);
    const ro = lastCamPos;
    const rr = [far[0]-near[0], far[1]-near[1], far[2]-near[2]];
    const rl = Math.sqrt(rr[0]*rr[0]+rr[1]*rr[1]+rr[2]*rr[2]);
    const rd = [rr[0]/rl, rr[1]/rl, rr[2]/rl];

    let bestT = Infinity, hitMotif = null;
    for (const motifIdx of _visibleMotifs()) {
      const { mn, mx } = cubeAABBFor(motifIdx);
      const t = rayAABBIntersect(ro, rd, mn, mx);
      if (t < bestT) { bestT = t; hitMotif = motifIdx; }
    }

    if (hitMotif !== null && bestT < Infinity) {
      openCubeDetail(hitMotif);
      return;
    } else {
      selectedMotifIdx = null;
    }
    _updateLightsLabel();
    rebuildScene();
  });
}

// ---------- Lighting (static for now) ----------
const lightDir = v3Normalize(vec3(), vec3(1.0, 2.0, 0.8));
const lightCol = new Float32Array([0.12, 0.11, 0.10]);
const grayLightCol = grayscaleColor(lightCol);
const awakenedLightPosBuf = new Float32Array(MAX_POINT_LIGHTS * 3);
const awakenedLightColBuf = new Float32Array(MAX_POINT_LIGHTS * 3);

function buildAwakenedLightBuffers(item, t, posOut, colOut) {
  posOut.fill(0);
  colOut.fill(0);
  const c = item.uniforms?.uCubeCenter;
  const hs = item.uniforms?.uCubeHalfSize || 1.0;
  const seed = c ? c[0] * 0.73 + c[1] * 1.91 + c[2] * 2.37 : 0.0;
  const count = Math.min(lights.count, MAX_POINT_LIGHTS);
  const tEff = t * (item.lightSpeedMult || 1.0);

  for (let i = 0; i < count; i++) {
    const phase = seed + i * 2.094;
    const speed = 0.45 + i * 0.17;
    const a = tEff * speed + phase;
    const b = tEff * (speed * 0.63 + 0.11) + phase * 1.7;
    const radius = 1.22 + i * 0.18;
    const wobble = 0.30 + i * 0.06;

    if (i % 3 === 0) {
      posOut[i*3+0] = Math.cos(a) * radius;
      posOut[i*3+1] = Math.sin(b) * wobble;
      posOut[i*3+2] = Math.sin(a) * radius;
    } else if (i % 3 === 1) {
      posOut[i*3+0] = Math.sin(b) * wobble;
      posOut[i*3+1] = Math.cos(a) * radius;
      posOut[i*3+2] = Math.sin(a) * radius;
    } else {
      posOut[i*3+0] = Math.cos(a) * radius;
      posOut[i*3+1] = Math.sin(a) * radius;
      posOut[i*3+2] = Math.sin(b) * wobble;
    }

    const pulse = 0.18 + 1.05 * Math.pow(0.5 + 0.5 * Math.sin(tEff * (1.25 + i * 0.31) + phase * 2.3), 2.0);
    colOut[i*3+0] = lights.colBuf[i*3+0] * pulse;
    colOut[i*3+1] = lights.colBuf[i*3+1] * pulse;
    colOut[i*3+2] = lights.colBuf[i*3+2] * pulse;
  }

  // `hs` is intentionally read above so this function stays coupled to the
  // cube-relative light convention used by normie-voxel.frag.
  void hs;
}

// Scratch matrix for the wireframe cube's model transform. The wireframe
// mesh is a unit box (-0.5..+0.5). Scale + translate it to the actual cube
// AABB so it coincides with the real Hilbert cube — otherwise edge bits
// (computed from the real vertices) appear to float off the wireframe.
const _M = mat4();
function cubeModelMatrix() {
  const verts = currentCubeVerts();
  let minX =  Infinity, minY =  Infinity, minZ =  Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of verts) {
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
  }
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const sx = maxX - minX;
  const sy = maxY - minY;
  const sz = maxZ - minZ;
  // Column-major: M = T(c) · S(s). Applied to a unit box this gives exactly
  // the AABB [min..max].
  _M[0]  = sx; _M[1]  = 0;  _M[2]  = 0;  _M[3]  = 0;
  _M[4]  = 0;  _M[5]  = sy; _M[6]  = 0;  _M[7]  = 0;
  _M[8]  = 0;  _M[9]  = 0;  _M[10] = sz; _M[11] = 0;
  _M[12] = cx; _M[13] = cy; _M[14] = cz; _M[15] = 1;
  return _M;
}

// Length-aware uniform setter. For arrays longer than 4 we dispatch by
// name (convention: uEdgeActive is a float array, everything else vec3).
const FLOAT_ARRAY_NAMES = new Set([
  'uEdgeActive',
  'uBubRadius', 'uBubPhase', 'uBubSpeed', 'uBubTravel',
]);
function setUniformByName(gl, loc, name, value) {
  if (loc === null) return;
  if (typeof value === 'number') { gl.uniform1f(loc, value); return; }
  if (!(value instanceof Float32Array || Array.isArray(value))) return;
  const arr = value instanceof Float32Array ? value : new Float32Array(value);
  if (arr.length > 4) {
    if (FLOAT_ARRAY_NAMES.has(name)) gl.uniform1fv(loc, arr);
    else                             gl.uniform3fv(loc, arr);
    return;
  }
  if (arr.length === 2) gl.uniform2fv(loc, arr);
  else if (arr.length === 3) gl.uniform3fv(loc, arr);
  else if (arr.length === 4) gl.uniform4fv(loc, arr);
}

// ---------- Scene build ----------
let sceneItems = [];
let detailSceneItems = [];
let lastInvVP  = null;
let lastCamPos = null;

// applyDim, applyMotifStyle, applyBurnedDesaturation, grayscaleColor imported from scene/styling.js

function pushMotifItems(itemsOut, motifIdx, renderMode, dim) {
  const cat = ensureMotifCategory(motifIdx);
  const agenticNonNormie = isAgenticNonNormieCube(motifIdx);

  if (showCubeGlass && renderMode === '3D') {
    const glassItems = buildCubeGlass(motifIdx, hilbert, gl, meshes, renderMode);
    applyMotifStyle(glassItems, cat, motifIdx);
    if (agenticNonNormie) applyAgenticAwakening(glassItems);
    if (glassItems?.length) itemsOut.push(...glassItems);
  }

  const walkerItems = buildStoneWalker(motifIdx, hilbert, serializedPlanes, gl, meshes);
  applyMotifStyle(walkerItems, cat, motifIdx);
  if (agenticNonNormie) applyAgenticAwakening(walkerItems);
  applyDim(walkerItems, dim);
  if (walkerItems?.length) itemsOut.push(...walkerItems);

  const voxelItems = build3DVoxels(motifIdx, hilbert, serializedPlanes, gl, meshes);
  applyMotifStyle(voxelItems, cat, motifIdx);
  if (agenticNonNormie) applyAgenticAwakening(voxelItems);
  applyDim(voxelItems, dim);
  if (voxelItems?.length) itemsOut.push(...voxelItems);

  const hlItems = buildHilbertLines(motifIdx, hilbert, gl, meshes);
  applyMotifStyle(hlItems, cat, motifIdx);
  if (agenticNonNormie) applyAgenticAwakening(hlItems);
  applyDim(hlItems, dim);
  if (hlItems?.length) itemsOut.push(...hlItems);

  const cardItems = buildCubeCardioid(motifIdx, hilbert, serializedPlanes, gl, meshes);
  applyMotifStyle(cardItems, cat, motifIdx);
  if (agenticNonNormie) applyAgenticAwakening(cardItems);
  applyDim(cardItems, dim);
  if (cardItems?.length) itemsOut.push(...cardItems);
}

function pushPlaneItems(itemsOut, plane, renderMode, cubeCtx, dim) {
  const motifIdx = plane.hierarchy.motifIndex;
  const cat = ensureMotifCategory(motifIdx);
  const agenticNonNormie = isAgenticNonNormieCube(motifIdx);

  if (isNormieCube(motifIdx)) {
    for (const builder of BUILDERS) {
      const result = builder(plane, hilbert, gl, meshes, renderMode, cubeCtx);
      if (!result) continue;
      const items = Array.isArray(result) ? result : [result];
      applyMotifStyle(items, cat, motifIdx);
      applyDim(items, dim);
      itemsOut.push(...items);
      break;
    }
  } else {
    const artItems = buildNonNormieArtworkPlane(plane, serializedPlanes, gl, meshes);
    if (agenticNonNormie) applyAgenticAwakening(artItems);
    applyDim(artItems, dim);
    if (artItems?.length) itemsOut.push(...artItems);

    const nonNormieWalkerItems = buildNonNormieWalker(plane, serializedPlanes, gl, meshes);
    if (agenticNonNormie) applyAgenticAwakening(nonNormieWalkerItems);
    applyDim(nonNormieWalkerItems, dim);
    if (nonNormieWalkerItems?.length) itemsOut.push(...nonNormieWalkerItems);

    const bannerItems = buildNonNormieBanner(plane, serializedPlanes, gl, meshes);
    applyBannerGlitch(bannerItems, null);
    if (agenticNonNormie) applyAgenticBannerPulse(bannerItems);
    applyDim(bannerItems, dim);
    if (bannerItems?.length) itemsOut.push(...bannerItems);

    if (agenticNonNormie) {
      const forestItems = buildForestPlane(plane, hilbert, gl, meshes, renderMode, cubeCtx);
      const items = Array.isArray(forestItems) ? forestItems : (forestItems ? [forestItems] : []);
      applyAgenticAwakening(items);
      applyDim(items, dim);
      if (items.length) itemsOut.push(...items);
    }
  }

  const outlineItems = build2DOutline(plane, gl, meshes);
  applyMotifStyle(outlineItems, cat, motifIdx);
  applyDim(outlineItems, dim);
  if (outlineItems?.length) itemsOut.push(...outlineItems);

  if (isNormieCube(motifIdx)) {
    const idLabelItems = buildNormieIdLabel(plane, gl, meshes);
    applyMotifStyle(idLabelItems, cat, motifIdx);
    applyDim(idLabelItems, dim);
    if (idLabelItems?.length) itemsOut.push(...idLabelItems);

    const traitsBannerItems = buildNormieTraitsBanner(plane, hilbert, gl, meshes);
    applyMotifStyle(traitsBannerItems, cat, motifIdx);
    applyBannerGlitch(traitsBannerItems, cat);
    applyDim(traitsBannerItems, dim);
    if (traitsBannerItems?.length) itemsOut.push(...traitsBannerItems);
  }

  const hilbertEdgeItems = buildPlaneOutline(plane, gl, meshes);
  applyMotifStyle(hilbertEdgeItems, cat, motifIdx);
  applyDim(hilbertEdgeItems, dim);
  if (hilbertEdgeItems?.length) itemsOut.push(...hilbertEdgeItems);

  if (showEdgePoints) {
    const dbg = buildEdgePointDebug(plane, gl, meshes);
    const items = Array.isArray(dbg) ? dbg.filter(Boolean) : (dbg ? [dbg] : []);
    applyMotifStyle(items, cat, motifIdx);
    applyDim(items, dim);
    itemsOut.push(...items);
  }
}

function rebuildScene() {
  sceneItems = [];
  detailSceneItems = [];
  jumpToFirstVisibleForFilter();
  _updateNftLabel();
  const p0 = currentPlane();

  const motifsInFilter = _visibleMotifs();
  const motifsToRender = (mode === 'BIG')
    ? motifsInFilter
    : (mode === '2D' ? [] : (isMintedSlot(p0.hierarchy.motifIndex) ? [p0.hierarchy.motifIndex] : []));

  const hasMinted = mintSimulationLoaded();
  const planesToRender = !hasMinted
    ? []
    : (mode === '2D')
      ? (isMintedSlot(p0.hierarchy.motifIndex) ? [p0] : [])
      : (mode === '3D')
        ? (isMintedSlot(p0.hierarchy.motifIndex)
            ? serializedPlanes.filter(p => p.hierarchy.motifIndex === p0.hierarchy.motifIndex)
            : [])
        : serializedPlanes.filter(p => _passesCategory(p.hierarchy.motifIndex));

  // Precompute per-motif cubeCtx (mirror slices for forest builder).
  // Always include the current plane's motif so 2D mode forest has context.
  const cubeCtxMap = {};
  const motifsForCtx = new Set([...motifsToRender, p0.hierarchy.motifIndex]);
  if (selectedMotifIdx !== null && selectedMotifIdx !== undefined) motifsForCtx.add(selectedMotifIdx);
  for (const motifIdx of motifsForCtx) {
    cubeCtxMap[motifIdx] = {
      slicesByAxis: computeMirrorSlices(motifIdx, hilbert, serializedPlanes),
    };
  }
  // --- Per-cube items ---
  for (const motifIdx of motifsToRender) {
    const focusDim = (mode === 'BIG' && selectedMotifIdx !== null && motifIdx !== selectedMotifIdx)
      ? 0.15 : 1.0;
    pushMotifItems(sceneItems, motifIdx, mode, focusDim);
  }

  // Light markers — once in any non-2D mode, anchored to the active cube.
  if (mode !== '2D' && showLightMarkers) {
    const activeMotif = (mode === 'BIG') ? selectedMotifIdx
                      : p0.hierarchy.motifIndex;
    if (activeMotif !== null && activeMotif !== undefined) {
      const { mn, mx } = cubeAABBFor(activeMotif);
      const cc = new Float32Array([
        (mn[0]+mx[0])*0.5, (mn[1]+mx[1])*0.5, (mn[2]+mx[2])*0.5,
      ]);
      const hs = Math.max(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]) * 0.5;
      sceneItems.push(...lights.buildMarkerItems(gl, meshes, 0.04, cc, hs));
      if (ensureMotifCategory(activeMotif) === 0)
        applyBurnedDesaturation(sceneItems.slice(-lights.count));
    }
  }

  // Hilbert edges and random walks for the current cube in 2D mode
  // (per-cube loop skips 2D — add them here).
  if (mode === '2D') {
    const motifIdx2D = p0.hierarchy.motifIndex;
    const cat2D = ensureMotifCategory(motifIdx2D);
    const hlItems2D = buildHilbertLines(motifIdx2D, hilbert, gl, meshes);
    applyMotifStyle(hlItems2D, cat2D, motifIdx2D);
    sceneItems.push(...hlItems2D);
    const walkerItems2D = buildStoneWalker(motifIdx2D, hilbert, serializedPlanes, gl, meshes);
    applyMotifStyle(walkerItems2D, cat2D, motifIdx2D);
    if (walkerItems2D?.length) sceneItems.push(...walkerItems2D);
  }

  // Inter-cube Hilbert path connectors in BIG mode.
  if (mode === 'BIG' && categoryFilter === null) {
    sceneItems.push(...buildFullHilbertPath(hilbert, gl, meshes));
  }

  // Empty mint-state scaffold: show the bare Hilbert structure before any
  // source token has been placed into a slot.
  if (!hasMinted && mode !== '2D') {
    if (mode !== 'BIG' || categoryFilter !== null) sceneItems.push(...buildFullHilbertPath(hilbert, gl, meshes));
  }

  // --- Per-plane items ---
  for (const plane of planesToRender) {
    const motifIdx = plane.hierarchy.motifIndex;
    const focusDim = (mode === 'BIG' && selectedMotifIdx !== null && motifIdx !== selectedMotifIdx)
      ? 0.15 : 1.0;
    pushPlaneItems(sceneItems, plane, mode, cubeCtxMap[motifIdx], focusDim);
  }

  if (cubeDetailOpen && selectedMotifIdx !== null && selectedMotifIdx !== undefined && isMintedSlot(selectedMotifIdx)) {
    const cubeCtx = cubeCtxMap[selectedMotifIdx];
    pushMotifItems(detailSceneItems, selectedMotifIdx, '3D', 1.0);
    for (const plane of serializedPlanes.filter(p => p.hierarchy.motifIndex === selectedMotifIdx)) {
      pushPlaneItems(detailSceneItems, plane, '3D', cubeCtx, 1.0);
    }
  }

  const cnt = {};
  for (const it of sceneItems) cnt[it.material] = (cnt[it.material] || 0) + 1;
  log(`scene: ${sceneItems.length} items | ${Object.entries(cnt).map(([m, n]) => `${m}=${n}`).join(', ')}`);
}

// Trigger a scene rebuild when normie pixel data arrives so 3D voxel meshes
// get built once their pixel data is available.
setDataReadyCallback(() => rebuildScene());
setBannerDataReadyCallback(() => rebuildScene());
setWalletDataReadyCallback(() => { _updateWalletStatus(); _updateMintStatus(); rebuildScene(); });
setMintDataReadyCallback(() => { _updateMintStatus(); rebuildScene(); });

loadMintSimulation()
  .then(cubes => {
    if (cubes.length > 0) {
      const first = cubes[0].slot;
      selectedMotifIdx = first;
      const idx = serializedPlanes.findIndex(p => p.hierarchy.motifIndex === first);
      if (idx >= 0) currentPlaneIdx = idx;
      recentreOrbit();
      log(`loaded ${cubes.length} saved mints`);
    } else {
      selectedMotifIdx = uniqueMotifs[Math.floor(Math.random() * uniqueMotifs.length)] ?? null;
      recentreOrbit();
    }
    _updateMintStatus();
    _updateNftLabel();
    rebuildScene();
  })
  .catch(err => log(`saved mints unavailable: ${String(err?.message || err)}`));

// ---------- SSE hot-reload ----------
const sse = new EventSource('/shader-changes');
sse.onopen = () => log('hot-reload: connected');
sse.onerror = () => log('hot-reload: disconnected');
sse.onmessage = (e) => {
  try {
    const { file } = JSON.parse(e.data);
    log(`hot: ${file} (wiring in later phase)`);
  } catch (_) {}
};

// ---------- Render loop (placeholder — Phase B will add the cameras + passes) ----------
const startT = performance.now();

function drawScene(items, cam, t) {
  const camRight = new Float32Array([cam.view[0], cam.view[4], cam.view[8]]);
  const camUp = new Float32Array([cam.view[1], cam.view[5], cam.view[9]]);
  const opaqueItems = items.filter(it => !it.blend || it.blend === 'opaque');
  const alphaItems = items.filter(it => it.blend === 'alpha' && !it.transparentLayer);
  const alphaOverlayItems = items.filter(it => it.blend === 'alpha' && it.transparentLayer);
  const additiveItems = items.filter(it => it.blend === 'additive');

  function drawItems(drawList, blendMode) {
    if (blendMode === 'additive') {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);
    } else if (blendMode === 'alpha') {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
    } else {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
    }
    gl.enable(gl.DEPTH_TEST);

    let currentProg = null;
    let L = null;
    for (const item of drawList) {
      const mat = materialsMap[item.material];
      if (!mat) continue;

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
        if (L.uEnvLayout) gl.uniform1i(L.uEnvLayout, envLayout);
        if (L.uPointLightCount) gl.uniform1i(L.uPointLightCount, lights.count);
      }

      if (L.uM) gl.uniformMatrix4fv(L.uM, false, item.transform);
      const ptPosLoc = L.uPointLightPos || L['uPointLightPos[0]'];
      const ptColLoc = L.uPointLightCol || L['uPointLightCol[0]'];
      let pointPosBuf = lights.posBuf;
      let pointColBuf = item.desaturate ? lights.grayColBuf : lights.colBuf;
      if (item.awakenedLights) {
        buildAwakenedLightBuffers(item, t, awakenedLightPosBuf, awakenedLightColBuf);
        pointPosBuf = awakenedLightPosBuf;
        pointColBuf = awakenedLightColBuf;
      }
      const lightScale = item.lightIntensityScale ?? 1.0;
      if (L.uLightCol) {
        const baseLight = item.desaturate ? grayLightCol : lightCol;
        gl.uniform3f(L.uLightCol, baseLight[0] * lightScale, baseLight[1] * lightScale, baseLight[2] * lightScale);
      }
      if (ptPosLoc) gl.uniform3fv(ptPosLoc, pointPosBuf);
      if (ptColLoc) {
        if (lightScale === 1.0) {
          gl.uniform3fv(ptColLoc, pointColBuf);
        } else {
          const scaled = new Float32Array(pointColBuf.length);
          for (let i = 0; i < pointColBuf.length; i++) scaled[i] = pointColBuf[i] * lightScale;
          gl.uniform3fv(ptColLoc, scaled);
        }
      }
      for (const [name, value] of Object.entries(item.uniforms || {})) {
        setUniformByName(gl, L[name], name, value);
      }

      if (item.samplers) {
        let unit = 0;
        for (const [name, src] of Object.entries(item.samplers)) {
          const tex = (typeof src === 'function') ? src() : src;
          if (!tex || !L[name]) continue;
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1i(L[name], unit);
          unit++;
        }
      }

      const mesh = meshes[item.mesh];
      if (!mesh) continue;
      gl.bindVertexArray(mesh.vao);
      if (mesh.mode === 'INSTANCED') {
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, mesh.instanceCount);
      } else if (mesh.indexCount > 0) {
        gl.drawElements(mesh.mode, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
      } else {
        gl.drawArrays(mesh.mode, 0, mesh.vertexCount);
      }
    }
    gl.bindVertexArray(null);
  }

  drawItems(opaqueItems, 'opaque');
  drawItems(alphaItems, 'alpha');
  drawItems(alphaOverlayItems, 'alpha');
  drawItems(additiveItems, 'additive');
}

function frame() {
  resize();
  const t = (performance.now() - startT) * 0.001;
  if (mode !== '2D' && showLightMarkers) {
    const activeMotif = (mode === 'BIG') ? selectedMotifIdx : currentPlane().hierarchy.motifIndex;
    if (activeMotif !== null && activeMotif !== undefined && [3, 4].includes(ensureMotifCategory(activeMotif))) {
      const { mn, mx } = cubeAABBFor(activeMotif);
      const cc = new Float32Array([
        (mn[0]+mx[0])*0.5, (mn[1]+mx[1])*0.5, (mn[2]+mx[2])*0.5,
      ]);
      const hs = Math.max(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]) * 0.5;
      const markerItem = { uniforms: { uCubeCenter: cc, uCubeHalfSize: hs } };
      buildAwakenedLightBuffers(markerItem, t, awakenedLightPosBuf, awakenedLightColBuf);
      lights.buildMarkerItems(gl, meshes, 0.04, cc, hs, awakenedLightPosBuf, awakenedLightColBuf);
    }
  }

  gl.clearColor(0.02, 0.03, 0.05, 1.0);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.SCISSOR_TEST);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const aspect = canvas.width / Math.max(1, canvas.height);
  const mainCam = (mode === '2D')
    ? faceOnCamera(currentPlane(), aspect)
    : orbit.camera(aspect);

  const VP = mat4(); multiply(VP, mainCam.proj, mainCam.view);
  const invVP = mat4(); invert(invVP, VP);
  lastInvVP = invVP;
  lastCamPos = mainCam.pos;

  drawScene(sceneItems, mainCam, t);

  if (cubeDetailOpen && detailSceneItems.length > 0 && cubeDetailEl) {
    const rect = cubeDetailEl.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const dprX = canvas.width / Math.max(1, canvasRect.width);
    const dprY = canvas.height / Math.max(1, canvasRect.height);
    const x = Math.max(0, Math.floor((rect.left - canvasRect.left) * dprX));
    const y = Math.max(0, Math.floor((canvasRect.bottom - rect.bottom) * dprY));
    const w = Math.min(canvas.width - x, Math.floor(rect.width * dprX));
    const h = Math.min(canvas.height - y, Math.floor(rect.height * dprY));
    if (w > 8 && h > 8) {
      gl.enable(gl.SCISSOR_TEST);
      gl.viewport(x, y, w, h);
      gl.scissor(x, y, w, h);
      gl.clearColor(0.015, 0.016, 0.02, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      drawScene(detailSceneItems, detailOrbit.camera(w / Math.max(1, h)), t);
      gl.disable(gl.SCISSOR_TEST);
    }
  }

  gl.disable(gl.BLEND);
  gl.depthMask(true);
  gl.depthFunc(gl.LESS);

  requestAnimationFrame(frame);
}
log('entering render loop');
rebuildScene();  // Initial scene build before first frame
requestAnimationFrame(frame);
