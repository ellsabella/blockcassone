// Update Cube page — slice 1: wallet art browser.
// Loads a wallet's NFTs (metadata across chains, all at once — cheap JSON), then
// pages the LIST 50 at a time and only renders <img> for the visible page, so we
// never ask OpenSea for thousands of images up front. Selection drives the two
// preview panels (cube + SVG); those previews and the owned-cube + commit flow
// are wired in later slices.

import { loadWalletNftsAcrossChains } from './wallet-nfts.js';

const PAGE_SIZE = 50;

const els = {
  addr: document.getElementById('wallet-addr'),
  load: document.getElementById('wallet-load'),
  status: document.getElementById('wallet-status'),
  list: document.getElementById('wallet-list'),
  prev: document.getElementById('wallet-prev'),
  next: document.getElementById('wallet-next'),
  page: document.getElementById('wallet-page'),
  stageCube: document.getElementById('stage-cube'),
  stageSvg: document.getElementById('stage-svg'),
  updateBtn: document.getElementById('update-btn'),
  overlay: document.getElementById('confirm-overlay'),
  confirmCancel: document.getElementById('confirm-cancel'),
  confirmLfg: document.getElementById('confirm-lfg'),
};

const state = {
  nfts: [],
  page: 0,
  selectedKey: null, // contract:tokenId of selected wallet art
  ownedCubeId: null, // target cube to overwrite (slice 4)
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

function selectNft(nft) {
  state.selectedKey = keyOf(nft);
  for (const row of els.list.querySelectorAll('.wallet-item')) {
    row.classList.toggle('selected', row.dataset.key === state.selectedKey);
  }
  // Slice 1: show the source art in both stages. Slice 2 swaps these for the real
  // 3D cube + the on-chain previewThumbnailSVG render.
  renderStagePlaceholder(els.stageCube, nft);
  renderStagePlaceholder(els.stageSvg, nft);
  refreshCommitState();
}

function renderStagePlaceholder(stage, nft) {
  if (!nft.imageUrl) { stage.innerHTML = '<span class="preview-empty">no image for this item</span>'; return; }
  const img = document.createElement('img');
  img.src = nft.imageUrl;
  img.alt = nft.name || '';
  stage.replaceChildren(img);
}

function refreshCommitState() {
  // Enabled only once both a source artwork and a target cube are chosen.
  els.updateBtn.disabled = !(state.selectedKey && state.ownedCubeId);
}

function openConfirm() {
  if (els.updateBtn.disabled) return;
  els.overlay.style.display = 'flex';
}
function closeConfirm() { els.overlay.style.display = 'none'; }
function commit() {
  // Slice 4: flatten -> attestation -> customizeCube. Stubbed for now.
  closeConfirm();
  setStatus('commit flow lands in a later slice');
}

els.load.addEventListener('click', loadWallet);
els.addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadWallet(); });
els.prev.addEventListener('click', () => { if (state.page > 0) { state.page--; renderList(); } });
els.next.addEventListener('click', () => { if (state.page < pageCount() - 1) { state.page++; renderList(); } });
els.updateBtn.addEventListener('click', openConfirm);
els.confirmCancel.addEventListener('click', closeConfirm);
els.confirmLfg.addEventListener('click', commit);
els.overlay.addEventListener('click', (e) => { if (e.target === els.overlay) closeConfirm(); });
