// Streets page — the merge + move surface. Streets and the cubes on them are the
// shared unit: you merge a street you fully own, and when you can't (someone
// else holds a plot) you move your own cubes out to consolidate elsewhere.
//
// Identity is the "you are" address (auto-filled with the dominant on-chain
// owner until wallet-connect lands): your cubes are green + draggable, everyone
// else's are red blockers. Moves are STAGED locally (orange) and committed in a
// batch via "confirm changes on-chain". Merging lets you pick which cube leads
// the street's art (the selected SVG).
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
  commitBar: document.getElementById('commit-bar'),
  commitSummary: document.getElementById('commit-summary'),
  commitGo: document.getElementById('commit-go'),
  commitDiscard: document.getElementById('commit-discard'),
};

let streets = [];          // [{ street, plots:[8], merged }] from chain
let recIndex = new Map();   // String(cubeId) -> record
let meAddr = '';            // lowercased "you are" address
let pendingMoves = new Map(); // String(cubeId) -> { fromSlot (original), toSlot }
let leadByStreet = new Map(); // street -> String(cubeId) chosen merge leader
let selected = null;        // { type:'street', street } | { type:'cube', street, slot, cubeId }
let pendingAction = null;   // { type:'merge'|'moves', ... }

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const status = (m) => { els.status.textContent = m; };
const isMine = (p) => p && (p.wallet || '').toLowerCase() === meAddr;
const canMergeNow = () => pendingMoves.size === 0;
function svgImg(svg) {
  const img = document.createElement('img');
  img.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
  return img;
}

async function load() {
  status('loading streets…');
  let records = [];
  try {
    const r = await loadChainMintRecords();
    records = (r && r.records) || [];
  } catch (e) {
    status(`load failed: ${String(e?.message || e).slice(0, 80)}`);
    return;
  }

  const byStreet = new Map();
  recIndex = new Map();
  for (const r of records) {
    const street = r.slot >> 3;
    if (!byStreet.has(street)) byStreet.set(street, { street, plots: new Array(8).fill(null), merged: null });
    const s = byStreet.get(street);
    if (r.sourceKindNumber === 3) { s.merged = r; continue; }
    s.plots[r.slot - street * 8] = r;
    recIndex.set(String(r.cubeId), r);
  }
  streets = [...byStreet.values()].sort((a, b) => a.street - b.street);

  // drop any staged move whose cube no longer exists (e.g. after a merge)
  for (const cid of [...pendingMoves.keys()]) if (!recIndex.has(cid)) pendingMoves.delete(cid);

  // "you are": default to the dominant owner so mine/theirs is meaningful with
  // no wallet connected; the user can override the field to act as anyone.
  const counts = new Map();
  for (const r of recIndex.values()) {
    const w = (r.wallet || '').toLowerCase();
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  if (!els.me.value.trim() && dominant) els.me.value = dominant;
  meAddr = (els.me.value.trim() || dominant).toLowerCase();

  render();
}

// Chain positions overlaid with staged moves: slot -> { rec, pending, fromSlot }.
function computeGrid() {
  const grid = new Map();
  for (const s of streets) for (let k = 0; k < 8; k++) {
    const rec = s.plots[k];
    if (rec) grid.set(s.street * 8 + k, { rec, pending: false, fromSlot: null });
  }
  for (const [, mv] of pendingMoves) grid.delete(mv.fromSlot);      // vacate origins
  for (const [cid, mv] of pendingMoves) {                          // place targets
    const rec = recIndex.get(cid);
    if (rec) grid.set(mv.toSlot, { rec, pending: true, fromSlot: mv.fromSlot });
  }
  return grid;
}

function occupantsOf(street, grid) {
  const out = [];
  for (let k = 0; k < 8; k++) {
    const occ = grid.get(street * 8 + k);
    if (occ) out.push({ slot: street * 8 + k, rec: occ.rec, pending: occ.pending });
  }
  return out;
}

function leaderFor(street, occupants) {
  const chosen = leadByStreet.get(street);
  if (chosen && occupants.some((o) => String(o.rec.cubeId) === chosen)) return chosen;
  return null; // auto = lowest occupied plot
}

function render() {
  const grid = computeGrid();
  els.list.replaceChildren();
  status(streets.length ? `${streets.length} street${streets.length === 1 ? '' : 's'} · you: ${short(meAddr)}` : 'no cubes on chain');
  for (const s of streets) els.list.appendChild(streetCard(s, grid));

  els.commitBar.style.display = pendingMoves.size ? 'flex' : 'none';
  els.commitSummary.textContent = `${pendingMoves.size} staged move${pendingMoves.size === 1 ? '' : 's'} — not yet on-chain`;

  restoreSelection(grid);
}

function streetCard(s, grid) {
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

  const occupied = occupantsOf(s.street, grid);
  const theirs = occupied.filter((o) => !isMine(o.rec));
  const mergeable = occupied.length > 0 && theirs.length === 0;

  if (mergeable && canMergeNow()) {
    const btn = document.createElement('button');
    btn.className = 'street-merge';
    btn.textContent = `Merge ${occupied.length} → 1`;
    btn.addEventListener('click', (e) => { e.stopPropagation(); selectStreet(s.street); askMerge(s.street, occupied.length, leaderFor(s.street, occupied)); });
    head.appendChild(btn);
  }
  head.style.cursor = 'pointer';
  head.addEventListener('click', () => selectStreet(s.street));
  card.appendChild(head);

  const elig = document.createElement('div');
  if (occupied.length === 0) {
    elig.className = 'street-meta';
    elig.textContent = 'no cubes here';
  } else if (mergeable && !canMergeNow()) {
    elig.className = 'ineligible';
    elig.textContent = 'confirm your staged moves on-chain before merging';
  } else if (mergeable) {
    elig.className = 'eligible';
    elig.textContent = `you own all ${occupied.length} occupied plot${occupied.length === 1 ? '' : 's'} → mergeable`;
  } else if (occupied.length === theirs.length) {
    elig.className = 'ineligible';
    elig.textContent = `${occupied.length} plot${occupied.length === 1 ? '' : 's'} here, none yours — owned by another wallet`;
  } else {
    elig.className = 'ineligible';
    elig.textContent = `${theirs.length} cube${theirs.length === 1 ? '' : 's'} (red) block the merge — drag your ${occupied.length - theirs.length} out to consolidate`;
  }
  card.appendChild(elig);

  const plots = document.createElement('div');
  plots.className = 'plots';
  plots.style.marginTop = '8px';
  for (let k = 0; k < 8; k++) plots.appendChild(plotCell(s.street, k, grid.get(s.street * 8 + k)));
  card.appendChild(plots);
  return card;
}

function plotCell(street, k, occ) {
  const slot = street * 8 + k;
  const cell = document.createElement('div');
  const tile = document.createElement('div');
  const cap = document.createElement('div');
  cap.className = 'plot-cap';

  if (occ) {
    const p = occ.rec;
    const mine = isMine(p);
    cell.className = 'plot ' + (occ.pending ? 'pending' : (mine ? 'mine' : 'theirs'));
    cell.dataset.cube = String(p.cubeId);
    cell.dataset.slot = String(slot);
    if (selected?.type === 'cube' && String(selected.cubeId) === String(p.cubeId)) cell.classList.add('selected');
    tile.className = 'plot-tile';
    tile.textContent = '…';
    cap.textContent = `#${p.cubeId} · ${occ.pending ? `staged →${slot}` : (mine ? 'you' : short(p.wallet))}`;
    cell.addEventListener('click', () => selectCube(street, p, slot, occ.pending));
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
    tile.textContent = environmentNameForStreet(street);
    cap.textContent = `plot ${slot} · vacant`;
    tile.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; tile.classList.add('drop-ok'); });
    tile.addEventListener('dragleave', () => tile.classList.remove('drop-ok'));
    tile.addEventListener('drop', (e) => {
      e.preventDefault();
      tile.classList.remove('drop-ok');
      let data;
      try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      if (data && Number.isInteger(data.cubeId) && data.fromSlot !== slot) stageMove(data.cubeId, data.fromSlot, slot);
    });
  }

  cell.append(tile, cap);
  return cell;
}

// ---- staged moves ----

function stageMove(cubeId, draggedFrom, toSlot) {
  const key = String(cubeId);
  const existing = pendingMoves.get(key);
  const origFrom = existing ? existing.fromSlot : draggedFrom; // keep the true chain origin
  if (toSlot === origFrom) pendingMoves.delete(key); // dragged back home
  else pendingMoves.set(key, { fromSlot: origFrom, toSlot });
  // keep the moved cube selected so it shows in the preview at its new spot
  selected = { type: 'cube', street: toSlot >> 3, slot: toSlot, cubeId };
  render();
}

// ---- selection + preview ----

function refreshHighlight() {
  for (const card of els.list.children) {
    const isStreetSel = selected?.type === 'street' && card.dataset.street === String(selected.street);
    card.style.boxShadow = isStreetSel ? '0 0 0 1px #ff7dcc, 0 0 14px rgba(255,58,184,0.2)' : '';
    for (const cell of card.querySelectorAll('.plot')) {
      cell.classList.toggle('selected', selected?.type === 'cube' && cell.dataset.cube === String(selected.cubeId));
    }
  }
}

function selectStreet(street) {
  const grid = computeGrid();
  const occupied = occupantsOf(street, grid);
  const theirs = occupied.filter((o) => !isMine(o.rec));
  const mergeable = occupied.length > 0 && theirs.length === 0;
  const chosen = leaderFor(street, occupied);
  const leaderOcc = chosen
    ? occupied.find((o) => String(o.rec.cubeId) === chosen)
    : occupied.slice().sort((a, b) => a.slot - b.slot)[0];
  selected = { type: 'street', street };
  refreshHighlight();

  els.preview.style.display = 'block';
  els.prevTitle.textContent = `Merge preview — Street #${street}`;
  els.prevMerge.style.display = '';
  if (mergeable && canMergeNow()) {
    els.prevState.className = 'eligible';
    els.prevState.textContent = `eligible · you own all ${occupied.length} plot${occupied.length === 1 ? '' : 's'}${chosen ? ' · custom lead' : ''}`;
    els.prevMerge.disabled = false;
    els.prevMerge.textContent = `Merge ${occupied.length} → 1`;
    els.prevMerge.onclick = () => askMerge(street, occupied.length, leaderFor(street, occupied));
  } else {
    els.prevState.className = 'ineligible';
    els.prevState.textContent = occupied.length === 0
      ? 'unable to merge · no cubes on this street'
      : (!canMergeNow() ? 'confirm staged moves first' : `unable to merge · ${theirs.length} cube${theirs.length === 1 ? '' : 's'} owned by another wallet`);
    els.prevMerge.disabled = true;
    els.prevMerge.textContent = 'Merge → 1';
    els.prevMerge.onclick = null;
  }

  showSvg(leaderOcc ? leaderOcc.rec.cubeId : null);
  show3d(street, occupied);
}

// A single-cube selection: bright border, that cube in the preview, and (if it's
// yours on a mergeable street) it becomes the merge lead — its SVG drives the
// street token.
function selectCube(street, p, slot, pending) {
  const mine = isMine(p);
  if (mine) leadByStreet.set(street, String(p.cubeId));
  selected = { type: 'cube', street, slot, cubeId: p.cubeId };
  refreshHighlight();

  const grid = computeGrid();
  const occupied = occupantsOf(street, grid);
  const theirs = occupied.filter((o) => !isMine(o.rec));
  const mergeable = occupied.length > 0 && theirs.length === 0;

  els.preview.style.display = 'block';
  els.prevTitle.textContent = `Cube #${p.cubeId} — plot ${slot} · street ${street}`;
  if (mine && mergeable && canMergeNow()) {
    els.prevState.className = 'eligible';
    els.prevState.textContent = 'this cube will lead the merged street';
    els.prevMerge.style.display = '';
    els.prevMerge.disabled = false;
    els.prevMerge.textContent = `Merge street #${street} · this lead`;
    els.prevMerge.onclick = () => askMerge(street, occupied.length, p.cubeId);
  } else {
    els.prevMerge.style.display = 'none';
    if (pending) { els.prevState.className = 'ineligible'; els.prevState.textContent = `staged move → plot ${slot} (unconfirmed)`; }
    else if (mine) { els.prevState.className = 'eligible'; els.prevState.textContent = 'yours · drag onto a vacant plot to move'; }
    else { els.prevState.className = 'ineligible'; els.prevState.textContent = `owned by ${short(p.wallet)} · blocks merge on street ${street}`; }
  }

  showSvg(p.cubeId);
  show3d(street, [{ slot, rec: p }]);
}

function showSvg(cubeId) {
  els.prevSvg.textContent = cubeId == null ? 'no occupied plots' : '…';
  if (cubeId == null) return;
  cubeThumbnailSVG(cubeId)
    .then((svg) => { if (selected && svg && svg.includes('<svg')) els.prevSvg.replaceChildren(svgImg(svg)); })
    .catch(() => { els.prevSvg.textContent = 'err'; });
}

function show3d(street, occ) {
  if (!occ.length) { els.prevFrame.removeAttribute('src'); return; }
  const plots = occ.map((o) => ({ slot: o.slot, src: Number(o.rec.source.tokenId), seed: o.rec.seed }));
  els.prevFrame.src = `/viewer/street-preview.html?street=${street}&plots=${encodeURIComponent(JSON.stringify(plots))}`;
}

function hidePreview() {
  selected = null;
  refreshHighlight();
  els.preview.style.display = 'none';
  els.prevFrame.removeAttribute('src');
}

function restoreSelection(grid) {
  if (selected?.type === 'street') {
    const s = streets.find((x) => x.street === selected.street);
    if (s && !s.merged) selectStreet(selected.street); else hidePreview();
  } else if (selected?.type === 'cube') {
    for (const [slot, occ] of grid) {
      if (String(occ.rec.cubeId) === String(selected.cubeId)) { selectCube(slot >> 3, occ.rec, slot, occ.pending); return; }
    }
    hidePreview();
  } else {
    hidePreview();
  }
}

// ---- confirm + commit (merge / batched moves share the modal) ----

function askMerge(street, count, leaderCubeId) {
  pendingAction = { type: 'merge', street, leaderCubeId: leaderCubeId ? Number(leaderCubeId) : 0 };
  els.confirmTitle.textContent = 'Merge this street?';
  const leadNote = leaderCubeId ? ` Cube #${leaderCubeId} leads the street art.` : '';
  els.confirmText.textContent =
    `Street ${street}: burn ${count} cube${count === 1 ? '' : 's'} into a single street token.${leadNote} Irreversible.`;
  els.confirmGo.textContent = 'Merge · LFG';
  els.overlay.style.display = 'flex';
}

function askConfirmMoves() {
  if (!pendingMoves.size) return;
  pendingAction = { type: 'moves' };
  els.confirmTitle.textContent = 'Confirm changes on-chain?';
  els.confirmText.textContent =
    `Apply ${pendingMoves.size} move${pendingMoves.size === 1 ? '' : 's'} on-chain. This is irreversible — are you sure?`;
  els.confirmGo.textContent = 'Confirm · LFG';
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
      await mergeStreet({ street: a.street, owner: meAddr, leaderCubeId: a.leaderCubeId });
      leadByStreet.delete(a.street);
      status(`street ${a.street} merged into a street token`);
      await load();
    } else {
      const entries = [...pendingMoves.entries()];
      let done = 0;
      for (const [key, mv] of entries) {
        status(`moving cube #${key} → plot ${mv.toSlot} (${done + 1}/${entries.length})…`);
        await moveCube({ cubeId: Number(key), owner: meAddr, newSlot: mv.toSlot });
        pendingMoves.delete(key);
        done++;
      }
      status(`${done} move${done === 1 ? '' : 's'} committed`);
      await load();
    }
  } catch (e) {
    console.error(`[streets] ${a.type} failed`, e);
    status(`${a.type} failed: ${String(e?.message || e).slice(0, 80)}`);
    await load(); // resync; any moves that landed are now on-chain, rest stay staged
  }
}

els.reload.addEventListener('click', load);
els.me.addEventListener('change', load);
els.prevClose.addEventListener('click', hidePreview);
els.confirmCancel.addEventListener('click', closeModal);
els.confirmGo.addEventListener('click', doConfirm);
els.overlay.addEventListener('click', (e) => { if (e.target === els.overlay) closeModal(); });
els.commitGo.addEventListener('click', askConfirmMoves);
els.commitDiscard.addEventListener('click', () => { pendingMoves.clear(); render(); });

load();
