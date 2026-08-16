#!/usr/bin/env bash
# Simulate the PRODUCTION DeployGenesis against a live mainnet fork (no broadcast).
# Validates current bytecode (CubeWorldLib linking, EIP-170) + reports fresh gas.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
export PATH="$PATH:$HOME/.foundry/bin"

# Scratch path: DeployLocalGenesis-style config writers run even in simulation and
# would clobber the tracked Sepolia chain-config.json (bitten twice).
export BLOCKCASSONE_CHAIN_CONFIG_OUT=data/chain-config.simulation.json

BLOCKCASSONE_OWNER="${DEV_THROWAWAY_PUBLIC}" \
BLOCKCASSONE_ATTESTATION_SIGNER="${DEV_THROWAWAY_PUBLIC}" \
forge script contracts/script/DeployGenesis.s.sol:DeployGenesis \
  --rpc-url "$ETH_RPC_URL" --sender "$DEV_THROWAWAY_PUBLIC" -vv 2>&1 \
  | grep -E "deploy gas|CubeNFT|Minter|Error|error|revert|Script ran" | head -15
