#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export PATH="$PATH:$HOME/.foundry/bin"
source "$HOME/.nvm/nvm.sh"

CUBE=$(node -e "console.log(JSON.parse(require('fs').readFileSync('data/sepolia-full/contracts.json','utf8')).cubeNft)")
echo "renderer now: $(cast call "$CUBE" 'renderer()(address)' --rpc-url "$BLOCKCASSONE_RPC_URL")"
URI=$(cast call "$CUBE" 'tokenURI(uint256)(string)' 11 --rpc-url "$BLOCKCASSONE_RPC_URL")
echo "uri length: ${#URI}"
# strip quotes + data:application/json;base64, then decode the name field
BODY=$(echo "$URI" | tr -d '"' | sed 's|^data:application/json;base64,||')
echo "$BODY" | base64 -d 2>/dev/null | head -c 200
echo
