#!/usr/bin/env bash
# Vendors @walletconnect/ethereum-provider into a single self-contained browser ESM file
# so the no-bundler viewer can import it locally (no CDN, works under a 'self' CSP).
# Re-run after bumping the dep. Output: viewer/vendor/walletconnect-provider.js
set -e
cd "$HOME/blockcassone"
export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH"
mkdir -p viewer/vendor
printf "export { EthereumProvider } from '@walletconnect/ethereum-provider';\n" > viewer/vendor/_wc-entry.js
./node_modules/.bin/esbuild viewer/vendor/_wc-entry.js \
  --bundle --format=esm --platform=browser --minify \
  --define:global=globalThis \
  --define:process.env.NODE_ENV='"production"' \
  --outfile=viewer/vendor/walletconnect-provider.js
echo "minified bytes: $(wc -c < viewer/vendor/walletconnect-provider.js)"
echo "gzip est:       $(gzip -c viewer/vendor/walletconnect-provider.js | wc -c) bytes"
