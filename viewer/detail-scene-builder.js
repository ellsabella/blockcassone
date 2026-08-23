import { buildForestPlane } from './materials/forest.js';
import { buildCubeGlass } from './cube-glass.js';
import {
  build2DOutline,
  build3DVoxels,
  buildPlaneOutline,
  buildNormieIdLabel,
  isNormieCube,
} from './normies-manager.js';
import { buildHilbertLines } from './hilbert-lines.js';
import { buildCubeCardioid } from './cube-cardioid.js';
import { buildStoneWalker } from './materials/stone-walker.js';
import {
  applyDim,
  applyMotifStyle,
  applyBannerGlitch,
  applyAgenticAwakening,
  applyAgenticBannerPulse,
} from './scene/styling.js';

const PLANE_BUILDERS = [buildForestPlane];

function identityAgenticNonNormie() {
  return false;
}

function unknownCategory() {
  return null;
}

export function pushDetailMotifItems({
  itemsOut,
  motifIdx,
  renderMode,
  dim,
  hilbert,
  serializedPlanes,
  planesForMotif,
  gl,
  meshes,
  showCubeGlass = true,
  showStoneWalker = true,
  showVoxels = true,
  showHilbertLines = true,
  showCardioid = true,
  isAgenticNonNormieCube = identityAgenticNonNormie,
  categoryForMotif = unknownCategory,
}) {
  if (renderMode === 'BIG') {
    const agenticNonNormie = isAgenticNonNormieCube(motifIdx);
    const cubePlanes = planesForMotif(motifIdx);

    if (showHilbertLines) {
      const hlItems = buildHilbertLines(motifIdx, hilbert, gl, meshes);
      if (agenticNonNormie) applyAgenticAwakening(hlItems);
      applyDim(hlItems, dim);
      if (hlItems?.length) itemsOut.push(...hlItems);
    }

    if (showCardioid) {
      const cardItems = buildCubeCardioid(motifIdx, hilbert, cubePlanes, gl, meshes);
      if (agenticNonNormie) applyAgenticAwakening(cardItems);
      applyDim(cardItems, dim);
      if (cardItems?.length) itemsOut.push(...cardItems);
    }
    return;
  }

  const cat = categoryForMotif(motifIdx);
  const agenticNonNormie = isAgenticNonNormieCube(motifIdx);

  if (showCubeGlass && renderMode === '3D') {
    const glassItems = buildCubeGlass(motifIdx, hilbert, gl, meshes, renderMode);
    applyMotifStyle(glassItems, cat, motifIdx);
    if (agenticNonNormie) applyAgenticAwakening(glassItems);
    if (glassItems?.length) itemsOut.push(...glassItems);
  }

  if (showStoneWalker) {
    const walkerItems = buildStoneWalker(motifIdx, hilbert, planesForMotif ? planesForMotif(motifIdx) : serializedPlanes, gl, meshes);
    applyMotifStyle(walkerItems, cat, motifIdx);
    if (agenticNonNormie) applyAgenticAwakening(walkerItems);
    applyDim(walkerItems, dim);
    if (walkerItems?.length) itemsOut.push(...walkerItems);
  }

  if (showVoxels) {
    const voxelItems = build3DVoxels(motifIdx, hilbert, planesForMotif ? planesForMotif(motifIdx) : serializedPlanes, gl, meshes);
    applyMotifStyle(voxelItems, cat, motifIdx);
    if (agenticNonNormie) applyAgenticAwakening(voxelItems);
    applyDim(voxelItems, dim);
    if (voxelItems?.length) itemsOut.push(...voxelItems);
  }

  if (showHilbertLines) {
    const hlItems = buildHilbertLines(motifIdx, hilbert, gl, meshes);
    applyMotifStyle(hlItems, cat, motifIdx);
    if (agenticNonNormie) applyAgenticAwakening(hlItems);
    applyDim(hlItems, dim);
    if (hlItems?.length) itemsOut.push(...hlItems);
  }

  if (showCardioid) {
    const cardItems = buildCubeCardioid(motifIdx, hilbert, planesForMotif ? planesForMotif(motifIdx) : serializedPlanes, gl, meshes);
    applyMotifStyle(cardItems, cat, motifIdx);
    if (agenticNonNormie) applyAgenticAwakening(cardItems);
    applyDim(cardItems, dim);
    if (cardItems?.length) itemsOut.push(...cardItems);
  }
}

export function pushDetailPlaneItems({
  itemsOut,
  plane,
  renderMode,
  cubeCtx,
  dim,
  hilbert,
  serializedPlanes,
  planesForMotif = null,
  gl,
  meshes,
  showEdgePoints = false,
  showForest = true,
  showNonNormieArtwork = true,
  showNonNormieWalker = true,
  showNonNormieBanner = true,
  showNormieOutline = true,
  showNormieIdLabel = true,
  showNormieTraitsBanner = true,
  showPlaneOutline = true,
  buildEdgePointDebug = null,
  buildNonNormieArtworkPlane = null,
  buildNonNormieWalker = null,
  buildNonNormieBanner = null,
  buildNonNormieIdLabel = null,
  isAgenticNonNormieCube = identityAgenticNonNormie,
  categoryForMotif = unknownCategory,
}) {
  const motifIdx = plane.hierarchy.motifIndex;
  const cat = categoryForMotif(motifIdx);
  const agenticNonNormie = isAgenticNonNormieCube(motifIdx);
  // Per-motif plane list for the builders (they filter by motif internally —
  // handing them the 3-plane slice instead of all ~12k kills the O(world) scans
  // that dominated rebuild time).
  const _mp = (p) => (planesForMotif ? planesForMotif(p.hierarchy.motifIndex) : serializedPlanes);

  if (isNormieCube(motifIdx)) {
    if (showForest) {
      for (const builder of PLANE_BUILDERS) {
        const result = builder(plane, hilbert, gl, meshes, renderMode, cubeCtx);
        if (!result) continue;
        const items = Array.isArray(result) ? result : [result];
        applyMotifStyle(items, cat, motifIdx);
        applyDim(items, dim);
        itemsOut.push(...items);
        break;
      }
    }
  } else {
    const artItems = showNonNormieArtwork && buildNonNormieArtworkPlane
      ? buildNonNormieArtworkPlane(plane, _mp(plane), gl, meshes)
      : [];
    if (agenticNonNormie) applyAgenticAwakening(artItems);
    applyDim(artItems, dim);
    if (artItems?.length) itemsOut.push(...artItems);

    const walkerItems = showNonNormieWalker && buildNonNormieWalker
      ? buildNonNormieWalker(plane, _mp(plane), gl, meshes)
      : [];
    if (agenticNonNormie) applyAgenticAwakening(walkerItems);
    applyDim(walkerItems, dim);
    if (walkerItems?.length) itemsOut.push(...walkerItems);

    const bannerItems = showNonNormieBanner && buildNonNormieBanner
      ? buildNonNormieBanner(plane, _mp(plane), gl, meshes)
      : [];
    applyBannerGlitch(bannerItems, null);
    if (agenticNonNormie) applyAgenticBannerPulse(bannerItems);
    applyDim(bannerItems, dim);
    if (bannerItems?.length) itemsOut.push(...bannerItems);

    const idLabelItems = showNormieIdLabel && buildNonNormieIdLabel
      ? buildNonNormieIdLabel(plane, _mp(plane), gl, meshes)
      : [];
    if (agenticNonNormie) applyAgenticAwakening(idLabelItems);
    applyDim(idLabelItems, dim);
    if (idLabelItems?.length) itemsOut.push(...idLabelItems);

    if (showForest && agenticNonNormie) {
      const forestItems = buildForestPlane(plane, hilbert, gl, meshes, renderMode, cubeCtx);
      const items = Array.isArray(forestItems) ? forestItems : (forestItems ? [forestItems] : []);
      applyAgenticAwakening(items);
      applyDim(items, dim);
      if (items.length) itemsOut.push(...items);
    }
  }

  if (showNormieOutline) {
    const outlineItems = build2DOutline(plane, gl, meshes);
    applyMotifStyle(outlineItems, cat, motifIdx);
    applyDim(outlineItems, dim);
    if (outlineItems?.length) itemsOut.push(...outlineItems);
  }

  if (isNormieCube(motifIdx)) {
    if (showNormieIdLabel) {
      const idLabelItems = buildNormieIdLabel(plane, gl, meshes);
      applyMotifStyle(idLabelItems, cat, motifIdx);
      applyDim(idLabelItems, dim);
      if (idLabelItems?.length) itemsOut.push(...idLabelItems);
    }

    // Source-contract banner (the Normies address), same as non-Normie cubes get —
    // one consistent banner across all artwork. Replaces the old traits-hash banner,
    // whose data (traits.raw from the normies API) isn't in the self-contained path.
    if (showNormieTraitsBanner && buildNonNormieBanner) {
      const bannerItems = buildNonNormieBanner(plane, _mp(plane), gl, meshes);
      applyMotifStyle(bannerItems, cat, motifIdx);
      applyBannerGlitch(bannerItems, cat);
      applyDim(bannerItems, dim);
      if (bannerItems?.length) itemsOut.push(...bannerItems);
    }
  }

  if (showPlaneOutline) {
    const hilbertEdgeItems = buildPlaneOutline(plane, gl, meshes);
    applyMotifStyle(hilbertEdgeItems, cat, motifIdx);
    applyDim(hilbertEdgeItems, dim);
    if (hilbertEdgeItems?.length) itemsOut.push(...hilbertEdgeItems);
  }

  if (showEdgePoints && buildEdgePointDebug) {
    const edgeItems = buildEdgePointDebug(plane, gl, meshes);
    applyMotifStyle(edgeItems, cat, motifIdx);
    applyDim(edgeItems, dim);
    if (edgeItems?.length) itemsOut.push(...edgeItems);
  }
}

export function buildCubeDetailScene({
  motifIdx,
  hilbert,
  serializedPlanes,
  planesForMotif,
  gl,
  meshes,
  cubeCtx = null,
  dim = 1,
  showCubeGlass = true,
  showEdgePoints = false,
  showStoneWalker = true,
  showVoxels = true,
  showHilbertLines = true,
  showCardioid = true,
  showForest = true,
  showNonNormieArtwork = true,
  showNonNormieWalker = true,
  showNonNormieBanner = true,
  showNormieOutline = true,
  showNormieIdLabel = true,
  showNormieTraitsBanner = true,
  showPlaneOutline = true,
  buildEdgePointDebug = null,
  buildNonNormieArtworkPlane = null,
  buildNonNormieWalker = null,
  buildNonNormieBanner = null,
  buildNonNormieIdLabel = null,
  isAgenticNonNormieCube = identityAgenticNonNormie,
  categoryForMotif = unknownCategory,
}) {
  const items = [];
  pushDetailMotifItems({
    itemsOut: items,
    motifIdx,
    renderMode: '3D',
    dim,
    hilbert,
    serializedPlanes,
    planesForMotif,
    gl,
    meshes,
    showCubeGlass,
    showStoneWalker,
    showVoxels,
    showHilbertLines,
    showCardioid,
    isAgenticNonNormieCube,
    categoryForMotif,
  });

  for (const plane of planesForMotif(motifIdx)) {
    pushDetailPlaneItems({
      itemsOut: items,
      plane,
      renderMode: '3D',
      cubeCtx,
      dim,
      hilbert,
      serializedPlanes,
      gl,
      meshes,
      showEdgePoints,
      showForest,
      showNonNormieArtwork,
      showNonNormieWalker,
      showNonNormieBanner,
      showNormieOutline,
      showNormieIdLabel,
      showNormieTraitsBanner,
      showPlaneOutline,
      buildEdgePointDebug,
      buildNonNormieArtworkPlane,
      buildNonNormieWalker,
      buildNonNormieBanner,
      buildNonNormieIdLabel,
      isAgenticNonNormieCube,
      categoryForMotif,
    });
  }

  return items;
}
