// Dev server — Node stdlib only.
// Serves the renderer/ directory and pushes shader hot-reload events via SSE.

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// The viewer fans out many concurrent /api/chain-rpc eth_calls (thumbnails, previews), all
// proxied through Node's built-in fetch (undici) on one shared global dispatcher. That trips
// undici's default 10-listener "possible EventEmitter memory leak" warning on its socket pool —
// legitimate concurrency, not a leak. Raise the ceiling so the console stays clean.
require('events').EventEmitter.defaultMaxListeners = 100;

const ROOT      = __dirname;                        // renderer/
const REPO_ROOT = path.resolve(__dirname, '..');    // blockcassone/
const PORT      = parseInt(process.env.PORT || '3000', 10);

// ---------- Share-on-X snapshots (Twitter/X card images) ----------
// Client captures the cube view → POST /s → we store a WebP + an id→slot record; /s/<id> serves an
// unfurl card page (twitter:image) and redirects humans to the cube; /s/<id>.webp serves the image.
// Ephemeral by design: swept on a short TTL + a hard count cap so disk never accumulates.
const SHARES_DIR      = path.join(REPO_ROOT, 'shares');
const SHARES_INDEX    = path.join(SHARES_DIR, 'index.json');
const SHARE_TTL_MS    = 3 * 60 * 60 * 1000; // delete images older than 3h (past X's crawl window)
const SHARE_MAX       = 500;                // hard cap: keep only the newest N images
const SHARE_MIN_AGE_MS = 60 * 60 * 1000;    // never count-evict anything younger than 1h
const SHARE_ID_RE     = /^[A-Za-z0-9_-]{6,40}$/;
fs.mkdirSync(SHARES_DIR, { recursive: true });

function loadDotEnv(filePath, { override = false } = {}) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (key && (override || process.env[key] === undefined)) process.env[key] = value;
  }
}

const ENV_PATH = path.join(REPO_ROOT, '.env');
const DEV_MINTS_PATH = path.join(REPO_ROOT, 'viewer', 'data', 'dev-mints.json');
loadDotEnv(ENV_PATH);

// Route prefixes that should resolve from the repo root (outside renderer/).
// Everything else resolves from renderer/.
const REPO_PREFIXES = ['/viewer/', '/core/', '/public/', '/schema/', '/renderer/', '/data/', '/dist/', '/tmp/'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.otf':  'font/otf',
  '.ttf':  'font/ttf',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

async function devFetch(url, options = {}) {
  // Dev-box TLS workaround ONLY: in production (NODE_ENV=production, as set by the
  // systemd unit) outbound TLS is always verified — the proxy talks to key-bearing
  // RPC endpoints and must not be MITM-able.
  if (process.env.NODE_ENV === 'production') return fetch(url, options);
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    return await fetch(url, options);
  } finally {
    if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
  }
}

function sendJson(res, code, payload) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function defaultDevMints() {
  return { nextCubeId: 1, mints: [] };
}

function readDevMints() {
  try {
    if (!fs.existsSync(DEV_MINTS_PATH)) return defaultDevMints();
    const parsed = JSON.parse(fs.readFileSync(DEV_MINTS_PATH, 'utf8'));
    return {
      nextCubeId: Math.max(1, Number(parsed.nextCubeId) || 1),
      mints: Array.isArray(parsed.mints) ? parsed.mints : [],
    };
  } catch (_) {
    return defaultDevMints();
  }
}

function writeDevMints(state) {
  fs.mkdirSync(path.dirname(DEV_MINTS_PATH), { recursive: true });
  fs.writeFileSync(DEV_MINTS_PATH, JSON.stringify(state, null, 2) + '\n');
}

function readChainConfig() {
  // The proxy's upstream RPC. Prefer a SERVER-ONLY env var so a key-bearing endpoint
  // (e.g. Alchemy on Sepolia) never has to live in the browser-served chain-config.json
  // — in proxied mode the deploy writes rpcUrl:"" there on purpose. Fall back to the
  // config's rpcUrl only for local dev, where it's a non-secret 127.0.0.1 node.
  loadDotEnv(ENV_PATH, { override: true });
  const envRpc = process.env.BLOCKCASSONE_RPC_URL || process.env.BLOCKCASSONE_PROXY_RPC_URL;
  try {
    // Honour the same dev-only override the static handler applies to
    // /data/chain-config.json, so server-side eth_calls hit the same chain
    // the browser is looking at.
    const configPath = process.env.BLOCKCASSONE_CHAIN_CONFIG
      ? path.join(REPO_ROOT, String(process.env.BLOCKCASSONE_CHAIN_CONFIG).replace(/^\/+/, ''))
      : path.join(REPO_ROOT, 'data', 'chain-config.json');
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return {
      rpcUrl: String(envRpc || parsed.rpcUrl || 'http://127.0.0.1:8545'),
      chainId: Number(parsed.chainId || 0),
      cubeNft: String(parsed.cubeNft || ''),
      thumbnailRenderer: String(parsed.thumbnailRenderer || ''),
      // Attestation-service verification targets (see handleAttest):
      flatteningAttestation: String(parsed.flatteningAttestation || ''),
      normies: String(parsed.normies || ''),
      nonNormieStore: String(parsed.nonNormieStore || ''),
    };
  } catch (_) {
    return { rpcUrl: String(envRpc || 'http://127.0.0.1:8545'), chainId: 0, cubeNft: '', thumbnailRenderer: '' };
  }
}

// Minimal eth_call over the upstream RPC (no viem dependency, so this works on a
// bare local dev box). Returns the raw 0x-prefixed return data.
async function ethCall(rpcUrl, to, data) {
  const r = await devFetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'eth_call error');
  return String(j.result || '0x');
}

const pad32 = (hex) => hex.replace(/^0x/, '').padStart(64, '0');

// Decode a single ABI-encoded `string` return (offset, length, utf-8 bytes).
function decodeAbiString(ret) {
  const hex = ret.replace(/^0x/, '');
  if (hex.length < 128) return '';
  const len = parseInt(hex.slice(64, 128), 16);
  const bytes = Buffer.from(hex.slice(128, 128 + len * 2), 'hex');
  return bytes.toString('utf8');
}

// The REAL per-cube 2D thumbnail: cubeForSlot(slot) -> thumbnailSVG(cubeId) on-chain,
// built from the SAME art bytes the 3D cube renders — so the two panels always match.
// GET /api/thumbnail?slot=N  (or ?cube=ID)  ->  image/svg+xml
// On-chain thumbnail render is SECONDS of heavy view-call — cache it. Art is
// immutable until customize/rebase mechanics open (off at launch), so a short
// TTL is purely defensive; slot→cube mappings can change as mints land, so
// slot-derived lookups re-resolve but the per-cube SVG cache still hits.
const _thumbCache = new Map(); // cubeId -> { svg, ts }
const THUMB_TTL_MS = 10 * 60 * 1000;
const THUMB_CACHE_MAX = 800;
const THUMBS_DIR = path.join(REPO_ROOT, 'data', 'thumbs'); // indexer-baked SVGs

// slot -> cubeId from the indexer snapshot (mtime-cached) — kills the live
// cubeForSlot eth_call for every already-indexed cube. Fresh mints not yet in
// the snapshot fall back to the chain (stale-tolerant, live-correct).
let _slotMap = { mtime: 0, map: null };
function slotToCubeFromSnapshot(slot) {
  try {
    const p = path.join(REPO_ROOT, 'data', 'world-snapshot.json');
    const st = fs.statSync(p);
    if (!_slotMap.map || st.mtimeMs !== _slotMap.mtime) {
      const snap = JSON.parse(fs.readFileSync(p, 'utf8'));
      const m = new Map();
      for (const r of snap.records || []) {
        if (Number.isInteger(r.slot) && r.cubeId) m.set(r.slot, String(r.cubeId));
      }
      _slotMap = { mtime: st.mtimeMs, map: m };
    }
    return _slotMap.map.get(slot) || null;
  } catch (_) { return null; }
}

async function handleThumbnail(req, res) {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const cfg = readChainConfig();
    if (!cfg.thumbnailRenderer) { sendJson(res, 503, { error: 'thumbnailRenderer not configured' }); return; }
    let cubeId = url.searchParams.get('cube');
    if (!cubeId) {
      const slot = Number(url.searchParams.get('slot'));
      if (!Number.isInteger(slot) || slot < 0) { sendJson(res, 400, { error: 'bad slot' }); return; }
      if (!cfg.cubeNft) { sendJson(res, 503, { error: 'cubeNft not configured' }); return; }
      cubeId = slotToCubeFromSnapshot(slot); // indexer-first, zero RPC
      if (!cubeId) {
        const ret = await ethCall(cfg.rpcUrl, cfg.cubeNft, '0x7bdf1f21' + pad32(slot.toString(16))); // cubeForSlot(uint32)
        cubeId = BigInt(ret || '0x0').toString();
      }
    }
    if (BigInt(cubeId) === 0n) { sendJson(res, 404, { error: 'no cube at slot' }); return; }
    cubeId = BigInt(cubeId).toString();
    const sendSvg = (svg) => {
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=600',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(svg);
    };
    const hit = _thumbCache.get(cubeId);
    if (hit && Date.now() - hit.ts < THUMB_TTL_MS) { sendSvg(hit.svg); return; }
    // Indexer-baked thumbnail on disk → serve with zero RPC (the normal path).
    try {
      const baked = fs.readFileSync(path.join(THUMBS_DIR, `${cubeId}.svg`), 'utf8');
      if (baked) {
        if (_thumbCache.size >= THUMB_CACHE_MAX) _thumbCache.delete(_thumbCache.keys().next().value);
        _thumbCache.set(cubeId, { svg: baked, ts: Date.now() });
        sendSvg(baked);
        return;
      }
    } catch (_) { /* not baked yet — live render below */ }
    const svgRet = await ethCall(cfg.rpcUrl, cfg.thumbnailRenderer,
      '0x1df76ecc' + pad32(BigInt(cubeId).toString(16))); // thumbnailSVG(uint256)
    const svg = decodeAbiString(svgRet);
    if (!svg) { sendJson(res, 502, { error: 'empty thumbnail' }); return; }
    if (_thumbCache.size >= THUMB_CACHE_MAX) {
      const oldest = _thumbCache.keys().next().value;
      _thumbCache.delete(oldest);
    }
    _thumbCache.set(cubeId, { svg, ts: Date.now() });
    sendSvg(svg);
  } catch (err) {
    sendJson(res, 502, { error: 'thumbnail failed', detail: String(err?.message || err) });
  }
}

function sanitizeMintRecord(record, cubeId) {
  const slot = Number(record?.slot);
  const source = record?.source || {};
  return {
    cubeId,
    slot,
    wallet: String(record?.wallet || '').toLowerCase(),
    sourceKind: record?.sourceKind === 'normie' ? 'normie' : (record?.sourceKind === 'cc0' ? 'cc0' : 'external'),
    source: {
      chain: String(source.chain || ''),
      chainId: Number(source.chainId || 0),
      contract: String(source.contract || '').toLowerCase(),
      tokenId: String(source.tokenId || ''),
    },
    cc0: record?.cc0 && typeof record.cc0 === 'object' ? {
      projectId: String(record.cc0.projectId || ''),
      projectName: String(record.cc0.projectName || ''),
      license: String(record.cc0.license || ''),
      provenance: String(record.cc0.provenance || ''),
    } : null,
    agentic: Boolean(record?.agentic),
    agentId: record?.agentId ? String(record.agentId) : '',
    art: record?.art && typeof record.art === 'object' ? record.art : null,
  };
}

async function handleDevMints(req, res) {
  if (req.method === 'GET') {
    sendJson(res, 200, readDevMints());
    return;
  }

  if (req.method === 'DELETE') {
    const state = defaultDevMints();
    writeDevMints(state);
    sendJson(res, 200, state);
    return;
  }

  if (req.method === 'POST') {
    try {
      const payload = JSON.parse(await readRequestBody(req, 12_000_000));
      const incoming = Array.isArray(payload?.mints) ? payload.mints : [];
      const state = readDevMints();
      for (const mint of incoming) {
        const record = sanitizeMintRecord(mint, state.nextCubeId++);
        if (!Number.isInteger(record.slot) || record.slot < 0) continue;
        if (!record.source.chain || !record.source.contract || !record.source.tokenId) continue;
        state.mints.push(record);
      }
      writeDevMints(state);
      sendJson(res, 200, state);
    } catch (err) {
      sendJson(res, 400, { error: 'Invalid dev mint payload', detail: String(err?.message || err) });
    }
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}

// ---------- OpenSea API key: self-healing free "agent" key ----------
// OpenSea issues instant, no-signup free keys via POST /api/v2/auth/keys (30-day expiry,
// 3 creations/hr/IP — https://docs.opensea.io/reference/api-keys). We cache + persist one,
// refresh it a day before expiry, and regenerate on a 401/403 — so the wallet-NFT proxy
// keeps working with zero manual key rotation. A manually-set OPENSEA_API_KEY in .env is
// used as a seed if present; otherwise a free key is generated on first need.
const OPENSEA_KEY_FILE = path.join(REPO_ROOT, 'data', '.opensea-key.json');
const OPENSEA_REFRESH_BUFFER_MS = 24 * 60 * 60 * 1000;
let _osKey = null; // { apiKey, expiresAt }
let _osKeyInflight = null;

function _osKeyValid(rec) { return rec && rec.apiKey && (rec.expiresAt - Date.now() > OPENSEA_REFRESH_BUFFER_MS); }

function _loadPersistedOsKey() {
  try { const j = JSON.parse(fs.readFileSync(OPENSEA_KEY_FILE, 'utf8')); if (j && j.apiKey) return j; } catch (_) {}
  return null;
}

async function generateOpenSeaKey() {
  const r = await devFetch('https://api.opensea.io/api/v2/auth/keys', { method: 'POST', headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`auth/keys HTTP ${r.status}`);
  const j = await r.json();
  const apiKey = j.api_key || j.apiKey || j.key;
  if (!apiKey) throw new Error('auth/keys returned no api_key');
  const expiresAt = j.expires_at ? Date.parse(j.expires_at) : (Date.now() + 30 * 24 * 60 * 60 * 1000);
  _osKey = { apiKey, expiresAt };
  try {
    fs.mkdirSync(path.dirname(OPENSEA_KEY_FILE), { recursive: true });
    fs.writeFileSync(OPENSEA_KEY_FILE, JSON.stringify({ ..._osKey, generatedAt: new Date().toISOString(), raw: j }, null, 2));
  } catch (_) { /* non-fatal */ }
  console.log(`[opensea] generated free agent key, expires ${new Date(expiresAt).toISOString()}`);
  return apiKey;
}

async function getOpenSeaKey(forceNew = false) {
  if (!forceNew) {
    if (_osKeyValid(_osKey)) return _osKey.apiKey;
    const p = _loadPersistedOsKey();
    if (_osKeyValid(p)) { _osKey = p; return p.apiKey; }
    loadDotEnv(ENV_PATH, { override: true });
    if (!_osKey && !p && process.env.OPENSEA_API_KEY) return process.env.OPENSEA_API_KEY; // manual seed
  }
  // Coalesce concurrent regenerations (rate-limited 3/hr/IP).
  if (!_osKeyInflight) _osKeyInflight = generateOpenSeaKey().finally(() => { _osKeyInflight = null; });
  return _osKeyInflight;
}

async function proxyOpenSea(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const upstreamPath = url.pathname.replace(/^\/api\/opensea\/?/, '');
  const upstream = new URL(`https://api.opensea.io/api/v2/${upstreamPath}`);
  upstream.search = url.search;
  const call = (key) => devFetch(upstream, { headers: { accept: 'application/json', 'x-api-key': key } });

  try {
    let key = await getOpenSeaKey();
    let upstreamRes = await call(key);
    if (upstreamRes.status === 401 || upstreamRes.status === 403) {
      // Key expired/invalid — regenerate once and retry.
      key = await getOpenSeaKey(true);
      upstreamRes = await call(key);
    }
    const text = await upstreamRes.text();
    res.writeHead(upstreamRes.status, {
      'Content-Type': upstreamRes.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(text);
  } catch (err) {
    sendJson(res, 502, {
      error: 'OpenSea proxy failed',
      detail: String(err?.message || err),
      cause: err?.cause ? String(err.cause?.message || err.cause) : undefined,
      code: err?.cause?.code,
    });
  }
}

async function proxyNormies(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const upstreamPath = url.pathname.replace(/^\/api\/normies\/?/, '');
  const upstream = new URL(`https://api.normies.art/${upstreamPath}`);
  upstream.search = url.search;

  try {
    const upstreamRes = await devFetch(upstream);
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    res.writeHead(upstreamRes.status, {
      'Content-Type': upstreamRes.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  } catch (err) {
    sendJson(res, 502, {
      error: 'Normies proxy failed',
      detail: String(err?.message || err),
      cause: err?.cause ? String(err.cause?.message || err.cause) : undefined,
      code: err?.cause?.code,
    });
  }
}

async function proxyChainRpc(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readRequestBody(req, 4_000_000);
    const config = readChainConfig();
    // Fallback pool (SITE_DEPLOY "RPC provisioning" #3): if the primary answers 429
    // (Alchemy throughput cap) or 5xx, or is unreachable, retry against publicnode.
    // MAINNET ONLY — a fallback must never answer for a local/Sepolia chain.
    const upstreams = [config.rpcUrl];
    const fallback = process.env.BLOCKCASSONE_FALLBACK_RPC_URL || 'https://ethereum-rpc.publicnode.com';
    if (config.chainId === 1 && fallback && fallback !== config.rpcUrl) upstreams.push(fallback);
    let lastErr = null;
    for (let i = 0; i < upstreams.length; i++) {
      const isLast = i === upstreams.length - 1;
      try {
        // Timeout on non-final upstreams: a HANGING primary must fail over to
        // publicnode, not hold the browser's request open indefinitely.
        const ac = new AbortController();
        const timer = isLast ? null : setTimeout(() => ac.abort(), 10_000);
        const upstreamRes = await devFetch(upstreams[i], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: ac.signal,
        }).finally(() => { if (timer) clearTimeout(timer); });
        if (!isLast && (upstreamRes.status === 429 || upstreamRes.status >= 500)) {
          lastErr = new Error(`upstream ${i} status ${upstreamRes.status}`);
          continue;
        }
        const text = await upstreamRes.text();
        res.writeHead(upstreamRes.status, {
          'Content-Type': upstreamRes.headers.get('content-type') || 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(text);
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('no upstream responded');
  } catch (err) {
    sendJson(res, 502, {
      error: 'Chain RPC proxy failed',
      detail: String(err?.message || err),
      cause: err?.cause ? String(err.cause?.message || err.cause) : undefined,
      code: err?.cause?.code,
    });
  }
}

// ---------- Attestation signer service (/api/attest) ----------
// The FlatteningAttestation is signed by a server-held key (never the browser). The
// client (viewer/preview-chain.js) builds the EXACT EIP-712 typed data it will submit,
// POSTs it here, and gets back a signature. On local Anvil the client uses the node's
// unlocked signer (eth_signTypedData_v4) instead and never reaches this route.
//
// SECURITY: NOT a blind oracle — verifyAttestRequest() pins the EIP-712 envelope and
// independently enforces the pool + ownership/delegation rules against the chain
// before anything is signed (see the block comment above it for what is and is not
// covered). The remaining trust gap is payloadHash fidelity (no server-side
// re-flatten), which only lets an owner stylise art on a source they legitimately
// control.
//
// viem is required LAZILY so the dev server still boots without it (only the Sepolia
// signer path needs it — install with `npm i viem` on the VPS). Key from env:
// BLOCKCASSONE_ATTESTATION_SIGNER_PK (or ATTEST_SIGNER_PK) — the PRIVATE key whose
// address is the deploy-time BLOCKCASSONE_ATTESTATION_SIGNER.
let _attestAccount = null;
function getAttestAccount() {
  if (_attestAccount) return _attestAccount;
  const pk = process.env.BLOCKCASSONE_ATTESTATION_SIGNER_PK || process.env.ATTEST_SIGNER_PK;
  if (!pk) throw new Error('Missing BLOCKCASSONE_ATTESTATION_SIGNER_PK in .env');
  let privateKeyToAccount;
  try { ({ privateKeyToAccount } = require('viem/accounts')); }
  catch (_) { throw new Error('viem not installed for the signer service — run: npm i viem'); }
  _attestAccount = privateKeyToAccount(pk.startsWith('0x') ? pk : '0x' + pk);
  return _attestAccount;
}

// viem wants bigint for uint/int fields and a real bool; the client sends them as
// strings over JSON, so coerce by the primaryType's field types before signing.
function coerceTypedMessage(types, primaryType, message) {
  const out = { ...message };
  for (const f of (types[primaryType] || [])) {
    if (out[f.name] == null) continue;
    if (/^u?int\d*$/.test(f.type)) out[f.name] = BigInt(out[f.name]);
    else if (f.type === 'bool' && typeof out[f.name] === 'string') out[f.name] = out[f.name] === 'true';
  }
  return out;
}

// ---- attestation verification (mainnet hardening) --------------------------
// The signer must never be a blind oracle: before signing we independently verify
// that the requested attestation is one the legit client flow could have built.
//   PIN     domain (name/version/chainId/verifyingContract), primaryType, version
//           fields, deadline window.
//   POOL    the source must not be mint-pool art: not a Normie, no committed
//           payload in the NonNormieArtStore (pool + reserve), not already the
//           source of a live cube (cubeForSourceKey). Mirrors the UI guard — but
//           HERE is the real enforcement (the UI can be bypassed; this can't).
//   OWNER   the minter must own the source token, or hold a delegate.xyz
//           Registry-V2 delegation from its owner. The token is looked up on
//           mainnet first, then the other wallet chains the site lists.
// What is NOT verified: that the payloadHash is a faithful flattening of the
// source's art (would need a server-side re-render). An owner can therefore
// still stylise art on a source THEY OWN — accepted; the pool + ownership rules
// are the ones that protect other people and the mint.
const ATTEST_WORD = (v) => BigInt(v).toString(16).padStart(64, '0');
const ATTEST_ADDR = (a) => String(a).replace(/^0x/, '').toLowerCase().padStart(64, '0');
const ATTEST_DELEGATE_REGISTRY = '0x00000000000000447e69651d841bD8D104Bed493';
const ATTEST_ALT_CHAINS = [ // where else wallet art may live (viewer DEFAULT_WALLET_CHAINS)
  { name: 'base', rpcUrl: 'https://mainnet.base.org' },
  { name: 'shape', rpcUrl: 'https://mainnet.shape.network' },
];
const ZERO_RET = (r) => /^0x0*$/.test(String(r || '0x0'));

// Per-IP limiter: attests are rare (one per commit), so a low ceiling is safe.
const _attestHits = new Map(); // ip -> { n, resetAt }
function attestRateLimited(ip) {
  const now = Date.now();
  const h = _attestHits.get(ip);
  if (!h || now > h.resetAt) { _attestHits.set(ip, { n: 1, resetAt: now + 3_600_000 }); return false; }
  h.n += 1;
  return h.n > 30;
}

// keccak256(abi.encode(...)) via viem (already a signer-service dependency).
function attestKeys(chainId, sourceContract, sourceTokenId) {
  const { keccak256, encodeAbiParameters } = require('viem');
  const storeKey = keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }], [sourceContract, BigInt(sourceTokenId)]));
  const claimKey = keccak256(encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }],
    [BigInt(chainId), sourceContract, BigInt(sourceTokenId)]));
  return { storeKey: storeKey.slice(2), claimKey: claimKey.slice(2) };
}

async function verifyAttestRequest(typedData, vaultHint) {
  const config = readChainConfig();
  const m = typedData.message || {};
  const d = typedData.domain || {};
  const fail = (reason) => ({ ok: false, reason });

  // PIN — exactly the envelope preview-chain.js builds, nothing else.
  if (typedData.primaryType !== 'Attestation') return fail('unexpected primaryType');
  if (d.name !== 'TheBLOCKFlattening' || String(d.version) !== '1') return fail('unexpected domain');
  if (Number(d.chainId) !== config.chainId) return fail('unexpected domain chainId');
  if (!config.flatteningAttestation ||
      String(d.verifyingContract).toLowerCase() !== config.flatteningAttestation.toLowerCase()) {
    return fail('unexpected verifyingContract');
  }
  if (String(m.agentic) === 'true' || m.agentic === true) return fail('agentic attestations are not served here');
  if (Number(m.payloadVersion) !== 1 || Number(m.flatteningVersion) !== 1) return fail('unexpected payload version');
  const deadline = Number(m.deadline || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!(deadline > now && deadline <= now + 7200)) return fail('deadline outside the accepted window');
  const minter = String(m.minter || '');
  const sourceContract = String(m.sourceContract || '');
  if (!/^0x[0-9a-fA-F]{40}$/.test(minter) || !/^0x[0-9a-fA-F]{40}$/.test(sourceContract)) {
    return fail('malformed addresses');
  }
  let sourceTokenId;
  try { sourceTokenId = BigInt(m.sourceTokenId); } catch (_) { return fail('malformed sourceTokenId'); }

  // POOL — never attest mint-pool art (mirrors CubeNFT's chain-blind sourceKey).
  if (config.normies && sourceContract.toLowerCase() === config.normies.toLowerCase()) {
    return fail('Normies are mint-pool art');
  }
  const { storeKey, claimKey } = attestKeys(config.chainId, sourceContract, sourceTokenId);
  if (config.nonNormieStore) {
    const r = await ethCall(config.rpcUrl, config.nonNormieStore, '0x65626080' + storeKey); // sourcePayloadHash(bytes32)
    if (!ZERO_RET(r)) return fail('source is reserved by the mint pool');
  }
  if (config.cubeNft) {
    const r = await ethCall(config.rpcUrl, config.cubeNft, '0xdd597020' + claimKey); // cubeForSourceKey(bytes32)
    if (!ZERO_RET(r)) return fail('source is already claimed by a cube');
  }

  // OWNER — find the token's chain and verify the minter controls it.
  //   ERC-721:  ownerOf == minter, or a delegate.xyz ERC-721 delegation from the owner.
  //   ERC-1155: balanceOf(minter, id) > 0, or — with the client's vault hint —
  //             balanceOf(vault, id) > 0 plus a delegate.xyz ERC-1155 delegation
  //             (1155s have no single owner to discover on-chain, so the vault
  //             must be named by the requester; the hint is verified, not trusted).
  const chains = [{ name: 'ethereum', rpcUrl: config.rpcUrl }, ...ATTEST_ALT_CHAINS];
  const vault = /^0x[0-9a-fA-F]{40}$/.test(String(vaultHint || '')) ? String(vaultHint) : null;
  const ownerData = '0x6352211e' + ATTEST_WORD(sourceTokenId); // ownerOf(uint256)
  const balData = (who) => '0x00fdd58e' + ATTEST_ADDR(who) + ATTEST_WORD(sourceTokenId); // balanceOf(address,uint256)
  for (const chain of chains) {
    // ERC-721 path
    let owner = null;
    try {
      const r = await ethCall(chain.rpcUrl, sourceContract, ownerData);
      if (r && r !== '0x' && !ZERO_RET(r)) owner = '0x' + String(r).replace(/^0x/, '').slice(-40);
    } catch (_) { /* not a 721 on this chain — try 1155 below */ }
    if (owner) {
      if (owner.toLowerCase() === minter.toLowerCase()) return { ok: true };
      try {
        const del = await ethCall(chain.rpcUrl, ATTEST_DELEGATE_REGISTRY,
          '0xb9f36874' + ATTEST_ADDR(minter) + ATTEST_ADDR(owner) + ATTEST_ADDR(sourceContract)
          + ATTEST_WORD(sourceTokenId) + '0'.repeat(64)); // checkDelegateForERC721(...,rights=0)
        if (!ZERO_RET(del)) return { ok: true };
      } catch (_) { /* registry unreachable on this chain */ }
      return fail('minter neither owns the source token nor holds a delegate.xyz delegation from its owner');
    }
    // ERC-1155 path
    let minterBal = null;
    try {
      const r = await ethCall(chain.rpcUrl, sourceContract, balData(minter));
      if (r && r !== '0x') minterBal = BigInt(r);
    } catch (_) { /* not an 1155 either — token isn't on this chain */ }
    if (minterBal !== null) {
      if (minterBal > 0n) return { ok: true };
      if (vault) {
        try {
          const vb = BigInt(await ethCall(chain.rpcUrl, sourceContract, balData(vault)) || '0x0');
          const del = await ethCall(chain.rpcUrl, ATTEST_DELEGATE_REGISTRY,
            '0xb8705875' + ATTEST_ADDR(minter) + ATTEST_ADDR(vault) + ATTEST_ADDR(sourceContract)
            + ATTEST_WORD(sourceTokenId) + '0'.repeat(64)); // checkDelegateForERC1155(...,rights=0) -> amount
          if (vb > 0n && !ZERO_RET(del)) return { ok: true };
        } catch (_) { /* fall through to the refusal */ }
      }
      return fail('minter holds no balance of that ERC-1155 token (and no verifiable vault delegation)');
    }
  }
  return fail('source token not found on any supported chain');
}

// ---- Promo recording sink (?rec mode in the viewer) ------------------------
// Deterministic frame capture lands here: PNG frames → data/recordings/<shot>/frames,
// then /api/rec/finish assembles a high-quality MP4 (x264 crf 14) with ffmpeg.
// LOCAL DEV ONLY: refused in production and for any non-loopback peer.
const REC_DIR = path.join(REPO_ROOT, 'data', 'recordings');
const _recSafeShot = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'shot';

function recRefused(req, res) {
  const ip = String(req.socket.remoteAddress || '');
  const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (process.env.NODE_ENV === 'production' || !loopback) {
    sendJson(res, 403, { error: 'recording endpoints are local-dev only' });
    return true;
  }
  return false;
}

function readBinaryBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleRecFrame(req, res) {
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
  if (recRefused(req, res)) return;
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const shot = _recSafeShot(url.searchParams.get('shot'));
    const n = Math.max(0, Math.floor(Number(url.searchParams.get('n')) || 0));
    const dir = path.join(REC_DIR, shot, 'frames');
    // Frame 0 starts a fresh take — wipe any previous frames so a shorter re-run
    // can never inherit stale tail frames into its MP4.
    if (n === 0) fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const body = await readBinaryBody(req, 64_000_000);
    fs.writeFileSync(path.join(dir, `f${String(n).padStart(6, '0')}.png`), body);
    sendJson(res, 200, { ok: true, n });
  } catch (err) {
    sendJson(res, 500, { error: 'frame write failed', detail: String(err?.message || err) });
  }
}

async function handleRecFinish(req, res) {
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
  if (recRefused(req, res)) return;
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const shot = _recSafeShot(url.searchParams.get('shot'));
    const fps = Math.max(10, Math.min(120, Number(url.searchParams.get('fps')) || 60));
    const dir = path.join(REC_DIR, shot, 'frames');
    const frames = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^f\d{6}\.png$/.test(f)).length : 0;
    if (!frames) { sendJson(res, 400, { error: 'no frames for shot ' + shot }); return; }
    const out = path.join(REC_DIR, `${shot}-${fps}fps.mp4`);
    const { execFile } = require('node:child_process');
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-framerate', String(fps),
        '-i', path.join(dir, 'f%06d.png'),
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '14',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        out,
      ], { timeout: 600_000 }, (err, _so, se) => (err ? reject(new Error(String(se || err.message).slice(0, 300))) : resolve()));
    });
    console.log(`[rec] ${shot}: ${frames} frames @ ${fps}fps → ${out}`);
    sendJson(res, 200, { ok: true, file: `data/recordings/${shot}-${fps}fps.mp4`, frames, seconds: Number((frames / fps).toFixed(1)) });
  } catch (err) {
    sendJson(res, 500, { error: 'encode failed', detail: String(err?.message || err) });
  }
}

async function handleAttest(req, res) {
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
  loadDotEnv(ENV_PATH, { override: true });
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (attestRateLimited(ip)) { sendJson(res, 429, { error: 'Too many attestation requests — try later' }); return; }
    const { typedData, vault } = JSON.parse(await readRequestBody(req, 4_000_000));
    if (!typedData || !typedData.domain || !typedData.message || !typedData.primaryType) {
      sendJson(res, 400, { error: 'Missing typedData {domain, types, primaryType, message}' });
      return;
    }
    const verdict = await verifyAttestRequest(typedData, vault);
    if (!verdict.ok) { sendJson(res, 403, { error: 'Attestation refused', detail: verdict.reason }); return; }
    const account = getAttestAccount();
    const types = { ...typedData.types };
    delete types.EIP712Domain; // viem derives the domain type itself
    const signature = await account.signTypedData({
      domain: typedData.domain,
      types,
      primaryType: typedData.primaryType,
      message: coerceTypedMessage(types, typedData.primaryType, typedData.message),
    });
    sendJson(res, 200, { signature, signer: account.address });
  } catch (err) {
    sendJson(res, 500, { error: 'Attestation signing failed', detail: String(err?.message || err) });
  }
}

async function proxyImage(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const imageUrl = url.searchParams.get('url');
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing image url');
    return;
  }

  try {
    const upstreamRes = await devFetch(imageUrl);
    if (!upstreamRes.ok) {
      res.writeHead(upstreamRes.status, { 'Content-Type': 'text/plain' });
      res.end(`Image fetch failed: ${upstreamRes.status}`);
      return;
    }
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    res.writeHead(200, {
      'Content-Type': upstreamRes.headers.get('content-type') || 'image/png',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Image proxy failed: ${String(err?.message || err)}`);
  }
}

function readRequestBinary(req, maxBytes = 6_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let len = 0;
    req.on('data', chunk => {
      len += chunk.length;
      if (len > maxBytes) { reject(new Error('Image too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readShareIndex() {
  try { return JSON.parse(fs.readFileSync(SHARES_INDEX, 'utf8')) || {}; }
  catch (_) { return {}; }
}
function writeShareIndex(index) {
  try { fs.writeFileSync(SHARES_INDEX, JSON.stringify(index)); } catch (_) {}
}
function removeShareImage(id) {
  try { fs.unlinkSync(path.join(SHARES_DIR, `${id}.webp`)); } catch (_) {}
}

// Delete images past the TTL, then enforce the count cap (evict oldest beyond SHARE_MAX, but never
// anything younger than SHARE_MIN_AGE_MS). The id→slot record is dropped with its image — old links
// then just redirect to the viewer home instead of the exact cube.
function sweepShares() {
  const index = readShareIndex();
  const now = Date.now();
  let changed = false;
  for (const [id, rec] of Object.entries(index)) {
    if (!rec || now - (rec.ts || 0) > SHARE_TTL_MS) { removeShareImage(id); delete index[id]; changed = true; }
  }
  const live = Object.entries(index).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0)); // newest first
  for (let i = SHARE_MAX; i < live.length; i++) {
    const [id, rec] = live[i];
    if (now - (rec.ts || 0) < SHARE_MIN_AGE_MS) continue;
    removeShareImage(id); delete index[id]; changed = true;
  }
  if (changed) writeShareIndex(index);
}

// POST /s?slot=<n> with a WebP body → { id }. Stores shares/<id>.webp + an id→slot record.
async function handleShareUpload(req, res) {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const slot = parseInt(url.searchParams.get('slot') || '', 10);
    if (!Number.isInteger(slot) || slot < 0 || slot >= 4096) { sendJson(res, 400, { error: 'bad slot' }); return; }
    const buf = await readRequestBinary(req);
    if (!buf || buf.length < 64) { sendJson(res, 400, { error: 'empty image' }); return; }
    const id = crypto.randomBytes(9).toString('base64url'); // 12 url-safe chars
    fs.writeFileSync(path.join(SHARES_DIR, `${id}.webp`), buf);
    const index = readShareIndex();
    index[id] = { slot, ts: Date.now() };
    writeShareIndex(index);
    sweepShares(); // opportunistic cleanup on every upload
    sendJson(res, 200, { id, path: `/s/${id}` });
  } catch (err) {
    sendJson(res, 400, { error: 'share upload failed', detail: String(err?.message || err) });
  }
}

function serveShareImage(res, id) {
  fs.readFile(path.join(SHARES_DIR, `${id}.webp`), (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=86400' });
    res.end(data);
  });
}

// The unfurl card page: crawlers read the twitter:image/og:image meta; humans get JS-redirected to
// the cube in the viewer (crawlers don't run JS, so they still parse the card).
function serveShareCard(req, res, id) {
  const rec = readShareIndex()[id];
  const slot = rec ? rec.slot : null;
  const slot4 = slot != null ? String(slot).padStart(4, '0') : '----';
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || 'http';
  const host = req.headers.host || `localhost:${PORT}`;
  const base = `${proto}://${host}`;
  const imgUrl = `${base}/s/${id}.webp`;
  const deep = slot != null ? `${base}/viewer/?cube=${slot}` : `${base}/viewer/`;
  const title = `THE BLOCK — Cube #${slot4}`;
  const desc = 'by @bright_lightart';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${imgUrl}">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${imgUrl}">
<meta property="og:url" content="${base}/s/${id}">
<script>location.replace(${JSON.stringify(deep)});</script>
</head><body style="background:#05060a;color:#cfe8ff;font-family:system-ui,sans-serif;padding:24px">
Redirecting to <a href="${deep}" style="color:#90d0ff">THE BLOCK</a>…
</body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

// ---------- One-click Post-to-X (OAuth 2.0 Authorization Code + PKCE) ----------
// No server-side token store: the X access/refresh tokens live ONLY in an AES-256-GCM
// encrypted httpOnly cookie ("xauth"). The PKCE code_verifier + state ride a short-lived
// encrypted cookie ("xoauth") across the redirect. Requires X_CLIENT_ID in .env; if
// X_CLIENT_SECRET is also set the token endpoint is called with Basic auth (confidential
// client), otherwise as a public client. Tokens are NEVER logged.
const X_AUTH_COOKIE   = 'xauth';
const X_LOGIN_COOKIE  = 'xoauth';
const X_KEY_FILE      = path.join(SHARES_DIR, '.x-cookie-key');
const X_AUTH_MAX_AGE  = 30 * 24 * 3600; // cookie lifetime (s) — refresh token keeps it usable
const X_TOKEN_URL     = 'https://api.x.com/2/oauth2/token';
const X_MEDIA_URL     = 'https://api.x.com/2/media/upload';
const X_SCOPES        = 'tweet.read tweet.write users.read media.write offline.access';

let _xCookieKey = null;
function getXCookieKey() {
  if (_xCookieKey) return _xCookieKey;
  const hex = process.env.X_COOKIE_KEY || '';
  if (/^[0-9a-fA-F]{64}$/.test(hex)) { _xCookieKey = Buffer.from(hex, 'hex'); return _xCookieKey; }
  // No explicit key: derive one from X_CLIENT_ID + a random salt persisted next to the
  // shares (chmod 600), so server restarts keep existing cookies decryptable.
  let salt = '';
  try { salt = fs.readFileSync(X_KEY_FILE, 'utf8').trim(); } catch (_) {}
  if (!/^[0-9a-f]{64}$/.test(salt)) {
    salt = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(X_KEY_FILE, salt + '\n', { mode: 0o600 }); } catch (_) {}
  }
  _xCookieKey = crypto.createHash('sha256').update(`${process.env.X_CLIENT_ID || ''}|${salt}`).digest();
  return _xCookieKey;
}

// value = base64url( iv(12) | gcmTag(16) | ciphertext )
function sealXCookie(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getXCookieKey(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
}
function openXCookie(value) {
  try {
    const raw = Buffer.from(String(value || ''), 'base64url');
    if (raw.length < 29) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', getXCookieKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const pt = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    return JSON.parse(pt.toString('utf8'));
  } catch (_) { return null; } // wrong key / tampered / not ours → treated as absent
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

// Public origin as the browser sees it (behind the Caddy proxy or direct).
function requestBase(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).split(',')[0].trim();
  const fwdProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = fwdProto || (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? 'http' : 'https');
  return { base: `${proto}://${host}`, secure: proto === 'https' };
}

function xCookieHeader(name, value, { maxAge, secure } = {}) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// GET /api/x/login → 302 to X's authorize page; verifier+state stashed in the xoauth cookie.
function handleXLogin(req, res) {
  loadDotEnv(ENV_PATH, { override: true });
  const clientId = process.env.X_CLIENT_ID;
  if (!clientId) { sendJson(res, 503, { ok: false, reason: 'X sharing not configured — set X_CLIENT_ID in .env' }); return; }
  const { base, secure } = requestBase(req);
  const verifier  = crypto.randomBytes(32).toString('base64url'); // 43 chars, RFC 7636 range
  const state     = crypto.randomBytes(16).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const redirectUri = `${base}/api/x/callback`;
  // Mobile same-tab flow: ?ret=<same-origin path> — after the callback the tab
  // is 302'd back there instead of the close-popup page. Path-only (no open
  // redirect): must start with a single '/'.
  const retRaw = new URL(req.url, base).searchParams.get('ret') || '';
  const ret = /^\/(?!\/)/.test(retRaw) ? retRaw.slice(0, 300) : '';
  const auth = new URL('https://x.com/i/oauth2/authorize');
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('redirect_uri', redirectUri);
  auth.searchParams.set('scope', X_SCOPES);
  auth.searchParams.set('state', state);
  auth.searchParams.set('code_challenge', challenge);
  auth.searchParams.set('code_challenge_method', 'S256');
  res.writeHead(302, {
    Location: auth.toString(),
    'Set-Cookie': xCookieHeader(X_LOGIN_COOKIE, sealXCookie({ v: verifier, s: state, r: redirectUri, ret, ts: Date.now() }), { maxAge: 600, secure }),
    'Cache-Control': 'no-store',
  });
  res.end();
}

// POST to the token endpoint. Public client → client_id in the body; confidential
// client (X_CLIENT_SECRET set) → HTTP Basic auth as well.
async function xTokenRequest(params) {
  const clientId = process.env.X_CLIENT_ID || '';
  const secret   = process.env.X_CLIENT_SECRET || '';
  const body = new URLSearchParams({ ...params, client_id: clientId });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (secret) headers.Authorization = 'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64');
  const r = await devFetch(X_TOKEN_URL, { method: 'POST', headers, body: body.toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error(`token endpoint HTTP ${r.status}: ${j.error_description || j.error || 'no access_token'}`);
  }
  return j;
}

function xClosePopupHtml(message, ok) {
  const notify = ok ? `try{window.opener&&window.opener.postMessage('x-auth-ok','*')}catch(e){}` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>THE BLOCK — X</title></head>
<body style="background:#05060a;color:#cfe8ff;font-family:system-ui,sans-serif;padding:24px">${message}
<script>${notify}window.close();</script></body></html>`;
}

// GET /api/x/callback → verify state, exchange the code, set the encrypted xauth cookie,
// notify the opener and close the popup.
async function handleXCallback(req, res) {
  loadDotEnv(ENV_PATH, { override: true });
  const { base, secure } = requestBase(req);
  const url = new URL(req.url, base);
  const login = openXCookie(parseCookies(req)[X_LOGIN_COOKIE]);
  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const fail = (msg) => {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(xClosePopupHtml(`X connection failed: ${msg} — close this window and try again.`, false));
  };
  if (url.searchParams.get('error')) { fail(url.searchParams.get('error_description') || url.searchParams.get('error')); return; }
  if (!login || !code || !state || state !== login.s) { fail('login state mismatch or expired'); return; }
  try {
    const tok = await xTokenRequest({ grant_type: 'authorization_code', code, redirect_uri: login.r, code_verifier: login.v });
    const payload = {
      at: tok.access_token,
      rt: tok.refresh_token || '',
      exp: Date.now() + (Number(tok.expires_in) || 7200) * 1000,
      un: '', // username cached lazily by /api/x/status
    };
    const setCookies = [
      xCookieHeader(X_AUTH_COOKIE, sealXCookie(payload), { maxAge: X_AUTH_MAX_AGE, secure }),
      xCookieHeader(X_LOGIN_COOKIE, '', { maxAge: 0, secure }),
    ];
    if (login.ret) {
      // Same-tab (mobile) flow: bounce straight back to the app.
      res.writeHead(302, { Location: login.ret, 'Cache-Control': 'no-store', 'Set-Cookie': setCookies });
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': setCookies,
    });
    res.end(xClosePopupHtml('Connected to X — you can close this window.', true));
  } catch (err) {
    console.warn(`[x] token exchange failed: ${String(err?.message || err)}`); // message never contains tokens
    fail('token exchange failed');
  }
}

function readXSession(req) {
  const payload = openXCookie(parseCookies(req)[X_AUTH_COOKIE]);
  return payload && payload.at ? payload : null;
}

function setXSessionCookie(res, session, secure) {
  const { _dirty, ...payload } = session;
  res.setHeader('Set-Cookie', xCookieHeader(X_AUTH_COOKIE, sealXCookie(payload), { maxAge: X_AUTH_MAX_AGE, secure }));
}

// Bearer fetch with a one-shot refresh-token retry on 401. Mutates `session` in place and
// marks it _dirty when the cookie must be re-issued.
async function xApiFetch(session, url, options = {}) {
  const call = () => devFetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${session.at}` } });
  let r = await call();
  if (r.status === 401 && session.rt) {
    try {
      const tok = await xTokenRequest({ grant_type: 'refresh_token', refresh_token: session.rt });
      session.at = tok.access_token;
      if (tok.refresh_token) session.rt = tok.refresh_token; // X rotates refresh tokens
      session.exp = Date.now() + (Number(tok.expires_in) || 7200) * 1000;
      session._dirty = true;
      r = await call();
    } catch (_) { /* refresh failed — surface the original 401 */ }
  }
  return r;
}

// GET /api/x/status → { connected, username? }. Username is cached inside the cookie
// payload so we only hit GET /2/users/me once per connection (rate limit is tight).
async function handleXStatus(req, res) {
  loadDotEnv(ENV_PATH, { override: true });
  const { secure } = requestBase(req);
  const session = readXSession(req);
  if (!session) { sendJson(res, 200, { connected: false }); return; }
  if (session.un) { sendJson(res, 200, { connected: true, username: session.un }); return; }
  try {
    const r = await xApiFetch(session, 'https://api.x.com/2/users/me');
    if (!r.ok) {
      // 401 after refresh attempt → dead session; 429 → still connected, just uncached name.
      if (r.status === 429) { sendJson(res, 200, { connected: true }); return; }
      // Surface X's actual objection — a valid token with 403s here usually means
      // the X app is not attached to a Project (v2 API requires it).
      const detail = await r.text().then(t => t.slice(0, 300)).catch(() => '');
      console.warn(`[x] /users/me failed HTTP ${r.status}: ${detail}`);
      sendJson(res, 200, { connected: false, apiError: `HTTP ${r.status}`, detail });
      return;
    }
    const j = await r.json().catch(() => ({}));
    session.un = String(j?.data?.username || '');
    session._dirty = true;
    setXSessionCookie(res, session, secure);
    sendJson(res, 200, { connected: true, username: session.un || undefined });
  } catch (_) {
    sendJson(res, 200, { connected: false });
  }
}

// Minimal multipart/form-data encoder (Node stdlib only). Buffer values become file parts.
function xMultipart(fields) {
  const boundary = '----xshare' + crypto.randomBytes(12).toString('hex');
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Buffer.isBuffer(value)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="media"\r\nContent-Type: application/octet-stream\r\n\r\n`));
      parts.push(value, Buffer.from('\r\n'));
    } else {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`));
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

// v2 media id lives at data.id; keep v1.1-shaped fallbacks in case the endpoint answers
// with the legacy shape (the chunked INIT/APPEND/FINALIZE protocol is the same).
const xMediaId = (j) => String(j?.data?.id || j?.data?.media_id_string || j?.media_id_string || j?.id || '');

async function xUploadMedia(session, buf, mediaType) {
  const post = async (fields) => {
    const { body, contentType } = xMultipart(fields);
    const r = await xApiFetch(session, X_MEDIA_URL, { method: 'POST', headers: { 'Content-Type': contentType }, body });
    const text = await r.text();
    let j = {}; try { j = JSON.parse(text); } catch (_) {}
    if (!r.ok) {
      const e = new Error(`media ${fields.command || 'upload'} failed (HTTP ${r.status})`);
      e.status = r.status;
      e.detail = j?.errors?.[0]?.message || j?.detail || j?.error || text.slice(0, 200);
      e.resetHeader = r.headers.get('x-rate-limit-reset');
      throw e;
    }
    return j;
  };
  // SIMPLE (non-chunked) upload: current v2 /2/media/upload expects the file in a
  // `media` multipart field directly — the legacy command-style INIT/APPEND/FINALIZE
  // protocol at this path gets rejected with "Missing media field in JSON". Our
  // snapshots (~200KB) are far under the 5MB image cap, so one shot is correct.
  const up = await post({ media: buf, media_category: 'tweet_image', media_type: mediaType });
  const id = xMediaId(up);
  if (!id) throw new Error('media upload returned no media id');
  return id;
}

// POST /api/x/post {shareId, text} → uploads shares/<shareId>.webp as tweet media and
// creates the tweet. Returns {ok:true, tweetUrl} or {ok:false, reason, resetAt?}.
async function handleXPost(req, res) {
  if (req.method !== 'POST') { sendJson(res, 405, { ok: false, reason: 'method not allowed' }); return; }
  loadDotEnv(ENV_PATH, { override: true });
  if (!process.env.X_CLIENT_ID) { sendJson(res, 503, { ok: false, reason: 'X sharing not configured — set X_CLIENT_ID in .env' }); return; }
  const { secure } = requestBase(req);
  const session = readXSession(req);
  if (!session) { sendJson(res, 401, { ok: false, reason: 'not connected to X' }); return; }
  try {
    let parsed = {};
    try { parsed = JSON.parse(await readRequestBody(req, 100_000) || '{}'); } catch (_) {}
    const shareId = String(parsed.shareId || '');
    if (!SHARE_ID_RE.test(shareId)) { sendJson(res, 400, { ok: false, reason: 'bad shareId' }); return; }
    const imgPath = path.join(SHARES_DIR, `${shareId}.webp`);
    if (!fs.existsSync(imgPath)) { sendJson(res, 404, { ok: false, reason: 'snapshot expired — reopen the share panel' }); return; }
    const buf = fs.readFileSync(imgPath);
    const text = String(parsed.text || '').slice(0, 280);

    const mediaId = await xUploadMedia(session, buf, 'image/webp');
    const r = await xApiFetch(session, 'https://api.x.com/2/tweets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, media: { media_ids: [mediaId] } }),
    });
    const j = await r.json().catch(() => ({}));
    if (session._dirty) setXSessionCookie(res, session, secure);
    if (r.status === 429) {
      const reset = Number(r.headers.get('x-rate-limit-reset') || r.headers.get('x-app-limit-24hour-reset') || 0);
      sendJson(res, 429, { ok: false, reason: 'X rate limit reached', resetAt: reset ? new Date(reset * 1000).toISOString() : undefined });
      return;
    }
    if (r.status === 401) { sendJson(res, 401, { ok: false, reason: 'X session expired — reconnect' }); return; }
    if (!r.ok || !j?.data?.id) {
      sendJson(res, 502, { ok: false, reason: String(j?.detail || j?.errors?.[0]?.message || j?.title || `tweet failed (HTTP ${r.status})`) });
      return;
    }
    const tweetUrl = session.un
      ? `https://x.com/${session.un}/status/${j.data.id}`
      : `https://x.com/i/web/status/${j.data.id}`;
    console.log(`[x] posted share ${shareId} → tweet ${j.data.id}`);
    sendJson(res, 200, { ok: true, tweetUrl });
  } catch (err) {
    if (session._dirty) { try { setXSessionCookie(res, session, secure); } catch (_) {} }
    const status = err?.status === 429 ? 429 : (err?.status === 401 ? 401 : 502);
    const payload = { ok: false, reason: String(err?.detail || err?.message || err) };
    if (err?.status === 429 && err.resetHeader) payload.resetAt = new Date(Number(err.resetHeader) * 1000).toISOString();
    if (status === 401) payload.reason = 'X session expired — reconnect';
    sendJson(res, status, payload);
  }
}

// Ensure shaders/ exists so fs.watch can attach to it.
const shadersDir = path.join(ROOT, 'shaders');
if (!fs.existsSync(shadersDir)) {
  fs.mkdirSync(shadersDir, { recursive: true });
  console.log(`[server] created ${path.relative(ROOT, shadersDir)}/`);
}

// ---------- SSE hot-reload ----------
const sseClients = new Set();

function broadcastShaderChange(file) {
  const payload = `data: ${JSON.stringify({ file })}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch (_) { /* client gone */ }
  }
}

// Debounce so a single save doesn't fire multiple events (common on Windows).
const WATCH_DEBOUNCE_MS = 100;
const pending = new Set();
let watchTimer = null;

fs.watch(shadersDir, { persistent: true }, (eventType, filename) => {
  if (!filename || !filename.endsWith('.glsl')) return;
  pending.add(`shaders/${filename.replace(/\\/g, '/')}`);
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    for (const f of pending) {
      console.log(`[sse] shader changed: ${f}`);
      broadcastShaderChange(f);
    }
    pending.clear();
  }, WATCH_DEBOUNCE_MS);
});

// ---------- HTTP server ----------
const server = http.createServer((req, res) => {
  if (req.url === '/dev-config') {
    loadDotEnv(ENV_PATH, { override: true });
    sendJson(res, 200, {
      openseaConfigured: true, // the proxy self-generates a free OpenSea key on demand
      defaultWallet: process.env.OPENSEA_DEFAULT_WALLET || '',
      // Public client value (safe to expose) — the SAME WalletConnect project id the
      // allowlist build uses. Reads WALLETCONNECT_ID, falling back to the allowlist's
      // WALLETCONNECT_PROJECT_ID name so either works.
      walletConnectProjectId: process.env.WALLETCONNECT_ID || process.env.WALLETCONNECT_PROJECT_ID || '',
      // One-click Post-to-X available only when the server has an X OAuth2 app configured.
      xShareEnabled: !!process.env.X_CLIENT_ID,
    });
    return;
  }

  // One-click Post-to-X: OAuth login/callback + status + direct post.
  {
    const xPath = req.url.split('?')[0];
    if (xPath === '/api/x/login')    { handleXLogin(req, res); return; }
    if (xPath === '/api/x/callback') { handleXCallback(req, res); return; }
    if (xPath === '/api/x/status')   { handleXStatus(req, res); return; }
    if (xPath === '/api/x/post')     { handleXPost(req, res); return; }
  }

  if (req.url.startsWith('/api/opensea/')) {
    proxyOpenSea(req, res);
    return;
  }

  if (req.url.startsWith('/api/normies/')) {
    proxyNormies(req, res);
    return;
  }

  if (req.url === '/api/chain-rpc') {
    proxyChainRpc(req, res);
    return;
  }

  if (req.url === '/api/attest') {
    handleAttest(req, res);
    return;
  }

  if (req.url.startsWith('/api/rec/frame')) {
    handleRecFrame(req, res);
    return;
  }

  if (req.url.startsWith('/api/rec/finish')) {
    handleRecFinish(req, res);
    return;
  }

  if (req.url.startsWith('/api/thumbnail')) {
    handleThumbnail(req, res);
    return;
  }

  if (req.url.startsWith('/api/image')) {
    proxyImage(req, res);
    return;
  }

  if (req.url === '/api/dev-mints') {
    handleDevMints(req, res);
    return;
  }

  // Share-on-X: upload a snapshot, and serve its card page / image.
  const sharePath = req.url.split('?')[0];
  if (sharePath === '/s' && req.method === 'POST') { handleShareUpload(req, res); return; }
  if (sharePath.startsWith('/s/')) {
    const m = sharePath.match(/^\/s\/([A-Za-z0-9_-]{6,40})(\.webp)?$/);
    if (m && SHARE_ID_RE.test(m[1])) {
      if (m[2]) serveShareImage(res, m[1]);
      else serveShareCard(req, res, m[1]);
      return;
    }
  }

  if (req.url === '/shader-changes') {
    res.writeHead(200, {
      'Content-Type':   'text/event-stream',
      'Cache-Control':  'no-cache',
      'Connection':     'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // Suppress the browser's automatic favicon request.
  if (req.url === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  let rel = req.url.split('?')[0];
  try { rel = decodeURIComponent(rel); } catch (_) {}
  // Site root → the hero landing page (self-contained flythrough with an Enter → /viewer/).
  if (rel === '/') rel = '/landing.html';
  // Pretty /about route → the static About page.
  else if (rel === '/about') rel = '/about.html';
  // Any URL ending with '/' → serve that directory's index.html.
  else if (rel.endsWith('/')) rel += 'index.html';

  // Dev-only chain-config override: BLOCKCASSONE_CHAIN_CONFIG=data/chain-config.mainnet.json
  // makes the server hand the browser THAT file for /data/chain-config.json, so a local
  // checkout can hydrate against mainnet without dirtying the git-tracked dev config.
  // (Production doesn't set it — the deploy script cp's the mainnet file into place.)
  if (rel === '/data/chain-config.json' && process.env.BLOCKCASSONE_CHAIN_CONFIG) {
    rel = '/' + String(process.env.BLOCKCASSONE_CHAIN_CONFIG).replace(/^\/+/, '');
  }

  // Pick root: repo root for /viewer/, /core/, /public/, /schema/, /renderer/; renderer/ for everything else.
  const useRepoRoot = REPO_PREFIXES.some(p => rel.startsWith(p));
  const baseRoot    = useRepoRoot ? REPO_ROOT : ROOT;
  const filePath    = path.normalize(path.join(baseRoot, rel));

  // Directory-traversal guard — must stay under the chosen root.
  if (!filePath.startsWith(baseRoot)) {
    console.warn(`[server] 403 ${rel}`);
    res.writeHead(403); res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.warn(`[server] 404 ${rel}${err.code !== 'ENOENT' ? ` (${err.code})` : ''}`);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    // World snapshot: briefly cacheable (60s) so the landing page's prefetch is
    // honored and the viewer opens with the data already local. The indexer
    // refreshes every 2 min, so staleness is bounded and harmless.
    const cacheControl = rel === '/data/world-snapshot.json' ? 'public, max-age=60' : 'no-store';
    res.writeHead(200, {
      'Content-Type':   MIME[ext] || 'application/octet-stream',
      'Cache-Control':  cacheControl,
      // Permissive dev-only CSP so embedded browsers (VSCode Simple Browser,
      // etc.) don't over-restrict module/worker execution. Never ship this.
      'Content-Security-Policy':
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: http: https:; " +
        // wss: for the WalletConnect relay (relay.walletconnect.com) + explorer over https:.
        "connect-src 'self' http: https: wss:; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:;",
    });
    res.end(data);
  });
});

// Sweep share snapshots on a timer (in addition to the opportunistic sweep on each upload).
sweepShares();
setInterval(sweepShares, 15 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`[server] blockcassone dev → http://localhost:${PORT}`);
  console.log(`[server] watching ${path.relative(ROOT, shadersDir)}/ for *.glsl changes`);
  console.log(`[server] share snapshots → ${path.relative(REPO_ROOT, SHARES_DIR)}/ (TTL ${SHARE_TTL_MS / 3600000}h, cap ${SHARE_MAX})`);
});
