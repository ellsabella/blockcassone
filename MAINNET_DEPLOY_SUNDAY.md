# TheBLOCK — Sunday Mainnet Deploy (command sheet)

Scope: contracts + verification + renderer chunks + CC0 pool commit. **STOP after
step 5** — Normie snapshot, GTD reservations, finalize, merkle root, stage windows
are post-allowlist-close ops (LAUNCH_RUNBOOK.md Phase 2), not today.

Rule in force: the contract address stays UNANNOUNCED until the audit clears.
Measured cost basis: 525.8M gas on the identical Sepolia run + ~30M chunks →
≈ 0.022 ETH @ 0.04 gwei. Fund the deployer ~0.5 ETH for spike armor.

## 0. Pre-flight (once)
- `.env`: `MAINNET_DEPLOYER_PRIVATE` (fresh ops key), `ETHERSCAN_API_KEY` set.
- Deployer funded (~0.5 ETH). All work committed; `forge test` green (212).
- Re-confirm Nouns supply if days have passed (`bash scripts/cc0-supplies.sh`) —
  they mint daily; the pool must only contain EXISTING ids at commit time.
- `DEPLOYER=$(cast wallet address --private-key $MAINNET_DEPLOYER_PRIVATE)`

## 1. Deploy + verify (one command, ~21.4M gas)
```bash
BLOCKCASSONE_OWNER=$DEPLOYER \
BLOCKCASSONE_ATTESTATION_SIGNER=<signer addr> \
forge script contracts/script/DeployGenesis.s.sol:DeployGenesis \
  --rpc-url "$ETH_RPC_URL" --sender $DEPLOYER \
  --private-key "$MAINNET_DEPLOYER_PRIVATE" \
  --broadcast --slow --verify
```
Record every address from the console output. CubeWorldLib deploys + links
automatically; `--verify` submits it and CubeNFT (with the library) to Etherscan.

## 2. Renderer chunks (~30M gas)
```bash
BLOCKCASSONE_STORE=<RendererAssetStore> node scripts/upload-chunks-mainnet.mjs
```
Idempotent (skips already-correct chunks). Head slot stays empty by design.

## 3. CC0 pools + payloads (~330M gas, ~90 txs)
```bash
BLOCKCASSONE_MINTER=<MultiSourceGenesisMinter> \
forge script contracts/script/CommitPools.s.sol:CommitPools \
  --rpc-url "$ETH_RPC_URL" --sender $DEPLOYER \
  --private-key "$MAINNET_DEPLOYER_PRIVATE" --broadcast --slow
```
On a mid-run failure add `--resume` — do NOT re-run from scratch (committed
payloads can't be overwritten; a fresh run would revert).

## 4. Verify pools art-backed
```bash
for c in 1 2 3 4 5; do
  cast call <minter> 'firstUncommittedPoolToken(uint8)(bool,uint256)' $c --rpc-url "$ETH_RPC_URL"
done   # every line must be (false, 0)
```

## 5. Sanity reads, then stop
```bash
cast call <cubeNft> 'name()(string)' --rpc-url "$ETH_RPC_URL"        # TheBLOCK
cast call <cubeNft> 'maxSupply()(uint256)' --rpc-url "$ETH_RPC_URL"  # 4096
cast call <minter> 'totalPublicRemaining()(uint256)' --rpc-url "$ETH_RPC_URL"
```
Do NOT: addSnapshotNormies / reserveSources / finalizeSnapshot / updateAllowList /
updatePublicDrop / setGtdEndTime / setPhase. Those wait for allowlist close + audit.

## Notes
- Dataset provenance: pools are seeded-PRNG (`blockcassone-cc0-genesis-v1`) with the
  36 verified GTD wallets' 44 CC0 picks injected as required ids; skull #2847
  replaced by #7231 (only off-chain-art skull drawn; deterministic redraw);
  Chain Runners flattened via getDna (the 2026-08-15 fix); supplies re-confirmed live.
- reserve-plan-mainnet.json (gitignored) holds the verified GTD plan — regenerate
  against the REAL minter address before executing reservations later.
