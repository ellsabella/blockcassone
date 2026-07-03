// Dev-only performance instrumentation for the Big Cube page.
//
// Two axes we care about, kept separate on purpose:
//   • DATA  — chain RPC traffic (the indexer target). Every eth_call funnels
//             through chain-cubes.js `rpc()` and preview-chain.js
//             `ethCall`/`rpcRaw`; those wrap themselves with recordRpc().
//   • RENDER — rebuildScene() cost + item count + frame rate, fed from main.js.
//
// Nothing here changes behaviour; it only counts. Remove/guard before prod.
// Toggle the HUD in the viewer with the `P` key (wired in main.js).

const RPC_SLOW_MS = 250;   // flag an individual RPC round-trip slower than this
const FPS_WINDOW = 60;     // frames averaged for the FPS readout

const state = {
  // DATA (cumulative since last reset)
  rpcRequests: 0,   // HTTP round-trips to the RPC proxy/node
  rpcSubCalls: 0,   // JSON-RPC calls (a batch of 100 counts as 100)
  rpcErrors: 0,
  rpcMs: 0,         // summed wall-time across all RPC round-trips
  rpcSlow: 0,       // round-trips over RPC_SLOW_MS
  lastRpcMs: 0,
  lastRpcMethod: '',
  // hydration = one full loadChainMintRecords() pass
  hydrationMs: 0,
  hydrationRecords: 0,
  hydrations: 0,
  // RENDER
  lastRebuildMs: 0,
  maxRebuildMs: 0,
  rebuilds: 0,
  lastItemCount: 0,
  // frame timing
  _frameTimes: [],
  _lastFrameAt: 0,
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Wrap an RPC round-trip. Returns a `done(ok)` you call when it settles.
// `subCalls` is the number of JSON-RPC calls in the (possibly batched) request.
export function startRpc(method, subCalls = 1) {
  const t0 = now();
  return function done(ok = true) {
    const dt = now() - t0;
    state.rpcRequests += 1;
    state.rpcSubCalls += subCalls;
    state.rpcMs += dt;
    state.lastRpcMs = dt;
    state.lastRpcMethod = method;
    if (dt > RPC_SLOW_MS) state.rpcSlow += 1;
    if (!ok) state.rpcErrors += 1;
  };
}

export function recordHydration(ms, records) {
  state.hydrationMs = ms;
  state.hydrationRecords = records;
  state.hydrations += 1;
}

export function noteRebuild(ms, itemCount) {
  state.lastRebuildMs = ms;
  state.maxRebuildMs = Math.max(state.maxRebuildMs, ms);
  state.rebuilds += 1;
  state.lastItemCount = itemCount;
}

export function noteFrame() {
  const t = now();
  if (state._lastFrameAt) {
    state._frameTimes.push(t - state._lastFrameAt);
    if (state._frameTimes.length > FPS_WINDOW) state._frameTimes.shift();
  }
  state._lastFrameAt = t;
}

function fps() {
  const n = state._frameTimes.length;
  if (!n) return 0;
  const avg = state._frameTimes.reduce((a, b) => a + b, 0) / n;
  return avg > 0 ? 1000 / avg : 0;
}

export function getSnapshot() {
  return {
    fps: fps(),
    rebuild: { last: state.lastRebuildMs, max: state.maxRebuildMs, count: state.rebuilds, items: state.lastItemCount },
    rpc: {
      requests: state.rpcRequests,
      subCalls: state.rpcSubCalls,
      errors: state.rpcErrors,
      totalMs: state.rpcMs,
      slow: state.rpcSlow,
      lastMs: state.lastRpcMs,
      lastMethod: state.lastRpcMethod,
    },
    hydration: { ms: state.hydrationMs, records: state.hydrationRecords, count: state.hydrations },
  };
}

// Reset the cumulative counters (frame ring is left alone so FPS stays live).
export function resetMetrics() {
  Object.assign(state, {
    rpcRequests: 0, rpcSubCalls: 0, rpcErrors: 0, rpcMs: 0, rpcSlow: 0,
    lastRpcMs: 0, lastRpcMethod: '',
    hydrationMs: 0, hydrationRecords: 0, hydrations: 0,
    maxRebuildMs: 0, rebuilds: 0,
  });
}

// One-line text summary for the HUD.
export function formatSnapshot(s = getSnapshot()) {
  const r = s.rpc;
  return [
    `FPS ${s.fps.toFixed(0)}`,
    `rebuild ${s.rebuild.last.toFixed(1)}ms (max ${s.rebuild.max.toFixed(0)}) · ${s.rebuild.items} items · ×${s.rebuild.count}`,
    `RPC ${r.requests} req / ${r.subCalls} calls · ${r.totalMs.toFixed(0)}ms · ${r.errors} err · ${r.slow} slow`,
    `hydrate ${s.hydration.ms.toFixed(0)}ms · ${s.hydration.records} records · ×${s.hydration.count}`,
  ].join('\n');
}
