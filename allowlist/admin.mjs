#!/usr/bin/env node
// Allowlist admin tools. Runs against the local dataset file (on the VPS) or a remote
// deployment over HTTPS with the admin token.
//
//   node admin.mjs count                 # how many registrations
//   node admin.mjs stats                 # breakdown by collection + spots
//   node admin.mjs list [n]              # last n registrations (default 20)
//   node admin.mjs export [out.json]     # write the full dataset as pretty JSON
//   node admin.mjs verify                # re-check every signature (integrity)
//
// Remote (any machine):  set ALLOWLIST_URL + ALLOWLIST_ADMIN_TOKEN (or --url / --token)
//   ALLOWLIST_URL=https://al.example ALLOWLIST_ADMIN_TOKEN=xxxxx node admin.mjs count
// Local (on the host):   no URL → reads SUBMISSIONS_FILE (or ../allowlist-submissions.jsonl)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localStore } from './api.mjs';
import { CONFIG } from './src/config.js';
import { recoverTypedDataAddress } from 'viem';

// Load the repo-root .env (mirrors server.mjs) so `node admin.mjs …` on the box resolves
// SUBMISSIONS_FILE / ALLOWLIST_ADMIN_TOKEN without an inline prefix. Real env wins.
const HERE = path.dirname(fileURLToPath(import.meta.url));
try {
  const txt = fs.readFileSync(path.resolve(HERE, '..', '.env'), 'utf8');
  for (const line of txt.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* rely on process env */ }

const args = process.argv.slice(2);
const cmd = args[0] || 'count';
const flag = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.slice(1).filter(a => !a.startsWith('--'));

const URL_ = flag('url') || process.env.ALLOWLIST_URL || '';
const TOKEN = flag('token') || process.env.ALLOWLIST_ADMIN_TOKEN || '';

async function remote(pathname) {
  const res = await fetch(`${URL_.replace(/\/$/, '')}${pathname}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  if (res.status === 403) { console.error('403 forbidden — wrong/missing ALLOWLIST_ADMIN_TOKEN'); process.exit(1); }
  if (!res.ok) { console.error(`${res.status} ${await res.text()}`); process.exit(1); }
  return res;
}

async function rows() {
  if (URL_) return (await (await remote('/api/allowlist-export')).json());
  return localStore(process.env).rows();
}

async function main() {
  if (cmd === 'count') {
    if (URL_) { console.log((await (await remote('/api/allowlist-count')).json()).count); return; }
    console.log(localStore(process.env).rows().length);
    return;
  }

  if (cmd === 'stats') {
    if (URL_) { console.log(JSON.stringify(await (await remote('/api/allowlist-stats')).json(), null, 2)); return; }
    const rs = localStore(process.env).rows();
    const byCollection = {}; const byKind = { gtd: 0, interest: 0 };
    let spots = 0, artworks = 0, interestFcfsEligible = 0;
    for (const r of rs) {
      const kind = r.kind === 'interest' ? 'interest' : 'gtd';
      byKind[kind] += 1;
      if (kind === 'interest') {
        if (Number(r.heldSummary?.normies || 0) + Number(r.heldSummary?.other || 0) > 0) interestFcfsEligible += 1;
        continue;
      }
      spots += Number(r.entitlement?.spots || (r.sources || []).length) || 0;
      artworks += (r.sources || []).length;
      for (const s of r.sources || []) {
        const name = CONFIG.collections[s.collectionId]?.name || `#${s.collectionId}`;
        byCollection[name] = (byCollection[name] || 0) + 1;
      }
    }
    console.log(JSON.stringify({
      registrations: rs.length, byKind, interestFcfsEligible,
      totalSpotsRequested: spots, artworksRequested: artworks, byCollection,
      first: rs[0]?.receivedAt || null, last: rs[rs.length - 1]?.receivedAt || null,
    }, null, 2));
    return;
  }

  if (cmd === 'list') {
    const n = Number(positional[0] || 20);
    const rs = await rows();
    for (const r of rs.slice(-n)) {
      const arts = (r.sources || []).map(s => `${CONFIG.collections[s.collectionId]?.name || s.collectionId}#${s.tokenId}`).join(', ');
      console.log(`${r.receivedAt || '?'}  ${r.wallet}  spots:${r.entitlement?.spots ?? '?'}  [${arts}]`);
    }
    return;
  }

  if (cmd === 'export') {
    const out = positional[0] || 'allowlist-submissions.json';
    const rs = await rows();
    fs.writeFileSync(out, JSON.stringify(rs, null, 2));
    console.log(`wrote ${rs.length} registrations → ${out}`);
    return;
  }

  if (cmd === 'verify') {
    const rs = await rows();
    let ok = 0, bad = 0;
    for (const r of rs) {
      try {
        const signer = await recoverTypedDataAddress({
          domain: CONFIG.eip712Domain, types: CONFIG.eip712Types, primaryType: 'Attestation',
          message: {
            wallet: r.wallet, vaults: r.vaults || [],
            sources: (r.sources || []).map(s => ({ collectionId: Number(s.collectionId), tokenId: BigInt(s.tokenId), contractAddr: s.contractAddr })),
            issuedAt: BigInt(r.issuedAt), nonce: r.nonce,
          },
          signature: r.signature,
        });
        if (signer.toLowerCase() === String(r.wallet).toLowerCase()) ok++;
        else { bad++; console.log(`BAD SIG  ${r.wallet}  (signer ${signer})`); }
      } catch (e) { bad++; console.log(`UNVERIFIABLE  ${r.wallet}  ${e.message}`); }
    }
    console.log(`\n${ok} valid · ${bad} invalid of ${rs.length}`);
    return;
  }

  console.error(`unknown command: ${cmd}\nsee the header of admin.mjs for usage`);
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
