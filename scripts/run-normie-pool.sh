#!/usr/bin/env bash
# Select the 1,679-id Normie genesis pool + fetch raw art (ETH_RPC_URL from .env).
# Usage: wsl -e bash scripts/run-normie-pool.sh  [env: POOL_COUNT=, SELECT_SEED=, CONCURRENCY=]
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
source ~/.nvm/nvm.sh
exec node scripts/build-normie-pool.mjs
