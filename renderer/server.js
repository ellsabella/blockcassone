// Dev server — Node stdlib only.
// Serves the renderer/ directory and pushes shader hot-reload events via SSE.

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT      = __dirname;                        // renderer/
const REPO_ROOT = path.resolve(__dirname, '..');    // blockcassone/
const PORT      = parseInt(process.env.PORT || '3000', 10);

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
const REPO_PREFIXES = ['/viewer/', '/core/', '/public/', '/schema/', '/renderer/', '/data/'];

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

  if (req.url.startsWith('/api/image')) {
    proxyImage(req, res);
    return;
  }

  if (req.url === '/api/dev-mints') {
    handleDevMints(req, res);
    return;
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
  // Any URL ending with '/' → serve that directory's index.html.
  if (rel.endsWith('/')) rel += 'index.html';

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

server.listen(PORT, () => {
  console.log(`[server] blockcassone dev → http://localhost:${PORT}`);
  console.log(`[server] watching ${path.relative(ROOT, shadersDir)}/ for *.glsl changes`);
});
