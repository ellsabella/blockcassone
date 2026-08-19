#!/usr/bin/env bash
# Old renderer vs new renderer: does cube #11's thumbnail SVG actually differ on-chain?
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export PATH="$PATH:$HOME/.foundry/bin"
source "$HOME/.nvm/nvm.sh"

OLD=$(node -e "console.log(JSON.parse(require('fs').readFileSync('data/sepolia-full/contracts.json','utf8')).renderer)")
CUBE=$(node -e "console.log(JSON.parse(require('fs').readFileSync('data/sepolia-full/contracts.json','utf8')).cubeNft)")
NEW=$(cast call "$CUBE" 'renderer()(address)' --rpc-url "$BLOCKCASSONE_RPC_URL" | tr -d '\n')
echo "old renderer: $OLD"
echo "new renderer: $NEW"
for R in "$OLD" "$NEW"; do
  H=$(cast call "$R" 'thumbnailSVG(uint256)(string)' 11 --rpc-url "$BLOCKCASSONE_RPC_URL" | sha256sum | cut -c1-16)
  echo "thumbnailSVG(11) via $R -> $H"
done
