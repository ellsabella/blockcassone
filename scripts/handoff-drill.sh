#!/usr/bin/env bash
# LIVE handoff drill on the Sepolia full deployment: throwaway -> fresh test key ->
# back. Proves the enumeration, the transfers, and that a brand-new owner can run
# the same script (i.e. the Rabby handoff on mainnet will work, and so would a
# recovery in the other direction).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export PATH="$PATH:$HOME/.foundry/bin"
source "$HOME/.nvm/nvm.sh"

CUBES=$(node -e "console.log(JSON.parse(require('fs').readFileSync('data/sepolia-full/contracts.json','utf8')).cubeNft)")
RPC="$BLOCKCASSONE_RPC_URL"

# Fresh test key (stands in for the Rabby), lightly funded for the return leg.
TEST_JSON=$(cast wallet new --json)
TEST_ADDR=$(echo "$TEST_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d)[0].address))")
TEST_PK=$(echo "$TEST_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d)[0].private_key))")
echo "test owner: $TEST_ADDR"
cast send "$TEST_ADDR" --value 0.02ether --private-key "$DEV_THROWAWAY_PRIVATE" --rpc-url "$RPC" > /dev/null
echo "funded test owner"

echo "=== leg 1: throwaway -> test key ==="
BLOCKCASSONE_CUBES="$CUBES" BLOCKCASSONE_NEW_OWNER="$TEST_ADDR" \
forge script contracts/script/HandoffOwnership.s.sol:HandoffOwnership \
  --rpc-url "$RPC" --private-key "$DEV_THROWAWAY_PRIVATE" --broadcast --slow 2>&1 \
  | grep -E -- "->|already|stays|COMPLETE|Error" | head -10

echo "=== leg 2: test key -> throwaway (fresh owner runs the same script) ==="
BLOCKCASSONE_CUBES="$CUBES" BLOCKCASSONE_NEW_OWNER="$DEV_THROWAWAY_PUBLIC" \
forge script contracts/script/HandoffOwnership.s.sol:HandoffOwnership \
  --rpc-url "$RPC" --private-key "$TEST_PK" --broadcast --slow 2>&1 \
  | grep -E -- "->|already|stays|COMPLETE|Error" | head -10

echo "=== final owners ==="
cast call "$CUBES" 'owner()(address)' --rpc-url "$RPC"
