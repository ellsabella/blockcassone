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
    const pRaw = Math.max(0, Math.min(1, (now - started) / durationMs));
    const s = ease(pRaw) * (total - lookAheadLen); // stop short so "look ahead" never clamps at the end
    const eye  = at(s);
    const look = at(s + lookAheadLen);
    const bob  = Math.sin(now * 0.008) * heightOffset * 0.10; // subtle running bob
    const ex = eye.x,  ey = eye.y  + heightOffset + bob, ez = eye.z;
    const lx = look.x, ly = look.y + heightOffset * 0.55,  lz = look.z;

    // Invert the orbit model: place the camera at the eye, aim the target at the look-ahead point.
    let dx = ex - lx, dy = ey - ly, dz = ez - lz;
    const dist = Math.hypot(dx, dy, dz) || 0.001;
    dx /= dist; dy /= dist; dz /= dist;
    const st = orbit.state;
    st.target[0] = lx; st.target[1] = ly; st.target[2] = lz;
    st.distance = dist;
    st.pitch = Math.asin(Math.max(-1, Math.min(1, dy)));
    st.yaw   = Math.atan2(dx, dz);
    st.near  = near;
    if (st.far < far) st.far = far;

    return { progress: pRaw, seg: eye.seg, done: pRaw >= 1 };
  }

  return { start, update, get total() { return total; } };
}
