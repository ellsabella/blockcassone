// Normie 3D voxels — one mesh per cube built from multi-plane pixel intersection.

import { isNormieCube, normieIdForCube } from './status.js';
import { ensureFetched, getPlanePixelArray, makePlanePixelFn } from './api.js';
import { otsuRecursiveBands } from '../nft-art-grid.js';
import { createMeshGL } from '../../renderer/src/geometry.js';
import { mat4, identity } from '../../renderer/src/math.js';

const VOXEL_RED            = new Float32Array([1.0, 0.08, 0.04]);
const VOXEL_SHRINK         = 0.46;
const VOXEL_BAND_ALPHA_MULT = [1.0, 0.84, 0.68, 0.50, 0.34, 0.20, 0.08];
const VOXEL_ALPHA_3        = 0.22;

export function buildVoxelMesh(gl, centers, alphaValues, variantValues, voxelSize) {
  if (centers.length === 0) return null;
  const [hx, hy, hz] = [voxelSize[0] * VOXEL_SHRINK, voxelSize[1] * VOXEL_SHRINK, voxelSize[2] * VOXEL_SHRINK];

  const faceTriangles = [
    // +X
    [[ hx,-hy, hz],[ hx, hy, hz],[ hx, hy,-hz],  [ hx,-hy, hz],[ hx, hy,-hz],[ hx,-hy,-hz]],
    // -X
    [[-hx,-hy,-hz],[-hx, hy,-hz],[-hx, hy, hz],  [-hx,-hy,-hz],[-hx, hy, hz],[-hx,-hy, hz]],
    // +Y
    [[-hx, hy, hz],[ hx, hy, hz],[ hx, hy,-hz],  [-hx, hy, hz],[ hx, hy,-hz],[-hx, hy,-hz]],
    // -Y
    [[-hx,-hy,-hz],[ hx,-hy,-hz],[ hx,-hy, hz],  [-hx,-hy,-hz],[ hx,-hy, hz],[-hx,-hy, hz]],
    // +Z
    [[-hx,-hy, hz],[ hx,-hy, hz],[ hx, hy, hz],  [-hx,-hy, hz],[ hx, hy, hz],[-hx, hy, hz]],
    // -Z
    [[ hx,-hy,-hz],[-hx,-hy,-hz],[-hx, hy,-hz],  [ hx,-hy,-hz],[-hx, hy,-hz],[ hx, hy,-hz]],
  ];

  const faceNormals = [
    [ 1, 0, 0], [-1, 0, 0],
    [ 0, 1, 0], [ 0,-1, 0],
    [ 0, 0, 1], [ 0, 0,-1],
  ];

  const positions = new Float32Array(centers.length * 36 * 3);
  const normals   = new Float32Array(centers.length * 36 * 3);
  const alphas    = new Float32Array(centers.length * 36);
  const variants  = new Float32Array(centers.length * 36);
  let p = 0, n = 0, a = 0;
  for (let v = 0; v < centers.length; v++) {
    const [cx, cy, cz] = centers[v];
    const alpha = alphaValues[v];
    const variant = variantValues[v];
    for (let f = 0; f < faceTriangles.length; f++) {
      const [nx, ny, nz] = faceNormals[f];
      for (const [dx, dy, dz] of faceTriangles[f]) {
        positions[p++] = cx + dx;
        positions[p++] = cy + dy;
        positions[p++] = cz + dz;
        normals[n++] = nx; normals[n++] = ny; normals[n++] = nz;
        alphas[a++] = alpha;
        variants[a-1] = variant;
      }
    }
  }
  return createMeshGL(gl, { positions, normals, alphas, variants });
}

export function build3DVoxels(motifIdx, hilbert, allPlanes, gl, meshes) {
  if (!isNormieCube(motifIdx)) return [];
  const cubePlanes = allPlanes.filter(p =>
    p.hierarchy && p.hierarchy.motifIndex === motifIdx
  );
  if (cubePlanes.length < 2) return [];

  const id = normieIdForCube(motifIdx);
  ensureFetched(id);

  const planePix = cubePlanes.map(plane => getPlanePixelArray(plane, allPlanes));
  if (planePix.some(p => !p)) {
    console.log(`[normies] motif ${motifIdx}: waiting for ${planePix.filter(p => !p).length}/${cubePlanes.length} grids`);
    return [];
  }

  const infoKey = `normie-voxels-info-${motifIdx}`;
  const key2    = `normie-voxels-score2-${motifIdx}`;
  const key3    = `normie-voxels-score3-${motifIdx}`;

  if (meshes[infoKey] === undefined) {
    const base = motifIdx * 8;
    const mn = [ Infinity,  Infinity,  Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 8; i++) {
      const v = hilbert.rawVertices[base + i];
      if (v.x < mn[0]) mn[0] = v.x; if (v.x > mx[0]) mx[0] = v.x;
      if (v.y < mn[1]) mn[1] = v.y; if (v.y > mx[1]) mx[1] = v.y;
      if (v.z < mn[2]) mn[2] = v.z; if (v.z > mx[2]) mx[2] = v.z;
    }
    meshes[infoKey] = {
      center:   new Float32Array([(mn[0]+mx[0])*0.5, (mn[1]+mx[1])*0.5, (mn[2]+mx[2])*0.5]),
      halfSize: Math.max(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]) * 0.5,
    };
    const voxelSize = [
      (mx[0] - mn[0]) / 40,
      (mx[1] - mn[1]) / 40,
      (mx[2] - mn[2]) / 40,
    ];

    const planePixelFns = cubePlanes.map(pl => makePlanePixelFn(pl, mn, voxelSize));
    const maxScore = cubePlanes.length;
    const filled = new Uint8Array(40 * 40 * 40);
    const centers3  = [];
    const alphas3   = [];
    const variants3 = [];
    const touchedVoxels = meshes[`stone-walk-touched-${motifIdx}`];
    const ci = 19.5, cj = 19.5, ck = 19.5;

    for (let xi = 0; xi < 40; xi++) {
      for (let yi = 0; yi < 40; yi++) {
        for (let zi = 0; zi < 40; zi++) {
          let score = 0;
          for (let p = 0; p < cubePlanes.length; p++) {
            score += planePix[p][planePixelFns[p](xi, yi, zi)];
          }
          if (score < maxScore) continue;
          filled[xi * 1600 + yi * 40 + zi] = 1;
        }
      }
    }

    function filledAt(x, y, z) {
      if (x < 0 || x > 39 || y < 0 || y > 39 || z < 0 || z > 39) return 0;
      return filled[x * 1600 + y * 40 + z];
    }

    const voxelGrayscale  = new Float32Array(64000);
    const grayscaleSamples = [];
    for (let xi = 0; xi < 40; xi++) {
      for (let yi = 0; yi < 40; yi++) {
        for (let zi = 0; zi < 40; zi++) {
          const vi = xi * 1600 + yi * 40 + zi;
          if (!filled[vi]) continue;
          let sum = 0;
          for (let pp = 0; pp < cubePlanes.length; pp++) {
            const pidx = planePixelFns[pp](xi, yi, zi);
            const pcol = pidx % 40;
            const prow = (pidx / 40) | 0;
            let count = 0, possible = 0;
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const r = prow + dr, c = pcol + dc;
                if (r < 0 || r > 39 || c < 0 || c > 39) continue;
                possible++;
                count += planePix[pp][r * 40 + c];
              }
            }
            sum += possible > 0 ? count / possible : 0;
          }
          const g = sum / cubePlanes.length;
          voxelGrayscale[vi] = g;
          grayscaleSamples.push(g);
        }
      }
    }
    const numBands = VOXEL_BAND_ALPHA_MULT.length;
    const bandThresholds = grayscaleSamples.length >= numBands
      ? otsuRecursiveBands(new Float32Array(grayscaleSamples), numBands)
      : Array.from({ length: numBands - 1 }, (_, i) => (i + 1) / numBands);
    const bandCounts = new Array(numBands).fill(0);

    for (let xi = 0; xi < 40; xi++) {
      for (let yi = 0; yi < 40; yi++) {
        for (let zi = 0; zi < 40; zi++) {
          if (!filledAt(xi, yi, zi)) continue;
          const cx = mn[0] + (xi + 0.5) * voxelSize[0];
          const cy = mn[1] + (yi + 0.5) * voxelSize[1];
          const cz = mn[2] + (zi + 0.5) * voxelSize[2];
          centers3.push([cx, cy, cz]);

          const axisNeighbors =
            filledAt(xi-1, yi, zi) + filledAt(xi+1, yi, zi) +
            filledAt(xi, yi-1, zi) + filledAt(xi, yi+1, zi) +
            filledAt(xi, yi, zi-1) + filledAt(xi, yi, zi+1);
          let neighbor26 = 0;
          for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++)
              for (let dz = -1; dz <= 1; dz++)
                if (dx !== 0 || dy !== 0 || dz !== 0)
                  neighbor26 += filledAt(xi + dx, yi + dy, zi + dz);
          const interior = axisNeighbors / 6;
          const dense    = neighbor26 / 26;

          const t = Math.max(
            Math.abs(xi - ci) / ci,
            Math.abs(yi - cj) / cj,
            Math.abs(zi - ck) / ck,
          );
          const falloff = 0.90 - 0.85 * t;

          let h = ((xi * 73856093) ^ (yi * 19349663) ^ (zi * 83492791)) >>> 0;
          h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
          const rand    = h / 0xFFFFFFFF;
          const variety = 0.35 + rand * 0.65;
          const interiorMult = 1.0 - 0.84 * Math.pow(interior, 1.35);
          const denseMult    = 1.0 - 0.38 * Math.pow(dense, 1.05);

          const vIdx      = xi * 1600 + yi * 40 + zi;
          const walkerMult = (touchedVoxels && touchedVoxels.has(vIdx)) ? 2.8 : 1.0;

          const g = voxelGrayscale[vIdx];
          let band = 0;
          for (let bt = 0; bt < bandThresholds.length; bt++) {
            if (g >= bandThresholds[bt]) band = bt + 1;
          }
          bandCounts[band]++;

          alphas3.push(falloff * variety * interiorMult * denseMult * walkerMult * VOXEL_BAND_ALPHA_MULT[band]);
          variants3.push(rand);
        }
      }
    }

    meshes[key2] = null;
    meshes[key3] = buildVoxelMesh(gl, centers3, alphas3, variants3, voxelSize);
    console.log(`[normies] motif ${motifIdx} (${maxScore} planes, axes: ${cubePlanes.map(p=>p.axis).join(',')}): score3=${centers3.length} bands=[${bandCounts.join(',')}] thresholds=[${bandThresholds.map(t=>t.toFixed(2)).join(',')}]`);
  }

  const items     = [];
  const info      = meshes[infoKey];
  const transform = mat4(); identity(transform);
  if (meshes[key3] && info) {
    items.push({
      mesh: key3, material: 'normie-voxel', transform, blend: 'alpha',
      uniforms: {
        uTint: VOXEL_RED, uAlpha: VOXEL_ALPHA_3, uLightScale: 1.0,
        uCubeCenter: info.center, uCubeHalfSize: info.halfSize,
      },
    });
  }
  return items;
}
