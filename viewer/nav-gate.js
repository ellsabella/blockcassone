// PLAY-menu gating. The post-mint pages (Update Cube, Move / Merge) live in a "PLAY ▾"
// dropdown. Each item is a live link once its on-chain switch is on, otherwise it shows a
// "SOON" chip and isn't clickable. The menu is always visible (so "coming soon" is advertised
// before launch). The CONTRACT is the real gate — any move/merge/customize tx reverts while
// its switch is off, and each page has its own paused screen — so revealing the link is purely
// cosmetic and safe.
//
// Auto-flip: we poll the switches every 60s; the moment one turns on, its item becomes a live
// link IN PLACE (no reload). New visitors get the right state on load. Two cheap eth_calls per
// minute, and polling stops once everything is live.
//
// Local review: `?preview` treats every switch as on (and carries the flag through the links).
import { contractFlags } from './preview-chain.js';

const isOn = (f, g, preview) =>
  preview ? true
  : g === 'customize' ? !!f.customizesEnabled
  : g === 'move' ? !!f.movesEnabled
  : g === 'merge' ? !!f.mergesEnabled
  : g === 'streets' ? !!(f.movesEnabled || f.mergesEnabled)
  : true;

function applyState(f, preview) {
  document.querySelectorAll('[data-gate]').forEach(el => {
    const live = isOn(f, el.getAttribute('data-gate'), preview);
    el.classList.toggle('live', live);
    el.classList.toggle('soon', !live);
    if (el.classList.contains('nav-item')) {
      // Remember the real href once, so we can drop it while "soon" and restore it when live.
      if (el.dataset.href == null && el.getAttribute('href')) el.dataset.href = el.getAttribute('href');
      let chip = el.querySelector('.soon-chip');
      if (live) {
        if (chip) chip.remove();
        if (el.dataset.href) {
          let href = el.dataset.href;
          if (preview) { try { const u = new URL(href, location.origin); u.searchParams.set('preview', '1'); href = u.pathname + u.search; } catch (_) {} }
          el.setAttribute('href', href);
        }
      } else {
        el.removeAttribute('href'); // not navigable while paused
        if (!chip) { chip = document.createElement('span'); chip.className = 'soon-chip'; chip.textContent = 'SOON'; el.appendChild(chip); }
      }
    } else {
      // Any other gated element (legacy flat links): reveal only when live.
      el.style.display = live ? '' : 'none';
    }
  });
  const menu = document.getElementById('play-menu');
  if (menu) menu.style.display = ''; // always show PLAY, even pre-launch (items carry SOON)
}

(async function gateNav() {
  const preview = new URLSearchParams(location.search).has('preview');

  // Dropdown open/close (click-toggle works on desktop + mobile).
  const btn = document.getElementById('play-btn');
  const dd = document.getElementById('play-dropdown');
  if (btn && dd) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = dd.hidden;
      dd.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', () => { dd.hidden = true; btn.setAttribute('aria-expanded', 'false'); });
  }

  let f;
  try { f = await contractFlags(); }
  catch { f = { customizesEnabled: false, movesEnabled: false, mergesEnabled: false }; }
  applyState(f, preview);

  if (preview) return; // preview forces everything on — nothing to poll
  const poll = setInterval(async () => {
    let g;
    try { g = await contractFlags(); }
    catch { return; }
    applyState(g, false);
    if (g.customizesEnabled && g.movesEnabled && g.mergesEnabled) clearInterval(poll);
  }, 60000);
})();
