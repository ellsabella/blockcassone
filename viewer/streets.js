// Streets page — street-centric merge surface. Groups all on-chain cubes by
// street, shows each street's 8 plots + merge eligibility, and renders merged
// streets distinctly. Merge burns a street's cubes into one street token.
import { loadChainMintRecords } from './chain-cubes.js';
import { cubeThumbnailSVG, mergeStreet } from './preview-chain.js';
import { environmentNameForStreet } from '/core/cube-env.js';

const els = {
  list: document.getElementById('streets'),
  status: document.getElementById('status'),
  reload: document.getElementById('reload'),
  overlay: document.getElementById('confirm-overlay'),
  confirmText: document.getElementById('confirm-text'),
  confirmCancel: document.getElementById('confirm-cancel'),
  confirmGo: document.getElementById('confirm-go'),
};

let pendingMerge = null; // { street, owner }

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const status = (m) => { els.status.textContent = m; };
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
  const streets = [...byStreet.values()].sort((a, b) => a.street - b.street);
  status(streets.length ? `${streets.length} street${streets.length === 1 ? '' : 's'}` : 'no cubes on chain');
  for (const s of streets) els.list.appendChild(streetCard(s));
}

function streetCard(s) {
  const card = document.createElement('div');
  card.className = 'street' + (s.merged ? ' merged' : '');

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
  const owners = [...new Set(occupied.map((p) => (p.wallet || '').toLowerCase()))];
  const mergeable = occupied.length > 0 && owners.length === 1;

  if (mergeable) {
    const btn = document.createElement('button');
    btn.className = 'street-merge';
    btn.textContent = `Merge ${occupied.length} → 1`;
    btn.addEventListener('click', () => askMerge(s.street, occupied[0].wallet, occupied.length));
    head.appendChild(btn);
  }
  card.appendChild(head);

  const elig = document.createElement('div');
  if (mergeable) {
    elig.className = 'eligible';
    elig.textContent = `you own all ${occupied.length} occupied plot${occupied.length === 1 ? '' : 's'} → mergeable (${short(owners[0])})`;
  } else if (occupied.length === 0) {
    elig.className = 'street-meta';
    elig.textContent = 'no cubes here';
  } else {
    elig.className = 'ineligible';
    elig.textContent = `${occupied.length} occupied across ${owners.length} owners — consolidate (move/buy the rest) before merging`;
  }
  card.appendChild(elig);

  const plots = document.createElement('div');
  plots.className = 'plots';
  plots.style.marginTop = '8px';
  for (let k = 0; k < 8; k++) {
    const p = s.plots[k];
    const cell = document.createElement('div');
    cell.className = 'plot';
    const tile = document.createElement('div');
    const cap = document.createElement('div');
    cap.className = 'plot-cap';
    if (p) {
      tile.className = 'plot-tile';
      tile.textContent = '…';
      if (owners.length > 1 && (p.wallet || '').toLowerCase() !== owners[0]) cell.classList.add('theirs');
      cap.textContent = `#${p.cubeId} · ${short(p.wallet)}`;
      cubeThumbnailSVG(p.cubeId)
        .then((svg) => { if (svg && svg.includes('<svg')) tile.replaceChildren(svgImg(svg)); })
        .catch(() => { tile.textContent = 'err'; });
    } else {
      tile.className = 'plot-tile vacant';
      tile.textContent = environmentNameForStreet(s.street);
      cap.textContent = `plot ${s.street * 8 + k} · vacant`;
    }
    cell.append(tile, cap);
    plots.appendChild(cell);
  }
  card.appendChild(plots);
  return card;
}

function askMerge(street, owner, count) {
  pendingMerge = { street, owner };
  els.confirmText.textContent =
    `Street ${street}: burn ${count} cube${count === 1 ? '' : 's'} into a single street token. Irreversible.`;
  els.overlay.style.display = 'flex';
}

async function doMerge() {
  if (!pendingMerge) return;
  const { street, owner } = pendingMerge;
  pendingMerge = null;
  els.overlay.style.display = 'none';
  status(`merging street ${street}…`);
  try {
    await mergeStreet({ street, owner });
    status(`street ${street} merged into a street token`);
    await load();
  } catch (e) {
    console.error('[streets] merge failed', e);
    status(`merge failed: ${String(e?.message || e).slice(0, 80)}`);
  }
}

els.reload.addEventListener('click', load);
els.confirmCancel.addEventListener('click', () => { pendingMerge = null; els.overlay.style.display = 'none'; });
els.confirmGo.addEventListener('click', doMerge);
els.overlay.addEventListener('click', (e) => { if (e.target === els.overlay) { pendingMerge = null; els.overlay.style.display = 'none'; } });

load();
