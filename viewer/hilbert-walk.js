// First-person "run the Hilbert line" camera driver.
//
// Rides the eye ALONG the raw Hilbert polyline at constant speed (arc-length parameterised),
// looking a short distance ahead down the curve — as if a tiny person were running the line.
// Like createCinematicFlight, it mutates orbit.state directly (target/distance/yaw/pitch), so
// everything that reads the camera afterwards (scope/LOD, projection) sees the flown pose.
//
//   const walk = createHilbertWalk(orbit, points, { durationMs, lookAheadLen, heightOffset });
//   walk.start(performance.now());
//   // in the render loop:  const info = walk.update(performance.now());  // {progress, done}

export function createHilbertWalk(orbit, points, opts = {}) {
  const durationMs   = opts.durationMs   || 30000;
  const lookAheadLen = opts.lookAheadLen || 1;      // world units to look ahead down the curve
  const heightOffset = opts.heightOffset || 0;      // world units to lift the eye above the line
  const far          = opts.far          || 400;
  const near         = opts.near ?? 0.05;
  const loop         = !!opts.loop;                 // wrap forever (seamless loop) vs one-shot
  const fixedTarget  = opts.target || null;         // always face this point (e.g. street centre) vs look-ahead
  const minDist      = opts.minDist || 0;           // keep the eye at least this far from the target

  // Cumulative arc length so speed is constant regardless of segment spacing.
  const n = points.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const a = points[i - 1], b = points[i];
    cum[i] = cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  const total = cum[n - 1] || 1;

  // Position at arc-length s (clamped), linearly interpolated within its segment.
  function at(s) {
    s = Math.max(0, Math.min(total, s));
    let lo = 1, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < s) lo = mid + 1; else hi = mid; }
    const i = Math.max(1, lo);
    const s0 = cum[i - 1], s1 = cum[i];
    const f = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    const a = points[i - 1], b = points[i];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, seg: i - 1 };
  }

  let started = 0;
  function start(now) { started = now; }

  // smootherstep on the first/last ~8% so the run eases in and settles at the end.
  function ease(p) {
    const a = 0.08;
    if (p < a)      { const u = p / a;           return a * (u * u * (3 - 2 * u)); }
    if (p > 1 - a)  { const u = (1 - p) / a;      return 1 - a * (u * u * (3 - 2 * u)); }
    return p;
  }

  function update(now) {
    let p = (now - started) / durationMs;
    if (loop) p = p - Math.floor(p);                       // wrap 0..1 forever
    else p = Math.max(0, Math.min(1, p));
    const s = loop ? p * total : ease(p) * Math.max(0, total - lookAheadLen);
    const eye = at(s);
    const bob = loop ? 0 : Math.sin(now * 0.008) * heightOffset * 0.10; // no bob in a seamless loop
    const ex = eye.x, ey = eye.y + heightOffset + bob, ez = eye.z;

    // Aim: either a fixed point (e.g. street centre) or a look-ahead point down the curve.
    let lx, ly, lz;
    if (fixedTarget) { lx = fixedTarget[0]; ly = fixedTarget[1]; lz = fixedTarget[2]; }
    else { const look = at(s + lookAheadLen); lx = look.x; ly = look.y + heightOffset * 0.55; lz = look.z; }

    // Invert the orbit model: camera at the eye, target at the aim point.
    let dx = ex - lx, dy = ey - ly, dz = ez - lz;
    let dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-6) { dx = 0; dy = 0.3; dz = 1; dist = Math.hypot(dx, dy, dz); }
    dx /= dist; dy /= dist; dz /= dist;
    const st = orbit.state;
    st.target[0] = lx; st.target[1] = ly; st.target[2] = lz;
    st.distance = Math.max(dist, minDist);
    st.pitch = Math.asin(Math.max(-1, Math.min(1, dy)));
    st.yaw   = Math.atan2(dx, dz);
    st.near  = near;
    if (st.far < far) st.far = far;

    return { progress: p, seg: eye.seg, done: !loop && p >= 1 };
  }

  return { start, update, get total() { return total; } };
}

// "Rollercoaster": ride the Hilbert line THROUGH the middles of the cubes while a slow
// breathing envelope pulls the eye radially out of the block (see it whole) and dives it
// back onto the line (through cube interiors), pullCycles times per run. The eye's outward
// direction is radial from the block centre through the current line point (+ a little up),
// so the pull-out always reads as "zooming out of the block". One-shot, eased ends.
export function createRollercoaster(orbit, points, opts = {}) {
  const durationMs   = opts.durationMs   || 24000;
  const lookAheadLen = opts.lookAheadLen || 1;
  const pullMax      = opts.pullMax      || 30;     // world units at full zoom-out
  const pullCycles   = opts.pullCycles   ?? 2;      // dives through the line per run
  const center       = opts.center       || [0, 0, 0];
  const near         = opts.near ?? 0.05;
  const far          = opts.far  || 800;

  // Arc-length parameterisation (same machinery as createHilbertWalk).
  const n = points.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const a = points[i - 1], b = points[i];
    cum[i] = cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  const total = cum[n - 1] || 1;
  function at(s) {
    s = Math.max(0, Math.min(total, s));
    let lo = 1, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < s) lo = mid + 1; else hi = mid; }
    const i = Math.max(1, lo);
    const s0 = cum[i - 1], s1 = cum[i];
    const f = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    const a = points[i - 1], b = points[i];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
  }

  let started = 0;
  const start = now => { started = now; };

  function ease(p) { // smootherstep on the first/last 8%
    const a = 0.08;
    if (p < a)     { const u = p / a;       return a * (u * u * (3 - 2 * u)); }
    if (p > 1 - a) { const u = (1 - p) / a; return 1 - a * (u * u * (3 - 2 * u)); }
    return p;
  }

  function update(now) {
    const p = Math.max(0, Math.min(1, (now - started) / durationMs));
    const s = ease(p) * Math.max(0, total - lookAheadLen);
    const line = at(s);
    const look = at(s + lookAheadLen);
    // Breathing pull: starts fully OUT (see the block), dives to the line (through
    // cube middles), back out — cos wave, sharpened toward the line so the time
    // spent inside the cubes feels substantial.
    const w = 0.5 + 0.5 * Math.cos(p * pullCycles * Math.PI * 2);
    const pull = pullMax * Math.pow(w, 1.6);
    let ox = line.x - center[0], oy = line.y - center[1], oz = line.z - center[2];
    const ol = Math.hypot(ox, oy, oz) || 1; ox /= ol; oy /= ol; oz /= ol;
    oy += 0.35; const on = Math.hypot(ox, oy, oz); ox /= on; oy /= on; oz /= on;
    const ex = line.x + ox * pull, ey = line.y + oy * pull, ez = line.z + oz * pull;

    let dx = ex - look.x, dy = ey - look.y, dz = ez - look.z;
    let dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-6) { dx = 0; dy = 0.3; dz = 1; dist = Math.hypot(dx, dy, dz); }
    dx /= dist; dy /= dist; dz /= dist;
    const st = orbit.state;
    st.target[0] = look.x; st.target[1] = look.y; st.target[2] = look.z;
    st.distance = dist;
    st.pitch = Math.asin(Math.max(-1, Math.min(1, dy)));
    st.yaw   = Math.atan2(dx, dz);
    st.near  = near;
    if (st.far < far) st.far = far;
    return { progress: p, done: p >= 1 };
  }
  return { start, update, get total() { return total; } };
}

// Figure-eight orbit around a fixed centre (e.g. one cube). Yaw/pitch trace a 1:2 Lissajous (the
// figure-8), sweeping all sides; distance pulses out and back in. Seamless loop. Drives orbit.state.
export function createCubeOrbit(orbit, center, opts = {}) {
  const durationMs = opts.durationMs || 10000;
  const loops      = opts.loops ?? 3;               // figure-eights per clip
  const yawAmp     = opts.yawAmp   ?? Math.PI;      // ±180° → every side
  const pitchAmp   = opts.pitchAmp ?? 1.0;          // ±~57° → top & bottom
  const diveMin    = opts.diveMin ?? 0.1;           // closest approach — dives into the centre
  const diveMax    = opts.diveMax ?? 3;             // farthest pull-out
  const diveCycles = opts.diveCycles ?? loops;      // dives into the middle per clip
  const far        = opts.far  || 400;
  const near       = opts.near ?? 0.05;

  let started = 0;
  const start = now => { started = now; };

  function update(now) {
    let p = (now - started) / durationMs;
    p = p - Math.floor(p);                           // wrap → seamless loop
    const th = p * loops * Math.PI * 2;
    const st = orbit.state;
    st.target[0] = center[0]; st.target[1] = center[1]; st.target[2] = center[2];
    st.yaw   = yawAmp   * Math.sin(th);
    st.pitch = pitchAmp * Math.sin(2 * th);          // 1:2 Lissajous → figure-eight
    // Pulled out at the loop ends, diving to diveMin (into the middle) once per dive-cycle.
    st.distance = diveMin + (diveMax - diveMin) * (0.5 + 0.5 * Math.cos(p * diveCycles * Math.PI * 2));
    st.near = near;
    if (st.far < far) st.far = far;
    return { progress: p, done: false };
  }
  return { start, update };
}
