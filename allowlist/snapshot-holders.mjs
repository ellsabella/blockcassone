#!/usr/bin/env node
// Holder snapshot for the gated mint stages: pulls ALL current holders of one or
// more collections (or the top N by balance) and writes wallet lists that feed
// straight into merkle.mjs (`--fcfs-config` group `wallets` files).
//
// Data source is the Alchemy NFT API (`getOwnersForContract`, the same key the
// allowlist stack already uses) — NOT the OpenSea UI: scraping opensea.io is
// against their ToS, breaks on every frontend change, and returns the same
// ownership data this endpoint serves in a few paginated calls. Ownership is
// read from chain state, so "snapshot day before mint" == run this that day.
//
//   ALCHEMY_KEY=<key> node snapshot-holders.mjs --contract 0xabc…              # all holders
//   node snapshot-holders.mjs --contract 0xabc…,0xdef…    # several collections, merged + deduped
//   node snapshot-holders.mjs --contract 0xabc… --top 500 # top 500 by combined balance
//   node snapshot-holders.mjs --contract 0xabc… --min 2   # only holders with >= 2 tokens
//   … [--out-prefix snapshot] [--exclude exclude.json]    # exclude: burn/staking/team addrs
//
// Outputs: <prefix>-wallets.json (merkle.mjs-ready address array),
//          <prefix>-holders.csv (wallet,balance per collection + total, sorted desc).
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

const KEY = process.env.ALCHEMY_KEY
  || (/(?:alchemy\.com\/v2\/)([^/\s?]+)/.exec(process.env.ETH_RPC_URL || '') || [])[1];
const norm = a => { const s = String(a).toLowerCase(); if (!/^0x[0-9a-f]{40}$/.test(s)) throw new Error(`bad address: ${a}`); return s; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ownersOf(contract) {
  // Paginate getOwnersForContract with balances; returns Map(wallet -> tokenCount).
  const owners = new Map();
  let pageKey;
  do {
    const url = new URL(`https://eth-mainnet.g.alchemy.com/nft/v3/${KEY}/getOwnersForContract`);
    url.searchParams.set('contractAddress', contract);
    url.searchParams.set('withTokenBalances', 'true');
    if (pageKey) url.searchParams.set('pageKey', pageKey);
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (r.status === 429) { await sleep(1500); continue; } // backoff, retry same page
    if (!r.ok) throw new Error(`${contract}: HTTP ${r.status} ${await r.text()}`);
    const body = await r.json();
    for (const o of body.owners || []) {
      const w = norm(o.ownerAddress);
      // v3 balances are per-token entries; sum them (ERC-1155-safe).
      const bal = (o.tokenBalances || []).reduce((a, t) => a + Number(t.balance || 1), 0);
      owners.set(w, (owners.get(w) || 0) + bal);
    }
    pageKey = body.pageKey;
  } while (pageKey);
  return owners;
}

async function main() {
  if (!KEY) { console.error('Set ALCHEMY_KEY (or an Alchemy ETH_RPC_URL).'); process.exit(1); }
  const contracts = (flag('contract') || '').split(',').map(s => s.trim()).filter(Boolean).map(norm);
  if (!contracts.length) { console.error('Missing --contract 0x… (comma-separate several).'); process.exit(1); }

  const exclude = new Set(
    (flag('exclude') ? JSON.parse(fs.readFileSync(flag('exclude'), 'utf8')) : []).map(norm)
  );
  exclude.add('0x0000000000000000000000000000000000000000');
  exclude.add('0x000000000000000000000000000000000000dead');

  const perContract = new Map(); // contract -> Map(wallet -> balance)
  for (const c of contracts) {
    const owners = await ownersOf(c);
    perContract.set(c, owners);
    console.log(`${c}: ${owners.size} holders`);
  }

  // Merge: total balance across all listed collections per wallet.
  const totals = new Map();
  for (const owners of perContract.values()) {
    for (const [w, bal] of owners) {
      if (exclude.has(w)) continue;
      totals.set(w, (totals.get(w) || 0) + bal);
    }
  }

  let rows = [...totals.entries()].map(([wallet, total]) => ({ wallet, total }));
  const min = Number(flag('min') || 1);
  rows = rows.filter(r => r.total >= min);
  rows.sort((a, b) => b.total - a.total || (a.wallet < b.wallet ? -1 : 1)); // stable: balance desc, addr asc
  if (flag('top')) rows = rows.slice(0, Number(flag('top')));

  const prefix = flag('out-prefix') || 'snapshot';
  fs.writeFileSync(`${prefix}-wallets.json`, JSON.stringify(rows.map(r => r.wallet), null, 2));
  const header = ['wallet', ...contracts, 'total'].join(',');
  const csv = rows.map(r =>
    [r.wallet, ...contracts.map(c => perContract.get(c).get(r.wallet) || 0), r.total].join(',')
  );
  fs.writeFileSync(`${prefix}-holders.csv`, header + '\n' + csv.join('\n') + '\n');

  console.log(`${rows.length} wallets after min>=${min}${flag('top') ? `, top ${flag('top')}` : ''} (excluded ${exclude.size} addrs incl. burn).`);
  console.log(`wrote ${prefix}-wallets.json (feed to merkle.mjs group "wallets"), ${prefix}-holders.csv`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
