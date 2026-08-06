#!/usr/bin/env bash
# Bundles the RainbowKit + wagmi wallet island (viewer/wallet-widget/index.jsx) into a single
# self-contained IIFE the no-bundler viewer loads with a plain <script>. Re-run after edits.
set -e
cd "$HOME/blockcassone"
export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH"
mkdir -p viewer/vendor
./node_modules/.bin/esbuild viewer/wallet-widget/index.jsx \
  --bundle --format=iife --jsx=automatic --minify --platform=browser \
  --loader:.css=text \
  --inject:viewer/wallet-widget/_polyfills.js \
  --define:process.env.NODE_ENV='"production"' \
  --outfile=viewer/vendor/wallet-widget.js
echo "bytes:    $(wc -c < viewer/vendor/wallet-widget.js)"
echo "gzip est: $(gzip -c viewer/vendor/wallet-widget.js | wc -c) bytes"
