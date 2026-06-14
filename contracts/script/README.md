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

Then deploy a sample genesis world and write `data/chain-config.json`.
The local script deploys:

- `LocalMockNormies`
- `CubeNFT`
- `RendererAssetStore`
- `CubeRendererV2`
- `NormieGenesisMinter`

```bash
forge script contracts/script/DeployLocalGenesis.s.sol:DeployLocalGenesis \
  --rpc-url http://127.0.0.1:8545 \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
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
Local genesis deployments also write `renderer`, `rendererAssetStore`, and
`normieStorage`. The viewer can hydrate minted cube art from the local mock
storage contract, and `CubeRendererV2.tokenURI` embeds packed Normie image bytes
directly into the token HTML without calling the dev Normies API.

For local Anvil testing, leave `BLOCKCASSONE_OWNER` unset unless you are also
broadcasting from that same address. The setup calls are owner-gated. The
sender/private key above are Anvil's first default account; do not use them
outside local development.

Quick tokenURI smoke test after deployment:

```bash
cast call "$CUBE_NFT" "tokenURI(uint256)(string)" 1 \
  --rpc-url http://127.0.0.1:8545
```

To export the exact buyer-facing `animation_url` HTML from `tokenURI` into a
temporary preview folder:

```bash
npm run export:token-html -- --token-id=1
```

By default this reads `data/chain-config.json`, calls `CubeNFT.tokenURI(1)`,
and writes:

- `cube-1.html`: decoded `animation_url` HTML
- `cube-1.metadata.json`: decoded metadata JSON
- `cube-1.image.svg`: decoded static `image`

The script also scans the HTML for obvious offchain dependencies such as
`fetch()`, `/api/normies`, `api.normies.art`, and remote `http(s)` URLs.

## Mainnet-Fork Token Preview

`DeployLocalGenesis` uses synthetic `LocalMockNormies` bitmap data. It proves
the renderer/chunk/tokenURI pipeline, but it is not suitable for judging whether
the cube looks like a real Normie.

To preview against real Normie art, run Anvil as a mainnet fork:

```bash
anvil --fork-url "$ETH_RPC_URL"
```

Then deploy the preview stack. This script points `CubeNFT.normieContract` at
the real Normies contract and points `CubeRendererV2.normieStorage` at the real
NormiesStorage contract, while still deploying the Blockcassone contracts
locally on the fork:

```bash
forge script contracts/script/DeployMainnetNormiePreview.s.sol:DeployMainnetNormiePreview \
  --rpc-url http://127.0.0.1:8545 \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast
```

Optional environment variables:

- `BLOCKCASSONE_SAMPLE_MINTS`: number of preview cubes to mint, default `3`.
- `BLOCKCASSONE_SAMPLE_NORMIE_START`: first real Normie ID to preview, default
  `1`.

After deployment, upload the renderer chunks and export the token HTML:

```bash
npm run upload:token-renderer
npm run export:token-html -- --token-id=1 --source=token-uri
```

The exported HTML should now be generated from real NormiesStorage raw bytes,
not the synthetic local mock pattern.

## Mainnet Normie Data Inspection

Before locking the final onchain renderer around Normie storage bytes, inspect
the live contracts through a mainnet fork/RPC:

```bash
forge script contracts/script/InspectNormieData.s.sol:InspectNormieData \
  --fork-url "$ETH_RPC_URL"
```

This prints renderer-facing facts from `MainnetNormieAdapter`: token existence,
owner, storage/reveal status, raw image byte length/hash, and trait bytes/hash.
Use this to confirm the Solidity reads match the dev pipeline before porting any
Normie pixel decoding into the final HTML renderer.
