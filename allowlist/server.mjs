// Standalone production server for the allowlist site. Serves the built dist/ and the
// shared API (api.mjs). Run behind a TLS reverse proxy (Caddy/nginx) — see DEPLOY.md.
//   PORT=8787 node server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler } from './api.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, 'dist');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1'; // bind localhost; the proxy terminates TLS

// Load repo-root .env into process.env (without overriding real env / systemd EnvironmentFile).
function loadEnvFile() {
  try {
    const txt = fs.readFileSync(path.resolve(HERE, '..', '.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch { /* rely on process env */ }
}
loadEnvFile();

const api = createApiHandler(process.env);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.map': 'application/json',
};

function securityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'SAMEORIGIN');       // the app iframes cube-bg.html same-origin
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('permissions-policy', 'geolocation=(), microphone=(), camera=()');
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = path.join(DIST, rel);
  // Path-traversal guard: resolved path must stay inside DIST.
  if (!abs.startsWith(DIST + path.sep) && abs !== DIST) { res.statusCode = 403; res.end('forbidden'); return; }
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback → index.html
      const idx = path.join(DIST, 'index.html');
      res.statusCode = 200; res.setHeader('content-type', MIME['.html']);
      fs.createReadStream(idx).pipe(res);
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', MIME[path.extname(abs)] || 'application/octet-stream');
    if (/\/assets\//.test(rel)) res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    fs.createReadStream(abs).pipe(res);
  });
}

http.createServer(async (req, res) => {
  securityHeaders(res);
  try {
    if (await api(req, res)) return;   // handled an /api/* route
  } catch (e) {
    res.statusCode = 500; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: 'server error' }));
    console.error('[server] api error', e);
    return;
  }
  serveStatic(req, res);
}).listen(PORT, HOST, () => {
  console.log(`[allowlist] serving ${DIST} on http://${HOST}:${PORT}`);
});
