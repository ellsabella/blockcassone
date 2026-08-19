// Shared allowlist API — used by the Vite dev/preview proxy (vite.config.js) AND the
// standalone production server (server.mjs). Framework-agnostic: createApiHandler(env)
// returns async (req,res) => handled:boolean. Secrets (Alchemy key, RPC, admin token)
// come from `env` and never reach the browser.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoverTypedDataAddress } from 'viem';
import { CONFIG, entitlementFor } from './src/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const MAX_BODY = 16 * 1024;           // 16 KB — a signed request is tiny
const RL_WINDOW_MS = 60_000;          // per-IP rate-limit window (all limiters)
const SUBMIT_MAX_PER_WINDOW = 8;      // signed submits / IP / min
const ALCHEMY_MAX_PER_WINDOW = 60;    // holdings reads / IP / min (a full scan is a few calls)
const RPC_MAX_PER_WINDOW = 200;       // wagmi/rainbowkit chatter + one delegate read / IP / min
const RPC_BATCH_MAX = 20;             // reject oversized JSON-RPC batches

// The proxies are otherwise open to our Alchemy key + RPC, so lock them down: Alchemy is limited
// to the one endpoint the app needs, and the RPC proxy to read-only methods (no getLogs / filters /
// writes / trace / debug — the expensive + abusable ones).
const ALCHEMY_ALLOWED_PATH = '/getNFTsForOwner';
const ALLOWED_RPC_METHODS = new Set([
  'eth_chainId', 'eth_call', 'eth_getBalance', 'eth_blockNumber', 'eth_getBlockByNumber',
  'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_estimateGas',
  'eth_getCode', 'eth_getStorageAt', 'eth_getTransactionCount', 'net_version', 'web3_clientVersion',
]);

const NFT_CACHE_TTL = 60_000;         // collapse repeat holdings scans of the same wallet
const NFT_CACHE_MAX = 2000;

const json = (res, code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };

function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket?.remoteAddress || 'unknown';
}

// Fixed-window per-IP limiter. Each limiter keeps its own bucket map.
function makeLimiter(maxPerWindow, windowMs = RL_WINDOW_MS) {
  const buckets = new Map(); // ip -> { count, resetAt }
  return (ip) => {
    const now = Date.now();
    const e = buckets.get(ip);
    if (!e || now > e.resetAt) { buckets.set(ip, { count: 1, resetAt: now + windowMs }); return false; }
    e.count += 1;
    return e.count > maxPerWindow;
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '', size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); } else b += c; });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

export function createApiHandler(env) {
  const rpc = env.ETH_RPC_URL || '';
  const alchemyKey = env.ALCHEMY_KEY || (/(?:alchemy\.com\/v2\/)([^/\s?]+)/.exec(rpc) || [])[1] || '';
  const adminToken = env.ALLOWLIST_ADMIN_TOKEN || '';
  const FILE = env.SUBMISSIONS_FILE
    ? path.resolve(env.SUBMISSIONS_FILE)
    : path.join(REPO_ROOT, 'allowlist-submissions.jsonl');

  // Cloudflare Turnstile — OFF until TURNSTILE_SECRET is set, so the site behaves exactly as today
  // until you configure keys. When set, /api/allowlist-submit requires a valid token (stops bot
  // registrations + interest spam). The read proxies are additionally gated only if
  // TURNSTILE_GATE_PROXIES is truthy (they're already IP-rate-limited + Cloudflare-fronted).
  const turnstileSecret = env.TURNSTILE_SECRET || '';
  const gateProxies = /^(1|true|yes|on)$/i.test(env.TURNSTILE_GATE_PROXIES || '');

  // Hard kill-switch: set REGISTRATION_CLOSED=1 to seal the allowlist. /api/allowlist-submit then
  // rejects every POST (bots included) regardless of signature/captcha; reads (status/admin) stay up.
  const registrationClosed = /^(1|true|yes|on)$/i.test(env.REGISTRATION_CLOSED || '');

  // FCFS / GTD checker lists — plain address-per-line files, read SERVER-SIDE ONLY (never sent to
  // the client). Live-editable: changes are picked up on the next request (mtime-cached). Point
  // these at a writable dir (e.g. /var/lib/blockcassone) so /api/allowlist-add can append to them.
  const gtdListFile = env.GTD_LIST_FILE ? path.resolve(env.GTD_LIST_FILE) : path.join(REPO_ROOT, 'gtd.txt');
  const fcfsListFile = env.FCFS_LIST_FILE ? path.resolve(env.FCFS_LIST_FILE) : path.join(REPO_ROOT, 'fcfs.txt');
  let _tierCache = null;
  const _fileAddrs = fp => { try { return fs.readFileSync(fp, 'utf8').split('\n').map(l => l.trim().toLowerCase()).filter(l => /^0x[0-9a-f]{40}$/.test(l)); } catch { return []; } };
  const _mtime = fp => { try { return fs.statSync(fp).mtimeMs; } catch { return 0; } };
  function tierIndex() {
    const key = `${_mtime(gtdListFile)}:${_mtime(fcfsListFile)}`;
    if (_tierCache && _tierCache.key === key) return _tierCache;
    const gtd = new Set(_fileAddrs(gtdListFile));
    const fcfs = new Set(_fileAddrs(fcfsListFile));
    for (const w of gtd) fcfs.delete(w); // GTD outranks FCFS
    _tierCache = { key, gtd, fcfs };
    return _tierCache;
  }

  const submitLimited = makeLimiter(SUBMIT_MAX_PER_WINDOW);
  const alchemyLimited = makeLimiter(ALCHEMY_MAX_PER_WINDOW);
  const rpcLimited = makeLimiter(RPC_MAX_PER_WINDOW);
  const nftCache = new Map(); // rest-path -> { at, status, body }

  function readAll() {
    try {
      return fs.readFileSync(FILE, 'utf8').split('\n').filter(l => l.trim())
        .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  }
  const isRegistered = w => { const lw = w.toLowerCase(); return readAll().some(r => String(r.wallet || '').toLowerCase() === lw); };

  const isAdmin = req => {
    const auth = String(req.headers.authorization || '');
    const tok = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    return adminToken && tok && tok.length === adminToken.length && tok === adminToken;
  };

  // Reconstruct the exact signed message and recover the signer.
  async function verifySignature(p) {
    const message = {
      wallet: p.wallet,
      vaults: Array.isArray(p.vaults) ? p.vaults : [],
      sources: (p.sources || []).map(s => ({ collectionId: Number(s.collectionId), tokenId: BigInt(s.tokenId), contractAddr: s.contractAddr })),
      issuedAt: BigInt(p.issuedAt),
      nonce: p.nonce,
    };
    const signer = await recoverTypedDataAddress({
      domain: CONFIG.eip712Domain, types: CONFIG.eip712Types, primaryType: 'Attestation', message, signature: p.signature,
    });
    return signer.toLowerCase() === String(p.wallet).toLowerCase();
  }

  // Verify the lighter "register interest" attestation.
  async function verifyInterest(p) {
    const message = { wallet: p.wallet, handle: String(p.handle || ''), issuedAt: BigInt(p.issuedAt), nonce: p.nonce };
    const signer = await recoverTypedDataAddress({
      domain: CONFIG.eip712Domain, types: CONFIG.eip712InterestTypes, primaryType: 'Interest', message, signature: p.signature,
    });
    return signer.toLowerCase() === String(p.wallet).toLowerCase();
  }

  // Verify a Cloudflare Turnstile token against siteverify. Passes (no-op) when the secret is
  // unset. Tokens are single-use, so the client fetches a fresh one per protected request.
  async function verifyTurnstile(token, ip) {
    if (!turnstileSecret) return true;
    if (typeof token !== 'string' || !token) return false;
    try {
      const form = new URLSearchParams({ secret: turnstileSecret, response: token });
      if (ip) form.set('remoteip', ip);
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form,
      });
      const j = await r.json().catch(() => ({}));
      return j.success === true;
    } catch { return false; }
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (!p.startsWith('/api/')) return false;

    // ---- key-injecting proxies (never expose the key; rate-limited + endpoint-locked) ----
    if (p === '/api/alchemy-nft' || p.startsWith('/api/alchemy-nft/')) {
      if (!alchemyKey) return json(res, 500, { error: 'Missing ALCHEMY_KEY / Alchemy ETH_RPC_URL' }), true;
      if (alchemyLimited(clientIp(req))) return json(res, 429, { error: 'rate limited' }), true;
      if (gateProxies && !(await verifyTurnstile(req.headers['cf-turnstile-token'], clientIp(req)))) return json(res, 403, { error: 'captcha failed' }), true;
      const rest = req.url.slice('/api/alchemy-nft'.length);
      if (rest.split('?')[0] !== ALCHEMY_ALLOWED_PATH) return json(res, 403, { error: 'endpoint not allowed' }), true;
      const now = Date.now();
      const hit = nftCache.get(rest);
      if (hit && now - hit.at < NFT_CACHE_TTL) {
        res.statusCode = hit.status; res.setHeader('content-type', 'application/json'); res.end(hit.body); return true;
      }
      try {
        const r = await fetch(`https://eth-mainnet.g.alchemy.com/nft/v3/${alchemyKey}${rest}`, { headers: { accept: 'application/json' } });
        const body = await r.text();
        if (r.status === 200) {
          if (nftCache.size >= NFT_CACHE_MAX) nftCache.clear();
          nftCache.set(rest, { at: now, status: r.status, body });
        }
        res.statusCode = r.status; res.setHeader('content-type', 'application/json'); res.end(body);
      } catch (e) { json(res, 502, { error: 'Alchemy proxy failed', detail: String(e) }); }
      return true;
    }
    if (p === '/api/mainnet-rpc') {
      if (!rpc) return json(res, 500, { error: 'Missing ETH_RPC_URL' }), true;
      if (rpcLimited(clientIp(req))) return json(res, 429, { error: 'rate limited' }), true;
      if (gateProxies && !(await verifyTurnstile(req.headers['cf-turnstile-token'], clientIp(req)))) return json(res, 403, { error: 'captcha failed' }), true;
      let body;
      try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad body' }), true; }
      let parsed;
      try { parsed = JSON.parse(body); } catch { return json(res, 400, { error: 'bad json' }), true; }
      const calls = Array.isArray(parsed) ? parsed : [parsed];
      if (calls.length > RPC_BATCH_MAX) return json(res, 413, { error: 'batch too large' }), true;
      for (const c of calls) {
        if (!c || !ALLOWED_RPC_METHODS.has(c.method)) return json(res, 403, { error: `method not allowed: ${c?.method}` }), true;
      }
      try {
        const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
        res.statusCode = r.status; res.setHeader('content-type', 'application/json'); res.end(await r.text());
      } catch (e) { json(res, 502, { error: 'RPC proxy failed', detail: String(e) }); }
      return true;
    }

    // ---- allowlist status (public) ----
    if (p === '/api/allowlist-status') {
      const w = url.searchParams.get('wallet') || '';
      return json(res, 200, { registered: /^0x[0-9a-fA-F]{40}$/.test(w) ? isRegistered(w) : false }), true;
    }

    // ---- allowlist tier check (public) — returns only a tier; the list stays server-side ----
    if (p === '/api/allowlist-check') {
      const w = String(url.searchParams.get('wallet') || '').trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(w)) return json(res, 400, { error: 'invalid address' }), true;
      const lw = w.toLowerCase();
      const idx = tierIndex();
      const tier = idx.gtd.has(lw) ? 'gtd' : idx.fcfs.has(lw) ? 'fcfs' : null;
      return json(res, 200, { address: lw, tier }), true;
    }

    // ---- speedy list update (admin) — append a wallet to gtd.txt / fcfs.txt, no redeploy ----
    if (p === '/api/allowlist-add') {
      if (!isAdmin(req)) return json(res, 403, { error: 'forbidden' }), true;
      const w = String(url.searchParams.get('wallet') || '').trim().toLowerCase();
      const tier = String(url.searchParams.get('tier') || '').toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(w)) return json(res, 400, { error: 'invalid address' }), true;
      if (tier !== 'gtd' && tier !== 'fcfs') return json(res, 400, { error: 'tier must be gtd or fcfs' }), true;
      const idx = tierIndex();
      if (idx.gtd.has(w)) return json(res, 200, { ok: true, already: 'gtd', wallet: w }), true;
      if (tier === 'fcfs' && idx.fcfs.has(w)) return json(res, 200, { ok: true, already: 'fcfs', wallet: w }), true;
      try { fs.appendFileSync(tier === 'gtd' ? gtdListFile : fcfsListFile, w + '\n'); }
      catch (e) { return json(res, 500, { error: 'write failed', detail: String(e) }), true; }
      _tierCache = null; // force re-read on next check
      return json(res, 200, { ok: true, added: w, tier }), true;
    }

    // ---- allowlist submit (public, signed) — GTD art request OR register-interest ----
    if (p === '/api/allowlist-submit') {
      if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true;
      if (registrationClosed) return json(res, 403, { error: 'registration closed', closed: true }), true;
      if (submitLimited(clientIp(req))) return json(res, 429, { error: 'rate limited' }), true;
      let payload;
      try { payload = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'bad body' }), true; }
      if (!(await verifyTurnstile(payload.turnstileToken, clientIp(req)))) return json(res, 403, { error: 'captcha failed' }), true;
      const wallet = String(payload.wallet || '');
      if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json(res, 400, { error: 'bad wallet' }), true;
      if (typeof payload.signature !== 'string' || !payload.signature.startsWith('0x'))
        return json(res, 400, { error: 'missing signature' }), true;
      const kind = payload.kind === 'interest' ? 'interest' : 'gtd';

      let ok = false;
      if (kind === 'interest') {
        if (typeof payload.handle === 'string' && payload.handle.length > CONFIG.interestHandleMax)
          return json(res, 400, { error: 'handle too long' }), true;
        try { ok = await verifyInterest(payload); } catch { ok = false; }
      } else {
        if (!Array.isArray(payload.sources) || payload.sources.length < 1 || payload.sources.length > CONFIG.gtdCapPerWallet)
          return json(res, 400, { error: 'bad sources' }), true;
        try { ok = await verifySignature(payload); } catch { ok = false; }
      }
      if (!ok) return json(res, 401, { error: 'signature does not match wallet' }), true;
      if (isRegistered(wallet)) return json(res, 409, { alreadyRegistered: true }), true;

      const record = { ...payload, kind, wallet: wallet.toLowerCase(), receivedAt: new Date().toISOString(), ip: clientIp(req) };
      try { fs.appendFileSync(FILE, JSON.stringify(record) + '\n', { mode: 0o600 }); }
      catch (e) { return json(res, 500, { error: 'persist failed', detail: String(e) }), true; }
      return json(res, 200, { ok: true }), true;
    }

    // ---- admin (Bearer token) ----
    if (p === '/api/allowlist-count' || p === '/api/allowlist-stats' || p === '/api/allowlist-export') {
      if (!isAdmin(req)) return json(res, 403, { error: 'forbidden' }), true;
      const rows = readAll();
      if (p === '/api/allowlist-count') return json(res, 200, { count: rows.length }), true;
      if (p === '/api/allowlist-export') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.setHeader('content-disposition', 'attachment; filename="allowlist-submissions.json"');
        res.end(JSON.stringify(rows, null, 2));
        return true;
      }
      // stats
      const byCollection = {};
      const byKind = { gtd: 0, interest: 0 };
      let totalSpots = 0;
      let interestHolders = 0; // interest registrants that DO hold a qualifying asset (FCFS-eligible)
      for (const r of rows) {
        const kind = r.kind === 'interest' ? 'interest' : 'gtd';
        byKind[kind] += 1;
        if (kind === 'interest') {
          const held = Number(r.heldSummary?.normies || 0) + Number(r.heldSummary?.other || 0);
          if (held > 0) interestHolders += 1;
          continue;
        }
        totalSpots += Number(r.entitlement?.spots || (r.sources || []).length) || 0;
        for (const s of r.sources || []) {
          const name = CONFIG.collections[s.collectionId]?.name || `#${s.collectionId}`;
          byCollection[name] = (byCollection[name] || 0) + 1;
        }
      }
      return json(res, 200, {
        registrations: rows.length,
        byKind,
        interestFcfsEligible: interestHolders,
        totalSpotsRequested: totalSpots,
        artworksRequested: rows.reduce((a, r) => a + (r.sources || []).length, 0),
        byCollection,
        first: rows[0]?.receivedAt || null,
        last: rows[rows.length - 1]?.receivedAt || null,
      }), true;
    }

    return json(res, 404, { error: 'not found' }), true;
  };
}

// Direct file access for the admin CLI running ON the host.
export function localStore(env) {
  const FILE = env?.SUBMISSIONS_FILE ? path.resolve(env.SUBMISSIONS_FILE) : path.join(REPO_ROOT, 'allowlist-submissions.jsonl');
  const rows = () => {
    try { return fs.readFileSync(FILE, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)); }
    catch { return []; }
  };
  return { FILE, rows, entitlementFor };
}
