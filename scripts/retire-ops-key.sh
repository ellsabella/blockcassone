#!/usr/bin/env bash
# Ops-key retirement, step 2 (AFTER HandoffOwnership): sweep the key's remaining ETH
# to the long-term owner, leaving only dust for the sweep gas. Then delete the
# keystore (~/.foundry/keystores/<account>) — the key is worthless once ownership
# and funds are gone.
#   ACCOUNT=theblock-deployer TO=0xRabby RPC=$ETH_RPC_URL bash scripts/retire-ops-key.sh
set -euo pipefail
export PATH="$PATH:$HOME/.foundry/bin"

: "${ACCOUNT:?set ACCOUNT=<keystore name>}"
: "${TO:?set TO=<long-term owner address>}"
: "${RPC:?set RPC=<rpc url>}"

FROM=$(cast wallet address --account "$ACCOUNT")
BAL=$(cast balance "$FROM" --rpc-url "$RPC")
GAS_PRICE=$(cast gas-price --rpc-url "$RPC")
FEE=$((21000 * GAS_PRICE * 2))
if [ "$BAL" -le "$FEE" ]; then echo "balance $BAL <= fee allowance $FEE — nothing to sweep"; exit 0; fi
VALUE=$((BAL - FEE))
echo "sweeping $(cast to-unit $VALUE ether) ETH  $FROM -> $TO"
cast send "$TO" --value "$VALUE" --account "$ACCOUNT" --rpc-url "$RPC"
echo "swept. Remaining: $(cast balance "$FROM" --rpc-url "$RPC") wei. Now delete ~/.foundry/keystores/$ACCOUNT"
