# Allowlist — secure VPS deployment

A short-lived (a few days) public site that durably collects **signed** allowlist requests
and lets you review/download them. Everything sensitive stays server-side.

## What runs where

```
 Browser ──HTTPS──▶ Caddy (TLS, :443) ──▶ node server.mjs (:8787, localhost)
                                              ├─ serves  dist/           (built SPA)
                                              ├─ proxies /api/alchemy-nft, /api/mainnet-rpc  (key injected here, never shipped)
                                              ├─ POST    /api/allowlist-submit   (verifies EIP-712 sig, dedups, rate-limits)
                                              │            └─▶ appends to  $SUBMISSIONS_FILE  (the dataset)
                                              └─ admin   /api/allowlist-{count,stats,export}  (Bearer token)
```

The dataset is `allowlist-submissions.jsonl` — one signed JSON record per line, append-only.

## Security model

- **Secrets never reach the browser.** Alchemy key + mainnet RPC live in `.env`, injected by the server-side proxy only.
- **Every submission is signature-verified server-side** (`recoverTypedDataAddress` must equal the claimed wallet) → nobody can register a wallet they don't control. Verified by the smoke test (forged submit → 401).
- **One registration per wallet** (409 on duplicate). Covers GTD art requests AND the lighter
  "register interest" opt-in (non-holders / sub-threshold holders); both are signed.
- **Rate limited** per IP, per endpoint: 8 submits/min, 60 holdings reads/min, 200 RPC calls/min.
  16 KB body cap + strict shape validation.
- **The key-injecting proxies are locked down** so they can't be abused as a free Alchemy/RPC:
  `/api/alchemy-nft` allows **only** `getNFTsForOwner`; `/api/mainnet-rpc` allows **only** a
  read-only method allowlist (no `eth_getLogs`/filters/writes/trace/debug) and rejects oversized
  batches. Holdings reads are cached 60 s to collapse repeat scans.
- **Recommended: put Cloudflare (free tier) in front** — WAF rate-limit rules + Bot Fight Mode +
  caching add a network-layer defence on top of the app limits above (esp. for the read proxies).
- **Admin endpoints require a Bearer token** (`ALLOWLIST_ADMIN_TOKEN`) sent in the `Authorization` header — never in a URL/query (stays out of proxy logs). Disabled entirely if the env var is unset.
- **TLS everywhere** (Caddy auto-HTTPS). Server binds `127.0.0.1` — only the proxy is public.
- Dataset file is `chmod 600`, owned by the service user, and gitignored.

## 1. Provision (Ubuntu 22.04+, 1 GB is plenty)

```bash
# as root, first login
adduser --disabled-password blockal
usermod -aG sudo blockal
# SSH keys only
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
# firewall: SSH + web only
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 2. Node + code

```bash
# as blockal
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
git clone <your repo> ~/blockcassone     # or rsync just the allowlist/ dir + repo .env
cd ~/blockcassone/allowlist
npm ci
npm run build                            # produces dist/
```

## 3. Configure `.env` (repo root, `chmod 600`)

```bash
sudo mkdir -p /var/lib/blockcassone && sudo chown blockal:blockal /var/lib/blockcassone
cat > ~/blockcassone/.env <<EOF
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<YOUR_ALCHEMY_KEY>
# ALCHEMY_KEY=<key>            # optional; auto-extracted from ETH_RPC_URL if it's an Alchemy URL
ALLOWLIST_ADMIN_TOKEN=$(openssl rand -hex 32)
SUBMISSIONS_FILE=/var/lib/blockcassone/allowlist-submissions.jsonl
WALLETCONNECT_PROJECT_ID=<from cloud.reown.com>
EOF
chmod 600 ~/blockcassone/.env
grep ALLOWLIST_ADMIN_TOKEN ~/blockcassone/.env   # save this token somewhere safe
```

**WalletConnect** — `WALLETCONNECT_PROJECT_ID` is baked into the bundle at `npm run build`
(client value, safe to embed). **Set it before building** or mobile/QR wallets can't connect
(injected extension wallets like MetaMask still work either way; the app logs a warning if it's
missing). Free id at cloud.reown.com — takes ~2 min.

## 4. Run under systemd

```ini
# /etc/systemd/system/blockal.service
[Unit]
Description=Blockcassone allowlist
After=network.target

[Service]
User=blockal
WorkingDirectory=/home/blockal/blockcassone/allowlist
Environment=PORT=8787
ExecStart=/usr/bin/node server.mjs
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/blockcassone

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now blockal
sudo systemctl status blockal
```

## 5. TLS reverse proxy (Caddy = auto-HTTPS)

Point a DNS `A` record (e.g. `al.yourdomain.com`) at the VPS IP, then:

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
# (install Caddy per caddyserver.com/docs/install)
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
al.yourdomain.com {
    encode gzip
    reverse_proxy 127.0.0.1:8787
}
EOF
sudo systemctl reload caddy
```

Caddy fetches a Let's Encrypt cert automatically. Site is now live on `https://al.yourdomain.com`.

## 6. Admin tools (check count / download)

On the VPS (reads the file directly):

```bash
cd ~/blockcassone/allowlist
node admin.mjs count                 # → number of registrations
node admin.mjs stats                 # → totals, by-collection, spots, first/last
node admin.mjs list 30               # → last 30 rows
node admin.mjs export final.json     # → full pretty JSON
node admin.mjs verify                # → re-check every signature
```

From your laptop (over HTTPS, needs the token):

```bash
export ALLOWLIST_URL=https://al.yourdomain.com
export ALLOWLIST_ADMIN_TOKEN=<the token from .env>
node admin.mjs count
node admin.mjs stats
node admin.mjs export final.json     # downloads + writes the whole dataset
```

Or raw curl:

```bash
curl -H "Authorization: Bearer $ALLOWLIST_ADMIN_TOKEN" https://al.yourdomain.com/api/allowlist-count
curl -H "Authorization: Bearer $ALLOWLIST_ADMIN_TOKEN" https://al.yourdomain.com/api/allowlist-export -o final.json
```

## 7. Backups (cheap insurance while live)

```bash
# hourly copy, keep the append-only file safe
( crontab -l 2>/dev/null; echo "0 * * * * cp /var/lib/blockcassone/allowlist-submissions.jsonl /var/lib/blockcassone/backup-\$(date +\%Y\%m\%d\%H).jsonl" ) | crontab -
```

## 8. Teardown (after the window closes)

1. `node admin.mjs export final.json` (from your laptop) — grab the final dataset.
2. `node admin.mjs verify` — confirm every signature is valid.
3. Destroy the droplet.
4. **Rotate the Alchemy key** (it lived on the box) and discard the admin token.

## After the window closes → reserve the guaranteed art on-chain

The site collects **signed requests**; the guarantee only exists once the approved
(wallet → chosen sources) are baked on-chain via `reserveSources()`. Bridge tool:
[reserve.mjs](reserve.mjs).

```bash
# 1. export + review the dataset
node admin.mjs export final.json
node admin.mjs verify                 # confirm every signature is valid

# 2. (optional) prune final.json to the approved set after human review

# 3. DRY RUN — re-verifies ownership/delegation LIVE on mainnet, writes reserve-plan.json
ETH_RPC_URL=<rpc> node reserve.mjs --minter 0xMINTER --in final.json

# 4a. execute with a hot key …
OWNER_PRIVATE_KEY=0x… ETH_RPC_URL=<rpc> node reserve.mjs --minter 0xMINTER --in final.json --execute
# 4b. … or submit each reserve-plan.json → plan[].calldata to the minter via your Safe / hardware wallet / cast send
```

The dry run drops any source **not still owned** by the wallet (directly or via a live
delegate.xyz delegation) — a signed-but-since-sold source can't sneak a cube. It's idempotent
(wallets already reserved on-chain are skipped) and must run **before** `finalizeSnapshot`.
STORED (CC0) sources must already be in the genesis pool with a committed payload, else the
on-chain call reverts `SourceNotInPool` / `MissingSourcePayload` (fix the pool, re-run). See
[[LAUNCH_RUNBOOK.md]].

### Then: generate the GTD allowlist merkle (so OpenSea can gate the GTD stage)

```bash
node merkle.mjs --in reserve-plan.json --start <gtd-open-unix> --end <gtd-close-unix>
```
Produces `allowlist-root.txt` (set on-chain: `cubes.updateAllowList(seaDrop, {merkleRoot, …})`),
`allowlist-proofs.json` (per-winner `{mintParams, proof}` for the mint UI / `allowListURI`), and
`allowlist.csv` (`address,maxMintable` for an OpenSea dashboard upload). Each winner's leaf caps
them at **exactly their reservation count** and pins the **0.0069** price — so they can only mint
their guaranteed art, only in the GTD window. Format verified byte-for-byte against real SeaDrop
1.0 (`test/SeaDropForkE2E.t.sol`). Run the GTD stage with the minter in `Phase.Allowlist`.

### After the GTD window closes: release unclaimed reservations

Winners who didn't mint leave their reserved art stranded (pulled from the pool, never minted →
the collection under-fills). Return it to the public draw **before** opening FCFS/Public:

```bash
# owner tx — do it once the GTD stage has ended and phase is moving to Public
cast send $MINTER 'releaseReservations(address[])' '[0xwinnerA,0xwinnerB,…]' --rpc-url <rpc> [--ledger]
```
`releaseReservations` is owner-only, reverts while `phase == Allowlist` (can't rug a live GTD), and
is idempotent (only the unminted tail per wallet). The list of no-shows = winners with
`reservationRemaining(wallet) > 0` after the GTD stage.

## Notes

- `SUBMISSIONS_FILE` can be any absolute path — keep it **outside** the git repo (we default the
  local/dev file to the repo root, which is gitignored).
