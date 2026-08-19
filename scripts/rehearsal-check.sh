#!/usr/bin/env bash
# Pre-flight checks for the Sepolia dress rehearsal (prints no secrets).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export PATH="$PATH:$HOME/.foundry/bin"

RPC="${BLOCKCASSONE_RPC_URL:?BLOCKCASSONE_RPC_URL not set}"
echo "chainid=$(cast chain-id --rpc-url "$RPC")"
echo "throwaway=$DEV_THROWAWAY_PUBLIC"
echo "throwaway_balance_eth=$(cast balance "$DEV_THROWAWAY_PUBLIC" --rpc-url "$RPC" --ether)"
echo "seadrop_code_chars=$(cast code 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5 --rpc-url "$RPC" | wc -c)"
echo "normie_raw_files=$(ls data/normie-raw-*.hex 2>/dev/null | wc -l)"
echo "cc0_payload_files=$(ls data/cc0/*.hex 2>/dev/null | wc -l)"
echo "renderer_chunks=$(ls dist/token-renderer/renderer-chunks.json 2>/dev/null || echo MISSING)"
