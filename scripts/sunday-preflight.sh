#!/usr/bin/env bash
# Sunday pre-flight: funding, Nouns supply, suite, tree state, env names.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export PATH="$PATH:$HOME/.foundry/bin"

DEPLOYER=0x5A1c0c3dE4754c726A2E4FB2EcE9F934FDB18dd2
echo "deployer balance: $(cast balance $DEPLOYER --rpc-url "$ETH_RPC_URL" --ether) ETH"
echo "mainnet gas: $(cast gas-price --rpc-url "$ETH_RPC_URL" | awk '{printf "%.3f gwei\n", $1/1e9}')"
echo "nouns totalSupply: $(cast call 0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03 'totalSupply()(uint256)' --rpc-url "$ETH_RPC_URL" | awk '{print $1}') (pool max id 1959 — must be below)"
echo "env names present: $(grep -oE '^(DEPLOYER|ATTESTOR|MAINNET[A-Z_]*|ETHERSCAN_API_KEY)=' .env | tr -d '=' | tr '\n' ' ')"
echo "git: $(git status --short | wc -l) dirty files, HEAD $(git log --oneline -1 | head -c 60)"
echo "unpushed: $(git log --oneline @{u}..HEAD 2>/dev/null | wc -l) commits"
forge test 2>&1 | tail -1
