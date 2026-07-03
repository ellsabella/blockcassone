// Production token-renderer entry (the on-chain animation_url bundle).
// Runs the scene with no non-Normie deps, so nothing network-bound is imported
// and the bundle stays forbiddenPatterns-clean.
import { main } from './entry.js';

main().catch(err => {
  const label = document.getElementById('h');
  if (label) label.textContent = String(err?.message || err);
  console.error(err);
});
