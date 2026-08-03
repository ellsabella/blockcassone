// Dev server — Node stdlib only.
// Serves the renderer/ directory and pushes shader hot-reload events via SSE.

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

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
const REPO_PREFIXES = ['/viewer/', '/core/', '/public/', '/schema/', '/renderer/', '/data/', '/dist/'];

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
    const configPath = path.join(REPO_ROOT, 'data', 'chain-config.json');
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return {
      rpcUrl: String(envRpc || parsed.rpcUrl || 'http://127.0.0.1:8545'),
    };
  } catch (_) {
    return { rpcUrl: String(envRpc || 'http://127.0.0.1:8545') };
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

async function proxyOpenSea(req, res) {
  loadDotEnv(ENV_PATH, { override: true });
  const apiKey = process.env.OPENSEA_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, { error: 'Missing OPENSEA_API_KEY in .env' });
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const upstreamPath = url.pathname.replace(/^\/api\/opensea\/?/, '');
  const upstream = new URL(`https://api.opensea.io/api/v2/${upstreamPath}`);
  upstream.search = url.search;

  try {
    const upstreamRes = await devFetch(upstream, {
      headers: {
        'accept': 'application/json',
        'x-api-key': apiKey,
      },
    });
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
    const upstreamRes = await devFetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const text = await upstreamRes.text();
    res.writeHead(upstreamRes.status, {
      'Content-Type': upstreamRes.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(text);
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
// SECURITY: this signs whatever attestation the client sends — i.e. a signing oracle,
// acceptable for the Sepolia E2E stub (a throwaway signer key). For a real launch, the
// service should independently verify the flattening and own the nonce/deadline before
// signing, rather than trusting the client's payloadHash.
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

async function handleAttest(req, res) {
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
  loadDotEnv(ENV_PATH, { override: true });
  try {
    const { typedData } = JSON.parse(await readRequestBody(req, 4_000_000));
    if (!typedData || !typedData.domain || !typedData.message || !typedData.primaryType) {
      sendJson(res, 400, { error: 'Missing typedData {domain, types, primaryType, message}' });
      return;
    }
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
      openseaConfigured: Boolean(process.env.OPENSEA_API_KEY),
      defaultWallet: process.env.OPENSEA_DEFAULT_WALLET || '',
    });
    return;
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
    res.writeHead(200, {
      'Content-Type':   MIME[ext] || 'application/octet-stream',
      'Cache-Control':  'no-store',
      // Permissive dev-only CSP so embedded browsers (VSCode Simple Browser,
      // etc.) don't over-restrict module/worker execution. Never ship this.
      'Content-Security-Policy':
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: http: https:; " +
        "connect-src 'self' http: https:; " +
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
