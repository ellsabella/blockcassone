#!/usr/bin/env bash
# Dump the LIVE on-chain thumbnails for the runner cubes to local SVG files.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export PATH="$PATH:$HOME/.foundry/bin"
source "$HOME/.nvm/nvm.sh"

CUBE=$(node -e "console.log(JSON.parse(require('fs').readFileSync('data/sepolia-full/contracts.json','utf8')).cubeNft)")
NEW=$(cast call "$CUBE" 'renderer()(address)' --rpc-url "$BLOCKCASSONE_RPC_URL" | tr -d '\n')
mkdir -p data/sepolia-full/thumbs
for ID in 11 15 16 17 19 29; do
  cast call "$NEW" 'thumbnailSVG(uint256)(string)' $ID --rpc-url "$BLOCKCASSONE_RPC_URL" \
    | sed 's/^"//; s/"$//' > "data/sepolia-full/thumbs/cube-$ID.svg"
  echo "cube $ID -> data/sepolia-full/thumbs/cube-$ID.svg ($(wc -c < data/sepolia-full/thumbs/cube-$ID.svg) bytes)"
done
