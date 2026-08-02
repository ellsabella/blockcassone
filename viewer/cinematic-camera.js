// Shared cinematic flight driver. Eases an orbit camera through a list of nested
// keyframes (cube → street → neighbourhood → region → world), looping back to the
// first. Used by BOTH the Home hero (auto-play) and the Big Cube "play flythrough"
// control — one implementation, no duplication.
//
//   const flight = createCinematicFlight(orbit, keyframes, { cycleMs });
//   // in the render loop:  const lvl = flight.update(performance.now());
//
// It mutates orbit.state directly (target/distance/yaw/pitch), so anything that
// reads the camera afterwards (scope/LOD, projection) sees the flown pose.

export function createCinematicFlight(orbit, keyframes, opts = {}) {
  const kf = keyframes.filter(Boolean);
  const stops = kf.length > 1 ? [...kf, kf[0]] : kf.slice(); // loop: dive back to the first
  const SEG = Math.max(1, stops.length - 1);
  const cycleMs = opts.cycleMs || SEG * 4200;
  const spin = opts.spin ?? 0.00011;
  const basePitch = opts.pitch ?? 0.30;
  const far = opts.far ?? 600;
  let pausedUntil = 0;

  // If the viewer interacts (drag/zoom), yield the camera for a bit, then resume.
  function pause(ms = 5000) { pausedUntil = performance.now() + ms; }

  function levelAt(nowMs) {
    const u = ((nowMs % cycleMs) / cycleMs) * SEG;
    const i = Math.min(SEG - 1, Math.floor(u));
    return { i, f: u - i };
  }

  function update(nowMs) {
    if (nowMs < pausedUntil || stops.length < 2) return null; // user is driving / nothing to fly
    const { i, f: fRaw } = levelAt(nowMs);
    const f = fRaw * fRaw * fRaw * (fRaw * (fRaw * 6 - 15) + 10); // smootherstep — lingers at each stop
    const A = stops[i], B = stops[i + 1];
    const s = orbit.state;
    s.target[0] = A.target[0] + (B.target[0] - A.target[0]) * f;
    s.target[1] = A.target[1] + (B.target[1] - A.target[1]) * f;
    s.target[2] = A.target[2] + (B.target[2] - A.target[2]) * f;
    s.distance = A.distance * Math.pow(B.distance / A.distance, f); // exponential = natural zoom
    s.yaw = Math.PI * 0.22 + nowMs * spin;
    s.pitch = basePitch + 0.15 * Math.sin(nowMs * 0.00007);
    if (s.far < far) s.far = far; // don't clip the whole world at max zoom-out
    // which keyframe are we closest to (for HUD + LOD scope)
    return { level: f < 0.5 ? i : Math.min(kf.length - 1, i + 1), from: i, to: i + 1, f };
  }

  return { update, pause, get cycleMs() { return cycleMs; }, levels: kf.length };
}
