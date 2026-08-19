#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export PATH="$PATH:$HOME/.foundry/bin"

forge script contracts/script/FixSepoliaArt.s.sol:FixSepoliaArt \
  --rpc-url "$BLOCKCASSONE_RPC_URL" --private-key "$DEV_THROWAWAY_PRIVATE" \
  --broadcast --slow 2>&1 | grep -E "recorded|new |Error|error" | head -12
