// Make HUD panels drag-to-move (by their title bar) and resize from a bottom-right corner,
// with per-panel localStorage persistence. Panels are position:fixed; dragging sets left/top
// (clearing right/bottom), resizing sets width/height. Everything is clamped to the viewport,
// and a "reset layout" affordance restores the CSS defaults. Pointer events → works on touch.

const LS_KEY = 'bc-panels-v3';
const load = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } };
const save = (all) => { try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch { /* quota */ } };

const registry = [];

export function makePanel(el, { handle, key, minW = 200, minH = 140 } = {}) {
  if (!el || el.__panelized || !key) return null;
  el.__panelized = true;
  const all = load();

  const clearAnchors = () => { el.style.right = 'auto'; el.style.bottom = 'auto'; };
  const applyGeom = (g) => {
    if (!g) return;
    if (g.w) { el.style.width = g.w + 'px'; el.style.maxWidth = 'none'; }
    if (g.h) { el.style.height = g.h + 'px'; el.style.maxHeight = 'none'; }
    if (g.left != null && g.top != null) { el.style.left = g.left + 'px'; el.style.top = g.top + 'px'; clearAnchors(); }
  };
  const persist = () => {
    const r = el.getBoundingClientRect();
    all[key] = { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    save(all);
  };
  const entry = { el, key, applySaved: () => applyGeom(load()[key]) };
  registry.push(entry);
  applyGeom(all[key]);

  // ---- drag by the title bar (ignore clicks on real controls). Pointer capture routes all
  // move/up events to the bar even when the cursor leaves it, so the drag can't get "stuck". ----
  const bar = handle || el;
  bar.style.cursor = 'move';
  bar.style.touchAction = 'none';
  bar.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    if (e.target.closest('button, a, input, select, textarea, [id$="-resize"], .panel-resize')) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const offX = e.clientX - r.left, offY = e.clientY - r.top;
    el.style.width = r.width + 'px'; el.style.maxWidth = 'none';
    el.style.left = r.left + 'px'; el.style.top = r.top + 'px'; clearAnchors();
    try { bar.setPointerCapture(e.pointerId); } catch (_) {}
    const move = (ev) => {
      el.style.left = Math.max(2, Math.min(window.innerWidth - 44, ev.clientX - offX)) + 'px';
      el.style.top = Math.max(2, Math.min(window.innerHeight - 34, ev.clientY - offY)) + 'px';
    };
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      persist();
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });

  // ---- resize from a bottom-right corner grip ----
  const grip = document.createElement('div');
  grip.className = 'panel-resize';
  grip.title = 'drag to resize';
  grip.style.cssText =
    'position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:6;touch-action:none;' +
    'background:linear-gradient(135deg,transparent 46%,rgba(255,255,255,.55) 46%,rgba(255,255,255,.55) 54%,transparent 54%,transparent 70%,rgba(255,255,255,.55) 70%,rgba(255,255,255,.55) 78%,transparent 78%)';
  if (getComputedStyle(el).position === 'static') el.style.position = 'fixed';
  el.appendChild(grip);
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const r = el.getBoundingClientRect();
    el.style.maxHeight = 'none'; el.style.maxWidth = 'none'; el.style.left = r.left + 'px'; el.style.top = r.top + 'px'; clearAnchors();
    const sx = e.clientX, sy = e.clientY, sw = r.width, sh = r.height;
    const move = (ev) => {
      el.style.width = Math.max(minW, Math.min(window.innerWidth - r.left - 6, sw + (ev.clientX - sx))) + 'px';
      el.style.height = Math.max(minH, Math.min(window.innerHeight - r.top - 6, sh + (ev.clientY - sy))) + 'px';
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); persist(); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });

  return entry;
}

// Wipe all saved panel geometry and reload so the CSS defaults take over.
export function resetPanelLayout() {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  location.reload();
}
