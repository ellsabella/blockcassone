# TheBLOCK main site — production deployment

Mirrors the proven allowlist VPS pattern (allowlist/DEPLOY.md): Caddy TLS → node on
localhost, secrets server-side only, Cloudflare in front. The strategy for "go live
immediately after mint close" is **prestage everything now** — the site runs in
production against mainnet from today, gated; launch is removing the gate.

```
Browser ──HTTPS──▶ Cloudflare ──▶ Caddy (:443) ──▶ node renderer/server.js (:3000, 127.0.0.1)
                                                      ├─ serves viewer/ + public/ (the site)
                                                      ├─ /api/chain-rpc   (mainnet RPC, key injected server-side)
                                                      ├─ /s /s/<id>       (share-on-X cards, ephemeral)
                                                      └─ /api/attest      (OFF at launch — customize phase only)
                              └────────────────────▶ indexer snapshot (static JSON, refreshed by timer)
```

## 0. What to verify locally BEFORE deploying (the "final pass")
- `data/chain-config.json` on the SERVER must be the MAINNET config —
  `data/chain-config.mainnet.json` is prepared with all V2 addresses
  (`directRpc:false`, `rpcUrl:""` so the browser only ever sees /api/chain-rpc;
  mock SeaDrop zeroed — mint UX is the OpenSea drop page, the sim controls are out).
- Known open UI item: Big Cube performance on 200+ NFT wallets (needs
  virtualisation). Decide: fix now or accept for launch.
- The renderer server reads config + env AT STARTUP — every config change needs a
  service restart.

## 1. Provision (same as allowlist: Ubuntu 22.04+, 1–2 GB)
```bash
adduser --disabled-password theblock && usermod -aG sudo theblock
# SSH keys only; ufw allow OpenSSH, 80, 443; ufw enable   (see allowlist/DEPLOY.md §1)
```

## 2. Code + config
```bash
# as theblock
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs git
git clone <repo> ~/blockcassone && cd ~/blockcassone
cp data/chain-config.mainnet.json data/chain-config.json
# .env (server-side only): BLOCKCASSONE_RPC_URL=<mainnet Alchemy>  PORT=3000
#   WALLETCONNECT_ID=<id>   (BLOCKCASSONE_ATTESTATION_SIGNER_PK: NOT until customize opens)
chmod 600 .env
```

## 3. Indexer snapshot (the site loads with 0 RPC calls)
```bash
cd ~/blockcassone/indexer && npm ci
# build the mainnet snapshot (see indexer/README.md for the exact build command),
# then verify the viewer loads from it. Refresh via systemd timer (below).
```

## 4. systemd
`/etc/systemd/system/theblock-site.service`:
```ini
[Unit]
Description=TheBLOCK site
After=network.target
[Service]
User=theblock
WorkingDirectory=/home/theblock/blockcassone/renderer
ExecStart=/usr/bin/node server.js
Restart=always
Environment=NODE_ENV=production
[Install]
WantedBy=multi-user.target
```
Plus `theblock-indexer.service` (oneshot snapshot build) + `theblock-indexer.timer`
(e.g. every 2 min during the active phase, relax later).
```bash
sudo systemctl enable --now theblock-site theblock-indexer.timer
```

## 5. Caddy (auto-HTTPS)
```
theblock.example {
    reverse_proxy 127.0.0.1:3000
}
```
Point DNS at the VPS **through Cloudflare now** (orange cloud): WAF + caching warm
up before launch, and the origin IP stays hidden.

## 6. The gate (this is what makes launch instant)
Run everything above TODAY. Gate public access with ONE of:
- Cloudflare Access rule on the hostname (fastest to lift), or
- a Caddy `basicauth`/holding-page block you delete at launch.

**Launch = lift the gate + purge Cloudflare cache.** No deploys, no DNS waits, no
restarts on the critical path. Target: <1 minute from "mint closed" to live.

## 7. Launch-day order (after mint close)
1. Confirm final indexer snapshot reflects the sold-out state (timer or manual run).
2. Lift the gate; purge cache; smoke-test from a phone (cold cache, real network).
3. Announce.
4. Post-mint phases later (owner/Rabby, separate decisions): enable moves/merges,
   then customizes + attest service (that's when the signer key goes in server env
   + service restart).

## RPC provisioning (indexer + site proxy)
Sizing (from indexer/README): full backfill ≈ 3 eth_calls/cube → ~12.3k calls at
sellout, + ~1,679 one-time Normie art reads (M4 cache). Monthly CU volume is
trivial (<1% of Alchemy's free tier) — **the binding constraint is THROUGHPUT**
(free tier ≈ 330 CU/s; we hit 429 storms all week at modest concurrency).
1. **Two separate Alchemy apps** (= separate keys): one for the indexer, one for
   the site's /api/chain-rpc proxy — isolation + double throughput, both free.
2. **Upgrade the site-proxy app to pay-as-you-go for launch month** — costs
   pennies at our volume, removes the throughput ceiling exactly when a traffic
   spike would hurt most.
3. **Fallback pool in the proxy**: on 429, fall back to publicnode
   (battle-tested this week for our own broadcasts). Small server.js addition.
4. Indexer backfill throttled to ~10 rps (full rebuild ≈ 20 min at sellout;
   incremental/event-follow after). Prestage: run the mainnet backfill NOW
   (near-instant pre-mint) and let the timer keep it warm as mints land.

## Share-on-X cards
The /s/<id> flow is production-ready: absolute URLs from X-Forwarded-Proto/Host
(Caddy sets both), summary_large_image + twitter:image + og:image, 3h image TTL
(X caches the image at crawl time, so expiry is safe by design). Launch checks:
- **Cloudflare: allow verified bots** (Bot Fight Mode can challenge Twitterbot —
  that would strip images from ALL share tweets; whitelist known bots or exempt
  /s/*).
- The pre-launch gate blocks X's crawler too — share cards only work (and can
  only be tested) once the gate lifts. First smoke test after launch: share a
  cube, paste the /s/<id> URL in the X composer, confirm the image unfurls.

## Ops notes
- Restart discipline: `sudo systemctl restart theblock-site` after ANY env/config change.
- shares/ is self-sweeping (3h TTL, 500 cap) — no disk babysitting.
- /api/chain-rpc is the only RPC the browser sees; the Alchemy key never ships.
- Keep the allowlist site's VPS separate or park it — its registration is closed.
