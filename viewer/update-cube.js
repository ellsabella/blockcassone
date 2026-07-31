// Update Cube page — slice 1: wallet art browser.
// Loads a wallet's NFTs (metadata across chains, all at once — cheap JSON), then
// pages the LIST 50 at a time and only renders <img> for the visible page, so we
// never ask OpenSea for thousands of images up front. Selection drives the two
// preview panels (cube + SVG); those previews and the owned-cube + commit flow
// are wired in later slices.

import { loadWalletNftsAcrossChains } from './wallet-nfts.js';
import { imageUrlToBinaryGrid, gridToTonalPayload } from './nft-art-grid.js';
import { previewThumbnailSVG, cubeThumbnailSVG, loadOwnedCubes, customizeCube, moveCube, setTransactionSender } from './preview-chain.js';
import { mountConnectButton, sendTransaction as walletSend, account as walletAccount } from './wallet.js';

const PAGE_SIZE = 50;
// Until a target cube is picked (slice 4) the SVG preview renders on a *demo* cube.
// Colour is slot-derived (unique axis), so vary the slot per item rather than
// locking one hue — the real colour will be the target cube's once one is chosen.
const demoSlotFor = (tokenId) => Number(safeBig(tokenId) % 4096n);

const els = {
  addr: document.getElementById('wallet-addr'),
  connect: document.getElementById('wallet-connect'),
  load: document.getElementById('wallet-load'),
  status: document.getElementById('wallet-status'),
  list: document.getElementById('wallet-list'),
  prev: document.getElementById('wallet-prev'),
  next: document.getElementById('wallet-next'),
  page: document.getElementById('wallet-page'),
  stageSvg: document.getElementById('stage-svg'),
  cubeFrame: document.getElementById('cube-frame'),
  cubeEmpty: document.getElementById('cube-empty'),
  ownedList: document.getElementById('owned-list'),
  ownedEmpty: document.getElementById('owned-empty'),
  ownedActions: document.getElementById('owned-actions'),
  moveSlot: document.getElementById('move-slot'),
  moveBtn: document.getElementById('move-btn'),
  updateBtn: document.getElementById('update-btn'),
  overlay: document.getElementById('confirm-overlay'),
  confirmCancel: document.getElementById('confirm-cancel'),
  confirmLfg: document.getElementById('confirm-lfg'),
};

const state = {
  nfts: [],
  page: 0,
  selectedKey: null, // contract:tokenId of selected wallet art
  selectedNft: null, // the selected wallet art
  ownedCubes: [], // cubes on the local chain (candidate targets)
  target: null, // the owned cube chosen to overwrite { cubeId, seed, slot, owner }
  payload: null, // flattened 400-byte tonal payload of the selected art (for commit)
};

const keyOf = (n) => `${n.chain}:${n.contract}:${n.tokenId}`;
const pageCount = () => Math.max(1, Math.ceil(state.nfts.length / PAGE_SIZE));

function setStatus(msg) { els.status.textContent = msg; }

async function loadWallet() {
  const addr = els.addr.value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) { setStatus('enter a valid 0x address'); return; }
  els.load.disabled = true;
  setStatus('loading…');
  els.list.innerHTML = '<div class="preview-empty" style="padding:16px">Loading wallet…</div>';
  try {
    const result = await loadWalletNftsAcrossChains(addr);
    state.nfts = result.nfts || [];
    state.page = 0;
    state.selectedKey = null;
    const errs = Object.keys(result.chainErrors || {});
    setStatus(`${state.nfts.length} items${errs.length ? ` · ${errs.join(',')} failed` : ''}`);
    renderList();
  } catch (err) {
    setStatus(`error: ${String(err?.message || err).slice(0, 60)}`);
    els.list.innerHTML = `<div class="preview-empty" style="padding:16px;color:#ff7d7d">${String(err?.message || err)}</div>`;
  } finally {
    els.load.disabled = false;
  }
}

function renderList() {
  const total = state.nfts.length;
  if (total === 0) {
    els.list.innerHTML = '<div class="preview-empty" style="padding:16px">No artwork found in this wallet.</div>';
    els.page.textContent = '—';
    els.prev.disabled = els.next.disabled = true;
    return;
  }
  const start = state.page * PAGE_SIZE;
  const slice = state.nfts.slice(start, start + PAGE_SIZE);

  const frag = document.createDocumentFragment();
  for (const nft of slice) {
    const row = document.createElement('div');
    row.className = 'wallet-item';
    const key = keyOf(nft);
    if (key === state.selectedKey) row.classList.add('selected');
    row.dataset.key = key;

    const img = document.createElement('img');
    img.className = 'wallet-thumb';
    img.loading = 'lazy';
    img.alt = '';
    if (nft.imageUrl) img.src = nft.imageUrl; // only the visible page renders -> images load 50 at a time
    img.onerror = () => { img.style.visibility = 'hidden'; };

    const meta = document.createElement('div');
    meta.className = 'wallet-meta';
    const name = document.createElement('div');
    name.className = 'wallet-name';
    name.textContent = nft.name || `#${nft.tokenId}`;
    const sub = document.createElement('div');
    sub.className = 'wallet-sub';
    sub.textContent = `${nft.chain} · ${nft.collection || 'unknown'} · #${nft.tokenId}`;
    meta.append(name, sub);

    row.append(img, meta);
    row.addEventListener('click', () => selectNft(nft));
    frag.appendChild(row);
  }
  els.list.replaceChildren(frag);
  els.list.scrollTop = 0;

  els.page.textContent = `${state.page + 1} / ${pageCount()}  ·  ${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total}`;
  els.prev.disabled = state.page === 0;
  els.next.disabled = state.page >= pageCount() - 1;
}

let previewToken = 0;

// Seed + slot the preview renders on: the chosen target cube's identity once one
// is picked (a true "after" preview), else a demo cube derived from the art.
function previewIdentity(nft) {
  if (state.target) return { seed: state.target.seed, slot: Number(state.target.slot) };
  return { seed: '0x' + safeBig(nft.tokenId).toString(16).padStart(64, '0'), slot: demoSlotFor(nft.tokenId) };
}

async function selectNft(nft) {
  state.selectedKey = keyOf(nft);
  state.selectedNft = nft;
  state.payload = null; // cleared until the new art finishes flattening
  for (const row of els.list.querySelectorAll('.wallet-item')) {
    row.classList.toggle('selected', row.dataset.key === state.selectedKey);
  }
  refreshCommitState();
  await renderPreviews();
}

async function renderPreviews() {
  const nft = state.selectedNft;
  if (!nft) return;
  const token = ++previewToken; // guard against out-of-order results on rapid clicks
  if (!nft.imageUrl) {
    showCubeEmpty('no image for this item');
    els.stageSvg.innerHTML = '<span class="preview-empty">no image for this item</span>';
    return;
  }
  const { seed, slot } = previewIdentity(nft);

  // Cube view: the dev-only preview iframe fetches + flattens the art and renders
  // the real 3D non-Normie cube via the token-renderer pipeline.
  showCubeFrame(nft, seed, slot);

  // SVG view: flatten here for the authoritative on-chain preview eth_call.
  els.stageSvg.innerHTML = '<span class="preview-empty">rendering on-chain…</span>';
  let payload;
  try {
    const grid = await imageUrlToBinaryGrid(nft.imageUrl);
    if (token !== previewToken) return;
    payload = gridToTonalPayload(grid);
    state.payload = payload; // reused by the commit
  } catch (err) {
    if (token !== previewToken) return;
    stageError(els.stageSvg, `flatten failed: ${msg(err)}`);
    return;
  }
  try {
    const svg = await previewThumbnailSVG({ seed, slot, sourceTokenId: safeBig(nft.tokenId), payload });
    if (token !== previewToken) return;
    if (svg && svg.includes('<svg')) {
      els.stageSvg.replaceChildren(svgToImg(svg));
      resetSvgZoom();
    } else {
      els.stageSvg.innerHTML = '<span class="preview-empty">empty SVG returned</span>';
    }
  } catch (err) {
    if (token !== previewToken) return;
    stageError(els.stageSvg, `SVG preview failed: ${msg(err)}`);
  }
}

function showCubeFrame(nft, seed, slot) {
  const q = new URLSearchParams({ art: nft.imageUrl, slot: String(slot), seed, src: String(nft.tokenId), ca: nft.contract || '' });
  els.cubeEmpty.style.display = 'none';
  els.cubeFrame.style.display = 'block';
  els.cubeFrame.src = '/viewer/cube-preview.html?' + q.toString();
}

function showCubeEmpty(text) {
  els.cubeFrame.style.display = 'none';
  els.cubeFrame.removeAttribute('src');
  els.cubeEmpty.textContent = text;
  els.cubeEmpty.style.display = '';
}

// Render an on-chain SVG as an <img> data-URI. Inline SVGs share element IDs
// (#n/#o/#g …), so multiple in one document cross-reference each other; an <img>
// isolates each one's IDs (and still zooms via CSS transform).
function svgToImg(svg) {
  const img = document.createElement('img');
  img.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
  img.alt = '';
  return img;
}

function safeBig(v) { try { return BigInt(v); } catch { return 0n; } }
function msg(err) { return String(err?.message || err).slice(0, 90); }
function stageError(stage, text) {
  stage.innerHTML = `<span class="preview-empty" style="color:#ff9a9a;padding:10px;text-align:center">${text}</span>`;
}

// --- Cubes you already own (local chain) -----------------------------------
async function loadOwned() {
  console.error('[update-cube] loadOwned: reading local-chain cubes…');
  els.ownedEmpty.textContent = 'loading your cubes…';
  els.ownedEmpty.style.display = '';
  try {
    state.ownedCubes = await loadOwnedCubes(); // all local cubes (dev); prod filters by wallet
    console.error('[update-cube] owned cubes loaded:', state.ownedCubes.length, state.ownedCubes);
    renderOwned();
  } catch (err) {
    console.error('[update-cube] loadOwned FAILED:', err);
    els.ownedList.querySelectorAll('.owned-card').forEach(c => c.remove());
    els.ownedEmpty.textContent = `couldn't load cubes: ${msg(err)}`;
    els.ownedEmpty.style.display = '';
  }
}

function renderOwned() {
  els.ownedList.querySelectorAll('.owned-card').forEach(c => c.remove());
  // (Re)rendering replaces the cards, so any prior selection is gone.
  state.target = null;
  els.moveBtn.disabled = true;
  refreshCommitState();
  if (!state.ownedCubes.length) {
    els.ownedEmpty.textContent = 'no cubes owned';
    els.ownedEmpty.style.display = '';
    els.ownedActions.style.display = 'none';
    return;
  }
  els.ownedEmpty.style.display = 'none';
  els.ownedActions.style.display = 'flex';
  const frag = document.createDocumentFragment();
  for (const cube of state.ownedCubes) {
    const card = document.createElement('div');
    card.className = 'owned-card';
    card.dataset.cubeId = String(cube.cubeId);
    const tile = document.createElement('div');
    tile.className = 'owned-tile';
    tile.innerHTML = '<span class="preview-empty" style="font-size:10px">…</span>';
    const label = document.createElement('div');
    label.style.cssText = 'font-size:10px;color:#9f9fa8;align-self:center;padding:0 6px;white-space:nowrap';
    label.innerHTML = `Cube&nbsp;#${cube.cubeId}<br>slot&nbsp;${cube.slot}`;
    card.append(tile, label);
    card.addEventListener('click', () => selectTarget(cube));
    frag.appendChild(card);
    cubeThumbnailSVG(cube.cubeId)
      .then(svg => { if (svg && svg.includes('<svg')) tile.replaceChildren(svgToImg(svg)); })
      .catch((err) => {
        console.error(`[update-cube] thumbnail #${cube.cubeId} failed:`, err);
        tile.innerHTML = '<span class="preview-empty" style="font-size:9px;color:#ff9a9a">err</span>';
      });
  }
  els.ownedList.appendChild(frag);
}

function selectTarget(cube) {
  state.target = cube;
  for (const card of els.ownedList.querySelectorAll('.owned-card')) {
    card.classList.toggle('selected', card.dataset.cubeId === String(cube.cubeId));
  }
  els.moveBtn.disabled = false;
  refreshCommitState();
  setStatus(`target: Cube #${cube.cubeId} (slot ${cube.slot})`);
  renderPreviews(); // re-render the top preview on the target cube's identity
}

async function moveFlow() {
  if (!state.target) { setStatus('select a cube to move'); return; }
  const slot = Number(els.moveSlot.value);
  if (!Number.isInteger(slot) || slot < 0) { setStatus('enter a target slot'); return; }
  els.moveBtn.disabled = true;
  setStatus(`moving cube #${state.target.cubeId} → slot ${slot}…`);
  try {
    await moveCube({ cubeId: state.target.cubeId, owner: walletAccount() || state.target.owner, newSlot: slot });
    setStatus(`cube #${state.target.cubeId} moved to slot ${slot}`);
    await loadOwned();
  } catch (err) {
    console.error('[update-cube] move failed', err);
    setStatus(`move failed: ${msg(err)}`);
    els.moveBtn.disabled = false;
  }
}

function refreshCommitState() {
  // Enabled only once both a source artwork and a target cube are chosen.
  els.updateBtn.disabled = !(state.selectedKey && state.target);
}

function openConfirm() {
  if (els.updateBtn.disabled) return;
  els.overlay.style.display = 'flex';
}
function closeConfirm() { els.overlay.style.display = 'none'; }

async function commit() {
  console.error('[update-cube] LFG/commit', {
    hasArt: !!state.selectedNft, hasTarget: !!state.target, hasPayload: !!state.payload,
  });
  if (!state.selectedNft || !state.target || !state.payload) {
    setStatus('pick wallet art + a target cube first');
    closeConfirm();
    return;
  }
  els.confirmLfg.disabled = true;
  setStatus(`customizing cube #${state.target.cubeId}…`);
  try {
    const tx = await customizeCube({
      cubeId: state.target.cubeId,
      owner: walletAccount() || state.target.owner,
      sourceContract: state.selectedNft.contract,
      sourceTokenId: state.selectedNft.tokenId,
      payload: state.payload,
    });
    closeConfirm();
    setStatus(`cube #${state.target.cubeId} customized · tx ${String(tx).slice(0, 12)}…`);
    await loadOwned(); // the target's thumbnail now renders the new art
  } catch (err) {
    console.error('[update-cube] customize failed', err);
    setStatus(`customize failed: ${msg(err)}`);
  } finally {
    els.confirmLfg.disabled = false;
  }
}

// --- SVG panel zoom + pan (wheel to zoom, drag to pan) ---------------------
const svgZoom = { scale: 1, x: 0, y: 0 };
function applySvgZoom() {
  const el = els.stageSvg.querySelector('img');
  if (!el) return;
  el.style.transformOrigin = 'center center';
  el.style.transform = `translate(${svgZoom.x}px, ${svgZoom.y}px) scale(${svgZoom.scale})`;
}
function resetSvgZoom() { svgZoom.scale = 1; svgZoom.x = 0; svgZoom.y = 0; applySvgZoom(); }

els.stageSvg.style.cursor = 'grab';
els.stageSvg.addEventListener('wheel', (e) => {
  if (!els.stageSvg.querySelector('img')) return;
  e.preventDefault();
  svgZoom.scale = Math.max(0.5, Math.min(12, svgZoom.scale * Math.exp(-e.deltaY * 0.0016)));
  applySvgZoom();
}, { passive: false });
let svgDrag = false, svgLastX = 0, svgLastY = 0;
els.stageSvg.addEventListener('pointerdown', (e) => {
  if (!els.stageSvg.querySelector('img')) return;
  svgDrag = true; svgLastX = e.clientX; svgLastY = e.clientY;
  els.stageSvg.style.cursor = 'grabbing';
  els.stageSvg.setPointerCapture(e.pointerId);
});
els.stageSvg.addEventListener('pointermove', (e) => {
  if (!svgDrag) return;
  svgZoom.x += e.clientX - svgLastX; svgZoom.y += e.clientY - svgLastY;
  svgLastX = e.clientX; svgLastY = e.clientY;
  applySvgZoom();
});
const endSvgDrag = () => { svgDrag = false; els.stageSvg.style.cursor = 'grab'; };
els.stageSvg.addEventListener('pointerup', endSvgDrag);
els.stageSvg.addEventListener('pointercancel', endSvgDrag);
els.stageSvg.addEventListener('dblclick', resetSvgZoom);

els.load.addEventListener('click', loadWallet);
els.addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadWallet(); });
els.prev.addEventListener('click', () => { if (state.page > 0) { state.page--; renderList(); } });
els.next.addEventListener('click', () => { if (state.page < pageCount() - 1) { state.page++; renderList(); } });
els.updateBtn.addEventListener('click', openConfirm);
els.confirmCancel.addEventListener('click', closeConfirm);
els.confirmLfg.addEventListener('click', commit);
els.overlay.addEventListener('click', (e) => { if (e.target === els.overlay) closeConfirm(); });
els.moveBtn.addEventListener('click', moveFlow);
els.moveSlot.addEventListener('keydown', (e) => { if (e.key === 'Enter') moveFlow(); });

// Wallet connect (injected/EIP-1193). When connected, customize/move txs are signed
// + sent by the holder's wallet, and the wallet address seeds the "load my NFTs"
// field. With no wallet, the unlocked-node dev fallback stays in effect.
if (els.connect) {
  fetch('/data/chain-config.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((cfg) => {
      mountConnectButton(els.connect, {
        chainId: Number(cfg.chainId || 0) || undefined,
        rpcUrl: cfg.rpcUrl || 'http://127.0.0.1:8545',
        chainName: 'Blockcassone (local)',
        onChange: (acct) => {
          setTransactionSender(acct ? walletSend : null);
          if (acct && els.addr) { els.addr.value = acct; loadWallet(); }
        },
      });
    });
}

// Load the cubes on the local chain (the overwrite targets) on page open.
loadOwned();
