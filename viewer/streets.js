// Streets page — the merge + move surface. Streets and the cubes on them are the
// shared unit: you merge a street you fully own, and when you can't (someone
// else holds a plot) you move your own cubes out to consolidate elsewhere.
// Identity is the "you are" address (auto-filled with the dominant on-chain
// owner until wallet-connect lands): your cubes are draggable + mergeable,
// everyone else's show muted dark-red as the blockers.
import { loadChainMintRecords } from './chain-cubes.js';
import { cubeThumbnailSVG, mergeStreet, moveCube } from './preview-chain.js';
import { environmentNameForStreet } from '/core/cube-env.js';

const els = {
  list: document.getElementById('streets'),
  status: document.getElementById('status'),
  reload: document.getElementById('reload'),
  me: document.getElementById('me'),
  overlay: document.getElementById('confirm-overlay'),
  confirmTitle: document.getElementById('confirm-title'),
  confirmText: document.getElementById('confirm-text'),
  confirmCancel: document.getElementById('confirm-cancel'),
  confirmGo: document.getElementById('confirm-go'),
  preview: document.getElementById('preview'),
  prevTitle: document.getElementById('prev-title'),
  prevState: document.getElementById('prev-state'),
  prevMerge: document.getElementById('prev-merge'),
  prevClose: document.getElementById('prev-close'),
  prevSvg: document.getElementById('prev-svg-stage'),
  prevFrame: document.getElementById('prev-frame'),
};

let streets = [];       // [{ street, plots:[8], merged }]
let meAddr = '';        // lowercased "you are" address
let selected = null;    // { type:'street', street } | { type:'cube', street, slot, cubeId }
let pendingAction = null; // { type:'merge', street, owner } | { type:'move', cubeId, fromSlot, toSlot, owner }

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const status = (m) => { els.status.textContent = m; };
const isMine = (p) => p && (p.wallet || '').toLowerCase() === meAddr;
function svgImg(svg) {
  const img = document.createElement('img');
  img.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
  return img;
}

async function load() {
  status('loading streets…');
  els.list.replaceChildren();
  let records = [];
  try {
    const r = await loadChainMintRecords();
    records = (r && r.records) || [];
  } catch (e) {
    status(`load failed: ${String(e?.message || e).slice(0, 80)}`);
    return;
  }

  const byStreet = new Map();
  for (const r of records) {
    const street = r.slot >> 3;
    if (!byStreet.has(street)) byStreet.set(street, { street, plots: new Array(8).fill(null), merged: null });
    const s = byStreet.get(street);
    if (r.sourceKindNumber === 3) s.merged = r; // merged-street token
    else s.plots[r.slot - street * 8] = r;
  }
  streets = [...byStreet.values()].sort((a, b) => a.street - b.street);

  // "you are": default to the dominant owner so mine/theirs is meaningful with
  // no wallet connected; the user can override the field to act as anyone.
  const counts = new Map();
  for (const s of streets) for (const p of s.plots) if (p) {
    const w = (p.wallet || '').toLowerCase();
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  if (!els.me.value.trim() && dominant) els.me.value = dominant;
  meAddr = (els.me.value.trim() || dominant).toLowerCase();

  status(streets.length ? `${streets.length} street${streets.length === 1 ? '' : 's'} · you: ${short(meAddr)}` : 'no cubes on chain');
  for (const s of streets) els.list.appendChild(streetCard(s));

  restoreSelection();
}

function streetCard(s) {
  const card = document.createElement('div');
  card.className = 'street' + (s.merged ? ' merged' : '');
  card.dataset.street = String(s.street);

  const head = document.createElement('div');
  head.className = 'street-head';
  const title = document.createElement('span');
  title.className = 'street-title';
  title.textContent = `Street #${s.street}`;
  const meta = document.createElement('span');
  meta.className = 'street-meta';
  meta.textContent = `${environmentNameForStreet(s.street)} · region ${s.street >> 6} · n'hood ${s.street >> 3}`;
  head.append(title, meta);

  if (s.merged) {
    const badge = document.createElement('span');
    badge.className = 'merged-badge street-merge';
    badge.textContent = 'MERGED STREET TOKEN';
    head.appendChild(badge);
    card.appendChild(head);

    const block = document.createElement('div');
    block.className = 'merged-block';
    const tile = document.createElement('div');
    tile.className = 'merged-tile';
    tile.textContent = '…';
    const info = document.createElement('div');
    info.innerHTML =
      `<div style="font-size:12px;color:#e2e2e8">Cube #${s.merged.cubeId}</div>` +
      `<div style="font-size:11px;color:#8f8f98">one token · all 8 plots locked</div>`;
    block.append(tile, info);
    card.appendChild(block);
    cubeThumbnailSVG(s.merged.cubeId)
      .then((svg) => { if (svg && svg.includes('<svg')) tile.replaceChildren(svgImg(svg)); })
      .catch(() => { tile.textContent = 'err'; });
    return card;
  }

  const occupied = s.plots.filter(Boolean);
  const mine = occupied.filter(isMine);
  const theirs = occupied.filter((p) => !isMine(p));
  const mergeable = occupied.length > 0 && theirs.length === 0;

  if (mergeable) {
    const btn = document.createElement('button');
    btn.className = 'street-merge';
    btn.textContent = `Merge ${occupied.length} → 1`;
    btn.addEventListener('click', (e) => { e.stopPropagation(); selectStreet(s); askMerge(s.street, meAddr, occupied.length); });
    head.appendChild(btn);
  }
  head.style.cursor = 'pointer';
  head.addEventListener('click', () => selectStreet(s));
  card.appendChild(head);

  const elig = document.createElement('div');
  if (mergeable) {
    elig.className = 'eligible';
    elig.textContent = `you own all ${occupied.length} occupied plot${occupied.length === 1 ? '' : 's'} → mergeable`;
  } else if (occupied.length === 0) {
    elig.className = 'street-meta';
    elig.textContent = 'no cubes here';
  } else if (mine.length === 0) {
    elig.className = 'ineligible';
    elig.textContent = `${occupied.length} plot${occupied.length === 1 ? '' : 's'} here, none yours — owned by another wallet`;
  } else {
    elig.className = 'ineligible';
    elig.textContent = `${theirs.length} cube${theirs.length === 1 ? '' : 's'} (dark red) block the merge — drag your ${mine.length} out to consolidate, or acquire theirs`;
  }
  card.appendChild(elig);

  const plots = document.createElement('div');
  plots.className = 'plots';
  plots.style.marginTop = '8px';
  for (let k = 0; k < 8; k++) {
    plots.appendChild(plotCell(s, k, s.plots[k]));
  }
  card.appendChild(plots);
  return card;
}

function plotCell(s, k, p) {
  const slot = s.street * 8 + k;
  const cell = document.createElement('div');
  const tile = document.createElement('div');
  const cap = document.createElement('div');
  cap.className = 'plot-cap';

  if (p) {
    const mine = isMine(p);
    cell.className = 'plot' + (mine ? ' mine' : ' theirs');
    cell.dataset.cube = String(p.cubeId);
    cell.dataset.slot = String(slot);
    if (selected?.type === 'cube' && String(selected.cubeId) === String(p.cubeId)) cell.classList.add('selected');
    tile.className = 'plot-tile';
    tile.textContent = '…';
    cap.textContent = `#${p.cubeId} · ${mine ? 'you' : short(p.wallet)}`;
    cell.addEventListener('click', () => selectCube(s, p, slot));
    cubeThumbnailSVG(p.cubeId)
      .then((svg) => { if (svg && svg.includes('<svg')) tile.replaceChildren(svgImg(svg)); })
      .catch(() => { tile.textContent = 'err'; });

    if (mine) {
      tile.draggable = true;
      tile.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify({ cubeId: Number(p.cubeId), fromSlot: slot }));
        document.body.classList.add('dragging');
      });
      tile.addEventListener('dragend', () => {
        document.body.classList.remove('dragging');
        for (const t of els.list.querySelectorAll('.drop-ok')) t.classList.remove('drop-ok');
      });
    }
  } else {
    cell.className = 'plot';
    cell.dataset.slot = String(slot);
    tile.className = 'plot-tile vacant';
    tile.textContent = environmentNameForStreet(s.street);
    cap.textContent = `plot ${slot} · vacant`;
    // drop target: move a dragged cube here
    tile.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; tile.classList.add('drop-ok'); });
    tile.addEventListener('dragleave', () => tile.classList.remove('drop-ok'));
    tile.addEventListener('drop', (e) => {
      e.preventDefault();
      tile.classList.remove('drop-ok');
      let data;
      try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      if (data && Number.isInteger(data.cubeId) && data.fromSlot !== slot) askMove(data.cubeId, data.fromSlot, slot);
    });
  }

  cell.append(tile, cap);
  return cell;
}

// ---- selection + preview ----

function refreshHighlight() {
  for (const card of els.list.children) {
    const isStreetSel = selected?.type === 'street' && card.dataset.street === String(selected.street);
    card.style.boxShadow = isStreetSel ? '0 0 0 1px #ff7dcc, 0 0 14px rgba(255,58,184,0.2)' : '';
    for (const cell of card.querySelectorAll('.plot')) {
      const on = selected?.type === 'cube' && cell.dataset.cube === String(selected.cubeId);
      cell.classList.toggle('selected', on);
    }
  }
}

// A street selection previews the *merged* result: leader (lowest occupied plot)
// SVG + a 3D render of the whole street, plus eligibility.
function selectStreet(s) {
  const occupied = s.plots.filter(Boolean);
  const theirs = occupied.filter((p) => !isMine(p));
  const mergeable = occupied.length > 0 && theirs.length === 0;
  const leader = occupied.slice().sort((a, b) => a.slot - b.slot)[0] || null;
  selected = { type: 'street', street: s.street };
  refreshHighlight();

  els.preview.style.display = 'block';
  els.prevTitle.textContent = `Merge preview — Street #${s.street}`;
  els.prevMerge.style.display = '';
  if (mergeable) {
    els.prevState.className = 'eligible';
    els.prevState.textContent = `eligible · you own all ${occupied.length} occupied plot${occupied.length === 1 ? '' : 's'}`;
    els.prevMerge.disabled = false;
    els.prevMerge.textContent = `Merge ${occupied.length} → 1`;
    els.prevMerge.onclick = () => askMerge(s.street, meAddr, occupied.length);
  } else {
    els.prevState.className = 'ineligible';
    els.prevState.textContent = occupied.length === 0
      ? 'unable to merge · no cubes on this street'
      : `unable to merge · ${theirs.length} cube${theirs.length === 1 ? '' : 's'} owned by another wallet`;
    els.prevMerge.disabled = true;
    els.prevMerge.textContent = 'Merge → 1';
    els.prevMerge.onclick = null;
  }

  showSvg(leader ? leader.cubeId : null);
  show3d(s.street, occupied);
}

// A single-cube selection: bright border + that cube in the preview (and, if
// yours, the reminder you can drag it to move).
function selectCube(s, p, slot) {
  selected = { type: 'cube', street: s.street, slot, cubeId: p.cubeId };
  refreshHighlight();

  els.preview.style.display = 'block';
  els.prevTitle.textContent = `Cube #${p.cubeId} — plot ${slot} · street ${s.street}`;
  els.prevMerge.style.display = 'none';
  if (isMine(p)) {
    els.prevState.className = 'eligible';
    els.prevState.textContent = 'yours · drag onto a vacant plot to move';
  } else {
    els.prevState.className = 'ineligible';
    els.prevState.textContent = `owned by ${short(p.wallet)} · blocks merge on street ${s.street}`;
  }

  showSvg(p.cubeId);
  show3d(s.street, [p]);
}

function showSvg(cubeId) {
  els.prevSvg.textContent = cubeId == null ? 'no occupied plots' : '…';
  if (cubeId == null) return;
  const want = cubeId;
  cubeThumbnailSVG(cubeId)
    .then((svg) => { if (selected && svg && svg.includes('<svg')) els.prevSvg.replaceChildren(svgImg(svg)); })
    .catch(() => { els.prevSvg.textContent = 'err'; });
}

function show3d(street, occupiedPlots) {
  if (!occupiedPlots.length) { els.prevFrame.removeAttribute('src'); return; }
  const plots = occupiedPlots.map((p) => ({ slot: p.slot, src: Number(p.source.tokenId), seed: p.seed }));
  els.prevFrame.src = `/viewer/street-preview.html?street=${street}&plots=${encodeURIComponent(JSON.stringify(plots))}`;
}

function hidePreview() {
  selected = null;
  refreshHighlight();
  els.preview.style.display = 'none';
  els.prevFrame.removeAttribute('src');
}

function restoreSelection() {
  if (selected?.type === 'street') {
    const s = streets.find((x) => x.street === selected.street);
    if (s && !s.merged) selectStreet(s); else hidePreview();
  } else if (selected?.type === 'cube') {
    for (const s of streets) {
      const k = s.plots.findIndex((p) => p && String(p.cubeId) === String(selected.cubeId));
      if (k >= 0) { selectCube(s, s.plots[k], s.street * 8 + k); return; }
    }
    hidePreview();
  } else {
    hidePreview();
  }
}

// ---- confirm + commit (merge / move share the modal) ----

function askMerge(street, owner, count) {
  pendingAction = { type: 'merge', street, owner };
  els.confirmTitle.textContent = 'Merge this street?';
  els.confirmText.textContent = `Street ${street}: burn ${count} cube${count === 1 ? '' : 's'} into a single street token. Irreversible.`;
  els.confirmGo.textContent = 'Merge · LFG';
  els.overlay.style.display = 'flex';
}

function askMove(cubeId, fromSlot, toSlot) {
  pendingAction = { type: 'move', cubeId, fromSlot, toSlot, owner: meAddr };
  els.confirmTitle.textContent = 'Move this cube?';
  els.confirmText.textContent =
    `Move cube #${cubeId} from plot ${fromSlot} (street ${fromSlot >> 3}) → plot ${toSlot} (street ${toSlot >> 3}).`;
  els.confirmGo.textContent = 'Move · LFG';
  els.overlay.style.display = 'flex';
}

function closeModal() { pendingAction = null; els.overlay.style.display = 'none'; }

async function doConfirm() {
  if (!pendingAction) return;
  const a = pendingAction;
  pendingAction = null;
  els.overlay.style.display = 'none';
  try {
    if (a.type === 'merge') {
      status(`merging street ${a.street}…`);
      await mergeStreet({ street: a.street, owner: a.owner });
      status(`street ${a.street} merged into a street token`);
    } else {
      status(`moving cube #${a.cubeId} → plot ${a.toSlot}…`);
      await moveCube({ cubeId: a.cubeId, owner: a.owner, newSlot: a.toSlot });
      // follow the cube so it stays selected at its new plot
      selected = { type: 'cube', street: a.toSlot >> 3, slot: a.toSlot, cubeId: a.cubeId };
      status(`cube #${a.cubeId} moved to plot ${a.toSlot}`);
    }
    await load();
  } catch (e) {
    console.error(`[streets] ${a.type} failed`, e);
    status(`${a.type} failed: ${String(e?.message || e).slice(0, 80)}`);
  }
}

els.reload.addEventListener('click', load);
els.me.addEventListener('change', load);
els.prevClose.addEventListener('click', hidePreview);
els.confirmCancel.addEventListener('click', closeModal);
els.confirmGo.addEventListener('click', doConfirm);
els.overlay.addEventListener('click', (e) => { if (e.target === els.overlay) closeModal(); });

load();
