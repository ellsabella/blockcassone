// Forest particle cloud + canopy halos. Topology comes from forest-grow.js
// — particles cluster along the same branch geometry the line bundles draw,
// so they refract / branch / terminate together.

import { hash1, V }                       from '../tree-walker.js';
import { createInstancedBillboardMesh }   from '../instanced-mesh.js';
import { mat4, identity }                 from '/renderer/src/math.js';
import { generateForestSegments } from './forest-grow.js';

// --- Tuning ---
// Particle density per depth — extended to depth 4 for refracted children.
const PARTICLES_PER_SEGMENT = [40, 40, 55, 70, 85];
const SIZE_PER_DEPTH        = [0.010, 0.008, 0.007, 0.006, 0.005];
const JITTER_PER_DEPTH      = [0.018, 0.028, 0.040, 0.050, 0.060];

const HALO_COUNT_PER_TREE = 8;
const HALO_SIZE           = 0.32;
const HALO_DEPTH_MARKER   = 1.3;     // > 1.0 triggers halo branch in shader
const HALO_SPREAD_FRAC    = 0.60;
const HALO_CANOPY_FRAC    = 0.85;  // was 2.4 — near trunk tip, inside cube

// Fraction of particles that render as white instead of the plane's axis
// colour. Softens the pure-RGB glow so the forest reads as multi-coloured
// rather than a single saturated cloud.
const WHITE_PARTICLE_FRACTION = 0.30;
const WHITE_TINT = new Float32Array([1.0, 1.0, 1.0]);

function axisColorLinear(axis) {
  const hex = (typeof CONFIG !== 'undefined' && CONFIG.axisColors[axis])
    ? CONFIG.axisColors[axis].hex
    : '#ffffff';
  const r = parseInt(hex.substr(1, 2), 16) / 255;
  const g = parseInt(hex.substr(3, 2), 16) / 255;
  const b = parseInt(hex.substr(5, 2), 16) / 255;
  return new Float32Array([r, g, b]);
}

function generateParticles(plane, hilbert, slicesByAxis) {
  const result = generateForestSegments(plane, hilbert, slicesByAxis);
  const { segments, seedBase } = result;
  if (segments.length === 0) return [];

  const particles = [];

  // Track which trees we've placed halos for (one halo cluster per active
  // edge bit, regardless of how many segments that tree produced).
  const haloDone = new Set();

  for (const seg of segments) {
    const { a, b, depth, bi, segIdx } = seg;
    const di     = Math.min(depth, PARTICLES_PER_SEGMENT.length - 1);
    const count  = PARTICLES_PER_SEGMENT[di];
    const sBase  = SIZE_PER_DEPTH[di];
    const jitter = JITTER_PER_DEPTH[di];

    const segDir = V.norm(V.sub(b, a));
    let r1 = V.cross(segDir, [0, 1, 0]);
    if (V.len(r1) < 0.1) r1 = [1, 0, 0]; else r1 = V.norm(r1);
    const r2 = V.norm(V.cross(r1, segDir));

    for (let i = 0; i < count; i++) {
      const sSeed = seedBase + bi * 0.13 + segIdx * 0.073 + i * 0.023;
      const st    = (i + hash1([sSeed, 0, 0]) * 0.7) / count;
      const theta = hash1([sSeed, 1, 0]) * Math.PI * 2;
      const rad   = hash1([sSeed, 2, 0]) * jitter;
      const cx    = Math.cos(theta) * rad;
      const sy    = Math.sin(theta) * rad;

      particles.push([
        a[0] + (b[0] - a[0]) * st + r1[0]*cx + r2[0]*sy,
        a[1] + (b[1] - a[1]) * st + r1[1]*cx + r2[1]*sy,
        a[2] + (b[2] - a[2]) * st + r1[2]*cx + r2[2]*sy,
        sBase * (0.65 + hash1([sSeed, 3, 0]) * 0.7),
        hash1([sSeed, 4, 0]),
        Math.min(depth / 4, 1.0),
      ]);
    }

    // Halo cluster: emitted ONCE per tree, anchored on the very first
    // (trunk) segment of each tree (segIdx === 0 within that bi). Uses the
    // ACTUAL trunk direction + length so trees with widely varying trunks
    // get correspondingly varied halo positions and sizes.
    if (segIdx === 0 && !haloDone.has(bi)) {
      haloDone.add(bi);
      const trunkVec = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const trunkLenActual = V.len(trunkVec);
      const haloCentre = [
        a[0] + trunkVec[0] * HALO_CANOPY_FRAC,
        a[1] + trunkVec[1] * HALO_CANOPY_FRAC,
        a[2] + trunkVec[2] * HALO_CANOPY_FRAC,
      ];
      const haloSpread = trunkLenActual * HALO_SPREAD_FRAC;
      for (let h = 0; h < HALO_COUNT_PER_TREE; h++) {
        const hSeed = seedBase + bi * 0.31 + h * 0.11;
        const theta = hash1([hSeed, 10, 0]) * Math.PI * 2;
        const phi   = hash1([hSeed, 11, 0]) * Math.PI;
        const rad   = hash1([hSeed, 12, 0]) * haloSpread;
        const sin_p = Math.sin(phi);
        particles.push([
          haloCentre[0] + sin_p * Math.cos(theta) * rad,
          haloCentre[1] + Math.cos(phi) * rad,
          haloCentre[2] + sin_p * Math.sin(theta) * rad,
          HALO_SIZE * (0.7 + hash1([hSeed, 13, 0]) * 0.6),
          hash1([hSeed, 14, 0]),
          HALO_DEPTH_MARKER,
        ]);
      }
    }
  }

  return particles;
}

function packParticles(particles) {
  const data = new Float32Array(particles.length * 6);
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    data.set(p, i * 6);
  }
  return data;
}

export function buildForestParticlesItem(plane, hilbert, gl, meshes, ctx) {
  const coloredKey = `forest-p-${plane.id}`;
  const whiteKey   = `forest-p-white-${plane.id}`;

  if (meshes[coloredKey] === undefined) {
    const slicesByAxis = ctx && ctx.slicesByAxis ? ctx.slicesByAxis : null;
    const particles = generateParticles(plane, hilbert, slicesByAxis);
    if (particles.length === 0) {
      meshes[coloredKey] = null;
      meshes[whiteKey]   = null;
    } else {
      const colored = [];
      const white = [];
      for (const p of particles) {
        // p[4] is the per-particle deterministic random in [0,1] (see
        // generateParticles); use it as a stable colour-class selector so
        // the same particles stay colored / white across rebuilds.
        if (p[4] < WHITE_PARTICLE_FRACTION) white.push(p);
        else colored.push(p);
      }
      meshes[coloredKey] = colored.length > 0
        ? createInstancedBillboardMesh(gl, packParticles(colored))
        : null;
      meshes[whiteKey] = white.length > 0
        ? createInstancedBillboardMesh(gl, packParticles(white))
        : null;
    }
  }

  const transform = mat4();
  identity(transform);
  const items = [];
  if (meshes[coloredKey]) items.push({
    mesh: coloredKey,
    material: 'plant-particle',
    transform,
    blend: 'additive',
    uniforms: {
      uTint:    axisColorLinear(plane.axis),
      uOpacity: 0.38,
    },
  });
  if (meshes[whiteKey]) items.push({
    mesh: whiteKey,
    material: 'plant-particle',
    transform,
    blend: 'additive',
    uniforms: {
      uTint:    WHITE_TINT,
      uOpacity: 0.38,
    },
  });
  return items.length > 0 ? items : null;
}
