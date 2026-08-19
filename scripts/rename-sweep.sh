#!/usr/bin/env bash
# One-shot brand rename: Blockcassone -> TheBLOCK in user-visible strings + comments.
# Case-sensitive on purpose: BLOCKCASSONE_* env vars, window.BLOCKCASSONE_TOKEN and
# lowercase paths are internal plumbing and stay as-is (user decision 2026-08-14).
set -euo pipefail
cd "$(dirname "$0")/.."

git ls-files '*.sol' '*.md' '*.mjs' '*.js' '*.jsx' '*.sh' '*.html' \
  | grep -v -E '(^data/|^dist/|^public/inputdata|package-lock)' \
  | xargs sed -i 's/Blockcassone Cubes/TheBLOCK/g; s/Blockcassone Cube #/TheBLOCK #/g; s/Blockcassone/TheBLOCK/g'

# Token symbol: CUBE -> BLOCK (appears only as the constructor symbol argument).
grep -rl --include='*.sol' '"CUBE"' contracts/ | xargs -r sed -i 's/"CUBE"/"BLOCK"/g'

echo "remaining 'Blockcassone' (should be only excluded/generated files):"
git grep -l 'Blockcassone' | head -10 || true
echo SWEEP_DONE
