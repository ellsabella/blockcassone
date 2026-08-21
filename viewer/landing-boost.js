// Landing → Explorer instant handoff.
//
// While the landing page (static index.html) plays its hero, this script loads
// the FULL Explorer in an iframe layered BEHIND the landing's opaque content
// (z-index:-1, full viewport — so it renders at full rAF rate while the visitor
// watches the video). Clicking ENTER fades the landing elements away and
// promotes the iframe: the neighbourhood view is already built and rendered,
// so the handoff is instant — no blank gap.
//
// Spliced into the landing with:
//   <script src="/viewer/landing-boost.js" defer></script>
// (defer ⇒ runs after any earlier inline ENTER handlers, which the button
// clone below deliberately discards.)
(function () {
  if (window.top !== window) return; // never inside a frame ourselves

  var frame = document.createElement('iframe');
  frame.src = '/viewer/';
  frame.title = 'TheBLOCK Explorer';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:-1;' +
    'pointer-events:none;background:#020203';
  document.body.appendChild(frame);

  var btn = document.getElementById('enter');
  if (!btn) return;
  // Clone the button to drop ALL previously attached click handlers (including
  // any older navigate-to-/viewer/ override baked into the page).
  var clone = btn.cloneNode(true);
  clone.removeAttribute('onclick');
  clone.setAttribute('type', 'button');
  btn.parentNode.replaceChild(clone, btn);

  clone.addEventListener('click', function () {
    var kids = Array.prototype.slice.call(document.body.children).filter(function (el) {
      return el !== frame;
    });
    kids.forEach(function (el) {
      el.style.transition = 'opacity .6s ease';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
    });
    frame.style.zIndex = '50';
    frame.style.pointerEvents = 'auto';
    frame.removeAttribute('aria-hidden');
    try { history.pushState({}, '', '/viewer/'); } catch (e) { /* URL cosmetics only */ }
    setTimeout(function () {
      kids.forEach(function (el) { try { el.remove(); } catch (e) {} });
    }, 700);
    try { frame.focus(); } catch (e) {}
  });
})();
