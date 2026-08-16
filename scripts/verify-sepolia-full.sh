#!/usr/bin/env bash
# Etherscan-verify the Sepolia full deployment (explicit constructor args — no
# creation-tx lookup needed). Makes the suite's source publicly readable at a
# NON-mainnet address; the mainnet address stays unannounced.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export PATH="$PATH:$HOME/.foundry/bin"
source "$HOME/.nvm/nvm.sh"

CFG=data/sepolia-full/contracts.json
j() { node -e "console.log(JSON.parse(require('fs').readFileSync('$CFG','utf8')).$1)"; }
LIB=$(node -e "
const r=JSON.parse(require('fs').readFileSync('broadcast/DeploySepoliaFull.s.sol/11155111/run-latest.json','utf8'));
const l=(r.libraries||[]).find(x=>x.includes('CubeWorldLib'));
console.log(l?l.split(':').pop():'');")
DEPLOYER=0xA883E405AF03d16092aee713fC36299127A14e12
CUBES=$(j cubeNft); NORMIES=$(j normies); ASSETS=$(j rendererAssetStore)
THUMB=$(j thumbnailRenderer); ARTSTORE=$(j artStore); MINTER=$(j genesisMinter)
CC1=$(j cc0_1); CC2=$(j cc0_2); CC3=$(j cc0_3); CC4=$(j cc0_4); CC5=$(j cc0_5)
SEED=$(cast keccak "theblock-sepolia-full-seed")
echo "lib=$LIB seed=$SEED"

V() { local addr=$1 target=$2; shift 2
  echo "--- $target @ $addr"
  forge verify-contract "$addr" "$target" --chain sepolia --watch "$@" 2>&1 | tail -2 || echo "  (failed — continue)"
}

[ -n "$LIB" ] && V "$LIB" contracts/src/lib/CubeWorldLib.sol:CubeWorldLib

V "$CUBES" contracts/src/CubeNFT.sol:CubeNFT \
  --libraries "contracts/src/lib/CubeWorldLib.sol:CubeWorldLib:$LIB" \
  --constructor-args "$(cast abi-encode 'constructor(string,string,address,uint32,address)' 'TheBLOCK' 'BLOCK' "$NORMIES" 4096 "$DEPLOYER")"

V "$MINTER" contracts/src/MultiSourceGenesisMinter.sol:MultiSourceGenesisMinter \
  --constructor-args "$(cast abi-encode 'constructor(address,bytes32,address,address,uint32,address[],uint32[])' \
    "$CUBES" "$SEED" "$DEPLOYER" "$ARTSTORE" 1679 "[$CC1,$CC2,$CC3,$CC4,$CC5]" '[901,655,410,328,123]')"

V "$ARTSTORE" contracts/src/NonNormieArtStore.sol:NonNormieArtStore \
  --constructor-args "$(cast abi-encode 'constructor(address,address)' "$CUBES" "$DEPLOYER")"

V "$(j renderer)" contracts/src/CubeRendererV2.sol:CubeRendererV2 \
  --constructor-args "$(cast abi-encode 'constructor(address,address,address,address,address)' \
    "$CUBES" "$ASSETS" "$NORMIES" "$THUMB" "$ARTSTORE")"
echo DONE
