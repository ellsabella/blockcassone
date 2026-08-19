#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export PATH="$PATH:$HOME/.foundry/bin"
RPC=https://ethereum-rpc.publicnode.com
RABBY=0xA2E8f8d26a6C1240b328Fc6F4f2d9bC3921D1f55
o() { cast call "$1" 'owner()(address)' --rpc-url $RPC; }
echo "CubeNFT:        $(o 0x1794d9119C2ceaDaa78D98e8330AD5395fa0C112)"
echo "Minter:         $(o 0x682faC6d06240C6b94ae17B6CD1B0C8A790f2648)"
echo "AssetStore:     $(o 0xed19db43529DB78f6A27b124a43bf0B385a96F49)"
echo "AgentRegistry:  $(o 0xFB41C8A94bc48De4c9f10141Bf8ca53430516c00)"
echo "Attestation:    $(o 0x7915FA1B376de495e0d0b254DA11A6cB27cC4b8f)"
echo "ArtStore (must stay controller 0x48F8…9222): $(o 0x063197C15FFC17650c0E3F8897Da3b2c9FC244BE)"
echo "expected owner: $RABBY"
