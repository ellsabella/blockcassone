const GRID_SIZE = 40;
const SMOOTH_GRID_SIZE = 120;
const THRESHOLD = 0.5;
const OTSU_BINS = 256;
const NUM_BANDS = 3;
const ANALYSIS_MAX_SIZE = 1024;
const MIN_PIXEL_GRID = 4;
const MAX_PIXEL_GRID = 96;
const MIN_PIXEL_ART_SCORE = 1.15;
const MIN_FLATNESS = 0.54;
const TRANSITION_THRESHOLD = 0.065;
const COMMON_PIXEL_GRIDS = [8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96];
const LOW_GRAYSCALE_RANGE = 0.18;
const LOW_GRAYSCALE_STD = 0.045;
const CROP_ALPHA_THRESHOLD_8BIT = 5;
const CROP_MAX_CONTENT_RATIO = 0.85;
const CROP_MIN_BBOX = 16;
const CROP_MARGIN_PX = 2;
const VIDEO_FRAME_TIMEOUT_MS = 9000;

function proxiedImageUrl(url) {
  return `/api/image?url=${encodeURIComponent(url)}`;
}

function normalizeMediaUrl(url) {
  const clean = String(url || '').trim();
  if (clean.startsWith('ipfs://ipfs/')) return `https://ipfs.io/ipfs/${clean.slice('ipfs://ipfs/'.length)}`;
  if (clean.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${clean.slice('ipfs://'.length)}`;
  if (clean.startsWith('ar://')) return `https://arweave.net/${clean.slice('ar://'.length)}`;
  return clean;
}

async function loadImageFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadImageFromDataUrl(dataUrl) {
  const img = new Image();
  img.decoding = 'async';
  img.src = dataUrl;
  await img.decode();
  return img;
}

function waitForVideoEvent(video, eventName, timeoutMs = VIDEO_FRAME_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`video ${eventName} timed out`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener(eventName, onEvent);
      video.removeEventListener('error', onError);
    }
    function onEvent() {
      cleanup();
      resolve();
    }
    function onError() {
      cleanup();
      reject(new Error('video decode failed'));
    }
    video.addEventListener(eventName, onEvent, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

async function loadVideoFrameFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    await waitForVideoEvent(video, 'loadedmetadata');

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    const targetTime = Math.min(Math.max(duration * 0.18, 0.12), Math.max(0, duration - 0.05));
    if (targetTime > 0.01) {
      video.currentTime = targetTime;
      await waitForVideoEvent(video, 'seeked');
    } else {
      await waitForVideoEvent(video, 'loadeddata');
    }

    const width = video.videoWidth || 1;
    const height = video.videoHeight || 1;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);
    void (`[nft-grid] extracted video frame ${width}x${height}`, { duration, targetTime });
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadImageFromUrl(url) {
  if (url.startsWith('data:')) {
    return loadImageFromDataUrl(url);
  }

  const res = await fetch(proxiedImageUrl(normalizeMediaUrl(url)));
  if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
  return loadImageFromBlob(await res.blob());
}

function decodeHtmlEntities(value) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function embeddedRasterUrlFromSvg(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const nodes = Array.from(doc.querySelectorAll('image,img'));
  for (const node of nodes) {
    const src =
      node.getAttribute('href') ||
      node.getAttribute('xlink:href') ||
      node.getAttribute('src');
    if (src && /^data:image\//i.test(src)) return decodeHtmlEntities(src);
  }

  const match = svgText.match(/\b(?:href|src)=["']([^"']*data:image\/[^"']+)["']/i);
  return match ? decodeHtmlEntities(match[1]) : null;
}

function svgTextToDataUrl(svgText) {
  let text = svgText;
  if (!/\b(?:width|height)=/i.test(text) && /\bviewBox=/i.test(text)) {
    text = text.replace(/<svg\b/i, '<svg width="1024" height="1024"');
  }
  if (!/\bxmlns=/.test(text)) {
    text = text.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
}

async function loadImageFromProxyResponse(res, normalizedUrl) {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const isSvg = contentType.includes('svg') || /\.svg(?:$|[?#])/i.test(normalizedUrl);
  const isVideo = contentType.startsWith('video/') || /\.(?:mp4|webm|mov|m4v|ogv)(?:$|[?#])/i.test(normalizedUrl);

  if (isVideo) {
    void (`[nft-grid] video media detected; extracting representative frame`, normalizedUrl);
    return loadVideoFrameFromBlob(await res.blob());
  }

  if (isSvg) {
    const svgText = await res.text();
    const embedded = embeddedRasterUrlFromSvg(svgText);
    if (embedded) {
      void (`[nft-grid] SVG contains embedded raster; sampling raster directly`, normalizedUrl);
      return loadImageFromUrl(embedded);
    }

    void (`[nft-grid] SVG has no embedded raster; rasterizing SVG wrapper`, normalizedUrl);
    return loadImageFromDataUrl(svgTextToDataUrl(svgText));
  }

  return loadImageFromBlob(await res.blob());
}

function drawForAnalysis(img) {
  const scale = Math.min(1, ANALYSIS_MAX_SIZE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return { w, h, data: ctx.getImageData(0, 0, w, h).data };
}

function cropToContent(sample) {
  const { w, h, data } = sample;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > CROP_ALPHA_THRESHOLD_8BIT) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return { sample, cropped: false, reason: 'all-transparent' };
  }
  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  if (bboxW < CROP_MIN_BBOX || bboxH < CROP_MIN_BBOX) {
    return { sample, cropped: false, reason: 'bbox-too-small', bboxW, bboxH };
  }
  const contentRatio = (bboxW * bboxH) / (w * h);
  if (contentRatio >= CROP_MAX_CONTENT_RATIO) {
    return { sample, cropped: false, reason: 'fills-canvas', contentRatio };
  }
  const cx0 = Math.max(0, minX - CROP_MARGIN_PX);
  const cy0 = Math.max(0, minY - CROP_MARGIN_PX);
  const cx1 = Math.min(w, maxX + 1 + CROP_MARGIN_PX);
  const cy1 = Math.min(h, maxY + 1 + CROP_MARGIN_PX);
  const cw = cx1 - cx0;
  const ch = cy1 - cy0;
  const cData = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcRow = (cy0 + y) * w + cx0;
    const dstRow = y * cw;
    for (let x = 0; x < cw; x++) {
      const s = (srcRow + x) * 4;
      const d = (dstRow + x) * 4;
      cData[d]     = data[s];
      cData[d + 1] = data[s + 1];
      cData[d + 2] = data[s + 2];
      cData[d + 3] = data[s + 3];
    }
  }
  return {
    sample: { w: cw, h: ch, data: cData },
    cropped: true,
    originalSize: `${w}x${h}`,
    croppedSize: `${cw}x${ch}`,
    contentRatio,
    bbox: { minX, minY, maxX, maxY },
  };
}

function pixelDiff(data, idxA, idxB) {
  const ar = data[idxA] / 255, ag = data[idxA + 1] / 255, ab = data[idxA + 2] / 255, aa = data[idxA + 3] / 255;
  const br = data[idxB] / 255, bg = data[idxB + 1] / 255, bb = data[idxB + 2] / 255, ba = data[idxB + 3] / 255;
  return (Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb)) * 0.333 + Math.abs(aa - ba) * 0.25;
}

function edgeProfiles(sample) {
  const { w, h, data } = sample;
  const vertical = new Float32Array(Math.max(0, w - 1));
  const horizontal = new Float32Array(Math.max(0, h - 1));

  for (let x = 1; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < h; y++) {
      const a = (y * w + x - 1) * 4;
      const b = (y * w + x) * 4;
      sum += pixelDiff(data, a, b);
    }
    vertical[x - 1] = sum / h;
  }

  for (let y = 1; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      const a = ((y - 1) * w + x) * 4;
      const b = (y * w + x) * 4;
      sum += pixelDiff(data, a, b);
    }
    horizontal[y - 1] = sum / w;
  }

  return { vertical, horizontal };
}

function transitionProfiles(sample) {
  const { w, h, data } = sample;
  const vertical = new Float32Array(Math.max(0, w - 1));
  const horizontal = new Float32Array(Math.max(0, h - 1));

  for (let x = 1; x < w; x++) {
    let hits = 0;
    for (let y = 0; y < h; y++) {
      const a = (y * w + x - 1) * 4;
      const b = (y * w + x) * 4;
      if (pixelDiff(data, a, b) > TRANSITION_THRESHOLD) hits++;
    }
    vertical[x - 1] = hits / h;
  }

  for (let y = 1; y < h; y++) {
    let hits = 0;
    for (let x = 0; x < w; x++) {
      const a = ((y - 1) * w + x) * 4;
      const b = (y * w + x) * 4;
      if (pixelDiff(data, a, b) > TRANSITION_THRESHOLD) hits++;
    }
    horizontal[y - 1] = hits / w;
  }

  return { vertical, horizontal };
}

function robustMax(profile) {
  let max = 0;
  for (let i = 0; i < profile.length; i++) if (profile[i] > max) max = profile[i];
  return max;
}

function clusteredTransitionPositions(profile) {
  const max = robustMax(profile);
  if (max <= 0.0005) return [];
  const threshold = Math.max(0.0025, max * 0.18);
  const out = [];
  let sumPos = 0, sumWeight = 0, bestWeight = 0, bestPos = 0;

  function flush() {
    if (sumWeight <= 0) return;
    out.push(sumWeight > bestWeight * 1.35 ? (sumPos / sumWeight) : bestPos);
    sumPos = 0; sumWeight = 0; bestWeight = 0; bestPos = 0;
  }

  for (let i = 0; i < profile.length; i++) {
    const v = profile[i];
    if (v >= threshold) {
      const pos = i + 1;
      sumPos += pos * v;
      sumWeight += v;
      if (v > bestWeight) {
        bestWeight = v;
        bestPos = pos;
      }
    } else {
      flush();
    }
  }
  flush();
  return out;
}

function meanProfile(profile) {
  if (!profile.length) return 0;
  let sum = 0;
  for (let i = 0; i < profile.length; i++) sum += profile[i];
  return sum / profile.length;
}

function profileAt(profile, position) {
  if (!profile.length) return 0;
  const i = Math.max(0, Math.min(profile.length - 1, Math.round(position) - 1));
  let best = profile[i];
  if (i > 0) best = Math.max(best, profile[i - 1]);
  if (i + 1 < profile.length) best = Math.max(best, profile[i + 1]);
  return best;
}

function scoreGridAxis(profile, length, cells) {
  const mean = meanProfile(profile);
  if (mean <= 0.0001) return { cells, score: 0, boundary: 0, interior: 0 };

  let boundarySum = 0;
  for (let i = 1; i < cells; i++) {
    boundarySum += profileAt(profile, (i * length) / cells);
  }
  const boundary = boundarySum / Math.max(1, cells - 1);

  let interiorSum = 0;
  for (let i = 0; i < cells; i++) {
    interiorSum += profileAt(profile, ((i + 0.5) * length) / cells);
  }
  const interior = interiorSum / Math.max(1, cells);
  const score = (boundary - interior * 0.55) / (mean + 0.012);
  return { cells, score, boundary, interior };
}

function inferGridAxis(profile, length) {
  const maxCells = Math.max(MIN_PIXEL_GRID, Math.min(MAX_PIXEL_GRID, Math.floor(length / 2)));
  let best = { cells: 0, score: -Infinity, boundary: 0, interior: 0 };
  for (let cells = MIN_PIXEL_GRID; cells <= maxCells; cells++) {
    const candidate = scoreGridAxis(profile, length, cells);
    const regularityPenalty = (Math.abs((length / cells) - Math.round(length / cells)) < 0.08) ? 0.10 : 0;
    candidate.score += regularityPenalty;
    if (candidate.score > best.score) best = candidate;
  }
  return best;
}

function scoreTransitionGrid(positions, length, cells) {
  if (positions.length < 2) return { cells, score: 0, fit: 0, coverage: 0 };
  const pitch = length / cells;
  const tolerance = Math.max(1.2, pitch * 0.18);
  let fitSum = 0;
  const usedLines = new Set();
  for (const pos of positions) {
    const nearest = Math.max(1, Math.min(cells - 1, Math.round(pos / pitch)));
    const expected = nearest * pitch;
    const dist = Math.abs(pos - expected);
    const fit = Math.max(0, 1 - dist / tolerance);
    fitSum += fit;
    if (fit > 0.45) usedLines.add(nearest);
  }
  const fit = fitSum / positions.length;
  const coverage = Math.min(1, usedLines.size / Math.max(3, cells * 0.18));
  const commonBoost = COMMON_PIXEL_GRIDS.includes(cells) ? 0.08 : 0;
  return { cells, score: fit * 1.12 + coverage * 0.38 + commonBoost, fit, coverage };
}

function inferGridAxisFromTransitions(positions, length) {
  const maxCells = Math.max(MIN_PIXEL_GRID, Math.min(MAX_PIXEL_GRID, Math.floor(length / 2)));
  let best = { cells: 0, score: 0, fit: 0, coverage: 0 };
  for (let cells = MIN_PIXEL_GRID; cells <= maxCells; cells++) {
    const candidate = scoreTransitionGrid(positions, length, cells);
    if (candidate.score > best.score) best = candidate;
  }
  return best;
}

function cellStats(sample, gridW, gridH) {
  const { w, h, data } = sample;
  const colors = new Array(gridW * gridH);
  let flatCells = 0;

  for (let row = 0; row < gridH; row++) {
    const y0 = Math.floor((row * h) / gridH);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * h) / gridH));
    for (let col = 0; col < gridW; col++) {
      const x0 = Math.floor((col * w) / gridW);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * w) / gridW));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      let minLum = Infinity, maxLum = -Infinity;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * w + x) * 4;
          const pr = data[idx] / 255;
          const pg = data[idx + 1] / 255;
          const pb = data[idx + 2] / 255;
          const pa = data[idx + 3] / 255;
          const lum = (0.299 * pr + 0.587 * pg + 0.114 * pb) * pa;
          r += pr; g += pg; b += pb; a += pa; n++;
          if (lum < minLum) minLum = lum;
          if (lum > maxLum) maxLum = lum;
        }
      }
      const inv = 1 / Math.max(1, n);
      if (maxLum - minLum < 0.08) flatCells++;
      colors[row * gridW + col] = { r: r * inv, g: g * inv, b: b * inv, a: a * inv };
    }
  }

  return { colors, flatness: flatCells / Math.max(1, gridW * gridH) };
}

function colorKey(c) {
  const r = Math.round(c.r * 15);
  const g = Math.round(c.g * 15);
  const b = Math.round(c.b * 15);
  const a = Math.round(c.a * 15);
  return `${r},${g},${b},${a}`;
}

function backgroundColor(colors, gridW, gridH) {
  const counts = new Map();
  const edgeCells = [];
  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) {
      if (row !== 0 && col !== 0 && row !== gridH - 1 && col !== gridW - 1) continue;
      edgeCells.push(colors[row * gridW + col]);
    }
  }
  for (const c of edgeCells) {
    const key = colorKey(c);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let bestKey = null, bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  if (!bestKey) return { r: 0, g: 0, b: 0, a: 1 };
  const [r, g, b, a] = bestKey.split(',').map(Number);
  return { r: r / 15, g: g / 15, b: b / 15, a: a / 15 };
}

function grayFor(c) {
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) * c.a;
}

function colorHue(c) {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const d = max - min;
  if (d < 1e-6) return 0;
  let h = 0;
  if (max === c.r) h = ((c.g - c.b) / d) % 6;
  else if (max === c.g) h = (c.b - c.r) / d + 2;
  else h = (c.r - c.g) / d + 4;
  h /= 6;
  return h < 0 ? h + 1 : h;
}

function grayscaleStats(values) {
  let min = Infinity, max = -Infinity, sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const mean = sum / Math.max(1, values.length);
  let variance = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - mean;
    variance += d * d;
  }
  return {
    min,
    max,
    mean,
    range: max - min,
    std: Math.sqrt(variance / Math.max(1, values.length)),
  };
}

function colorDistance2(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  const da = (a.a ?? 1) - (b.a ?? 1);
  return dr*dr + dg*dg + db*db + da*da * 0.18;
}

function kMeansDepthValues(colors, k = 40) {
  if (!colors.length) return new Float32Array();
  const sorted = colors
    .map((c, i) => ({ c, i, key: grayFor(c) * 0.45 + colorHue(c) * 0.45 + c.a * 0.10 }))
    .sort((a, b) => a.key - b.key);
  const count = Math.min(k, colors.length);
  const centers = [];
  for (let i = 0; i < count; i++) {
    const src = sorted[Math.floor(((i + 0.5) / count) * sorted.length)].c;
    centers.push({ r: src.r, g: src.g, b: src.b, a: src.a });
  }

  const assignments = new Uint16Array(colors.length);
  for (let iter = 0; iter < 8; iter++) {
    const sums = Array.from({ length: count }, () => ({ r: 0, g: 0, b: 0, a: 0, n: 0 }));
    for (let i = 0; i < colors.length; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < count; c++) {
        const d = colorDistance2(colors[i], centers[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      assignments[i] = best;
      const s = sums[best];
      s.r += colors[i].r; s.g += colors[i].g; s.b += colors[i].b; s.a += colors[i].a; s.n++;
    }
    for (let c = 0; c < count; c++) {
      const s = sums[c];
      if (!s.n) continue;
      centers[c] = { r: s.r / s.n, g: s.g / s.n, b: s.b / s.n, a: s.a / s.n };
    }
  }

  const order = centers
    .map((c, i) => ({
      i,
      key: grayFor(c) * 0.35 + colorHue(c) * 0.55 + Math.max(c.r, c.g, c.b) * 0.10,
    }))
    .sort((a, b) => a.key - b.key);
  const rank = new Float32Array(count);
  for (let i = 0; i < order.length; i++) rank[order[i].i] = count <= 1 ? 0 : i / (count - 1);

  const depthValues = new Float32Array(colors.length);
  for (let i = 0; i < colors.length; i++) depthValues[i] = rank[assignments[i]];
  return depthValues;
}

export function otsuMultiLevelThresholds(grayscale, numThresholds = NUM_BANDS - 1, numBins = OTSU_BINS) {
  const hist = new Float64Array(numBins);
  const total = grayscale.length;
  if (total === 0) return new Array(numThresholds).fill(THRESHOLD);
  for (let i = 0; i < total; i++) {
    const v = grayscale[i];
    const bin = v >= 1 ? numBins - 1 : Math.max(0, Math.floor(v * numBins));
    hist[bin]++;
  }
  for (let i = 0; i < numBins; i++) hist[i] /= total;

  const P = new Float64Array(numBins + 1);
  const S = new Float64Array(numBins + 1);
  for (let i = 0; i < numBins; i++) {
    P[i + 1] = P[i] + hist[i];
    S[i + 1] = S[i] + i * hist[i];
  }
  const classVar = (a, b) => {
    const w = P[b] - P[a];
    if (w <= 1e-12) return 0;
    const mu = (S[b] - S[a]) / w;
    return w * mu * mu;
  };

  if (numThresholds === 1) {
    let best = -1, bestT = numBins >> 1;
    for (let t = 1; t < numBins; t++) {
      const v = classVar(0, t) + classVar(t, numBins);
      if (v > best) { best = v; bestT = t; }
    }
    return [bestT / numBins];
  }
  if (numThresholds === 2) {
    let best = -1, bestT1 = 1, bestT2 = 2;
    for (let t1 = 1; t1 < numBins - 1; t1++) {
      const v1 = classVar(0, t1);
      for (let t2 = t1 + 1; t2 < numBins; t2++) {
        const v = v1 + classVar(t1, t2) + classVar(t2, numBins);
        if (v > best) { best = v; bestT1 = t1; bestT2 = t2; }
      }
    }
    return [bestT1 / numBins, bestT2 / numBins];
  }
  throw new Error(`otsuMultiLevelThresholds: unsupported numThresholds=${numThresholds}`);
}

// Area-average downsample of a square grayscale buffer (srcSize -> dstSize).
function downsampleGrayscale(src, srcSize, dstSize) {
  const factor = srcSize / dstSize;
  const dst = new Float32Array(dstSize * dstSize);
  for (let row = 0; row < dstSize; row++) {
    for (let col = 0; col < dstSize; col++) {
      const r0 = Math.floor(row * factor), r1 = Math.min(srcSize, Math.ceil((row + 1) * factor));
      const c0 = Math.floor(col * factor), c1 = Math.min(srcSize, Math.ceil((col + 1) * factor));
      let sum = 0, count = 0;
      for (let r = r0; r < r1; r++) {
        for (let c = c0; c < c1; c++) { sum += src[r * srcSize + c]; count++; }
      }
      dst[row * dstSize + col] = count > 0 ? sum / count : 0;
    }
  }
  return dst;
}

// Subject/background separation. A subject on a background (solid-colour character
// art, pixel art with a sky + floor, BRAINROT, etc.) can't be separated by global
// luminance Otsu — the subject holds both bright and dark parts. Instead we detect
// the background from the border/corners (MULTI-region: up to 3 dominant colours,
// so a bright sky AND a floor both count as background), then band the SUBJECT's
// luminance into 3 tonal levels (using all four payload states, 0 = background).
const BG_KEY_DIST2 = 0.03;      // squared RGB distance to call a pixel "background"
const BG_KEY_MIN_LIT = 12;      // ignore near-empty results
const BG_KEY_MAX_FILL = 0.94;   // ignore results that fill almost everything (bad bg guess)

// Background seeds = the dominant border/corner colours (up to 3 covering ~85% of
// the border). Corners weighted x2; transparent handled by the caller's alpha test.
function bgSeeds(colors, size) {
  const counts = new Map();
  const push = c => {
    if (!c || c.a < 0.15) return;
    const k = `${Math.round(c.r * 7)},${Math.round(c.g * 7)},${Math.round(c.b * 7)}`;
    const e = counts.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += c.r; e.g += c.g; e.b += c.b; counts.set(k, e);
  };
  for (let i = 0; i < size; i++) { push(colors[i]); push(colors[(size - 1) * size + i]); push(colors[i * size]); push(colors[i * size + size - 1]); }
  for (const idx of [0, size - 1, (size - 1) * size, size * size - 1]) push(colors[idx]);
  let total = 0; for (const e of counts.values()) total += e.n;
  const sorted = [...counts.values()].sort((a, b) => b.n - a.n);
  const seeds = []; let cum = 0;
  for (const e of sorted) { seeds.push({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }); cum += e.n; if (cum / Math.max(1, total) >= 0.85 || seeds.length >= 3) break; }
  return seeds;
}

// THE single canonical subject-separation — used by the pixel + smooth paths in
// imageUrlToBinaryGrid AND the dev/cc0-proof flattener (which imports it), so every
// non-Normie import shares one implementation. Down-samples any rawSize to the 40
// grid; returns 40x40 bands 0..3, or null when there's no usable subject/bg split.
// `outSize` = the band-map resolution (default GRID_SIZE=40). The source `rawSize` grid
// is coverage-mapped into outSize×outSize. Pass outSize == rawSize for a NATIVE-resolution
// band map (no scaling — used to pad small pixel art into 40 without ×1.25 distortion).
export function bandsFromBackgroundKey(colors, rawSize, outSize = GRID_SIZE) {
  if (!colors || colors.length < rawSize * rawSize) return null;
  const seeds = bgSeeds(colors, rawSize);
  const isBg = c => {
    if (!c || c.a < 0.4) return true;
    for (const s of seeds) if (colorDistance2(c, s) < BG_KEY_DIST2) return true;
    return false;
  };
  const lumOf = c => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  const factor = rawSize / outSize;
  const isFg = new Uint8Array(outSize * outSize);
  const fgLum = new Float32Array(outSize * outSize);
  let lit = 0;
  for (let row = 0; row < outSize; row++) {
    const r0 = Math.floor(row * factor), r1 = Math.min(rawSize, Math.ceil((row + 1) * factor));
    for (let col = 0; col < outSize; col++) {
      const c0 = Math.floor(col * factor), c1 = Math.min(rawSize, Math.ceil((col + 1) * factor));
      let fg = 0, n = 0, lsum = 0;
      for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) { const px = colors[r * rawSize + c]; n++; if (!isBg(px)) { fg++; lsum += lumOf(px); } }
      if (n > 0 && fg / n >= 0.5) { const i = row * outSize + col; isFg[i] = 1; fgLum[i] = lsum / fg; lit++; }
    }
  }
  // Despeckle: drop isolated foreground specks — a background texture (e.g. a
  // polka-dot backdrop) that leaked through separation shows up as single lit
  // cells. A foreground cell with < 2 foreground 8-neighbours becomes background,
  // so only coherent subject regions survive (matches the tonal/cube/SVG cleanly).
  {
    const keep = new Uint8Array(isFg.length);
    let kept = 0;
    for (let row = 0; row < outSize; row++) {
      for (let col = 0; col < outSize; col++) {
        const i = row * outSize + col;
        if (!isFg[i]) continue;
        let nb = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const r = row + dr, c = col + dc;
          if (r >= 0 && r < outSize && c >= 0 && c < outSize && isFg[r * outSize + c]) nb++;
        }
        if (nb >= 2) { keep[i] = 1; kept++; }
      }
    }
    isFg.set(keep);
    lit = kept;
  }
  if (lit < BG_KEY_MIN_LIT || lit > outSize * outSize * BG_KEY_MAX_FILL) return null;
  const lums = new Float32Array(lit); let k = 0;
  for (let i = 0; i < isFg.length; i++) if (isFg[i]) lums[k++] = fgLum[i];
  const th = otsuMultiLevelThresholds(lums, 2); // [t1 < t2] within the subject
  const bands = new Uint8Array(outSize * outSize);
  for (let i = 0; i < isFg.length; i++) { if (!isFg[i]) continue; const g = fgLum[i]; bands[i] = g < th[0] ? 3 : g < th[1] ? 2 : 1; }
  return bands;
}

// 40×40 tonal bands (0..2) via the same 2-level Otsu the cube outline uses, so the
// on-chain SVG silhouette matches the 3D cube form. band = #thresholds exceeded.
// Prefers a background-keyed silhouette (grid.bgBands40) when one was found.
export function gridToBands40(grid) {
  if (grid && grid.bgBands40) return grid.bgBands40;
  const grayscale = grid?.grayscale;
  if (!grayscale) return null;
  const rawSize = grid.gridSize || GRID_SIZE;
  const gs40 = rawSize > GRID_SIZE ? downsampleGrayscale(grayscale, rawSize, GRID_SIZE) : grayscale;
  const thresholds = otsuMultiLevelThresholds(gs40, 2) || [];
  const bands = new Uint8Array(GRID_SIZE * GRID_SIZE);
  for (let i = 0; i < bands.length; i++) {
    let b = 0;
    for (const t of thresholds) { if (gs40[i] >= t) b++; }
    bands[i] = b;
  }
  return bands;
}

// Pack the 40×40 bands into the on-chain 400-byte 2-bit tonal payload (row-major,
// 2 bits/cell; band 0 = background -> "off" in the on-chain renderer). Feeds
// CubeThumbnailRendererV1.previewThumbnailSVG and, on commit, customizeCube.
// Pack 40x40 tonal bands (0..3) into the on-chain 400-byte 2-bit payload (row-major,
// 2 bits/cell; band 0 -> "off"). The single packing routine — used by every path.
export function packTonalPayload(bands) {
  const payload = new Uint8Array(400);
  for (let i = 0; i < 1600; i++) if (bands[i]) payload[i >> 2] |= (bands[i] & 3) << ((i & 3) << 1);
  return payload;
}

export function gridToTonalPayload(grid) {
  // Background-keyed subject already has the subject as foreground (band>0): pack
  // directly (the flip below is only for the Otsu light/dark ambiguity).
  if (grid && grid.bgBands40) return packTonalPayload(grid.bgBands40);
  const bands = gridToBands40(grid);
  if (!bands) return new Uint8Array(400);
  // The on-chain art + glass land on band>0 (the "foreground"). Otsu makes the
  // lit region band>0, but for a light-background image that's the background — so
  // glass blankets it and looks poor. Keep the foreground the SPARSER half (usually
  // the subject): if the lit region is the majority, flip.
  let lit = 0;
  for (let i = 0; i < bands.length; i++) if (bands[i] > 0) lit++;
  const flip = lit > bands.length - lit;
  const out = new Uint8Array(bands.length);
  for (let i = 0; i < bands.length; i++) out[i] = flip ? (bands[i] > 0 ? 0 : 2) : bands[i];
  return packTonalPayload(out);
}

export function otsuRecursiveBands(grayscale, numBands, numBins = OTSU_BINS) {
  if (numBands <= 1) return [];
  const total = grayscale.length;
  if (total === 0) {
    return Array.from({ length: numBands - 1 }, (_, i) => (i + 1) / numBands);
  }
  const hist = new Float64Array(numBins);
  for (let i = 0; i < total; i++) {
    const v = grayscale[i];
    const bin = v >= 1 ? numBins - 1 : Math.max(0, Math.floor(v * numBins));
    hist[bin]++;
  }
  for (let i = 0; i < numBins; i++) hist[i] /= total;

  const P = new Float64Array(numBins + 1);
  const S = new Float64Array(numBins + 1);
  for (let i = 0; i < numBins; i++) {
    P[i + 1] = P[i] + hist[i];
    S[i + 1] = S[i] + i * hist[i];
  }
  const classVar = (a, b) => {
    const w = P[b] - P[a];
    if (w <= 1e-12) return 0;
    const mu = (S[b] - S[a]) / w;
    return w * mu * mu;
  };
  function bestSplit(lo, hi) {
    if (hi - lo < 2) return null;
    const base = classVar(lo, hi);
    let bestT = -1, bestGain = -Infinity;
    for (let t = lo + 1; t < hi; t++) {
      const gain = classVar(lo, t) + classVar(t, hi) - base;
      if (gain > bestGain) { bestGain = gain; bestT = t; }
    }
    return bestT < 0 ? null : { t: bestT, gain: bestGain };
  }

  const segments = [[0, numBins]];
  const splits = [bestSplit(0, numBins)];
  for (let n = 1; n < numBands; n++) {
    let bestIdx = -1, bestGain = -Infinity;
    for (let i = 0; i < splits.length; i++) {
      if (splits[i] && splits[i].gain > bestGain) {
        bestGain = splits[i].gain;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const [lo, hi] = segments[bestIdx];
    const { t } = splits[bestIdx];
    segments.splice(bestIdx, 1, [lo, t], [t, hi]);
    splits.splice(bestIdx, 1, bestSplit(lo, t), bestSplit(t, hi));
  }

  const thresholds = [];
  for (let i = 0; i < segments.length - 1; i++) {
    thresholds.push(segments[i][1] / numBins);
  }
  return thresholds.sort((a, b) => a - b);
}

function bandsFromGrayscale(grayscale, thresholds) {
  const bands = new Uint8Array(grayscale.length);
  for (let i = 0; i < grayscale.length; i++) {
    const v = grayscale[i];
    let band = 0;
    for (let t = 0; t < thresholds.length; t++) {
      if (v >= thresholds[t]) band = t + 1;
    }
    bands[i] = band;
  }
  return bands;
}

function grayscaleGridFromSample(sample, size) {
  const stats = cellStats(sample, size, size);
  const grayscale = new Float32Array(size * size);
  const bits = new Uint8Array(size * size);
  let ones = 0;
  for (let i = 0; i < stats.colors.length; i++) {
    const gray = grayFor(stats.colors[i]);
    grayscale[i] = gray;
    bits[i] = gray >= THRESHOLD ? 1 : 0;
    ones += bits[i];
  }
  const thresholds = otsuMultiLevelThresholds(grayscale);
  const bands = bandsFromGrayscale(grayscale, thresholds);
  return {
    bits,
    bands,
    thresholds,
    grayscale,
    bitString: size === GRID_SIZE ? Array.from(bits).join('') : null,
    ones,
  };
}

function colorGridFromImage(img, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, size, size);

  const data = ctx.getImageData(0, 0, size, size).data;
  const colors = new Array(size * size);
  const grayscale = new Float32Array(size * size);
  const bits = new Uint8Array(size * size);
  let ones = 0;
  for (let i = 0; i < size * size; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    const a = data[i * 4 + 3] / 255;
    colors[i] = { r, g, b, a };
    const gray = grayFor(colors[i]);
    grayscale[i] = gray;
    bits[i] = gray >= THRESHOLD ? 1 : 0;
    ones += bits[i];
  }
  const thresholds = otsuMultiLevelThresholds(grayscale);
  const bands = bandsFromGrayscale(grayscale, thresholds);
  return { bits, bands, thresholds, grayscale, intensity: grayscale, colors, bitString: null, ones };
}

function normalizeCellGrid(colors, gridW, gridH) {
  const bg = backgroundColor(colors, gridW, gridH);
  const outColors = new Array(GRID_SIZE * GRID_SIZE).fill(bg);
  const copyW = Math.min(GRID_SIZE, gridW);
  const copyH = Math.min(GRID_SIZE, gridH);
  const srcX0 = gridW > GRID_SIZE ? Math.floor((gridW - GRID_SIZE) / 2) : 0;
  const srcY0 = gridH > GRID_SIZE ? Math.floor((gridH - GRID_SIZE) / 2) : 0;
  const dstX0 = gridW < GRID_SIZE ? Math.floor((GRID_SIZE - gridW) / 2) : 0;
  const dstY0 = gridH < GRID_SIZE ? Math.floor((GRID_SIZE - gridH) / 2) : 0;

  for (let row = 0; row < copyH; row++) {
    for (let col = 0; col < copyW; col++) {
      outColors[(dstY0 + row) * GRID_SIZE + (dstX0 + col)] =
        colors[(srcY0 + row) * gridW + (srcX0 + col)];
    }
  }

  const bits = new Uint8Array(GRID_SIZE * GRID_SIZE);
  const grayscale = new Float32Array(GRID_SIZE * GRID_SIZE);
  let ones = 0;
  for (let i = 0; i < outColors.length; i++) {
    const gray = grayFor(outColors[i]);
    grayscale[i] = gray;
    bits[i] = gray >= THRESHOLD ? 1 : 0;
    ones += bits[i];
  }
  const thresholds = otsuMultiLevelThresholds(grayscale);
  const bands = bandsFromGrayscale(grayscale, thresholds);
  // Pixel art now gets subject separation too (previously only the smooth path did),
  // so gridToTonalPayload prefers the keyed subject over raw Otsu.
  const bgBands40 = bandsFromBackgroundKey(outColors, GRID_SIZE);
  return { bits, bands, thresholds, grayscale, bitString: Array.from(bits).join(''), ones, backgroundGray: grayFor(bg), bgBands40 };
}

function inferPixelGrid(sample) {
  const profiles = edgeProfiles(sample);
  const transition = transitionProfiles(sample);
  const txPositions = clusteredTransitionPositions(transition.vertical);
  const tyPositions = clusteredTransitionPositions(transition.horizontal);
  const xProfile = inferGridAxis(profiles.vertical, sample.w);
  const yProfile = inferGridAxis(profiles.horizontal, sample.h);
  const xTransition = inferGridAxisFromTransitions(txPositions, sample.w);
  const yTransition = inferGridAxisFromTransitions(tyPositions, sample.h);
  const x = xTransition.score >= 0.82 ? xTransition : xProfile;
  const y = yTransition.score >= 0.82 ? yTransition : yProfile;
  const stats = cellStats(sample, x.cells, y.cells);
  const usedTransitionGrid = x === xTransition || y === yTransition;
  const axisScore = usedTransitionGrid
    ? Math.min(x.score, y.score)
    : Math.min(xProfile.score, yProfile.score);
  const score = axisScore * 0.72 + stats.flatness * 0.58;
  const isPixelArt =
    x.cells >= MIN_PIXEL_GRID &&
    y.cells >= MIN_PIXEL_GRID &&
    ((xTransition.score >= 0.82 && yTransition.score >= 0.82) ||
      (xProfile.score >= MIN_PIXEL_ART_SCORE && yProfile.score >= MIN_PIXEL_ART_SCORE)) &&
    stats.flatness >= MIN_FLATNESS;

  return {
    isPixelArt,
    gridW: x.cells,
    gridH: y.cells,
    score,
    flatness: stats.flatness,
    axisScores: {
      x: x.score,
      y: y.score,
      xProfile: xProfile.score,
      yProfile: yProfile.score,
      xTransition: xTransition.score,
      yTransition: yTransition.score,
    },
    transitionCounts: { x: txPositions.length, y: tyPositions.length },
    detector: usedTransitionGrid ? 'transition' : 'profile',
    colors: stats.colors,
  };
}

export async function imageUrlToBinaryGrid(imageUrl) {
  if (!imageUrl) throw new Error('NFT has no image URL');
  const normalizedUrl = normalizeMediaUrl(imageUrl);
  void (`[nft-grid] fetch media`, { imageUrl, normalizedUrl });
  const res = await fetch(proxiedImageUrl(normalizedUrl));
  if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
  const img = await loadImageFromProxyResponse(res, normalizedUrl);
  void (`[nft-grid] decoded image ${img.width}x${img.height}`, normalizedUrl);

  const rawSample = drawForAnalysis(img);
  const cropResult = cropToContent(rawSample);
  const sample = cropResult.sample;
  const cropDiag = cropResult.cropped
    ? { from: cropResult.originalSize, to: cropResult.croppedSize, contentRatio: Number(cropResult.contentRatio.toFixed(3)) }
    : { skipped: cropResult.reason, ...(cropResult.contentRatio !== undefined ? { contentRatio: Number(cropResult.contentRatio.toFixed(3)) } : {}) };
  const pixelGrid = inferPixelGrid(sample);
  if (!pixelGrid.isPixelArt) {
    const smooth = colorGridFromImage(img, SMOOTH_GRID_SIZE);
    const smoothStats = grayscaleStats(smooth.grayscale);
    const useColorDepth = smoothStats.range < LOW_GRAYSCALE_RANGE || smoothStats.std < LOW_GRAYSCALE_STD;
    if (useColorDepth) {
      smooth.depthValues = kMeansDepthValues(smooth.colors, GRID_SIZE);
      smooth.depthMode = 'color-kmeans';
    } else {
      smooth.depthValues = smooth.grayscale;
      smooth.depthMode = 'grayscale';
    }
    // Background-keyed silhouette for solid-bg subject art (null if no flat bg).
    // Computed here while the full-res colour grid is still available.
    smooth.bgBands40 = bandsFromBackgroundKey(smooth.colors, SMOOTH_GRID_SIZE);
    delete smooth.colors;
    void (`[nft-grid] smooth art grid ready`, {
      normalizedUrl,
      imageSize: `${sample.w}x${sample.h}`,
      crop: cropDiag,
      grid: `${SMOOTH_GRID_SIZE}x${SMOOTH_GRID_SIZE}`,
      inferredGrid: `${pixelGrid.gridW}x${pixelGrid.gridH}`,
      ones: smooth.ones,
      depthMode: smooth.depthMode,
      grayscaleRange: Number(smoothStats.range.toFixed(3)),
      grayscaleStd: Number(smoothStats.std.toFixed(3)),
      score: Number(pixelGrid.score.toFixed(3)),
      flatness: Number(pixelGrid.flatness.toFixed(3)),
      axisScores: {
        x: Number(pixelGrid.axisScores.x.toFixed(3)),
        y: Number(pixelGrid.axisScores.y.toFixed(3)),
        xTransition: Number(pixelGrid.axisScores.xTransition.toFixed(3)),
        yTransition: Number(pixelGrid.axisScores.yTransition.toFixed(3)),
      },
      transitionCounts: pixelGrid.transitionCounts,
      detector: pixelGrid.detector,
    });
    return {
      ...smooth,
      discarded: false,
      kind: 'smooth',
      gridSize: SMOOTH_GRID_SIZE,
      depthLayers: GRID_SIZE,
      grayscaleStats: smoothStats,
      bitString: null,
      normalizedUrl,
      pixelGrid: {
        gridW: pixelGrid.gridW,
        gridH: pixelGrid.gridH,
        score: pixelGrid.score,
        flatness: pixelGrid.flatness,
        axisScores: pixelGrid.axisScores,
        transitionCounts: pixelGrid.transitionCounts,
        detector: pixelGrid.detector,
      },
    };
  }

  const normalized = normalizeCellGrid(pixelGrid.colors, pixelGrid.gridW, pixelGrid.gridH);
  void (`[nft-grid] pixel art grid ready`, {
    normalizedUrl,
    imageSize: `${sample.w}x${sample.h}`,
    crop: cropDiag,
    inferredGrid: `${pixelGrid.gridW}x${pixelGrid.gridH}`,
    ones: normalized.ones,
    backgroundGray: Number(normalized.backgroundGray.toFixed(3)),
    score: Number(pixelGrid.score.toFixed(3)),
    flatness: Number(pixelGrid.flatness.toFixed(3)),
    transitionCounts: pixelGrid.transitionCounts,
    detector: pixelGrid.detector,
  });

  return {
    ...normalized,
    normalizedUrl,
    discarded: false,
    kind: 'pixel',
    gridSize: GRID_SIZE,
    depthLayers: 40,
    pixelGrid: {
      gridW: pixelGrid.gridW,
      gridH: pixelGrid.gridH,
      score: pixelGrid.score,
      flatness: pixelGrid.flatness,
      axisScores: pixelGrid.axisScores,
      transitionCounts: pixelGrid.transitionCounts,
      detector: pixelGrid.detector,
    },
  };
}
