#!/usr/bin/env bash
# Wrapper for upload-chunks-mainnet.mjs: prompts for the deployer key silently and
# scopes it to this single process — never written to .env or shell history.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
source "$HOME/.nvm/nvm.sh"

: "${BLOCKCASSONE_STORE:?set BLOCKCASSONE_STORE=<RendererAssetStore>}"
read -r -s -p "deployer private key (hidden): " MAINNET_DEPLOYER_PRIVATE
echo
export MAINNET_DEPLOYER_PRIVATE
node scripts/upload-chunks-mainnet.mjs
