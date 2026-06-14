const BIT_VERSION = 1;

function bytesToBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function base64ToBytes(value) {
  const s = atob(String(value || ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function packBits(values, length = values?.length || 0) {
  const bytes = new Uint8Array(Math.ceil(length / 8));
  for (let i = 0; i < length; i++) {
    if (values[i]) bytes[i >> 3] |= 1 << (i & 7);
  }
  return bytesToBase64(bytes);
}

export function unpackBits(value, length) {
  const bytes = base64ToBytes(value);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (bytes[i >> 3] >> (i & 7)) & 1;
  return out;
}

function packUnitArray(values) {
  if (!values) return '';
  const bytes = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    bytes[i] = Math.max(0, Math.min(255, Math.round(Number(values[i] || 0) * 255)));
  }
  return bytesToBase64(bytes);
}

function unpackUnitArray(value, length) {
  const bytes = base64ToBytes(value);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = (bytes[i] || 0) / 255;
  return out;
}

export function compactGrid(grid) {
  if (!grid || grid.error || grid.discarded) return null;
  const size = Number(grid.gridSize || 40);
  const len = size * size;
  const out = {
    v: BIT_VERSION,
    k: grid.kind === 'smooth' ? 's' : 'p',
    s: size,
    d: Number(grid.depthLayers || 40),
    o: Number(grid.ones || 0),
  };
  if (grid.depthMode) out.m = grid.depthMode === 'color-kmeans' ? 'c' : 'g';
  if (grid.bits) out.b = packBits(grid.bits, len);
  if (grid.grayscale) out.g = packUnitArray(grid.grayscale);
  if (grid.depthValues) out.z = packUnitArray(grid.depthValues);
  if (grid.pixelGrid) {
    out.p = [
      Number(grid.pixelGrid.gridW || 0),
      Number(grid.pixelGrid.gridH || 0),
      Math.round(Number(grid.pixelGrid.score || 0) * 1000),
      Math.round(Number(grid.pixelGrid.flatness || 0) * 1000),
    ];
  }
  return out;
}

export function inflateGrid(snapshot) {
  if (!snapshot) return null;
  const size = Number(snapshot.s || 40);
  const len = size * size;
  const grid = {
    discarded: false,
    kind: snapshot.k === 's' ? 'smooth' : 'pixel',
    gridSize: size,
    depthLayers: Number(snapshot.d || 40),
    ones: Number(snapshot.o || 0),
    bitString: null,
  };
  if (snapshot.m) grid.depthMode = snapshot.m === 'c' ? 'color-kmeans' : 'grayscale';
  if (snapshot.b) {
    grid.bits = unpackBits(snapshot.b, len);
    if (size === 40) grid.bitString = Array.from(grid.bits).join('');
  }
  if (snapshot.g) {
    grid.grayscale = unpackUnitArray(snapshot.g, len);
    grid.intensity = grid.grayscale;
  }
  if (snapshot.z) grid.depthValues = unpackUnitArray(snapshot.z, len);
  if (snapshot.p) {
    grid.pixelGrid = {
      gridW: snapshot.p[0],
      gridH: snapshot.p[1],
      score: snapshot.p[2] / 1000,
      flatness: snapshot.p[3] / 1000,
    };
  }
  return grid;
}

export function compactNormieArt({ id, current, original, canvas, traits, agentic, agentId }) {
  const edited = Boolean(canvas && canvas.some(v => v !== 0));
  const art = {
    v: BIT_VERSION,
    k: 'n',
    id: Number(id),
    a: agentic ? 1 : 0,
    p: packBits(current, 1600),
  };
  if (agentId) art.ai = String(agentId);
  if (edited && original) art.o = packBits(original, 1600);
  if (edited) art.c = packBits(canvas, 1600);
  if (traits) {
    const raw = JSON.stringify(traits);
    art.th = fnv1a(raw).toString(16).padStart(8, '0');
    const attrs = Array.isArray(traits.attributes) ? traits.attributes : [];
    art.t = attrs
      .filter(a => a?.trait_type && a?.value !== undefined)
      .slice(0, 24)
      .map(a => [String(a.trait_type), String(a.value)]);
  }
  return art;
}

export function rawNormieBytesToPixels(raw) {
  if (!raw || raw.length !== 200) return null;
  const pixels = new Uint8Array(1600);
  for (let i = 0; i < 1600; i++) {
    pixels[i] = (raw[i >> 3] >> (7 - (i & 7))) & 1;
  }
  return pixels;
}

export function compactNormieArtFromRaw({ id, raw, traits, agentic, agentId }) {
  const current = rawNormieBytesToPixels(raw);
  if (!current) return null;
  return compactNormieArt({
    id,
    current,
    original: current,
    canvas: new Uint8Array(1600),
    traits,
    agentic,
    agentId,
  });
}

export function inflateNormieArt(art) {
  if (!art || art.k !== 'n') return null;
  const current = unpackBits(art.p, 1600);
  const original = art.o ? unpackBits(art.o, 1600) : current;
  const canvas = art.c ? unpackBits(art.c, 1600) : new Uint8Array(1600);
  return {
    id: Number(art.id),
    current,
    original,
    canvas,
    traits: art.t ? { attributes: art.t.map(([trait_type, value]) => ({ trait_type, value })) } : null,
    traitHash: art.th || '',
    awakened: Boolean(art.a),
    agentId: art.ai || '',
    edited: canvas.some(v => v !== 0),
  };
}

function fnv1a(value) {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
