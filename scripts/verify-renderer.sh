#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export PATH="$PATH:$HOME/.foundry/bin"
source "$HOME/.nvm/nvm.sh"

CUBES=$(node -e "console.log(JSON.parse(require('fs').readFileSync('data/rehearsal/contracts.json','utf8')).cubeNft)")
echo "renderer=$(cast call "$CUBES" 'renderer()(address)' --rpc-url "$BLOCKCASSONE_RPC_URL")"
node scripts/extract-anim.mjs 47 2>&1 | grep -E 'scheme|unsafe|normies-api|html length'
