// Mouse-driven orbit camera for the pipeline viewer.
//
//   left-drag   : rotate yaw / pitch around the target
//   right-drag  : pan the target in screen-space
//   wheel       : zoom (multiplicative — feels uniform at any distance)
//
// Replaces the fixed `isoCubeCamera` in 3D mode so we can inspect the glass
// shader from any angle. The 2D face-on camera still uses `faceOnCamera`.

import { mat4, vec3, lookAt, perspective } from '/renderer/src/math.js';

export function createOrbitCamera(canvas, opts = {}) {
  const shouldHandleEvent = opts.shouldHandleEvent || (() => true);
  const state = {
    target:   vec3(opts.target?.[0] ?? 0, opts.target?.[1] ?? 0, opts.target?.[2] ?? 0),
    distance: opts.distance ?? 4.0,
    yaw:      opts.yaw      ?? Math.PI * 0.25,
    pitch:    opts.pitch    ?? Math.PI * 0.18,
    fov:      opts.fov      ?? Math.PI * 0.25,    // 45° vertical
    near:     0.05,
    far:      200,
    minDist:  0.3,
    maxDist:  60,
    minPitch: -Math.PI * 0.49,
    maxPitch:  Math.PI * 0.49,
  };

  let dragging = null;   // 'rotate' | 'pan' | null
  let lastX = 0, lastY = 0;

  canvas.addEventListener('mousedown', (e) => {
    if (!shouldHandleEvent(e)) return;
    if (e.button === 0)      dragging = 'rotate';
    else if (e.button === 2) dragging = 'pan';
    else return;
    e.preventDefault();
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => { dragging = null; });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (dragging === 'rotate') {
      state.yaw   -= dx * 0.0065;
      state.pitch += dy * 0.0065;
      state.pitch = Math.max(state.minPitch, Math.min(state.maxPitch, state.pitch));
    } else {
      // Pan in the camera's right/up directions, scaled by distance.
      const sp = Math.sin(state.pitch), cp = Math.cos(state.pitch);
      const sy = Math.sin(state.yaw),   cy = Math.cos(state.yaw);
      // forward = (cp*sy, sp, cp*cy) (from target → camera)
      // right   = forward × worldUp(0,1,0) normalised
      // up      = right   × forward
      const fx = cp * sy, fy = sp, fz = cp * cy;
      const rx =  fz, ry = 0, rz = -fx;          // (f) × (0,1,0)
      const rl = Math.hypot(rx, ry, rz) || 1;
      const rxn = rx / rl, ryn = ry / rl, rzn = rz / rl;
      const ux = ryn * fz - rzn * fy;
      const uy = rzn * fx - rxn * fz;
      const uz = rxn * fy - ryn * fx;
      const k = state.distance * 0.0017;
      state.target[0] += (-rxn * dx + ux * dy) * k;
      state.target[1] += (-ryn * dx + uy * dy) * k;
      state.target[2] += (-rzn * dx + uz * dy) * k;
    }
  });
  canvas.addEventListener('wheel', (e) => {
    if (!shouldHandleEvent(e)) return;
    e.preventDefault();
    state.distance *= Math.exp(e.deltaY * 0.0009);
    state.distance = Math.max(state.minDist, Math.min(state.maxDist, state.distance));
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function setTarget(x, y, z) {
    state.target[0] = x; state.target[1] = y; state.target[2] = z;
  }
  function setDistance(d) { state.distance = d; }

  function camera(aspect) {
    const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
    const cy = Math.cos(state.yaw),   sy = Math.sin(state.yaw);
    const dx = cp * sy, dy = sp, dz = cp * cy;
    const pos = vec3(
      state.target[0] + dx * state.distance,
      state.target[1] + dy * state.distance,
      state.target[2] + dz * state.distance,
    );
    const view = lookAt(mat4(), pos, state.target, vec3(0, 1, 0));
    const proj = perspective(mat4(), state.fov, aspect, state.near, state.far);
    return { view, proj, pos };
  }

  return { camera, state, setTarget, setDistance };
}
