# Contracts Scripts

Foundry deployment and maintenance scripts will be added here.

Expected scripts:

- Deploy core NFT and renderer registry.
- Deploy renderer asset chunks.
- Register renderer versions.
- Configure attestation signer.
- Configure Normie adapter/font sources.

## Local Chain Viewer Bridge

For local viewer testing, run Anvil in WSL:

```bash
anvil
```

Then deploy a sample genesis world and write `data/chain-config.json`:

```bash
forge script contracts/script/DeployLocalGenesis.s.sol:DeployLocalGenesis \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast
```

Optional environment variables:

- `BLOCKCASSONE_SAMPLE_MINTS`: number of sample Normie cubes to mint, default `8`.
- `BLOCKCASSONE_TOTAL_SLOTS`: local cube supply, default `4096`.
- `BLOCKCASSONE_OWNER`: final owner after setup, default broadcaster.
- `BLOCKCASSONE_SEADROP`: authorized SeaDrop-like caller, default owner.
- `BLOCKCASSONE_CHAIN_CONFIG_OUT`: config output path, default `data/chain-config.json`.

The viewer reads `data/chain-config.json` and proxies JSON-RPC through
`/api/chain-rpc`, so browser CORS settings on Anvil do not matter.

For local Anvil testing, leave `BLOCKCASSONE_OWNER` unset unless you are also
broadcasting from that same address. The setup calls are owner-gated.
