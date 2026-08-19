#!/usr/bin/env bash
cd "$(dirname "$0")/../data"
echo "targets: runner 901, skull 655, pepe 410, noun 328, kevin 123, normie 1679"
for k in runner skull pepe noun kevin; do
  n=$(ls cc0-full/$k 2>/dev/null | wc -l)
  echo "cc0-full/$k: $n"
done
echo "normie-raw-full: $(ls normie-raw-full 2>/dev/null | wc -l)"
[ -f normie-pool.json ] && echo "normie-pool.json: present" || echo "normie-pool.json: MISSING"
[ -f cc0-full/failures.json ] && echo "failures: $(cat cc0-full/failures.json)" || echo "failures.json: none"
pgrep -af "flatten-pools|fetch-normie" | head -3 || true
