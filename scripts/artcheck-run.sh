#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export PATH="$PATH:$HOME/.foundry/bin"
mkdir -p data/sepolia-artcheck

forge script contracts/script/DeploySepoliaArtCheck.s.sol:DeploySepoliaArtCheck \
  --rpc-url "$BLOCKCASSONE_RPC_URL" --private-key "$DEV_THROWAWAY_PRIVATE" \
  --broadcast --slow 2>&1 | grep -E "CubeNFT|street token|rebased|Error|revert" | head -8
