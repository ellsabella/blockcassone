#!/usr/bin/env bash
# Fork-simulate the partial redeploy against LIVE mainnet state — including the real
# reused contracts (asset store chunks, attestation owner checks).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export PATH="$PATH:$HOME/.foundry/bin"
export BLOCKCASSONE_CHAIN_CONFIG_OUT=data/chain-config.simulation.json

BLOCKCASSONE_OWNER=0x5A1c0c3dE4754c726A2E4FB2EcE9F934FDB18dd2 \
forge script contracts/script/DeployGenesisV2.s.sol:DeployGenesisV2 \
  --rpc-url "$ETH_RPC_URL" --sender 0x5A1c0c3dE4754c726A2E4FB2EcE9F934FDB18dd2 -vv 2>&1 \
  | grep -E "Script ran|CubeNFT|Minter|REUSED|NEXT|Error|revert" | head -10
