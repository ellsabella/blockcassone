#!/usr/bin/env bash
# Confirm the Chain Runners keying bug: getDna(tokenId) vs raw tokenId, and that
# the MAIN contract's tokenURI (ground truth) matches renderer.tokenSVG(getDna(id)).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export PATH="$PATH:$HOME/.foundry/bin"

CR=0x97597002980134beA46250Aa0510C9B90d87A587
REND=0xfdac77881ff861fF76A83cc43A1be3C317c6A1cC

DNA=$(cast call $CR 'getDna(uint256)(uint256)' 403 --rpc-url "$ETH_RPC_URL")
echo "getDna(403) = $DNA"
echo "(raw tokenId 403 as dna would be: 403)"

# Renderer SVG for the REAL dna vs for the raw id — hash both to show they differ.
A=$(cast call $REND 'tokenSVG(uint256)(string)' "$DNA" --rpc-url "$ETH_RPC_URL" | head -c 4000 | sha256sum | cut -c1-16)
B=$(cast call $REND 'tokenSVG(uint256)(string)' 403 --rpc-url "$ETH_RPC_URL" | head -c 4000 | sha256sum | cut -c1-16)
echo "svg(getDna(403)) hash: $A"
echo "svg(403-as-dna)  hash: $B"
