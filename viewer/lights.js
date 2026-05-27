// Debug point lights for the pipeline viewer.
//
// Stores a small fixed-size array of (position, color) pairs, exposes them
// as flat Float32Arrays for shader uniforms (so they can be uploaded with a
// single `gl.uniform3fv` call), and builds per-light marker billboards so
// the lights are visible in the scene.
//
// Marker mesh is rebuilt on demand — call buildMarkerItems(gl) after any
// position change.

import { createInstancedBillboardMesh } from './instanced-mesh.js';
import { mat4, identity }               from '/renderer/src/math.js';

export const MAX_POINT_LIGHTS = 8;

const DEFAULT_LIGHTS = [
  // pos                       col (HDR — drives bloom on glass surfaces)
  { pos: [ 1.12,  0.80,  1.12], col: [ 5.0,  0.0,  0.0] },  // red
  { pos: [-1.12,  0.48,  0.80], col: [ 0.0,  5.0,  0.0] },  // green
  { pos: [ 0.32,  1.44, -1.12], col: [ 0.0,  0.0,  5.0] },  // blue
];

export function createLights(initial) {
  const lights = (initial && initial.length ? initial : DEFAULT_LIGHTS)
    .slice(0, MAX_POINT_LIGHTS)
    .map(l => ({ pos: l.pos.slice(), col: l.col.slice() }));

  const posBuf = new Float32Array(MAX_POINT_LIGHTS * 3);
  const colBuf = new Float32Array(MAX_POINT_LIGHTS * 3);
  const grayColBuf = new Float32Array(MAX_POINT_LIGHTS * 3);

  function sync() {
    posBuf.fill(0); colBuf.fill(0); grayColBuf.fill(0);
    for (let i = 0; i < lights.length; i++) {
      posBuf[i*3+0] = lights[i].pos[0];
      posBuf[i*3+1] = lights[i].pos[1];
      posBuf[i*3+2] = lights[i].pos[2];
      colBuf[i*3+0] = lights[i].col[0];
      colBuf[i*3+1] = lights[i].col[1];
      colBuf[i*3+2] = lights[i].col[2];
      const lum = lights[i].col[0] * 0.299 + lights[i].col[1] * 0.587 + lights[i].col[2] * 0.114;
      grayColBuf[i*3+0] = lum;
      grayColBuf[i*3+1] = lum;
      grayColBuf[i*3+2] = lum;
    }
  }
  sync();

  // One marker mesh per light so each can use its own colour as the
  // edge-glow uTint. Registers each mesh in the shared `meshes` dict under
  // a stable key and returns scene items ready to push into sceneItems.
  function buildMarkerItems(gl, meshes, sizeWorld = 0.05, cubeCenter = null, cubeHalfSize = 1.0, posOverride = null, colOverride = null) {
    const xform = mat4(); identity(xform);
    const items = [];
    for (let i = 0; i < lights.length; i++) {
      const key = `light-marker-${i}`;
      const px = posOverride ? posOverride[i*3+0] : lights[i].pos[0];
      const py = posOverride ? posOverride[i*3+1] : lights[i].pos[1];
      const pz = posOverride ? posOverride[i*3+2] : lights[i].pos[2];
      const col = colOverride
        ? new Float32Array([colOverride[i*3+0], colOverride[i*3+1], colOverride[i*3+2]])
        : new Float32Array(lights[i].col);
      let wx = px, wy = py, wz = pz;
      if (cubeCenter) {
        wx = cubeCenter[0] + wx * cubeHalfSize;
        wy = cubeCenter[1] + wy * cubeHalfSize;
        wz = cubeCenter[2] + wz * cubeHalfSize;
      }
      const data = new Float32Array(6);
      data[0] = wx;
      data[1] = wy;
      data[2] = wz;
      data[3] = sizeWorld;
      data[4] = i * 0.123;
      data[5] = 1.0;
      // Always rebuild so position changes take effect.
      meshes[key] = createInstancedBillboardMesh(gl, data);
      items.push({
        mesh: key,
        material: 'edge-glow',
        transform: xform,
        blend: 'additive',
        uniforms: {
          uTint:    col,
          uOpacity: 1.0,
        },
      });
    }
    return items;
  }

  function setLight(i, pos, col) {
    if (i < 0 || i >= lights.length) return;
    if (pos) lights[i].pos = pos.slice();
    if (col) lights[i].col = col.slice();
    sync();
  }

  return {
    lights,
    posBuf, colBuf, grayColBuf,
    get count() { return lights.length; },
    buildMarkerItems,
    setLight,
    sync,
  };
}
