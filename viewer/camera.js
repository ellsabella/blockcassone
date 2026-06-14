// Camera factories for the pipeline viewer. Both return { view, proj, pos }
// Float32Array matrices + a Float32Array camera position. The renderer
// consumes these via the pipeline's shared frame uniforms.

import { mat4, vec3, lookAt, ortho, multiply } from '../renderer/src/math.js';

// Face-on orthographic camera, perpendicular to a plane's normal, framed
// to the plane's four vertices. Used for 2D mode.
//
// `plane` is expected to expose:
//   - .axis   : 'x' | 'y' | 'z'
//   - .center : { x, y, z }   (world-space centre of the plane)
//   - optionally .vertices.positions: [{x,y,z}, ...] for tight framing
export function faceOnCamera(plane, aspect) {
  const c = vec3(plane.center.x, plane.center.y, plane.center.z);

  // Outward normal (toward the camera) derived from the plane's axis.
  let nx = 0, ny = 0, nz = 0;
  if      (plane.axis === 'x') nx = 1;
  else if (plane.axis === 'y') ny = 1;
  else                         nz = 1;

  const pos = vec3(c[0] + nx * 3, c[1] + ny * 3, c[2] + nz * 3);

  // Up vector must not be parallel to the view direction.
  const up = (Math.abs(ny) > 0.9) ? vec3(0, 0, 1) : vec3(0, 1, 0);

  const view = lookAt(mat4(), pos, c, up);

  // Frame to roughly the plane's extent. Each cube is 1 unit, so 0.6 gives
  // a small margin around the face.
  const h = 0.6;
  const proj = ortho(mat4(), -h * aspect, h * aspect, -h, h, 0.1, 10);

  return { view, proj, pos };
}

// Isometric orthographic camera, framed to the 8 vertices of a cube.
// Used for 3D mode.
export function isoCubeCamera(cubeVerts, aspect) {
  // Project each vertex with the Y-up iso projection to find screen bounds.
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let cx = 0, cy = 0, cz = 0;
  for (const v of cubeVerts) {
    const sx = (v.x - v.z) * 0.86602540378;
    const sy = v.y - (v.x + v.z) * 0.5;
    if (sx < minX) minX = sx; if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
    cx += v.x; cy += v.y; cz += v.z;
  }
  cx /= cubeVerts.length; cy /= cubeVerts.length; cz /= cubeVerts.length;

  const halfX = (maxX - minX) * 0.55;
  const halfY = (maxY - minY) * 0.55;
  const half  = Math.max(halfX, halfY);

  // Iso camera basis. Push the camera back along +(1,1,1) so the cube is
  // entirely in front of it.
  const s = 1 / Math.sqrt(3);
  const back = 10;
  const pos = vec3(cx + s * back, cy + s * back, cz + s * back);

  const view = lookAt(mat4(), pos, vec3(cx, cy, cz), vec3(0, 1, 0));
  const proj = ortho(mat4(), -half * aspect, half * aspect, -half, half, 0.1, 100);

  return { view, proj, pos };
}
