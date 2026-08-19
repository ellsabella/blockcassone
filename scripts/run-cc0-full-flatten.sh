#!/usr/bin/env bash
# Full CC0 pool flatten against mainnet (ETH_RPC_URL from .env).
# Usage: wsl -e bash scripts/run-cc0-full-flatten.sh  [extra env: ONLY=, LIMIT=, CONCURRENCY=]
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
source ~/.nvm/nvm.sh
exec node dev/cc0-proof/flatten-pools.mjs
