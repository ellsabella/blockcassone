// Shared, memoized fetch of the indexer's world snapshot. Two independent
// consumers (chain-cubes record load + mint-simulator CC0 art pool) used to
// each fetch AND JSON-parse the full file — ~13.5 MB twice at sellout. One
// promise, one parse, both read it.
let _snapPromise = null;
let _forceReload = false;

// Drop the memoized snapshot so the NEXT fetchWorldSnapshot() re-reads from the network
// (bypassing the 60s Cache-Control too). Call after a move/merge/customize tx so the page
// reflects the just-mined state instead of the snapshot it first loaded. Without this the
// promise is memoized for the page's lifetime and post-tx reloads show stale data.
export function invalidateWorldSnapshot() { _snapPromise = null; _forceReload = true; }

export function fetchWorldSnapshot() {
  if (!_snapPromise) {
    // cache: 'default' (NOT no-store) so the landing page's <link rel="prefetch">
    // of this file is actually honored — the viewer then reads it from cache and
    // the neighbourhood is ready the moment the fade lifts. The server caps
    // freshness via Cache-Control max-age.
    // ?fresh=1 (the Update page's "live in the Explorer" link) or an invalidate() after a
    // tx forces a network revalidation once so a just-changed cube never shows stale art.
    let fresh = false;
    try { fresh = new URLSearchParams(location.search).has('fresh'); } catch (_) {}
    const mode = (fresh || _forceReload) ? 'reload' : 'default';
    _forceReload = false;
    _snapPromise = fetch('/data/world-snapshot.json', { cache: mode })
      .then(res => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return _snapPromise;
}
