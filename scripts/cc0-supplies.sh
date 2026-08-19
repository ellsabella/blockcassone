#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export PATH="$PATH:$HOME/.foundry/bin"
for pair in "runner 0x97597002980134beA46250Aa0510C9B90d87A587" "skull 0x9251dEC8DF720C2ADF3B6f46d968107cbBADf4d4" "pepe 0x9131d8c7A411D90C6B164d296440701a0e5B3178" "noun 0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03" "kevin 0x17B19C70bfcA098da3f2eFeF6e7FA3a1C42F5429"; do
  set -- $pair
  echo "$1 totalSupply=$(cast call $2 'totalSupply()(uint256)' --rpc-url "$ETH_RPC_URL" | awk '{print $1}')"
done
