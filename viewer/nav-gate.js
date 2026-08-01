// Reveal a nav link only when its post-mint mechanic is enabled on-chain. Elements opt in
// with data-gate="customize|move|merge|streets" and start hidden (style="display:none"); this
// unhides them once the flag is confirmed true. The contract is the real gate — this only
// keeps the UI from advertising a mechanic that's paused (customizesEnabled etc.).
import { contractFlags } from './preview-chain.js';

(async function gateNav() {
  let f;
  try { f = await contractFlags(); }
  catch { f = { customizesEnabled: false, movesEnabled: false, mergesEnabled: false }; }
  const on = g =>
    g === 'customize' ? f.customizesEnabled
    : g === 'move' ? f.movesEnabled
    : g === 'merge' ? f.mergesEnabled
    : g === 'streets' ? (f.movesEnabled || f.mergesEnabled)
    : true;
  document.querySelectorAll('[data-gate]').forEach(el => {
    el.style.display = on(el.getAttribute('data-gate')) ? '' : 'none';
  });
})();
