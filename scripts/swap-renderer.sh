#!/usr/bin/env bash
# Deploy the current CubeRendererV2 and hot-swap it into the rehearsal CubeNFT
# (renderer is an owner-settable module — no token migration needed).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export PATH="$PATH:$HOME/.foundry/bin"
source "$HOME/.nvm/nvm.sh"

RPC="$BLOCKCASSONE_RPC_URL"
PK="$DEV_THROWAWAY_PRIVATE"
CFG=data/rehearsal/contracts.json
j() { node -e "console.log(JSON.parse(require('fs').readFileSync('$CFG','utf8')).$1)"; }

CUBES=$(j cubeNft); STORE=$(j rendererAssetStore); NORMIES=$(j normies)
THUMB=$(j thumbnailRenderer); ART=$(j artStore)

NEW=$(forge create contracts/src/CubeRendererV2.sol:CubeRendererV2 \
  --rpc-url "$RPC" --private-key "$PK" --broadcast \
  --constructor-args "$CUBES" "$STORE" "$NORMIES" "$THUMB" "$ART" \
  | grep 'Deployed to:' | awk '{print $3}')
echo "new CubeRendererV2: $NEW"

cast send "$CUBES" 'setRenderer(address)' "$NEW" --rpc-url "$RPC" --private-key "$PK" > /dev/null
echo "setRenderer done"
cast call "$CUBES" 'tokenURI(uint256)(string)' 6 --rpc-url "$RPC" | head -c 60
echo
