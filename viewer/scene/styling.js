// Scene item styling — dim, desaturate, pulse. Pure functions; callers resolve category first.

import { normieIdForCube, getNormieAge } from '../normies-manager.js';

export function applyDim(items, dim) {
  if (dim === 1.0 || !items) return;
  for (const it of items) {
    if (!it || !it.uniforms) continue;
    if (it.uniforms.uLineOpacity !== undefined) it.uniforms.uLineOpacity *= dim;
    if (it.uniforms.uAlpha       !== undefined) it.uniforms.uAlpha       *= dim;
    if (it.uniforms.uOpacity     !== undefined) it.uniforms.uOpacity     *= dim;
    if (it.uniforms.uLightScale  !== undefined) it.uniforms.uLightScale  *= dim;
  }
}

export function grayscaleColor(value) {
  if (!(value instanceof Float32Array || Array.isArray(value)) || value.length < 3) return value;
  const lum = value[0] * 0.299 + value[1] * 0.587 + value[2] * 0.114;
  const out = value instanceof Float32Array ? new Float32Array(value) : [...value];
  out[0] = lum; out[1] = lum; out[2] = lum;
  return out;
}

export function applyBurnedDesaturation(items) {
  if (!items) return;
  for (const it of items) {
    if (!it || !it.uniforms) continue;
    if (it.uniforms.uTint)    it.uniforms.uTint    = grayscaleColor(it.uniforms.uTint);
    if (it.uniforms.uBaseCol) it.uniforms.uBaseCol = grayscaleColor(it.uniforms.uBaseCol);
    if (it.uniforms.uLineOpacity !== undefined) it.uniforms.uLineOpacity *= 0.22;
    if (it.uniforms.uAlpha       !== undefined) it.uniforms.uAlpha       *= 0.22;
    if (it.uniforms.uOpacity     !== undefined) it.uniforms.uOpacity     *= 0.22;
    if (it.uniforms.uLightScale  !== undefined) it.uniforms.uLightScale  *= 0.25;
    it.desaturate = true;
    it.lightIntensityScale = 0.25;
  }
}

export function applyBaselineSoftening(items) {
  if (!items) return;
  for (const it of items) {
    if (!it || !it.uniforms) continue;
    if (it.uniforms.uLineOpacity !== undefined) it.uniforms.uLineOpacity *= 0.7;
    if (it.uniforms.uAlpha       !== undefined) it.uniforms.uAlpha       *= 0.7;
    if (it.uniforms.uOpacity     !== undefined) it.uniforms.uOpacity     *= 0.7;
    if (it.uniforms.uLightScale  !== undefined) it.uniforms.uLightScale  *= 0.7;
    it.lightIntensityScale = (it.lightIntensityScale ?? 1.0) * 0.7;
  }
}

export function applyAwakenedPulse(items, motifIdx) {
  if (!items) return;
  const id  = (motifIdx !== undefined && motifIdx !== null) ? normieIdForCube(motifIdx) : null;
  const age = (id !== null && id !== undefined) ? getNormieAge(id) : null;
  const speedMult = age === 'Old' ? 0.5 : age === 'Middle-Aged' ? 0.75 : 1.0;
  for (const it of items) {
    if (!it || !it.uniforms) continue;
    it.awakenedLights  = true;
    it.lightSpeedMult  = speedMult;
  }
}

// category must be pre-resolved by caller (via ensureMotifCategory).
export function applyMotifStyle(items, category, motifIdx) {
  if (category === 0) applyBurnedDesaturation(items);
  else if (category === 1) applyBaselineSoftening(items);
  else if (category === 3 || category === 4) applyAwakenedPulse(items, motifIdx);
}

// Intensity map: burned=1.0, base=0.0, edited=0.12, awakened=0.30,
// awakened+edited=0.40, null (non-normie)=0.08.
const BANNER_GLITCH_INTENSITY = [1.0, 0.0, 0.35, 0.65, 0.80];

export function applyBannerGlitch(items, category) {
  if (!items) return;
  const intensity = (category === null || category === undefined)
    ? 0.45
    : (BANNER_GLITCH_INTENSITY[category] ?? 0.0);
  for (const it of items) {
    if (!it || !it.uniforms) continue;
    it.uniforms.uGlitch = intensity;
  }
}
