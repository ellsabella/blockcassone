// Normies API - fetch data for a given normie ID (0-9999).
// Pixel endpoints are parsed to a 40x40 Uint8Array, where
// index = row * 40 + col, value = 0 or 1.

const API_ROOT = '/api/normies';
const BASE_URL = `${API_ROOT}/normie`;
const GRID_SIZE = 40;
const PIXEL_COUNT = GRID_SIZE * GRID_SIZE;

async function fetchText(url, id) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`normies API ${res.status} for id ${id}`);
  return res.text();
}

async function fetchJson(url, id) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`normies API ${res.status} for id ${id}`);
  return res.json();
}

async function fetchBinaryPixels(url, id) {
  const text = await fetchText(url, id);
  const clean = text.replace(/\s/g, '');
  if (clean.length !== PIXEL_COUNT)
    console.warn(`normies id ${id}: expected ${PIXEL_COUNT} chars, got ${clean.length}`);

  const pixels = new Uint8Array(PIXEL_COUNT);
  for (let i = 0; i < clean.length && i < PIXEL_COUNT; i++)
    pixels[i] = clean[i] === '1' ? 1 : 0;
  return pixels;
}

// Current composited bitmap. If a Normie has been edited, this is
// original/pixels XOR canvas/pixels.
export async function fetchNormiePixels(id) {
  return fetchBinaryPixels(`${BASE_URL}/${id}/pixels`, id);
}

// Original pre-Canvas bitmap.
export async function fetchNormieOriginalPixels(id) {
  return fetchBinaryPixels(`${BASE_URL}/${id}/original/pixels`, id);
}

// Canvas transform layer. This is not a composited image; each 1 means the
// corresponding original pixel is flipped.
export async function fetchNormieCanvasPixels(id) {
  return fetchBinaryPixels(`${BASE_URL}/${id}/canvas/pixels`, id);
}

// Pixel-level edit summary: { added, removed, addedCount, removedCount, netChange }.
export async function fetchNormieCanvasDiff(id) {
  return fetchJson(`${BASE_URL}/${id}/canvas/diff`, id);
}

export async function fetchNormieCanvasInfo(id) {
  return fetchJson(`${BASE_URL}/${id}/canvas/info`, id);
}

export async function fetchNormieTraits(id) {
  return fetchJson(`${BASE_URL}/${id}/traits`, id);
}

export async function fetchNormieTraitsBinary(id) {
  return fetchText(`${BASE_URL}/${id}/traits/binary`, id);
}

export async function fetchNormieMetadata(id) {
  return fetchJson(`${BASE_URL}/${id}/metadata`, id);
}

export async function fetchNormieOwner(id) {
  return fetchJson(`${BASE_URL}/${id}/owner`, id);
}

export async function fetchNormieBurnedInfo(id) {
  console.debug(`[normies] burned-history probe skipped for id ${id}`);
  return null;
}

export async function fetchAgentBinding(id) {
  return fetchJson(`${API_ROOT}/agents/binding/${id}`, id);
}

export async function fetchCanvasStatus() {
  return fetchJson(`${API_ROOT}/canvas/status`, 'canvas');
}

// Convenience: get a single pixel value (row 0-39, col 0-39).
export function getPixel(pixels, row, col) {
  return pixels[row * GRID_SIZE + col];
}

// Convenience: extract a rectangular sub-region as a new Uint8Array.
export function getRegion(pixels, r0, c0, r1, c1) {
  const h = r1 - r0, w = c1 - c0;
  const out = new Uint8Array(h * w);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      out[r * w + c] = pixels[(r0 + r) * GRID_SIZE + (c0 + c)];
    }
  }
  return out;
}
