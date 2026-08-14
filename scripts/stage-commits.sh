#!/usr/bin/env bash
# Stage today's work as three logical commits (messages in /tmp/cm{1,2,3}.txt).
set -euo pipefail
cd "$(dirname "$0")/.."

# 1) Rehearsal tooling + render pipeline fixes
git add .gitignore \
  contracts/script/DeploySepoliaRehearsal.s.sol \
  scripts/rehearsal-driver.mjs scripts/rehearsal-check.sh scripts/rehearsal-reset.mjs \
  scripts/fix-chunks.mjs scripts/extract-anim.mjs scripts/swap-renderer.sh \
  scripts/verify-renderer.sh scripts/build-token-renderer.mjs scripts/stage-commits.sh
git commit -F /tmp/cm1.txt

# 2) Rename + metadata (everything else EXCEPT the library-extraction files)
git add -A
git reset -q contracts/src/CubeNFT.sol contracts/src/lib/CubeWorldLib.sol foundry.toml
git commit -F /tmp/cm2.txt

# 3) CubeWorldLib extraction + via-ir off
git add contracts/src/CubeNFT.sol contracts/src/lib/CubeWorldLib.sol foundry.toml
git commit -F /tmp/cm3.txt

echo "---"
git log --oneline -4
git status --short | head -5
