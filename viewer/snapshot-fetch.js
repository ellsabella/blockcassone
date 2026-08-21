// Shared, memoized fetch of the indexer's world snapshot. Two independent
// consumers (chain-cubes record load + mint-simulator CC0 art pool) used to
// each fetch AND JSON-parse the full file — ~13.5 MB twice at sellout. One
// promise, one parse, both read it.
let _snapPromise = null;

export function fetchWorldSnapshot() {
  if (!_snapPromise) {
    // cache: 'default' (NOT no-store) so the landing page's <link rel="prefetch">
    // of this file is actually honored — the viewer then reads it from cache and
    // the neighbourhood is ready the moment the fade lifts. The server caps
    // freshness via Cache-Control max-age.
    _snapPromise = fetch('/data/world-snapshot.json', { cache: 'default' })
      .then(res => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return _snapPromise;
}
