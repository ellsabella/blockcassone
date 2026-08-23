// Mouse-driven orbit camera for the pipeline viewer.
//
//   left-drag   : rotate yaw / pitch around the target
//   right-drag  : pan the target in screen-space
//   wheel       : zoom (multiplicative — feels uniform at any distance)
//
// Replaces the fixed `isoCubeCamera` in 3D mode so we can inspect the glass
// shader from any angle. The 2D face-on camera still uses `faceOnCamera`.

import { mat4, vec3, lookAt, perspective } from '../renderer/src/math.js';

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

  // ---- Touch (mobile): one-finger rotate, pinch zoom, two-finger pan, tap = select.
  // preventDefault suppresses the browser's synthetic mouse events, so short taps
  // are re-synthesized as mousedown/mouseup for the existing selection handlers.
  let touchMode = null; // 'rotate' | 'pinch'
  let lastDist = 0, lastMidX = 0, lastMidY = 0;
  let tapX = 0, tapY = 0, tapT = 0, tapMoved = false;
  const pan = (dx, dy) => {
    const sp = Math.sin(state.pitch), cp = Math.cos(state.pitch);
    const sy = Math.sin(state.yaw),   cy = Math.cos(state.yaw);
    const fx = cp * sy, fy = sp, fz = cp * cy;
    const rx = fz, rz = -fx;
    const rl = Math.hypot(rx, 0, rz) || 1;
    const rxn = rx / rl, ryn = 0, rzn = rz / rl;
    const ux = ryn * fz - rzn * fy, uy = rzn * fx - rxn * fz, uz = rxn * fy - ryn * fx;
    const k = state.distance * 0.0017;
    state.target[0] += (-rxn * dx + ux * dy) * k;
    state.target[1] += (-ryn * dx + uy * dy) * k;
    state.target[2] += (-rzn * dx + uz * dy) * k;
  };
  canvas.addEventListener('touchstart', (e) => {
    if (!shouldHandleEvent(e)) return;
    if (e.touches.length === 1) {
      touchMode = 'rotate';
      lastX = tapX = e.touches[0].clientX;
      lastY = tapY = e.touches[0].clientY;
      tapT = Date.now(); tapMoved = false;
    } else if (e.touches.length >= 2) {
      touchMode = 'pinch'; tapMoved = true;
      const a = e.touches[0], b = e.touches[1];
      lastDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
      lastMidX = (a.clientX + b.clientX) / 2; lastMidY = (a.clientY + b.clientY) / 2;
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (!touchMode) return;
    e.preventDefault();
    if (touchMode === 'rotate' && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - lastX, dy = t.clientY - lastY;
      if (Math.abs(t.clientX - tapX) + Math.abs(t.clientY - tapY) > 8) tapMoved = true;
      lastX = t.clientX; lastY = t.clientY;
      state.yaw   -= dx * 0.0065;
      state.pitch += dy * 0.0065;
      state.pitch = Math.max(state.minPitch, Math.min(state.maxPitch, state.pitch));
    } else if (touchMode === 'pinch' && e.touches.length >= 2) {
      const a = e.touches[0], b = e.touches[1];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
      state.distance *= lastDist / dist;
      state.distance = Math.max(state.minDist, Math.min(state.maxDist, state.distance));
      lastDist = dist;
      const midX = (a.clientX + b.clientX) / 2, midY = (a.clientY + b.clientY) / 2;
      pan(midX - lastMidX, midY - lastMidY);
      lastMidX = midX; lastMidY = midY;
    }
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      const wasTap = touchMode === 'rotate' && !tapMoved && Date.now() - tapT < 350;
      touchMode = null;
      if (wasTap) {
        const opts = { bubbles: true, cancelable: true, clientX: tapX, clientY: tapY, button: 0 };
        canvas.dispatchEvent(new MouseEvent('mousedown', opts));
        canvas.dispatchEvent(new MouseEvent('mouseup', opts));
        canvas.dispatchEvent(new MouseEvent('click', opts));
      }
    } else if (e.touches.length === 1) {
      touchMode = 'rotate';
      lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
      tapMoved = true; // a finger lifted mid-gesture — never treat the remainder as a tap
    }
  });

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
