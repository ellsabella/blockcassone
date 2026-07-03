// Blockcassone viewer — dev tool for previewing artwork.

import { mat4, identity, v3Normalize, vec3, multiply, invert } from '../renderer/src/math.js';
import { createBox, createWireframeBox, createMeshGL }         from '../renderer/src/geometry.js';
import { loadMaterial }                                        from '../renderer/src/materials.js';
import { faceOnCamera }                                        from './camera.js';
import { createOrbitCamera }                                   from './orbit-camera.js';
import { createLights, MAX_POINT_LIGHTS }                      from './lights.js';
import { buildEdgePointDebug }                                 from './materials/debug-edge-points.js';
import { computeMirrorSlices }                                 from './internal-planes.js';
import {
  initNormiesManager, setDataReadyCallback, setBannerDataReadyCallback,
} from './normies-manager.js';
import { buildHilbertLines, buildFullHilbertPath, buildHilbertPathRange } from './hilbert-lines.js';
import { buildCubeCardioid }  from './cube-cardioid.js';
import { buildStoneWalker }   from './materials/stone-walker.js';
import { buildNonNormieArtworkPlane, buildNonNormieWalker, buildNonNormieBanner } from './non-normie-art-plane.js';
import {
  getWalletState,
  isAgenticNonNormieCube,
  loadWalletNftsAcrossChains,
  setWalletDataReadyCallback,
} from './wallet-nfts.js';
import { serializeAllPlaced } from '/core/serialize.js';
import { assignCubeEdgePoints, assignMotifEdgePoints, placeholderSeed } from '/core/cube-edge-points.js';
import {
  getMintedCubeForSlot,
  getMintedCubes,
  isMintedSlot,
  loadMintSimulation,
  mintSimulationLoaded,
  resetMintSimulation,
  setMintDataReadyCallback,
  simulateMintBatch,
  sourceNftForSlot,
} from './mint-simulator.js';
import { mintNormieCubeOnChain } from './preview-chain.js';
import {
  applyDim, applyMotifStyle, applyBurnedDesaturation, grayscaleColor,
} from './scene/styling.js';
import { pushDetailMotifItems, pushDetailPlaneItems } from './detail-scene-builder.js';
import { buildEmptySlotItems, environmentNameForStreet } from './environments.js';
import {
  ensureMotifCategory, visibleMotifs, visiblePlanes, categoryCounts,
  motifPassesCategory,
} from './scene/filtering.js';
import { updateCategoryButtons, updateCubeTypeButtons } from './ui/buttons.js';
import { updateNftLabel, updateLightsLabel }            from './ui/labels.js';
import {
  updateWalletStatus, updateMintStatus, mintCountValue, setMintCountValue,
} from './ui/wallet-mint.js';
import { noteRebuild, noteFrame, formatSnapshot, resetMetrics, getSnapshot } from './perf-metrics.js';
// Console accessors: type `perf()` at the devtools console prompt to dump the
// current metrics, or `perfReset()` to zero the cumulative counters.
if (typeof window !== 'undefined') {
  window.perf = () => { const s = getSnapshot(); console.log(formatSnapshot(s)); return s; };
  window.perfReset = () => { resetMetrics(); return 'perf metrics reset'; };
}

const canvas = document.getElementById('gl');
const logEl  = document.getElementById('log');
const nftLabelEl = document.getElementById('nft-label');
const selectionLinkEl = document.getElementById('selection-link');
const selectionLinkPathEl = document.getElementById('selection-link-path');
const mapLinkPathEl = document.getElementById('map-link-path');
const worldMapEl = document.getElementById('world-map');
const worldMapLabelEl = document.getElementById('world-map-label');
const mainAxisEl = document.getElementById('main-axis');
const worldMapAxisEl = document.getElementById('world-map-axis');
const ownerInventoryEl = document.getElementById('owner-inventory');
const ownerInventoryTitleEl = document.getElementById('owner-inventory-title');
const ownerInventoryListEl = document.getElementById('owner-inventory-list');

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
const HILBERT_ORDER = 5;
const STREET_SIZE = 8;
const NEIGHBOURHOOD_SIZE = 64;
const REGION_SIZE = 512;

const R = new Random();
const hilbert = generateHilbert3D(HILBERT_ORDER);
assignPlaneProperties(hilbert, R);
// Overwrite the random edge patterns with the deterministic per-cube sidePlan
// (the JS twin of the on-chain _sidePlan). Preview/unminted slots use a
// placeholder seed; minted cubes get recomputed from their real on-chain seed
// when chain data resolves (see applyMintedCubeSeed).
assignCubeEdgePoints(hilbert, placeholderSeed);
buildPlaneEdges(hilbert);
const blocks = buildBlocks(hilbert);

const placedPlanes = hilbert.planes;
log(`hilbert order ${hilbert.order}, regular planes ${placedPlanes.length}`);

// Serialize all placed planes — gives a clean shape with .axis, .center,
// .hierarchy.motifIndex, etc.
const serializedPlanes = serializeAllPlaced(hilbert, placedPlanes, blocks)
  .filter(p => p.type !== 'boundary');
log(`serialized (non-boundary) planes: ${serializedPlanes.length}`);

const planesByMotif = new Map();
for (const plane of serializedPlanes) {
  const motifIdx = plane.hierarchy?.motifIndex;
  if (motifIdx === null || motifIdx === undefined) continue;
  if (!planesByMotif.has(motifIdx)) planesByMotif.set(motifIdx, []);
  planesByMotif.get(motifIdx).push(plane);
}

function planesForMotif(motifIdx) {
  return planesByMotif.get(motifIdx) || [];
}

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

function aabbForMotifs(motifIndices) {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const motifIdx of motifIndices) {
    const box = cubeAABBFor(motifIdx);
    for (let i = 0; i < 3; i++) {
      mn[i] = Math.min(mn[i], box.mn[i]);
      mx[i] = Math.max(mx[i], box.mx[i]);
    }
  }
  return { mn, mx };
}

function centerOfAABB(box) {
  return [
    (box.mn[0] + box.mx[0]) * 0.5,
    (box.mn[1] + box.mx[1]) * 0.5,
    (box.mn[2] + box.mx[2]) * 0.5,
  ];
}

function sizeOfAABB(box) {
  return Math.max(box.mx[0] - box.mn[0], box.mx[1] - box.mn[1], box.mx[2] - box.mn[2]);
}

function wireTransformForAABB(box, pad = 0.08) {
  const sx = (box.mx[0] - box.mn[0]) * (1 + pad);
  const sy = (box.mx[1] - box.mn[1]) * (1 + pad);
  const sz = (box.mx[2] - box.mn[2]) * (1 + pad);
  const cx = (box.mn[0] + box.mx[0]) * 0.5;
  const cy = (box.mn[1] + box.mx[1]) * 0.5;
  const cz = (box.mn[2] + box.mx[2]) * 0.5;
  const M = mat4();
  M[0] = sx; M[1] = 0;  M[2] = 0;  M[3] = 0;
  M[4] = 0;  M[5] = sy; M[6] = 0;  M[7] = 0;
  M[8] = 0;  M[9] = 0;  M[10] = sz; M[11] = 0;
  M[12] = cx; M[13] = cy; M[14] = cz; M[15] = 1;
  return M;
}

function buildAABBGridMesh(gl, box, divisions) {
  const xs = [box.mn[0], box.mx[0]];
  const ys = [box.mn[1], box.mx[1]];
  const zs = [box.mn[2], box.mx[2]];
  const positions = [];
  const alphas = [];
  const pushLine = (a, b, alpha = 1.0) => {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    alphas.push(alpha, alpha);
  };
  const pushFaceGrid = (axis, sideValue, div, alpha) => {
    for (let i = 1; i < div; i++) {
      const t = i / div;
      if (axis === 'x') {
        const y = box.mn[1] + (box.mx[1] - box.mn[1]) * t;
        const z = box.mn[2] + (box.mx[2] - box.mn[2]) * t;
        pushLine([sideValue, y, box.mn[2]], [sideValue, y, box.mx[2]], alpha);
        pushLine([sideValue, box.mn[1], z], [sideValue, box.mx[1], z], alpha);
      } else if (axis === 'y') {
        const x = box.mn[0] + (box.mx[0] - box.mn[0]) * t;
        const z = box.mn[2] + (box.mx[2] - box.mn[2]) * t;
        pushLine([x, sideValue, box.mn[2]], [x, sideValue, box.mx[2]], alpha);
        pushLine([box.mn[0], sideValue, z], [box.mx[0], sideValue, z], alpha);
      } else {
        const x = box.mn[0] + (box.mx[0] - box.mn[0]) * t;
        const y = box.mn[1] + (box.mx[1] - box.mn[1]) * t;
        pushLine([x, box.mn[1], sideValue], [x, box.mx[1], sideValue], alpha);
        pushLine([box.mn[0], y, sideValue], [box.mx[0], y, sideValue], alpha);
      }
    }
  };

  for (const [div, alpha] of divisions) {
    for (const x of xs) pushFaceGrid('x', x, div, alpha);
    for (const y of ys) pushFaceGrid('y', y, div, alpha);
    for (const z of zs) pushFaceGrid('z', z, div, alpha);
  }

  return createMeshGL(gl, {
    positions: new Float32Array(positions),
    alphas: new Float32Array(alphas),
    mode: 'LINES',
  });
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
let mainViewScope = 'region';
let selectedMotifIdx = null;   // BIG mode: which cube is focused (null = none)
let selectedStreetIdx = null;
let selectedNeighbourhoodIdx = null;
let selectedRegionIdx = null;
let ownerFocusEnabled = false;
let ownerFocusAddress = '';
let ownerFocusLabelVersion = 0;
let ownerFocusMotifCache = new Set();
const lightsSelectedEl = document.getElementById('lights-selected');

const btnScopeStreet = document.getElementById('scope-street');
const btnScopeNeighbourhood = document.getElementById('scope-neighbourhood');
const btnScopeRegion = document.getElementById('scope-region');
const ownerFocusToggleBtn = document.getElementById('owner-focus-toggle');
const ownerFocusLabelEl = document.getElementById('owner-focus-label');
const btnNavUp = document.getElementById('nav-up');
const btnNavDown = document.getElementById('nav-down');
const btnNavLeft = document.getElementById('nav-left');
const btnNavRight = document.getElementById('nav-right');
const btnNavZNeg = document.getElementById('nav-z-neg');
const btnNavZPos = document.getElementById('nav-z-pos');

const _updateLightsLabel = () => updateLightsLabel(lightsSelectedEl, mode, selectedMotifIdx);

function activeMotifIdx() {
  if (mode === 'BIG' && selectedMotifIdx !== null && selectedMotifIdx !== undefined) return selectedMotifIdx;
  return currentPlane()?.hierarchy?.motifIndex ?? null;
}

const _updateNftLabel = () => updateNftLabel(nftLabelEl, activeMotifIdx());

function setMode(next) {
  if (mode === next) return;
  mode = next;
  if (mode === 'BIG') {
    selectedMotifIdx = currentPlane().hierarchy.motifIndex;
    selectedStreetIdx = null;
    selectedNeighbourhoodIdx = null;
    selectedRegionIdx = null;
    recentreOrbit();
  } else {
    recentreOrbit();
  }
  _updateLightsLabel();
  _updateNftLabel();
  if (typeof rebuildScene === 'function') rebuildScene();
}

function updateScopeButtons() {
  if (btnScopeStreet) btnScopeStreet.classList.toggle('active', mainViewScope === 'street');
  if (btnScopeNeighbourhood) btnScopeNeighbourhood.classList.toggle('active', mainViewScope === 'neighbourhood');
  if (btnScopeRegion) btnScopeRegion.classList.toggle('active', mainViewScope === 'region');
  updateWorldMapLabel();
}

function scopeDisplayName(scope) {
  if (scope === 'street') return 'Street';
  if (scope === 'neighbourhood') return 'Neighbourhood';
  return 'Region';
}

function selectionRangeLabel() {
  if (selectedRegionIdx !== null && selectedRegionIdx !== undefined) {
    const plotStart = selectedRegionIdx * REGION_SIZE;
    const plotEnd = plotStart + REGION_SIZE - 1;
    const nStart = Math.floor(plotStart / NEIGHBOURHOOD_SIZE);
    const nEnd = Math.floor(plotEnd / NEIGHBOURHOOD_SIZE);
    return `Region ${selectedRegionIdx} | neighbourhoods ${nStart}-${nEnd} | cubes ${plotStart}-${plotEnd}`;
  }
  if (selectedNeighbourhoodIdx !== null && selectedNeighbourhoodIdx !== undefined) {
    const plotStart = selectedNeighbourhoodIdx * NEIGHBOURHOOD_SIZE;
    const plotEnd = plotStart + NEIGHBOURHOOD_SIZE - 1;
    const sStart = Math.floor(plotStart / STREET_SIZE);
    const sEnd = Math.floor(plotEnd / STREET_SIZE);
    return `Neighbourhood ${selectedNeighbourhoodIdx} | streets ${sStart}-${sEnd} | cubes ${plotStart}-${plotEnd}`;
  }
  if (selectedStreetIdx !== null && selectedStreetIdx !== undefined) {
    const plotStart = selectedStreetIdx * STREET_SIZE;
    const plotEnd = plotStart + STREET_SIZE - 1;
    return `Street ${selectedStreetIdx} | cubes ${plotStart}-${plotEnd}`;
  }
  if (selectedMotifIdx !== null && selectedMotifIdx !== undefined) {
    if (mainViewScope === 'region') {
      const region = regionIndexForMotif(selectedMotifIdx);
      const plotStart = region * REGION_SIZE;
      const plotEnd = plotStart + REGION_SIZE - 1;
      const nStart = Math.floor(plotStart / NEIGHBOURHOOD_SIZE);
      const nEnd = Math.floor(plotEnd / NEIGHBOURHOOD_SIZE);
      return `Region ${region} | neighbourhoods ${nStart}-${nEnd} | cubes ${plotStart}-${plotEnd} | selected ${selectedMotifIdx}`;
    }
    if (mainViewScope === 'street') {
      const street = streetIndexForMotif(selectedMotifIdx);
      const plotStart = street * STREET_SIZE;
      const plotEnd = plotStart + STREET_SIZE - 1;
      return `Street ${street} | cubes ${plotStart}-${plotEnd} | selected ${selectedMotifIdx}`;
    }
    const neighbourhood = neighbourhoodIndexForMotif(selectedMotifIdx);
    const plotStart = neighbourhood * NEIGHBOURHOOD_SIZE;
    const plotEnd = plotStart + NEIGHBOURHOOD_SIZE - 1;
    const sStart = Math.floor(plotStart / STREET_SIZE);
    const sEnd = Math.floor(plotEnd / STREET_SIZE);
    return `Neighbourhood ${neighbourhood} | streets ${sStart}-${sEnd} | cubes ${plotStart}-${plotEnd} | selected ${selectedMotifIdx}`;
  }
  const plotStart = mainScopeStart();
  const plotEnd = plotStart + mainScopeCount() - 1;
  return `${scopeDisplayName(mainViewScope)} view | cubes ${plotStart}-${plotEnd}`;
}

function updateWorldMapLabel() {
  if (worldMapLabelEl) worldMapLabelEl.textContent = selectionRangeLabel();
}

function setMainViewScope(next) {
  if (next !== 'region' && next !== 'neighbourhood' && next !== 'street') return;
  mainViewScope = next;
  const anchor = selectedMotifIdx ?? currentAnchorMotif();
  if (mainViewScope === 'region') {
    selectedRegionIdx = regionIndexForMotif(anchor);
    selectedNeighbourhoodIdx = null;
    selectedStreetIdx = null;
  } else if (mainViewScope === 'neighbourhood') {
    selectedNeighbourhoodIdx = neighbourhoodIndexForMotif(anchor);
    selectedRegionIdx = null;
    selectedStreetIdx = null;
  } else {
    selectedStreetIdx = streetIndexForMotif(anchor);
    selectedNeighbourhoodIdx = null;
    selectedRegionIdx = null;
  }
  updateScopeButtons();
  recentreOrbit();
  rebuildScene();
}

if (btnScopeStreet) btnScopeStreet.addEventListener('click', () => setMainViewScope('street'));
if (btnScopeNeighbourhood) btnScopeNeighbourhood.addEventListener('click', () => setMainViewScope('neighbourhood'));
if (btnScopeRegion) btnScopeRegion.addEventListener('click', () => setMainViewScope('region'));
updateScopeButtons();

// Unique cube indices (ordered) for 3D-mode stepping.
const uniqueMotifs = [...new Set(serializedPlanes.map(p => p.hierarchy.motifIndex))]
  .sort((a, b) => a - b);
log(`unique cubes: ${uniqueMotifs.length}`);

function motifCenterTicks(motifIdx) {
  const box = cubeAABBFor(motifIdx);
  return [
    Math.round((box.mn[0] + box.mx[0])),
    Math.round((box.mn[1] + box.mx[1])),
    Math.round((box.mn[2] + box.mx[2])),
  ];
}

const motifCenterTicksByIdx = new Map();
for (const motifIdx of uniqueMotifs) {
  const ticks = motifCenterTicks(motifIdx);
  motifCenterTicksByIdx.set(motifIdx, ticks);
}

function mintPlacementSlots() {
  // Mint placement tests the production-scale world: any vacant plot across
  // the full order-5 curve is eligible. Selection/detail rendering still caps
  // focus at region scope so the UI never tries to select the whole block.
  return uniqueMotifs;
}

function currentAnchorMotif() {
  return selectedMotifIdx ?? currentPlane()?.hierarchy?.motifIndex ?? 0;
}

function mainScopeStart() {
  const anchor = currentAnchorMotif();
  if (mainViewScope === 'region') return regionIndexForMotif(anchor) * REGION_SIZE;
  if (mainViewScope === 'neighbourhood') return neighbourhoodIndexForMotif(anchor) * NEIGHBOURHOOD_SIZE;
  return streetIndexForMotif(anchor) * STREET_SIZE;
}

function mainScopeCount() {
  if (mainViewScope === 'region') return REGION_SIZE;
  if (mainViewScope === 'neighbourhood') return NEIGHBOURHOOD_SIZE;
  return STREET_SIZE;
}

function mainScopeMotifs() {
  return motifRange(mainScopeStart(), mainScopeCount());
}

function motifInMainScope(motifIdx) {
  const start = mainScopeStart();
  return motifIdx >= start && motifIdx < start + mainScopeCount();
}

function motifRange(start, count) {
  const out = [];
  const end = start + count;
  for (let motifIdx = start; motifIdx < end; motifIdx++) {
    if (planesByMotif.has(motifIdx)) out.push(motifIdx);
  }
  return out;
}

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
const mintPhaseInput = document.getElementById('mint-phase');
const mintRunBtn = document.getElementById('mint-run');
const mintResetBtn = document.getElementById('mint-reset');
const mintSlotInput = document.getElementById('mint-slot');
const mintAtSlotBtn = document.getElementById('mint-at-slot');
const mintStatusEl = document.getElementById('mint-status');
const mintSuccessEl = document.getElementById('mint-success');
const mintSuccessTextEl = document.getElementById('mint-success-text');
const mintSuccessCloseBtn = document.getElementById('mint-success-close');
const cubeDetailEl = document.getElementById('cube-detail');
const cubeDetailResizeEl = document.getElementById('cube-detail-resize');
const cubeDetailTitleEl = document.getElementById('cube-detail-title');
const cubeDetailCloseBtn = document.getElementById('cube-detail-close');
const cubeDetailPrevBtn = document.getElementById('cube-detail-prev');
const cubeDetailNextBtn = document.getElementById('cube-detail-next');
const cubeDetailInfoEl = document.getElementById('cube-detail-info');
const cubeDetailAxisEl = document.getElementById('cube-detail-axis');
const streetStatsEl = document.getElementById('street-stats');
const streetStatOccupiedEl = document.getElementById('street-stat-occupied');
const streetStatTypeEl = document.getElementById('street-stat-type');
const streetStatIndexEl = document.getElementById('street-stat-index');
let cubeDetailOpen = false;
let cubeDetailWidthPx = 0;
const ownerLabelCache = new Map();

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
  selectedStreetIdx = null;
  selectedNeighbourhoodIdx = null;
  selectedRegionIdx = null;
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
  selectedStreetIdx = null;
  selectedNeighbourhoodIdx = null;
  selectedRegionIdx = null;
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
if (ownerFocusToggleBtn) ownerFocusToggleBtn.addEventListener('click', toggleOwnerFocus);
refreshOwnerFocusLabel();

const _updateWalletStatus = () => updateWalletStatus(walletStatusEl);
const _updateMintStatus   = () => updateMintStatus(mintStatusEl, uniqueMotifs);
const _mintCountValue     = () => mintCountValue(mintCountInput);
const _setMintCountValue  = (v) => setMintCountValue(mintCountInput, v);
const _mintPhaseValue     = () => mintPhaseInput?.value === 'public' ? 'public' : 'allowlist';

async function resetMintAndScene() {
  clearGeneratedMeshes();
  await resetMintSimulation();
  cubeDetailOpen = false;
  if (cubeDetailEl) {
    cubeDetailEl.classList.remove('open');
    cubeDetailEl.setAttribute('aria-hidden', 'true');
  }
  selectedMotifIdx = null;
  selectedStreetIdx = null;
  selectedNeighbourhoodIdx = null;
  selectedRegionIdx = null;
  currentPlaneIdx = 0;
  _updateMintStatus();
  _updateNftLabel();
  refreshOwnerFocusLabel();
  recentreOrbit();
  rebuildScene();
}

function streetIndexForMotif(motifIdx) {
  return Math.floor((Number(motifIdx) || 0) / STREET_SIZE);
}

function neighbourhoodIndexForMotif(motifIdx) {
  return Math.floor((Number(motifIdx) || 0) / NEIGHBOURHOOD_SIZE);
}

function regionIndexForMotif(motifIdx) {
  return Math.floor((Number(motifIdx) || 0) / REGION_SIZE);
}

function environmentForStreet(streetIdx) {
  return environmentNameForStreet(streetIdx);
}

function shortAddress(address) {
  const value = String(address || '');
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value || 'unknown';
}

function normalizeAddress(address) {
  return String(address || '').trim().toLowerCase();
}

async function ownerLabelFor(address) {
  const clean = String(address || '').toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(clean)) return shortAddress(address);
  if (ownerLabelCache.has(clean)) return ownerLabelCache.get(clean);
  ownerLabelCache.set(clean, shortAddress(clean));
  try {
    const res = await fetch(`/api/opensea/accounts/resolve/${clean}`);
    if (res.ok) {
      const data = await res.json();
      const label = data.ens || data.ens_name || data.primary_ens || data.username || shortAddress(clean);
      ownerLabelCache.set(clean, label);
      return label;
    }
  } catch (_) {}
  return ownerLabelCache.get(clean);
}

function loadedWalletAddress() {
  const wallet = getWalletState();
  return normalizeAddress(wallet.loaded ? wallet.address : walletAddressInput?.value);
}

function ownerAddressForSlot(slot) {
  return normalizeAddress(getMintedCubeForSlot(slot)?.wallet);
}

function ownerFocusedCubes() {
  if (!ownerFocusEnabled || !ownerFocusAddress) return [];
  return getMintedCubes()
    .filter(cube => normalizeAddress(cube.wallet) === ownerFocusAddress)
    .sort((a, b) => a.slot - b.slot);
}

function ownerFocusedMotifSet() {
  return ownerFocusMotifCache;
}

function updateOwnerFocusButton() {
  if (ownerFocusToggleBtn) {
    ownerFocusToggleBtn.classList.toggle('active', ownerFocusEnabled);
    ownerFocusToggleBtn.setAttribute('aria-pressed', ownerFocusEnabled ? 'true' : 'false');
  }
}

function setOwnerFocusLabel(text) {
  if (ownerFocusLabelEl) ownerFocusLabelEl.textContent = text;
}

function refreshOwnerFocusLabel() {
  const version = ++ownerFocusLabelVersion;
  ownerFocusMotifCache = ownerFocusEnabled && ownerFocusAddress
    ? new Set(ownerFocusedCubes().map(cube => cube.slot))
    : new Set();
  updateOwnerFocusButton();
  if (!ownerFocusEnabled) {
    setOwnerFocusLabel('All Cubes');
    updateOwnerInventory('');
    return;
  }
  if (!ownerFocusAddress) {
    setOwnerFocusLabel('empty slot');
    updateOwnerInventory('empty slot');
    return;
  }
  const count = ownerFocusedCubes().length;
  const fallback = shortAddress(ownerFocusAddress);
  setOwnerFocusLabel(`All items owned by ${fallback}${count ? ` (${count})` : ''}`);
  updateOwnerInventory(fallback);
  ownerLabelFor(ownerFocusAddress).then(label => {
    if (version !== ownerFocusLabelVersion || !ownerFocusEnabled || ownerFocusAddress === '') return;
    setOwnerFocusLabel(`All items owned by ${label}${count ? ` (${count})` : ''}`);
    updateOwnerInventory(label);
  });
}

function updateOwnerInventory(ownerLabel) {
  if (!ownerInventoryEl || !ownerInventoryListEl) return;
  ownerInventoryListEl.replaceChildren();
  if (!ownerFocusEnabled || !ownerFocusAddress) {
    ownerInventoryEl.classList.remove('open');
    ownerInventoryEl.setAttribute('aria-hidden', 'true');
    return;
  }
  const cubes = ownerFocusedCubes();
  if (ownerInventoryTitleEl) {
    ownerInventoryTitleEl.textContent = `${ownerLabel || shortAddress(ownerFocusAddress)} (${cubes.length})`;
  }
  for (const cube of cubes) {
    const button = document.createElement('button');
    button.className = 'owner-inventory-item';
    if (cube.slot === selectedMotifIdx) button.classList.add('active');
    button.type = 'button';
    const source = cube.sourceKind === 'normie' ? `Normie #${cube.nft?.normieId ?? cube.nft?.tokenId ?? '?'}` : `${cube.nft?.name || 'Source'} #${cube.nft?.tokenId ?? '?'}`;
    const slotEl = document.createElement('span');
    const sourceEl = document.createElement('span');
    slotEl.textContent = String(cube.slot);
    sourceEl.textContent = source;
    button.append(slotEl, sourceEl);
    button.addEventListener('click', () => {
      mainViewScope = 'region';
      selectedStreetIdx = null;
      selectedNeighbourhoodIdx = null;
      selectedRegionIdx = null;
      updateScopeButtons();
      openCubeDetail(cube.slot);
      setOrbitTargetToSelection();
    });
    ownerInventoryListEl.append(button);
  }
  ownerInventoryEl.classList.add('open');
  ownerInventoryEl.setAttribute('aria-hidden', 'false');
}

function setOwnerFocusAddress(address) {
  ownerFocusAddress = normalizeAddress(address);
  refreshOwnerFocusLabel();
}

function syncOwnerFocusToSlot(slot) {
  if (!ownerFocusEnabled) return;
  setOwnerFocusAddress(ownerAddressForSlot(slot));
}

function toggleOwnerFocus() {
  ownerFocusEnabled = !ownerFocusEnabled;
  if (ownerFocusEnabled) {
    const walletOwner = loadedWalletAddress();
    const selectedOwner = selectedMotifIdx !== null && selectedMotifIdx !== undefined
      ? ownerAddressForSlot(selectedMotifIdx)
      : '';
    setOwnerFocusAddress(walletOwner || selectedOwner);
  } else {
    setOwnerFocusAddress('');
  }
  rebuildScene();
}

function setDetailInfo(rows) {
  if (!cubeDetailInfoEl) return;
  cubeDetailInfoEl.replaceChildren();
  for (const [label, value] of rows) {
    const k = document.createElement('span');
    const v = document.createElement('span');
    k.textContent = label;
    v.textContent = value;
    cubeDetailInfoEl.append(k, v);
  }
}

function updateCubeDetailInfo() {
  const motifIdx = selectedMotifIdx;
  if (motifIdx === null || motifIdx === undefined) {
    setDetailInfo([]);
    return;
  }
  const minted = getMintedCubeForSlot(motifIdx);
  const owner = minted?.wallet || '';
  const street = streetIndexForMotif(motifIdx);
  const rows = [
    ['owner', owner ? shortAddress(owner) : 'empty slot'],
    ['plot', String(motifIdx)],
    ['street', String(street)],
    ['neighbourhood', String(neighbourhoodIndexForMotif(motifIdx))],
    ['region', String(regionIndexForMotif(motifIdx))],
    ['environment', environmentForStreet(street)],
  ];
  setDetailInfo(rows);
  if (owner) {
    ownerLabelFor(owner).then(label => {
      if (selectedMotifIdx !== motifIdx) return;
      rows[0] = ['owner', label];
      setDetailInfo(rows);
    });
  }
}

function updateStreetStats() {
  if (!streetStatsEl) return;
  if (selectedStreetIdx === null || selectedStreetIdx === undefined || !cubeDetailOpen || !cubeDetailEl) {
    streetStatsEl.classList.remove('open');
    return;
  }
  const rect = cubeDetailEl.getBoundingClientRect();
  streetStatsEl.style.left = `${rect.left}px`;
  streetStatsEl.style.top = `${rect.top}px`;
  streetStatsEl.style.width = `${rect.width}px`;
  streetStatsEl.style.height = `${rect.height}px`;
  const occupied = getMintedCubes().filter(cube => streetIndexForMotif(cube.slot) === selectedStreetIdx).length;
  if (streetStatOccupiedEl) streetStatOccupiedEl.textContent = `occupied ${occupied}/8`;
  if (streetStatTypeEl) streetStatTypeEl.textContent = environmentForStreet(selectedStreetIdx);
  if (streetStatIndexEl) streetStatIndexEl.textContent = `street ${selectedStreetIdx}`;
  streetStatsEl.classList.add('open');
}

function projectWorldToScreen(point, VP) {
  return projectWorldToRect(point, VP, { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
}

function axisScreenVector(view, axis) {
  const x = view[0] * axis[0] + view[4] * axis[1] + view[8] * axis[2];
  const y = view[1] * axis[0] + view[5] * axis[1] + view[9] * axis[2];
  const len = Math.hypot(x, y) || 1;
  return [x / len, -y / len];
}

function updateAxisGizmo(el, cam, scale = 28) {
  if (!el || !cam?.view) return;
  const axes = [
    { label: 'X', color: '#ff4fae', dir: axisScreenVector(cam.view, [1, 0, 0]) },
    { label: 'Y', color: '#3cff78', dir: axisScreenVector(cam.view, [0, 1, 0]) },
    { label: 'Z', color: '#62a8ff', dir: axisScreenVector(cam.view, [0, 0, 1]) },
  ].sort((a, b) => {
    // Draw the more vertical/up-facing axis last so labels remain legible when
    // directions overlap in shallow camera angles.
    return Math.abs(a.dir[1]) - Math.abs(b.dir[1]);
  });
  const cx = 38;
  const cy = 42;
  const parts = [
    `<circle cx="${cx}" cy="${cy}" r="2" fill="rgba(230,230,240,0.72)"></circle>`,
  ];
  for (const axis of axes) {
    const x2 = cx + axis.dir[0] * scale;
    const y2 = cy + axis.dir[1] * scale;
    const lx = cx + axis.dir[0] * (scale + 9);
    const ly = cy + axis.dir[1] * (scale + 9);
    parts.push(`<path d="M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}" style="color:${axis.color};stroke:${axis.color}"></path>`);
    parts.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" style="fill:${axis.color};color:${axis.color}">${axis.label}</text>`);
  }
  el.innerHTML = `<svg viewBox="0 0 76 84" aria-hidden="true">${parts.join('')}</svg>`;
}

function projectWorldToRect(point, VP, rect) {
  const x = VP[0]*point[0] + VP[4]*point[1] + VP[8]*point[2]  + VP[12];
  const y = VP[1]*point[0] + VP[5]*point[1] + VP[9]*point[2]  + VP[13];
  const z = VP[2]*point[0] + VP[6]*point[1] + VP[10]*point[2] + VP[14];
  const w = VP[3]*point[0] + VP[7]*point[1] + VP[11]*point[2] + VP[15];
  if (Math.abs(w) < 1e-6 || z / w < -1 || z / w > 1) return null;
  const nx = x / w;
  const ny = y / w;
  return [
    rect.left + (nx * 0.5 + 0.5) * rect.width,
    rect.top + (-ny * 0.5 + 0.5) * rect.height,
  ];
}

function selectionAABB() {
  if (selectedRegionIdx !== null && selectedRegionIdx !== undefined) {
    return motifRangeAABB(selectedRegionIdx * REGION_SIZE, REGION_SIZE);
  }
  if (selectedNeighbourhoodIdx !== null && selectedNeighbourhoodIdx !== undefined) {
    return motifRangeAABB(selectedNeighbourhoodIdx * NEIGHBOURHOOD_SIZE, NEIGHBOURHOOD_SIZE);
  }
  if (selectedStreetIdx !== null && selectedStreetIdx !== undefined) {
    return motifRangeAABB(selectedStreetIdx * STREET_SIZE, STREET_SIZE);
  }
  if (selectedMotifIdx !== null && selectedMotifIdx !== undefined) {
    return cubeAABBFor(selectedMotifIdx);
  }
  return null;
}

function miniMapSelectionAABB() {
  if (selectedRegionIdx !== null && selectedRegionIdx !== undefined) {
    return motifRangeAABB(selectedRegionIdx * REGION_SIZE, REGION_SIZE);
  }
  if (selectedNeighbourhoodIdx !== null && selectedNeighbourhoodIdx !== undefined) {
    return motifRangeAABB(selectedNeighbourhoodIdx * NEIGHBOURHOOD_SIZE, NEIGHBOURHOOD_SIZE);
  }
  if (selectedStreetIdx !== null && selectedStreetIdx !== undefined) {
    return motifRangeAABB(selectedStreetIdx * STREET_SIZE, STREET_SIZE);
  }
  if (selectedMotifIdx !== null && selectedMotifIdx !== undefined) {
    if (mainViewScope === 'region') {
      return motifRangeAABB(regionIndexForMotif(selectedMotifIdx) * REGION_SIZE, REGION_SIZE);
    }
    if (mainViewScope === 'neighbourhood') {
      return motifRangeAABB(neighbourhoodIndexForMotif(selectedMotifIdx) * NEIGHBOURHOOD_SIZE, NEIGHBOURHOOD_SIZE);
    }
    return motifRangeAABB(streetIndexForMotif(selectedMotifIdx) * STREET_SIZE, STREET_SIZE);
  }
  return motifRangeAABB(mainScopeStart(), mainScopeCount());
}

function wireAnchorCandidates(box) {
  if (!box) return [];
  const xs = [box.mn[0], box.mx[0]];
  const ys = [box.mn[1], box.mx[1]];
  const zs = [box.mn[2], box.mx[2]];
  const cx = (box.mn[0] + box.mx[0]) * 0.5;
  const cy = (box.mn[1] + box.mx[1]) * 0.5;
  const cz = (box.mn[2] + box.mx[2]) * 0.5;
  const points = [];

  for (const x of xs) for (const y of ys) for (const z of zs) points.push([x, y, z]);
  for (const y of ys) for (const z of zs) points.push([cx, y, z]);
  for (const x of xs) for (const z of zs) points.push([x, cy, z]);
  for (const x of xs) for (const y of ys) points.push([x, y, cz]);
  return points;
}

function expandAABB(box, pad) {
  if (!box) return null;
  const sx = box.mx[0] - box.mn[0];
  const sy = box.mx[1] - box.mn[1];
  const sz = box.mx[2] - box.mn[2];
  return {
    mn: [box.mn[0] - sx * pad * 0.5, box.mn[1] - sy * pad * 0.5, box.mn[2] - sz * pad * 0.5],
    mx: [box.mx[0] + sx * pad * 0.5, box.mx[1] + sy * pad * 0.5, box.mx[2] + sz * pad * 0.5],
  };
}

function selectionWirePad() {
  if (selectedRegionIdx !== null && selectedRegionIdx !== undefined) return 0.018;
  if (selectedNeighbourhoodIdx !== null && selectedNeighbourhoodIdx !== undefined) return 0.025;
  if (selectedStreetIdx !== null && selectedStreetIdx !== undefined) return 0.035;
  return 0.12;
}

function selectionWireAABB() {
  return expandAABB(selectionAABB(), selectionWirePad());
}

function selectionLinkColor() {
  if (selectedStreetIdx !== null && selectedStreetIdx !== undefined) {
    return {
      stroke: 'rgba(255, 132, 45, 0.92)',
      filter: 'drop-shadow(0 0 5px rgba(255, 132, 45, 0.58))',
    };
  }
  return {
    stroke: 'rgba(255, 58, 184, 0.86)',
    filter: 'drop-shadow(0 0 5px rgba(255, 58, 184, 0.52))',
  };
}

function updateSelectionLink(VP) {
  if (!selectionLinkEl || !selectionLinkPathEl) return;
  if (!cubeDetailOpen || selectedMotifIdx === null || selectedMotifIdx === undefined || !cubeDetailEl) {
    selectionLinkEl.classList.remove('active');
    return;
  }
  const rect = cubeDetailEl.getBoundingClientRect();
  const end = [rect.left, rect.top + rect.height * 0.5];
  let start = null;
  let bestD = Infinity;
  for (const point of wireAnchorCandidates(selectionWireAABB())) {
    const screen = projectWorldToScreen(point, VP);
    if (!screen) continue;
    const dx = screen[0] - end[0];
    const dy = screen[1] - end[1];
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      start = screen;
    }
  }
  if (!start) {
    selectionLinkEl.classList.remove('active');
    return;
  }
  const c1 = [start[0] + (end[0] - start[0]) * 0.42, start[1]];
  const c2 = [end[0] - 38, end[1]];
  const color = selectionLinkColor();
  selectionLinkPathEl.setAttribute('d', `M ${start[0].toFixed(1)} ${start[1].toFixed(1)} C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${end[0].toFixed(1)} ${end[1].toFixed(1)}`);
  selectionLinkPathEl.style.stroke = color.stroke;
  selectionLinkPathEl.style.filter = color.filter;
  selectionLinkEl.classList.add('active');
}

function nearestProjectedAnchor(box, VP, rect, target) {
  let best = null;
  let bestD = Infinity;
  for (const point of wireAnchorCandidates(box)) {
    const screen = projectWorldToRect(point, VP, rect);
    if (!screen) continue;
    const dx = screen[0] - target[0];
    const dy = screen[1] - target[1];
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = screen;
    }
  }
  return best;
}

function updateMapLink(mainVP, mapVP, mapRect) {
  if (!selectionLinkEl || !mapLinkPathEl || !worldMapEl) return;
  if (!mainVP || !mapVP || !mapRect) {
    selectionLinkEl.classList.remove('map-active');
    return;
  }
  const box = selectionWireAABB();
  if (!box || !mapRect) {
    selectionLinkEl.classList.remove('map-active');
    return;
  }
  const mainTarget = projectWorldToScreen(centerOfAABB(box), mainVP);
  if (!mainTarget) {
    selectionLinkEl.classList.remove('map-active');
    return;
  }
  const mapStart = nearestProjectedAnchor(box, mapVP, mapRect, mainTarget);
  const mainEnd = nearestProjectedAnchor(box, mainVP, { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }, mapStart || mainTarget);
  if (!mapStart || !mainEnd) {
    selectionLinkEl.classList.remove('map-active');
    return;
  }
  const c1 = [mapStart[0] + (mainEnd[0] - mapStart[0]) * 0.36, mapStart[1]];
  const c2 = [mainEnd[0] - (mainEnd[0] - mapStart[0]) * 0.18, mainEnd[1]];
  mapLinkPathEl.setAttribute('d', `M ${mapStart[0].toFixed(1)} ${mapStart[1].toFixed(1)} C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${mainEnd[0].toFixed(1)} ${mainEnd[1].toFixed(1)}`);
  mapLinkPathEl.style.stroke = 'rgba(255, 132, 45, 0.9)';
  mapLinkPathEl.style.filter = 'drop-shadow(0 0 5px rgba(255, 132, 45, 0.55))';
  selectionLinkEl.classList.add('map-active');
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

function openCubeDetail(motifIdx, { preserveStreet = false } = {}) {
  startDetailMaterialLoad();
  const idx = serializedPlanes.findIndex(p => p.hierarchy.motifIndex === motifIdx);
  if (idx >= 0) currentPlaneIdx = idx;
  selectedMotifIdx = motifIdx;
  syncOwnerFocusToSlot(motifIdx);
  if (!preserveStreet) {
    selectedStreetIdx = null;
    selectedNeighbourhoodIdx = null;
    selectedRegionIdx = null;
  }
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
  _updateNftLabel();
  updateCubeDetailInfo();
  updateStreetStats();
  setOrbitTargetToSelection();
  rebuildScene();
}

function activateOwnerFocusFor(address) {
  ownerFocusEnabled = true;
  setOwnerFocusAddress(address);
}

function selectStreet(motifIdx) {
  selectedStreetIdx = streetIndexForMotif(motifIdx);
  selectedNeighbourhoodIdx = null;
  selectedRegionIdx = null;
  updateScopeButtons();
  openCubeDetail(motifIdx, { preserveStreet: true });
  log(`street ${selectedStreetIdx} selected`);
}

function selectNeighbourhood(motifIdx, { preserveView = false } = {}) {
  if (!preserveView) mainViewScope = 'neighbourhood';
  selectedNeighbourhoodIdx = neighbourhoodIndexForMotif(motifIdx);
  selectedStreetIdx = null;
  selectedRegionIdx = null;
  updateScopeButtons();
  openCubeDetail(motifIdx, { preserveStreet: true });
  log(`neighbourhood ${selectedNeighbourhoodIdx} selected`);
}

function selectRegion(motifIdx) {
  mainViewScope = 'region';
  selectedRegionIdx = regionIndexForMotif(motifIdx);
  selectedNeighbourhoodIdx = null;
  selectedStreetIdx = null;
  updateScopeButtons();
  openCubeDetail(motifIdx, { preserveStreet: true });
  log(`region ${selectedRegionIdx} selected`);
}

function closeCubeDetail() {
  if (cubeDetailEl) {
    cubeDetailEl.classList.remove('open');
    cubeDetailEl.setAttribute('aria-hidden', 'true');
  }
  cubeDetailOpen = false;
  updateStreetStats();
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
    updateStreetStats();
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
    const wallet = getWalletState();
    const inputAddress = normalizeAddress(walletAddressInput?.value);
    const loadedAddress = normalizeAddress(wallet.address);
    if (!wallet.loaded) throw new Error('Load wallet NFTs before minting');
    if (inputAddress && inputAddress !== loadedAddress) {
      throw new Error(`Load ${shortAddress(inputAddress)} before minting. Currently loaded: ${shortAddress(loadedAddress)}`);
    }
    const mintSlots = mintPlacementSlots();
    const mintPhase = _mintPhaseValue();
    const minted = await simulateMintBatch(_mintCountValue(), mintSlots, { phase: mintPhase });
    clearGeneratedMeshes();
    if (minted.length > 0) {
      const first = minted[0].slot;
      const idx = serializedPlanes.findIndex(p => p.hierarchy.motifIndex === first);
      if (idx >= 0) currentPlaneIdx = idx;
      if (mode === 'BIG') {
        mainViewScope = 'region';
        updateScopeButtons();
        selectedStreetIdx = null;
        selectedNeighbourhoodIdx = null;
        selectedRegionIdx = null;
      }
      activateOwnerFocusFor(loadedAddress);
      openCubeDetail(first);
      setOrbitTargetToSelection();
      log(`minted ${minted.length} ${mintPhase} Normie ${minted.length === 1 ? 'cube' : 'cubes'} for ${shortAddress(loadedAddress)} across full curve: ${minted.map(c => `#${c.nft?.normieId}@slot${c.slot}`).join(', ')}`);
      openMintSuccess(minted.length);
    } else {
      log(`mint simulation: no eligible ${mintPhase} Normies or no empty slots`);
    }
    _updateMintStatus();
    _updateNftLabel();
    refreshOwnerFocusLabel();
    rebuildScene();
  } catch (err) {
    log(`mint failed: ${String(err?.message || err)}`);
  } finally {
    if (mintRunBtn) mintRunBtn.disabled = false;
  }
}

// Dev: mint a REAL on-chain cube at an explicit slot (colour = f(slot)), so you
// can preview specific colour/glass combos in the viewer. Local-only — needs the
// LocalMockNormies dev contract (mint() unguarded); no-ops on a mainnet fork.
async function runOnChainSlotMint() {
  const slot = parseInt(mintSlotInput?.value, 10);
  if (!Number.isInteger(slot) || slot < 0) { log('enter a slot number to on-chain mint'); return; }
  if (mintAtSlotBtn) mintAtSlotBtn.disabled = true;
  try {
    log(`on-chain minting a cube at slot ${slot}…`);
    const r = await mintNormieCubeOnChain({ slot });
    await loadMintSimulation(); // reloads on-chain records (chain-config enabled)
    const idx = serializedPlanes.findIndex(p => p.hierarchy.motifIndex === slot);
    if (idx >= 0) { currentPlaneIdx = idx; selectedMotifIdx = slot; openCubeDetail(slot); setOrbitTargetToSelection(); }
    _updateMintStatus();
    _updateNftLabel();
    refreshOwnerFocusLabel();
    rebuildScene();
    log(`on-chain mint: Normie #${r.normieId} @ slot ${slot} (owner ${shortAddress(r.cubeOwner)})`);
  } catch (err) {
    log(`on-chain mint failed: ${String(err?.message || err)}`);
  } finally {
    if (mintAtSlotBtn) mintAtSlotBtn.disabled = false;
  }
}
if (mintAtSlotBtn) mintAtSlotBtn.addEventListener('click', runOnChainSlotMint);
if (mintSlotInput) mintSlotInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runOnChainSlotMint(); });

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
    selectedStreetIdx = null;
    selectedNeighbourhoodIdx = null;
    selectedRegionIdx = null;
    currentPlaneIdx = 0;
    _updateMintStatus();
    _updateCategoryButtons();
    _updateCubeTypeButtons();
    if (ownerFocusEnabled) setOwnerFocusAddress(normalizeAddress(state.address));
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
  if (mode === 'BIG') {
    navigateMainSelection(dir);
    return;
  }
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

function navigateMainSelection(dir) {
  const size = mainScopeCount();
  const sectionCount = Math.max(1, Math.ceil(uniqueMotifs.length / size));
  const currentSection = Math.floor(currentAnchorMotif() / size);
  const nextSection = (currentSection + dir + sectionCount) % sectionCount;
  const nextMotif = Math.min(uniqueMotifs.length - 1, nextSection * size);
  const idx = serializedPlanes.findIndex(p => p.hierarchy.motifIndex === nextMotif);
  if (idx >= 0) currentPlaneIdx = idx;
  if (mainViewScope === 'region') selectRegion(nextMotif);
  else if (mainViewScope === 'neighbourhood') selectNeighbourhood(nextMotif);
  else selectStreet(nextMotif);
  recentreOrbit();
  log(`${mainViewScope} ${nextSection} selected`);
}

function navigateDetailCube(dir) {
  if (selectedMotifIdx === null || selectedMotifIdx === undefined) return;
  const owned = ownerFocusEnabled && ownerFocusAddress
    ? ownerFocusedCubes().map(cube => cube.slot)
    : [];
  const motifs = owned.length ? owned : mainScopeMotifs();
  if (motifs.length === 0) return;
  const curIdx = motifs.indexOf(selectedMotifIdx);
  const i = curIdx >= 0 ? curIdx : 0;
  openCubeDetail(motifs[(i + dir + motifs.length) % motifs.length]);
}

function axisDirectionVector(direction) {
  if (direction === 'up') return [0, 1, 0];
  if (direction === 'down') return [0, -1, 0];
  if (direction === 'right') return [1, 0, 0];
  if (direction === 'left') return [-1, 0, 0];
  if (direction === 'z-pos') return [0, 0, 1];
  return [0, 0, -1];
}

function rangeCenterTicks(start, count) {
  const box = motifRangeAABB(start, count);
  if (!box) return null;
  return [
    Math.round(box.mn[0] + box.mx[0]),
    Math.round(box.mn[1] + box.mx[1]),
    Math.round(box.mn[2] + box.mx[2]),
  ];
}

function bestCandidateInDirection(currentCenter, candidates, dir) {
  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const delta = [
      candidate.center[0] - currentCenter[0],
      candidate.center[1] - currentCenter[1],
      candidate.center[2] - currentCenter[2],
    ];
    const along = delta[0] * dir[0] + delta[1] * dir[1] + delta[2] * dir[2];
    if (along <= 0.001) continue;
    const len2 = delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2];
    const perpendicular = Math.max(0, len2 - along * along);
    const score = perpendicular * 64 + along;
    if (score < bestScore) {
      bestScore = score;
      best = candidate.id;
    }
  }
  return best;
}

function sectionInDirection(currentSection, sectionSize, dir, rangeStart = 0, rangeCount = uniqueMotifs.length) {
  const sectionCount = Math.max(1, Math.ceil(uniqueMotifs.length / sectionSize));
  const currentStart = currentSection * sectionSize;
  const currentCenter = rangeCenterTicks(currentStart, sectionSize);
  if (!currentCenter) return null;

  const rangeEnd = Math.min(uniqueMotifs.length, rangeStart + rangeCount);
  const firstSection = Math.max(0, Math.floor(rangeStart / sectionSize));
  const lastSection = Math.min(sectionCount - 1, Math.floor((rangeEnd - 1) / sectionSize));
  const candidates = [];
  for (let section = firstSection; section <= lastSection; section++) {
    if (section === currentSection) continue;
    const center = rangeCenterTicks(section * sectionSize, sectionSize);
    if (center) candidates.push({ id: section, center });
  }
  return bestCandidateInDirection(currentCenter, candidates, dir);
}

function motifInDirection(motifIdx, dir, candidatesInScope = uniqueMotifs) {
  const currentCenter = motifCenterTicksByIdx.get(motifIdx);
  if (!currentCenter) return null;
  const candidates = [];
  for (const candidate of candidatesInScope) {
    if (candidate === motifIdx) continue;
    const center = motifCenterTicksByIdx.get(candidate);
    if (center) candidates.push({ id: candidate, center });
  }
  return bestCandidateInDirection(currentCenter, candidates, dir);
}

function sectionNavigationRange(sectionSize) {
  const scopeCount = mainScopeCount();
  if (scopeCount > sectionSize) {
    return { start: mainScopeStart(), count: scopeCount };
  }
  return { start: 0, count: uniqueMotifs.length };
}

function navigateScreenDirection(direction) {
  const motifIdx = selectedMotifIdx ?? currentAnchorMotif();
  const dir = axisDirectionVector(direction);

  if (selectedStreetIdx !== null && selectedStreetIdx !== undefined) {
    const navStreetIdx = selectedStreetIdx;
    const range = sectionNavigationRange(STREET_SIZE);
    const nextStreet = sectionInDirection(navStreetIdx, STREET_SIZE, dir, range.start, range.count);
    if (nextStreet === null || nextStreet === undefined) {
      log(`no street ${direction} from ${navStreetIdx}`);
      return;
    }
    selectStreet(nextStreet * STREET_SIZE);
    setOrbitTargetToSelection();
    log(`${direction}: street ${navStreetIdx} -> ${nextStreet}`);
    return;
  }

  if (selectedNeighbourhoodIdx !== null && selectedNeighbourhoodIdx !== undefined) {
    const navNeighbourhoodIdx = selectedNeighbourhoodIdx;
    const range = sectionNavigationRange(NEIGHBOURHOOD_SIZE);
    const nextNeighbourhood = sectionInDirection(navNeighbourhoodIdx, NEIGHBOURHOOD_SIZE, dir, range.start, range.count);
    if (nextNeighbourhood === null || nextNeighbourhood === undefined) {
      log(`no neighbourhood ${direction} from ${navNeighbourhoodIdx}`);
      return;
    }
    selectNeighbourhood(nextNeighbourhood * NEIGHBOURHOOD_SIZE, { preserveView: mainViewScope === 'region' });
    setOrbitTargetToSelection();
    log(`${direction}: neighbourhood ${navNeighbourhoodIdx} -> ${nextNeighbourhood}`);
    return;
  }

  if (selectedRegionIdx !== null && selectedRegionIdx !== undefined) {
    const navRegionIdx = selectedRegionIdx;
    const nextRegion = sectionInDirection(navRegionIdx, REGION_SIZE, dir);
    if (nextRegion === null || nextRegion === undefined) {
      log(`no region ${direction} from ${navRegionIdx}`);
      return;
    }
    selectRegion(nextRegion * REGION_SIZE);
    setOrbitTargetToSelection();
    log(`${direction}: region ${navRegionIdx} -> ${nextRegion}`);
    return;
  }

  const nextMotif = motifInDirection(motifIdx, dir, mainScopeMotifs());
  if (nextMotif === null || nextMotif === undefined) {
    log(`no cube ${direction} from ${motifIdx}`);
    return;
  }
  openCubeDetail(nextMotif);
  setOrbitTargetToSelection();
  log(`${direction}: cube ${motifIdx} -> ${nextMotif}`);
}

if (btnNavUp) btnNavUp.addEventListener('click', () => navigateScreenDirection('up'));
if (btnNavDown) btnNavDown.addEventListener('click', () => navigateScreenDirection('down'));
if (btnNavLeft) btnNavLeft.addEventListener('click', () => navigateScreenDirection('left'));
if (btnNavRight) btnNavRight.addEventListener('click', () => navigateScreenDirection('right'));
if (btnNavZNeg) btnNavZNeg.addEventListener('click', () => navigateScreenDirection('z-neg'));
if (btnNavZPos) btnNavZPos.addEventListener('click', () => navigateScreenDirection('z-pos'));
if (cubeDetailPrevBtn) cubeDetailPrevBtn.addEventListener('click', () => navigateDetailCube(-1));
if (cubeDetailNextBtn) cubeDetailNextBtn.addEventListener('click', () => navigateDetailCube(+1));

// Debug toggles.
let showCubeGlass = false;
let showLightMarkers = false;
let showEdgePoints = false;
window.addEventListener('keydown', (e) => {
  const tag = String(document.activeElement?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return;
  if (e.key === 'ArrowUp')    { e.preventDefault(); navigateScreenDirection('up'); }
  if (e.key === 'ArrowDown')  { e.preventDefault(); navigateScreenDirection('down'); }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); navigateScreenDirection('left'); }
  if (e.key === 'ArrowRight') { e.preventDefault(); navigateScreenDirection('right'); }
  if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); navigateScreenDirection('z-neg'); }
  if (e.key === 'x' || e.key === 'X') { e.preventDefault(); navigateScreenDirection('z-pos'); }
  if (e.key === 'g' || e.key === 'G') { showCubeGlass      = !showCubeGlass;      rebuildScene(); log(`cube-glass overlay: ${showCubeGlass ? 'on' : 'off'}`); }
  if (e.key === 'l' || e.key === 'L') { showLightMarkers   = !showLightMarkers;   rebuildScene(); log(`light markers: ${showLightMarkers ? 'on' : 'off'}`); }
  if (e.key === 'e' || e.key === 'E') { showEdgePoints     = !showEdgePoints;     rebuildScene(); log(`edge points: ${showEdgePoints ? 'on' : 'off'}`); }
  if (e.key === 'p' || e.key === 'P') { togglePerfHud(); }
});

// ---------- Meshes ----------
const meshes = {
  wireBox:  createMeshGL(gl, createWireframeBox(1, 1, 1)),
  solidBox: createMeshGL(gl, createBox(1, 1, 1)),
};
{
  const wire = createWireframeBox(1, 1, 1);
  wire.alphas = new Float32Array(wire.positions.length / 3).fill(1);
  meshes.selectionWireBox = createMeshGL(gl, wire);
  meshes.worldMapGrid = buildAABBGridMesh(gl, worldAABB(), [
    [2, 0.95], // region grid: order-4 octants
    [4, 0.36], // neighbourhood grid: order-3 blocks
  ]);
}

function clearGeneratedMeshes() {
  for (const key of Object.keys(meshes)) {
    if (key !== 'wireBox' && key !== 'solidBox' && key !== 'selectionWireBox' && key !== 'worldMapGrid') delete meshes[key];
  }
}

// ---------- Materials ----------
const materialDefs = [
  {
    key: 'lines',
    name: 'lines',
    phase: 'ADDITIVE',
    vertPath: '/renderer/shaders/lines.vert.glsl',
    fragPath: '/renderer/shaders/lines.frag.glsl',
    uniforms: {},
    core: true,
  },
  {
    key: 'stone-glass',
    name: 'stone-glass',
    phase: 'TRANSPARENT',
    vertPath: '/renderer/shaders/stone-glass.vert.glsl',
    fragPath: '/renderer/shaders/stone-glass.frag.glsl',
    uniforms: {},
    core: true,
  },
  {
    key: 'normie-glow',
    name: 'normie-glow',
    phase: 'TRANSPARENT',
    vertPath: '/renderer/shaders/normie-glow.vert.glsl',
    fragPath: '/renderer/shaders/normie-glow.frag.glsl',
    uniforms: {},
    core: true,
  },
  {
    key: 'plant-particle',
    name: 'plant-particle',
    phase: 'ADDITIVE',
    vertPath: '/renderer/shaders/plant-particle.vert.glsl',
    fragPath: '/renderer/shaders/plant-particle.frag.glsl',
    uniforms: {},
  },
  {
    key: 'edge-glow',
    name: 'edge-glow',
    phase: 'ADDITIVE',
    vertPath: '/renderer/shaders/edge-glow.vert.glsl',
    fragPath: '/renderer/shaders/edge-glow.frag.glsl',
    uniforms: {},
  },
  {
    key: 'normie-voxel',
    name: 'normie-voxel',
    phase: 'TRANSPARENT',
    vertPath: '/renderer/shaders/normie-voxel.vert.glsl',
    fragPath: '/renderer/shaders/normie-voxel.frag.glsl',
    uniforms: {},
  },
  {
    key: 'feather-glass',
    name: 'feather-glass',
    phase: 'TRANSPARENT',
    vertPath: '/renderer/shaders/feather-glass.vert.glsl',
    fragPath: '/renderer/shaders/feather-glass.frag.glsl',
    uniforms: {},
  },
  {
    key: 'text-banner',
    name: 'text-banner',
    phase: 'ADDITIVE',
    vertPath: '/renderer/shaders/text-banner.vert.glsl',
    fragPath: '/renderer/shaders/text-banner.frag.glsl',
    uniforms: {},
  },
  {
    key: 'sand-grain',
    name: 'sand-grain',
    phase: 'ADDITIVE',
    vertPath: '/renderer/shaders/sand-grain.vert.glsl',
    fragPath: '/renderer/shaders/sand-grain.frag.glsl',
    uniforms: {},
  },
  {
    key: 'water-surface',
    name: 'water-surface',
    phase: 'TRANSPARENT',
    vertPath: '/renderer/shaders/water-surface.vert.glsl',
    fragPath: '/renderer/shaders/water-surface.frag.glsl',
    uniforms: {},
  },
  {
    key: 'grass-ground',
    name: 'grass-ground',
    phase: 'TRANSPARENT',
    vertPath: '/renderer/shaders/smooth-ground.vert.glsl',
    fragPath: '/renderer/shaders/smooth-ground.frag.glsl',
    uniforms: {},
  },
  {
    key: 'desert-dunes',
    name: 'desert-dunes',
    phase: 'OPAQUE',
    vertPath: '/renderer/shaders/smooth-ground.vert.glsl',
    fragPath: '/renderer/shaders/smooth-ground.frag.glsl',
    uniforms: {},
  },
  {
    key: 'grass-blade',
    name: 'grass-blade',
    phase: 'TRANSPARENT',
    vertPath: '/renderer/shaders/grass-blade.vert.glsl',
    fragPath: '/renderer/shaders/grass-blade.frag.glsl',
    uniforms: {},
  },
  {
    key: 'mountain-range',
    name: 'mountain-range',
    phase: 'TRANSPARENT',
    vertPath: '/renderer/shaders/ridge-terrain.vert.glsl',
    fragPath: '/renderer/shaders/mountain-range.frag.glsl',
    uniforms: {},
  },
  {
    key: 'ice-surface',
    name: 'ice-surface',
    phase: 'TRANSPARENT',
    vertPath: '/renderer/shaders/ridge-terrain.vert.glsl',
    fragPath: '/renderer/shaders/ice-surface.frag.glsl',
    uniforms: {},
  },
];

const materialsMap = {};
for (const mat of await Promise.all(materialDefs.filter(def => def.core).map(def => loadMaterial(gl, def)))) {
  materialsMap[mat.name] = mat;
}
log(`core materials: ${Object.keys(materialsMap).join(', ')}`);

let detailMaterialsStarted = false;
function startDetailMaterialLoad() {
  if (detailMaterialsStarted) return;
  detailMaterialsStarted = true;
  Promise.all(materialDefs.filter(def => !def.core).map(def => loadMaterial(gl, def)))
    .then(mats => {
      for (const mat of mats) materialsMap[mat.name] = mat;
      log(`detail materials loaded: ${mats.map(m => m.name).join(', ')}`);
      detailedEmptyScopesEnabled = true;
      rebuildScene();
    })
    .catch(err => log(`detail materials failed: ${String(err?.message || err)}`));
}

function scheduleDetailMaterialLoad() {
  const run = () => startDetailMaterialLoad();
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 1600 });
  else setTimeout(run, 250);
}

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

// Plane-material → scene-item builders. First matching builder wins.
// ---------- Orbit camera + debug lights ----------
function eventInCubeDetail(e) {
  if (!cubeDetailOpen || !cubeDetailEl) return false;
  const r = cubeDetailEl.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

function eventInWorldMap(e) {
  if (!worldMapEl) return false;
  const r = worldMapEl.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

const orbit = createOrbitCamera(canvas, {
  distance: 3.5,
  shouldHandleEvent: e => !eventInCubeDetail(e) && !eventInWorldMap(e),
});
const detailOrbit = createOrbitCamera(canvas, {
  distance: 3.5,
  shouldHandleEvent: eventInCubeDetail,
});
const miniMapOrbit = createOrbitCamera(canvas, {
  distance: 3.2,
  yaw: Math.PI * 0.17,
  pitch: Math.PI * 0.11,
  shouldHandleEvent: eventInWorldMap,
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

function worldAABB() {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const v of hilbert.rawVertices) {
    if (v.x < mn[0]) mn[0]=v.x; if (v.x > mx[0]) mx[0]=v.x;
    if (v.y < mn[1]) mn[1]=v.y; if (v.y > mx[1]) mx[1]=v.y;
    if (v.z < mn[2]) mn[2]=v.z; if (v.z > mx[2]) mx[2]=v.z;
  }
  return { mn, mx };
}

{
  const box = worldAABB();
  const center = centerOfAABB(box);
  miniMapOrbit.setTarget(center[0], center[1], center[2]);
  miniMapOrbit.setDistance(sizeOfAABB(box) * 2.35);
}

function motifRangeAABB(start, count) {
  const motifs = motifRange(start, count);
  return motifs.length ? aabbForMotifs(motifs) : null;
}

function activeOrbitAABB() {
  if (mode === 'BIG') {
    if (selectedRegionIdx !== null && selectedRegionIdx !== undefined) {
      return motifRangeAABB(selectedRegionIdx * REGION_SIZE, REGION_SIZE) || worldAABB();
    }
    if (selectedNeighbourhoodIdx !== null && selectedNeighbourhoodIdx !== undefined) {
      return motifRangeAABB(selectedNeighbourhoodIdx * NEIGHBOURHOOD_SIZE, NEIGHBOURHOOD_SIZE) || worldAABB();
    }
    if (selectedStreetIdx !== null && selectedStreetIdx !== undefined) {
      return motifRangeAABB(selectedStreetIdx * STREET_SIZE, STREET_SIZE) || worldAABB();
    }
    if (selectedMotifIdx !== null && selectedMotifIdx !== undefined) {
      return cubeAABBFor(selectedMotifIdx);
    }
    return motifRangeAABB(mainScopeStart(), mainScopeCount()) || worldAABB();
  }
  return aabbForMotifs([currentPlane().hierarchy.motifIndex]);
}

// Recentre orbit target and framing on the active scope. Called once at startup
// and after explicit navigation/reset actions. Selection clicks only update
// overlays/detail state so the Big Cube view does not jump under the cursor.
function recentreOrbit() {
  const box = activeOrbitAABB();
  const center = centerOfAABB(box);
  orbit.setTarget(center[0], center[1], center[2]);
  if (mode === 'BIG') {
    const isBroadScope =
      selectedRegionIdx !== null && selectedRegionIdx !== undefined ||
      selectedNeighbourhoodIdx !== null && selectedNeighbourhoodIdx !== undefined ||
      selectedStreetIdx !== null && selectedStreetIdx !== undefined ||
      selectedMotifIdx === null || selectedMotifIdx === undefined;
    const mult = isBroadScope
      ? (mainViewScope === 'region' ? 1.55 : mainViewScope === 'neighbourhood' ? 1.9 : 2.7)
      : 5.8;
    orbit.setDistance(sizeOfAABB(box) * mult);
  }
}
recentreOrbit();

function setOrbitTargetToSelection() {
  const box = selectionAABB() || activeOrbitAABB();
  const center = centerOfAABB(box);
  orbit.setTarget(center[0], center[1], center[2]);
}

function recentreDetailOrbit() {
  if (selectedMotifIdx === null || selectedMotifIdx === undefined) return;
  const { mn, mx } = cubeAABBFor(selectedMotifIdx);
  detailOrbit.setTarget((mn[0]+mx[0])*0.5, (mn[1]+mx[1])*0.5, (mn[2]+mx[2])*0.5);
  detailOrbit.setDistance(Math.max(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]) * 2.25);
}

// ---------- BIG-mode cube pick (click, not drag) ----------
{
  let downX = 0, downY = 0;
  let lastClickT = 0;
  let lastClickX = 0;
  let lastClickY = 0;
  let lastClickMotif = null;
  let clickSequenceCount = 0;

  function isRepeatClick(e, motifIdx) {
    const now = performance.now();
    const dx = e.clientX - lastClickX;
    const dy = e.clientY - lastClickY;
    return lastClickMotif === motifIdx && now - lastClickT < 360 && dx * dx + dy * dy < 36;
  }

  function rememberClick(e, motifIdx) {
    clickSequenceCount = isRepeatClick(e, motifIdx) ? clickSequenceCount + 1 : 1;
    lastClickT = performance.now();
    lastClickX = e.clientX;
    lastClickY = e.clientY;
    lastClickMotif = motifIdx;
  }

  function forgetClick() {
    lastClickT = 0;
    lastClickMotif = null;
    clickSequenceCount = 0;
  }

  function applyClickSequence(motifIdx) {
    const clickedStreetIdx = streetIndexForMotif(motifIdx);
    const promotingSelectedStreet = selectedStreetIdx === clickedStreetIdx;

    if (clickSequenceCount >= 4) {
      selectRegion(motifIdx);
      forgetClick();
      return true;
    }
    if (clickSequenceCount === 3) {
      selectNeighbourhood(motifIdx, { preserveView: promotingSelectedStreet });
      return true;
    }
    if (clickSequenceCount === 2) {
      if (promotingSelectedStreet) {
        selectNeighbourhood(motifIdx, { preserveView: true });
      } else {
        selectStreet(motifIdx);
      }
      return true;
    }
    openCubeDetail(motifIdx, { preserveStreet: promotingSelectedStreet });
    return true;
  }

  function pickBigMotifAt(e) {
    if (mode !== 'BIG') return null;
    if (eventInCubeDetail(e)) return null;
    if (!lastInvVP || !lastCamPos) return null;

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

    // Pickable set: in owner-focus mode, clicks intentionally target only
    // cubes belonging to the focused wallet. In general mode, filtered minted
    // cubes + every empty slot are pickable because biomes render
    // unconditionally in BIG mode.
    let bestT = Infinity, hitMotif = null;
    const pickable = new Set();
    if (ownerFocusEnabled && ownerFocusAddress) {
      for (const motifIdx of ownerFocusedMotifSet()) {
        if (motifInMainScope(motifIdx)) pickable.add(motifIdx);
      }
    } else {
      for (const motifIdx of _visibleMotifs().filter(motifInMainScope)) pickable.add(motifIdx);
      for (const motifIdx of mainScopeMotifs()) if (!isMintedSlot(motifIdx)) pickable.add(motifIdx);
    }
    for (const motifIdx of pickable) {
      const { mn, mx } = cubeAABBFor(motifIdx);
      const t = rayAABBIntersect(ro, rd, mn, mx);
      if (t < bestT) { bestT = t; hitMotif = motifIdx; }
    }
    return hitMotif !== null && bestT < Infinity ? hitMotif : null;
  }

  canvas.addEventListener('mousedown', (e) => { downX = e.clientX; downY = e.clientY; });
  canvas.addEventListener('mouseup', (e) => {
    if (mode !== 'BIG') return;
    const dx = e.clientX - downX, dy = e.clientY - downY;
    if (dx*dx + dy*dy > 25) return;  // was a drag, not a click

    if (eventInCubeDetail(e)) {
      if (lastClickMotif !== null && isRepeatClick(e, lastClickMotif)) {
        rememberClick(e, lastClickMotif);
        applyClickSequence(lastClickMotif);
      }
      return;
    }

    const hitMotif = pickBigMotifAt(e);
    if (hitMotif !== null) {
      rememberClick(e, hitMotif);
      applyClickSequence(hitMotif);
      return;
    } else {
      forgetClick();
      selectedMotifIdx = null;
      selectedStreetIdx = null;
      selectedNeighbourhoodIdx = null;
      selectedRegionIdx = null;
    }
    _updateLightsLabel();
    rebuildScene();
  });
  canvas.addEventListener('dblclick', (e) => {
    e.preventDefault();
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
let miniMapSceneItems = [];
let detailedEmptyScopesEnabled = false;
let lastInvVP  = null;
let lastCamPos = null;

// applyDim, applyMotifStyle, applyBurnedDesaturation, grayscaleColor imported from scene/styling.js

function pushMotifItems(itemsOut, motifIdx, renderMode, dim) {
  pushDetailMotifItems({
    itemsOut,
    motifIdx,
    renderMode,
    dim,
    hilbert,
    serializedPlanes,
    planesForMotif,
    gl,
    meshes,
    showCubeGlass,
    isAgenticNonNormieCube,
    categoryForMotif: ensureMotifCategory,
  });
}

function pushPlaneItems(itemsOut, plane, renderMode, cubeCtx, dim) {
  pushDetailPlaneItems({
    itemsOut,
    plane,
    renderMode,
    cubeCtx,
    dim,
    hilbert,
    serializedPlanes,
    gl,
    meshes,
    showEdgePoints,
    buildEdgePointDebug,
    buildNonNormieArtworkPlane,
    buildNonNormieWalker,
    buildNonNormieBanner,
    isAgenticNonNormieCube,
    categoryForMotif: ensureMotifCategory,
  });
}

function bigModeDimForMotif(motifIdx) {
  if (mode !== 'BIG') return 1.0;
  if (ownerFocusEnabled && ownerFocusAddress && ownerFocusedMotifSet().has(motifIdx)) return 1.5;
  if (selectedRegionIdx !== null && selectedRegionIdx !== undefined) {
    return regionIndexForMotif(motifIdx) === selectedRegionIdx ? 1.0 : 0.16;
  }
  if (selectedNeighbourhoodIdx !== null && selectedNeighbourhoodIdx !== undefined) {
    return neighbourhoodIndexForMotif(motifIdx) === selectedNeighbourhoodIdx ? 1.0 : 0.20;
  }
  if (selectedStreetIdx !== null && selectedStreetIdx !== undefined) {
    return streetIndexForMotif(motifIdx) === selectedStreetIdx ? 1.0 : 0.32;
  }
  return selectedMotifIdx !== null && selectedMotifIdx !== undefined && motifIdx !== selectedMotifIdx
    ? 0.60
    : 1.0;
}

function buildSelectionOverlayItems() {
  if (mode !== 'BIG' || selectedMotifIdx === null || selectedMotifIdx === undefined) return [];
  let box;
  let color;
  let opacity;
  if (selectedRegionIdx !== null && selectedRegionIdx !== undefined) {
    const start = selectedRegionIdx * REGION_SIZE;
    const motifs = motifRange(start, REGION_SIZE);
    if (!motifs.length) return [];
    box = aabbForMotifs(motifs);
    color = new Float32Array([1.0, 0.18, 0.72]);
    opacity = 0.95;
  } else if (selectedNeighbourhoodIdx !== null && selectedNeighbourhoodIdx !== undefined) {
    const start = selectedNeighbourhoodIdx * NEIGHBOURHOOD_SIZE;
    const motifs = motifRange(start, NEIGHBOURHOOD_SIZE);
    if (!motifs.length) return [];
    box = aabbForMotifs(motifs);
    color = new Float32Array([1.0, 0.18, 0.72]);
    opacity = 0.95;
  } else if (selectedStreetIdx !== null && selectedStreetIdx !== undefined) {
    const start = selectedStreetIdx * STREET_SIZE;
    const motifs = motifRange(start, STREET_SIZE);
    if (!motifs.length) return [];
    box = aabbForMotifs(motifs);
    color = new Float32Array([1.0, 0.44, 0.15]);
    opacity = 0.95;
  } else {
    box = cubeAABBFor(selectedMotifIdx);
    color = new Float32Array([1.0, 0.18, 0.72]);
    opacity = 0.9;
  }
  return buildWireGlowItems(box, color, opacity, selectionWirePad());
}

function buildWireGlowItems(box, color, opacity, pad) {
  return [
    {
      mesh: 'selectionWireBox',
      material: 'lines',
      transform: wireTransformForAABB(box, pad + 0.028),
      blend: 'additive',
      lineWidth: 4,
      uniforms: { uBaseCol: color, uLineOpacity: opacity * 0.34 },
    },
    {
      mesh: 'selectionWireBox',
      material: 'lines',
      transform: wireTransformForAABB(box, pad + 0.012),
      blend: 'additive',
      lineWidth: 3,
      uniforms: { uBaseCol: color, uLineOpacity: opacity * 0.58 },
    },
    {
      mesh: 'selectionWireBox',
      material: 'lines',
      transform: wireTransformForAABB(box, pad),
      blend: 'additive',
      lineWidth: 2,
      uniforms: { uBaseCol: color, uLineOpacity: opacity },
    },
  ];
}

function buildOwnerFocusOverlayItems() {
  if (mode !== 'BIG' || !ownerFocusEnabled || !ownerFocusAddress) return [];
  const items = [];
  const start = mainScopeStart();
  const end = start + mainScopeCount();
  for (const motifIdx of ownerFocusedMotifSet()) {
    if (motifIdx < start || motifIdx >= end) continue;
    items.push(...buildWireGlowItems(
      cubeAABBFor(motifIdx),
      new Float32Array([1.0, 0.18, 0.72]),
      motifIdx === selectedMotifIdx ? 1.0 : 0.68,
      0.18
    ));
  }
  return items;
}

function buildMiniMapOverlayItems() {
  const box = miniMapSelectionAABB();
  if (!box) return [];
  const transform = wireTransformForAABB(box, 0.0);
  return [
    {
      mesh: 'solidBox',
      material: 'stone-glass',
      transform,
      blend: 'alpha',
      noCull: true,
      uniforms: { uTint: new Float32Array([1.0, 0.45, 0.0]), uAlpha: 1.0 },
    },
    {
      mesh: 'solidBox',
      material: 'normie-glow',
      transform,
      blend: 'additive',
      noCull: true,
      uniforms: { uTint: new Float32Array([1.0, 0.32, 0.0]), uAlpha: 0.72 },
    },
  ];
}

function buildMiniMapOwnerMarkerItems() {
  if (!ownerFocusEnabled || !ownerFocusAddress) return [];
  const items = [];
  for (const motifIdx of ownerFocusedMotifSet()) {
    const transform = wireTransformForAABB(cubeAABBFor(motifIdx), 0.18);
    items.push({
      mesh: 'solidBox',
      material: 'stone-glass',
      transform,
      blend: 'alpha',
      noCull: true,
      uniforms: { uTint: new Float32Array([1.0, 0.02, 0.0]), uAlpha: motifIdx === selectedMotifIdx ? 1.0 : 0.78 },
    });
    items.push({
      mesh: 'solidBox',
      material: 'normie-glow',
      transform,
      blend: 'additive',
      noCull: true,
      uniforms: { uTint: new Float32Array([1.0, 0.0, 0.0]), uAlpha: motifIdx === selectedMotifIdx ? 0.85 : 0.42 },
    });
  }
  return items;
}

function motifSetForRange(start, count) {
  return new Set(motifRange(start, count));
}

function detailedEmptyMotifSet() {
  if (mode !== 'BIG') return new Set();
  if (!detailedEmptyScopesEnabled) return new Set();
  return motifSetForRange(mainScopeStart(), mainScopeCount());
}

function emptyBiomeDimForMotif(motifIdx) {
  if (selectedStreetIdx !== null && selectedStreetIdx !== undefined) {
    return streetIndexForMotif(motifIdx) === selectedStreetIdx ? 0.74 : (
      mainViewScope === 'street' ? 0.38 : mainViewScope === 'neighbourhood' ? 0.13 : 0.055
    );
  }
  if (selectedNeighbourhoodIdx !== null && selectedNeighbourhoodIdx !== undefined) {
    return neighbourhoodIndexForMotif(motifIdx) === selectedNeighbourhoodIdx ? 0.59 : (
      mainViewScope === 'street' ? 0.38 : mainViewScope === 'neighbourhood' ? 0.13 : 0.055
    );
  }
  if (selectedRegionIdx !== null && selectedRegionIdx !== undefined) {
    return regionIndexForMotif(motifIdx) === selectedRegionIdx ? 0.46 : (
      mainViewScope === 'street' ? 0.38 : mainViewScope === 'neighbourhood' ? 0.13 : 0.055
    );
  }
  if (selectedMotifIdx !== null && selectedMotifIdx !== undefined) {
    return motifIdx === selectedMotifIdx ? 0.70 : (
      mainViewScope === 'street' ? 0.32 : mainViewScope === 'neighbourhood' ? 0.10 : 0.04
    );
  }
  return mainViewScope === 'street' ? 0.48 : mainViewScope === 'neighbourhood' ? 0.16 : 0.06;
}

function fullArtworkMotifSet() {
  if (mode !== 'BIG') return new Set();
  if (ownerFocusEnabled && ownerFocusAddress) {
    const start = mainScopeStart();
    const end = start + mainScopeCount();
    return new Set([...ownerFocusedMotifSet()].filter(motifIdx => motifIdx >= start && motifIdx < end && isMintedSlot(motifIdx)));
  }
  if (mainViewScope === 'street' || mainViewScope === 'neighbourhood') {
    return new Set(mainScopeMotifs().filter(isMintedSlot));
  }
  if (selectedMotifIdx !== null && selectedMotifIdx !== undefined && isMintedSlot(selectedMotifIdx)) {
    return new Set([selectedMotifIdx]);
  }
  return new Set();
}

// Coalesce rebuilds: data-ready callbacks (wallet / mint / normie pixels /
// banner) each fire as their data streams in during a load, previously
// triggering a full rebuildScene() apiece (~8 heavy rebuilds per load). Collapse
// any burst within a frame into a single rebuild on the next animation frame.
let _rebuildScheduled = false;
function scheduleRebuild() {
  if (_rebuildScheduled) return;
  _rebuildScheduled = true;
  requestAnimationFrame(() => { _rebuildScheduled = false; rebuildScene(); });
}

// Per-slot cache for the static empty-world scaffold. The biome / Hilbert /
// cardioid / edge-point items for a slot depend only on its fixed world
// position — never on selection or dim — so build the GL meshes once and reuse
// them across rebuilds instead of reallocating ~6000 buffers every interaction.
// Styling (applyDim) mutates uniforms in place and compounds, so each rebuild
// gets a shallow CLONE: fresh item + uniforms objects that share the cached
// base's GL `mesh` handle (the expensive resource) but can be dimmed safely.
const _emptySlotCache = new Map();
const EMPTY_SLOT_CACHE_CAP = 2048; // soft bound on retained slot meshes
const SCAFFOLD_BUILD_BUDGET = 40;  // max NEW (uncached) slots built per frame
let _scaffoldIncomplete = false;   // a rebuild deferred some slot builds
function cloneSceneItems(items) {
  return items.map(it => (it && it.uniforms) ? { ...it, uniforms: { ...it.uniforms } } : { ...it });
}

function rebuildScene() {
  const _rebuildStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  _scaffoldIncomplete = false;
  sceneItems = [];
  detailSceneItems = [];
  miniMapSceneItems = [];
  updateWorldMapLabel();
  jumpToFirstVisibleForFilter();
  _updateNftLabel();
  const p0 = currentPlane();

  const fullArtworkMotifs = fullArtworkMotifSet();
  if (fullArtworkMotifs.size > 0) startDetailMaterialLoad();
  const motifsInFilter = _visibleMotifs();
  const motifsToRender = (mode === 'BIG')
    ? motifsInFilter.filter(motifIdx => motifInMainScope(motifIdx) && !fullArtworkMotifs.has(motifIdx))
    : (mode === '2D' ? [] : (isMintedSlot(p0.hierarchy.motifIndex) ? [p0.hierarchy.motifIndex] : []));

  const hasMinted = mintSimulationLoaded();
  const planesToRender = !hasMinted
    ? []
    : (mode === '2D')
      ? (isMintedSlot(p0.hierarchy.motifIndex) ? [p0] : [])
      : (mode === '3D')
        ? (isMintedSlot(p0.hierarchy.motifIndex)
            ? planesForMotif(p0.hierarchy.motifIndex)
            : [])
        : (mode === 'BIG')
          ? serializedPlanes.filter(p => fullArtworkMotifs.has(p.hierarchy.motifIndex))
          : [];

  // Precompute per-motif cubeCtx (mirror slices for forest builder).
  // Always include the current plane's motif so 2D mode forest has context.
  const cubeCtxMap = {};
  const motifsForCtx = new Set([...motifsToRender, ...fullArtworkMotifs, p0.hierarchy.motifIndex]);
  if (selectedMotifIdx !== null && selectedMotifIdx !== undefined) motifsForCtx.add(selectedMotifIdx);
  for (const motifIdx of motifsForCtx) {
    cubeCtxMap[motifIdx] = {
      slicesByAxis: computeMirrorSlices(motifIdx, hilbert, planesForMotif(motifIdx)),
    };
  }
  // --- Per-cube items ---
  for (const motifIdx of motifsToRender) {
    pushMotifItems(sceneItems, motifIdx, mode, bigModeDimForMotif(motifIdx));
  }
  for (const motifIdx of fullArtworkMotifs) {
    pushMotifItems(sceneItems, motifIdx, '3D', bigModeDimForMotif(motifIdx));
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

  // Main viewport scaffold is capped at the selected region/neighbourhood.
  // The full order-5 block lives in the minimap so this view never tries to
  // present the entire 4096-plot world at once.
  if (mode === 'BIG' && categoryFilter === null) {
    const scaffoldItems = buildHilbertPathRange(hilbert, mainScopeStart(), mainScopeCount(), gl, meshes);
    const hasFocusedScope =
      selectedMotifIdx !== null && selectedMotifIdx !== undefined ||
      selectedStreetIdx !== null && selectedStreetIdx !== undefined ||
      selectedNeighbourhoodIdx !== null && selectedNeighbourhoodIdx !== undefined ||
      selectedRegionIdx !== null && selectedRegionIdx !== undefined;
    applyDim(scaffoldItems, hasFocusedScope ? 0.24 : 0.62);
    sceneItems.push(...scaffoldItems);
  }

  // Empty mint-state scaffold: show the bare Hilbert structure before any
  // source token has been placed into a slot.
  if (!hasMinted && mode !== '2D') {
    if (mode !== 'BIG' || categoryFilter !== null) sceneItems.push(...buildFullHilbertPath(hilbert, gl, meshes));
  }

  // --- Per-plane items ---
  for (const plane of planesToRender) {
    const motifIdx = plane.hierarchy.motifIndex;
    pushPlaneItems(sceneItems, plane, mode, cubeCtxMap[motifIdx], bigModeDimForMotif(motifIdx));
  }

  // --- Empty-slot biomes (Big Cube view) ---
  // Biomes are world backdrop, not focus content — they use their own dim
  // policy: full brightness when nothing is selected, mild dim when a single
  // cube is selected, in-street stays bright when a street is selected.
  // The per-cube Hilbert line is drawn alongside so empty cubes still show
  // their internal Hilbert geometry in the correct perspective.
  function emptySlotItemsFor(motifIdx) {
    const cubePlanes = planesForMotif(motifIdx);
    const aabb = cubeAABBFor(motifIdx);
    const items = [
      ...buildEmptySlotItems(motifIdx, cubePlanes, aabb, gl, meshes),
      ...buildHilbertLines(motifIdx, hilbert, gl, meshes),
    ];

    // Empty slots should already read as part of the same world-language as
    // populated cubes: green Hilbert spine, pink corner-web, and glowing edge
    // bit/corner points. The source art layers are the only things missing.
    const cardItems = buildCubeCardioid(motifIdx, hilbert, cubePlanes, gl, meshes);
    if (cardItems?.length) items.push(...cardItems);
    for (const plane of cubePlanes) {
      const dbg = buildEdgePointDebug(plane, gl, meshes);
      const edgeItems = Array.isArray(dbg) ? dbg.filter(Boolean) : (dbg ? [dbg] : []);
      if (edgeItems.length) items.push(...edgeItems);
    }
    return items;
  }

  if (mode === 'BIG') {
    const detailedEmpty = detailedEmptyMotifSet();
    let builtThisRebuild = 0;
    for (const motifIdx of detailedEmpty) {
      if (isMintedSlot(motifIdx)) continue;
      // Reuse the cached pristine scaffold for this slot (built once); dim a clone.
      let base = _emptySlotCache.get(motifIdx);
      if (!base) {
        // Budget NEW builds per frame: entering a cold scope reveals over a few
        // frames instead of one ~200ms hitch. Cached slots are always shown.
        if (builtThisRebuild >= SCAFFOLD_BUILD_BUDGET) { _scaffoldIncomplete = true; continue; }
        base = emptySlotItemsFor(motifIdx);
        builtThisRebuild++;
        if (_emptySlotCache.size >= EMPTY_SLOT_CACHE_CAP) _emptySlotCache.clear();
        _emptySlotCache.set(motifIdx, base);
      }
      const items = cloneSceneItems(base);
      applyDim(items, emptyBiomeDimForMotif(motifIdx));
      sceneItems.push(...items);
    }
  }

  if (cubeDetailOpen && selectedMotifIdx !== null && selectedMotifIdx !== undefined) {
    if (isMintedSlot(selectedMotifIdx)) {
      const cubeCtx = cubeCtxMap[selectedMotifIdx];
      pushMotifItems(detailSceneItems, selectedMotifIdx, '3D', 1.0);
      for (const plane of planesForMotif(selectedMotifIdx)) {
        pushPlaneItems(detailSceneItems, plane, '3D', cubeCtx, 1.0);
      }
    } else {
      detailSceneItems.push(...emptySlotItemsFor(selectedMotifIdx));
    }
  }

  sceneItems.push(...buildOwnerFocusOverlayItems());
  sceneItems.push(...buildSelectionOverlayItems());
  miniMapSceneItems.push({
    mesh: 'solidBox',
    material: 'stone-glass',
    transform: wireTransformForAABB(worldAABB(), 0.0),
    blend: 'alpha',
    noCull: true,
    uniforms: {
      uTint: new Float32Array([0.0, 1.0, 0.24]),
      uAlpha: 0.035,
    },
  });
  miniMapSceneItems.push({
    mesh: 'selectionWireBox',
    material: 'lines',
    transform: wireTransformForAABB(worldAABB(), 0.0),
    blend: 'additive',
    uniforms: {
      uBaseCol: new Float32Array([0.0, 1.0, 0.24]),
      uLineOpacity: 0.26,
    },
  });
  miniMapSceneItems.push({
    mesh: 'worldMapGrid',
    material: 'lines',
    transform: identity(mat4()),
    blend: 'additive',
    uniforms: {
      uBaseCol: new Float32Array([0.0, 1.0, 0.24]),
      uLineOpacity: 0.46,
    },
  });
  miniMapSceneItems.push(...buildMiniMapOwnerMarkerItems());
  miniMapSceneItems.push(...buildMiniMapOverlayItems());

  const cnt = {};
  for (const it of sceneItems) cnt[it.material] = (cnt[it.material] || 0) + 1;
  log(`scene: ${sceneItems.length} items | ${Object.entries(cnt).map(([m, n]) => `${m}=${n}`).join(', ')}`);
  const _rebuildEnd = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  noteRebuild(_rebuildEnd - _rebuildStart, sceneItems.length + detailSceneItems.length + miniMapSceneItems.length);
  // Deferred some slot builds to stay within the per-frame budget — continue
  // filling the scope next frame. Cached slots make this converge in a few frames.
  if (_scaffoldIncomplete) scheduleRebuild();
}

// Trigger a scene rebuild when normie pixel data arrives so 3D voxel meshes
// get built once their pixel data is available.
setDataReadyCallback(() => scheduleRebuild());
setBannerDataReadyCallback(() => scheduleRebuild());
setWalletDataReadyCallback(() => { _updateWalletStatus(); _updateMintStatus(); refreshOwnerFocusLabel(); updateCubeDetailInfo(); updateStreetStats(); scheduleRebuild(); });
setMintDataReadyCallback(() => { _updateMintStatus(); refreshOwnerFocusLabel(); updateCubeDetailInfo(); updateStreetStats(); applyMintedCubeSeeds(); scheduleRebuild(); });

// Recompute edge points for real minted cubes from their on-chain seed, so a
// minted cube's unique-plane grown points match its on-chain 2D thumbnail.
// Simulated mints have no real seed and keep their placeholder pattern.
function applyMintedCubeSeeds() {
  for (const cube of getMintedCubes()) {
    if (!cube.seed || cube.slot == null) continue;
    const planes = planesForMotif(cube.slot); // serialized planes actually rendered
    if (planes.length === 3) assignMotifEdgePoints(planes, cube.seed);
  }
}

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
      selectedMotifIdx = uniqueMotifs[Math.floor(hash1(0x9eb6e202, uniqueMotifs.length, HILBERT_ORDER) * uniqueMotifs.length)] ?? null;
      recentreOrbit();
    }
    _updateMintStatus();
    _updateNftLabel();
    refreshOwnerFocusLabel();
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
    let cullEnabled = (blendMode === 'opaque');
    for (const item of drawList) {
      const mat = materialsMap[item.material];
      if (!mat) continue;

      // Per-item culling override. Needed for thin opaque meshes (e.g. dune
      // ground planes) where the per-cube transform can invert winding so
      // back-face culling would silently hide the surface.
      const wantCull = (blendMode === 'opaque') && !item.noCull;
      if (wantCull !== cullEnabled) {
        if (wantCull) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
        else          { gl.disable(gl.CULL_FACE); }
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
      if (mesh.mode === gl.LINES) gl.lineWidth(item.lineWidth || 1);
      if (mesh.mode === 'INSTANCED') {
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, mesh.instanceCount);
      } else if (mesh.indexCount > 0) {
        gl.drawElements(mesh.mode, mesh.indexCount, mesh.indexType || gl.UNSIGNED_SHORT, 0);
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

// ---------- Perf HUD (dev) ----------
// Toggle with `P`. Measures the two Big Cube cost axes separately: RENDER
// (rebuildScene ms + item count + FPS) and DATA (chain RPC round-trips/calls,
// the indexer target). Turning it on resets the cumulative counters so each
// session reads clean; the FPS ring keeps running. See viewer/perf-metrics.js.
let perfHudEl = null;
let perfHudOn = false;
let _lastHudUpdate = 0;
function ensurePerfHud() {
  if (perfHudEl) return perfHudEl;
  perfHudEl = document.createElement('div');
  perfHudEl.id = 'perf-hud';
  perfHudEl.style.cssText =
    'position:fixed;top:12px;right:12px;z-index:50;padding:8px 10px;' +
    'background:rgba(8,10,14,0.86);border:1px solid #2a3a2a;color:#7fdca0;' +
    'font:11px/1.5 "Courier New",monospace;white-space:pre;pointer-events:none;' +
    'text-shadow:0 0 2px rgba(0,0,0,0.8);';
  document.body.appendChild(perfHudEl);
  return perfHudEl;
}
function togglePerfHud() {
  perfHudOn = !perfHudOn;
  const el = ensurePerfHud();
  el.style.display = perfHudOn ? 'block' : 'none';
  // Do NOT reset on open — the counters are cumulative since page load, so the
  // wallet-load + chain-hydration work is still visible. Use perfReset() to zero.
  log(`perf HUD: ${perfHudOn ? 'on' : 'off'}`);
}
function updatePerfHud() {
  if (!perfHudOn || !perfHudEl) return;
  const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (nowMs - _lastHudUpdate < 250) return; // ~4 Hz is plenty and avoids self-cost
  _lastHudUpdate = nowMs;
  perfHudEl.textContent = 'BIG CUBE PERF  (P to hide)\n' + formatSnapshot();
}

function frame() {
  resize();
  noteFrame();
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
  updateSelectionLink(VP);
  updateStreetStats();
  updateAxisGizmo(mainAxisEl, mainCam, 28);

  drawScene(sceneItems, mainCam, t);

  let mapVP = null;
  let mapRectScreen = null;
  if (worldMapEl && miniMapSceneItems.length > 0) {
    const rect = worldMapEl.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const dprX = canvas.width / Math.max(1, canvasRect.width);
    const dprY = canvas.height / Math.max(1, canvasRect.height);
    const x = Math.max(0, Math.floor((rect.left - canvasRect.left) * dprX));
    const y = Math.max(0, Math.floor((canvasRect.bottom - rect.bottom) * dprY));
    const w = Math.min(canvas.width - x, Math.floor(rect.width * dprX));
    const h = Math.min(canvas.height - y, Math.floor(rect.height * dprY));
    if (w > 8 && h > 8) {
      const mapCam = miniMapOrbit.camera(w / Math.max(1, h));
      mapVP = mat4(); multiply(mapVP, mapCam.proj, mapCam.view);
      mapRectScreen = rect;
      gl.enable(gl.SCISSOR_TEST);
      gl.viewport(x, y, w, h);
      gl.scissor(x, y, w, h);
      gl.clearColor(0.005, 0.009, 0.007, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      drawScene(miniMapSceneItems, mapCam, t);
      updateAxisGizmo(worldMapAxisEl, mapCam, 24);
      gl.disable(gl.SCISSOR_TEST);
    }
  }
  updateMapLink(VP, mapVP, mapRectScreen);

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
      const detailCam = detailOrbit.camera(w / Math.max(1, h));
      drawScene(detailSceneItems, detailCam, t);
      updateAxisGizmo(cubeDetailAxisEl, detailCam, 24);
      gl.disable(gl.SCISSOR_TEST);
    }
  }

  gl.disable(gl.BLEND);
  gl.depthMask(true);
  gl.depthFunc(gl.LESS);

  updatePerfHud();
  requestAnimationFrame(frame);
}
log('entering render loop');
rebuildScene();  // Initial scaffold before first frame.
requestAnimationFrame(() => {
  scheduleDetailMaterialLoad();
});
requestAnimationFrame(frame);
