// Normie data layer — fetch cache, pixel arrays, texture cache.
// Owns all shared mutable state; other normie modules import accessors from here.

import { normieIdFromAssignedNft } from '../assignment.js';
import { compactNormieArtFromRaw, inflateNormieArt } from '../art-snapshot.js';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let gl_       = null;
let allPlanes_ = null;
let onDataReady = null;

const fetchCache       = new Map();
const statusFetchCache = new Map();
const pixelCache       = new Map();
export const normieCache = new Map();
const texCache         = new Map();

let normiesApiPromise = null;
function loadNormiesApi() {
  if (!normiesApiPromise) {
    normiesApiPromise = import('../' + 'normies-api.js');
  }
  return normiesApiPromise;
}

export function initNormiesManager(gl, planes) {
  gl_ = gl;
  if (planes) allPlanes_ = planes;
}

export function setDataReadyCallback(cb) { onDataReady = cb; }

export function getAllPlanes() { return allPlanes_; }

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isBurnedPayload(payload) {
  if (!payload) return false;
  if (payload.burned !== undefined) return Boolean(payload.burned);
  if (payload.tokenId !== undefined || payload.owner !== undefined || payload.burnedAt !== undefined) return true;
  if (payload.commitment || payload.burn || payload.event) return true;
  return false;
}

function classifyNormie(data) {
  if (!data) return null;
  if (data.burned) return 0;
  if (data.awakened && data.edited) return 4;
  if (data.awakened) return 3;
  if (data.edited) return 2;
  return 1;
}

function logOptionalFetchFailure(label, id, err) {
  const message = String(err?.message || err);
  const log = /\b(?:429|500|502|503|504)\b/.test(message) ? console.debug : console.warn;
  log(`[normies] ${label} failed ${id}:`, err);
}

function planeRoleForCubePlane(plane, cubePlanes) {
  const axisCounts = {};
  for (const p of cubePlanes) axisCounts[p.axis] = (axisCounts[p.axis] || 0) + 1;
  const uniqueAxis  = Object.keys(axisCounts).find(ax => axisCounts[ax] === 1);
  const mainPlane   = uniqueAxis ? cubePlanes.find(p => p.axis === uniqueAxis) : cubePlanes[0];
  if (!mainPlane || plane.id === mainPlane.id) return 'current';
  const sidePlanes  = cubePlanes.filter(p => p.id !== mainPlane.id).sort((a, b) => (a.id||0) - (b.id||0));
  return sidePlanes.findIndex(p => p.id === plane.id) === 0 ? 'original' : 'canvas';
}

function pixelArrayForRole(data, role) {
  if (!data) return null;
  if (!data.edited) return data.current;
  if (role === 'original') return data.original || data.current;
  if (role === 'canvas')   return data.canvas   || data.current;
  return data.current;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export function ensureFetched(id) {
  if (id === null || id === undefined) return;
  if (fetchCache.has(id)) return;
  const p = loadNormiesApi().then(api => Promise.all([
    api.fetchNormiePixels(id),
    api.fetchNormieOriginalPixels(id),
    api.fetchNormieCanvasPixels(id),
    api.fetchNormieCanvasDiff(id).catch(err => { logOptionalFetchFailure('canvas diff', id, err); return null; }),
    api.fetchNormieCanvasInfo(id).catch(err => { logOptionalFetchFailure('canvas info', id, err); return null; }),
    api.fetchNormieTraits(id).catch(err => { logOptionalFetchFailure('traits', id, err); return null; }),
  ])).then(([current, original, canvas, diff, info, traits]) => {
    const prev   = normieCache.get(id) || {};
    const edited = Boolean(info?.customized) || canvas.some(v => v !== 0);
    normieCache.set(id, { ...prev, current, original, canvas, diff, info, traits, edited, category: classifyNormie({ ...prev, edited }) });
    pixelCache.set(id, current);
    if (gl_) texCache.set(id, makeNormieTexture(gl_, current));
    if (onDataReady) onDataReady();
  }).catch(err => { console.warn(`[normies] fetch failed ${id}:`, err); });
  fetchCache.set(id, p);
}

export function hydrateNormieArtSnapshot(snapshot) {
  const data = inflateNormieArt(snapshot);
  if (!data || data.id === null || data.id === undefined) return;
  const prev = normieCache.get(data.id) || {};
  const next = {
    ...prev,
    current: data.current,
    original: data.original,
    canvas: data.canvas,
    traits: data.traits || prev.traits || null,
    traitHash: data.traitHash,
    edited: data.edited,
    awakened: data.awakened,
    bindingInfo: data.awakened ? { binding: true, agentId: data.agentId } : prev.bindingInfo,
  };
  next.category = classifyNormie(next);
  normieCache.set(data.id, next);
  pixelCache.set(data.id, data.current);
  fetchCache.set(data.id, Promise.resolve(next));
  statusFetchCache.set(data.id, Promise.resolve(next));
  if (gl_ && !texCache.has(data.id)) texCache.set(data.id, makeNormieTexture(gl_, data.current));
}

export function hydrateNormieRawBytes({ id, raw, traits = null, agentic = false, agentId = '' }) {
  const snapshot = compactNormieArtFromRaw({ id, raw, traits, agentic, agentId });
  if (snapshot) hydrateNormieArtSnapshot(snapshot);
}

export function ensureNormieStatusFetched(id) {
  if (id === null || id === undefined) return;
  ensureFetched(id);
  if (statusFetchCache.has(id)) return;
  const p = loadNormiesApi().then(api => Promise.all([
    api.fetchNormieBurnedInfo(id).catch(err => { if (err?.message && !err.message.includes('404')) console.warn(`[normies] burned info failed ${id}:`, err); return null; }),
    api.fetchAgentBinding(id).catch(err => { logOptionalFetchFailure('agent binding', id, err); return null; }),
  ])).then(([burnedInfo, bindingInfo]) => {
    const prev = normieCache.get(id) || {};
    const next = { ...prev, burnedInfo, bindingInfo, burned: isBurnedPayload(burnedInfo), awakened: Boolean(bindingInfo?.binding) };
    next.category = classifyNormie(next);
    normieCache.set(id, next);
    if (onDataReady) onDataReady();
  });
  statusFetchCache.set(id, p);
}

export function ensurePixelsFetched(id) { ensureFetched(id); }

// ---------------------------------------------------------------------------
// Data accessors
// ---------------------------------------------------------------------------

export function getNormieCategory(id) {
  if (id === null || id === undefined) return null;
  return normieCache.get(id)?.category ?? null;
}

export function getNormieAge(id) {
  if (id === null || id === undefined) return null;
  const attrs = normieCache.get(id)?.traits?.attributes;
  if (!Array.isArray(attrs)) return null;
  return attrs.find(a => a?.trait_type === 'Age')?.value ?? null;
}

export function getNormieData(id) { return normieCache.get(id) ?? null; }

export function getPlanePixelArray(plane, allPlanes = allPlanes_) {
  const motifIdx = plane.hierarchy?.motifIndex;
  const id = normieIdForCube_internal(motifIdx, allPlanes);
  if (id === null || id === undefined) return null;
  ensureFetched(id);
  const data = normieCache.get(id);
  if (!data) return null;
  const cubePlanes = (allPlanes || []).filter(p => p.hierarchy?.motifIndex === motifIdx);
  const role = planeRoleForCubePlane(plane, cubePlanes.length ? cubePlanes : [plane]);
  return pixelArrayForRole(data, role);
}

// Internal: resolve normie ID for a motif without importing from status.js
// (avoids circular dep — status.js imports from us).
function normieIdForCube_internal(motifIdx, planes) {
  const assignedId = normieIdFromAssignedNft(motifIdx);
  if (assignedId !== null && assignedId !== undefined) return assignedId;
  // Inline the hash check to avoid importing isNormieCube.
  let h = Math.imul((motifIdx + 1) >>> 0, 0x9e3779b1) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13;
  if ((h % 100) >= 62) return null;
  const cubePlanes = (planes || allPlanes_ || []).filter(p => p.hierarchy?.motifIndex === motifIdx);
  if (cubePlanes.length === 0) return 0;
  const axisCounts = {};
  for (const p of cubePlanes) axisCounts[p.axis] = (axisCounts[p.axis] || 0) + 1;
  const uniqueAxis  = Object.keys(axisCounts).find(ax => axisCounts[ax] === 1);
  const uniquePlane = uniqueAxis ? cubePlanes.find(p => p.axis === uniqueAxis) : cubePlanes[0];
  let hh = (uniquePlane.id * 2654435761) >>> 0;
  hh ^= hh >>> 16; hh = Math.imul(hh, 0x45d9f3b) >>> 0; hh ^= hh >>> 16;
  return (hh >>> 0) % 10000;
}

// ---------------------------------------------------------------------------
// Texture
// ---------------------------------------------------------------------------

function makeNormieTexture(gl, pixels) {
  const data = new Uint8Array(1600);
  for (let i = 0; i < 1600; i++) data[i] = pixels[i] ? 255 : 0;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 40, 40, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

// ---------------------------------------------------------------------------
// Pixel-function utility — used by voxels, stone-walker, non-normie-art-plane
// ---------------------------------------------------------------------------
export function makePlanePixelFn(plane, mn, voxelSize, corners) {
  const p  = corners || plane.vertices.positions;
  const p0 = p[0], p1 = p[1], p3 = p[3];
  const ax = plane.axis;
  const [a0, a1] = ax === 'x' ? [1, 2] : ax === 'y' ? [0, 2] : [0, 1];
  const coord = (pt, a) => a === 0 ? pt.x : a === 1 ? pt.y : pt.z;
  const o0 = coord(p0, a0), o1 = coord(p0, a1);
  const A = coord(p1, a0) - o0, B = coord(p3, a0) - o0;
  const C = coord(p1, a1) - o1, D = coord(p3, a1) - o1;
  const det = A * D - B * C;
  return (xi, yi, zi) => {
    const w = [
      mn[0] + (xi + 0.5) * voxelSize[0],
      mn[1] + (yi + 0.5) * voxelSize[1],
      mn[2] + (zi + 0.5) * voxelSize[2],
    ];
    const dx = w[a0] - o0, dy = w[a1] - o1;
    const col = Math.max(0, Math.min(39, Math.floor(((dx * D - dy * B) / det) * 40)));
    const row = Math.max(0, Math.min(39, Math.floor(((dy * A - dx * C) / det) * 40)));
    return row * 40 + col;
  };
}
