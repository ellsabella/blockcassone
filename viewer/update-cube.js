// Update Cube page.
// Pick one of YOUR cubes, then propose new art from your wallet (customizeCube) or a random
// CC0 pool source (rebaseToPoolSource — stubbed until an on-chain pool index exists). The 2D
// pane is the real on-chain thumbnail (previewThumbnailSVG / cubeThumbnailSVG); the 3D pane is
// the dev preview iframe. Hold-to-compare flips current vs proposed. The whole page is hidden
// when customizesEnabled is off on-chain (the contract is the real gate; this is UX only).

import { loadWalletNftsAcrossChains } from './wallet-nfts.js';
import { imageUrlToBinaryGrid, gridToTonalPayload } from './nft-art-grid.js';
import {
  previewThumbnailSVG, cubeThumbnailSVG, cubeAnimationURI, proposedAnimationURI, loadOwnedCubes,
  customizeCube, rebaseToPoolSource, contractFlags, setTransactionSender,
  poolSources, unclaimedPoolSources, poolSourcePayload,
} from './preview-chain.js';
import { mountConnectButton, sendTransaction as walletSend, account as walletAccount } from './wallet.js?v=20260806-1';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const msg = e => String((e && e.message) || e).slice(0, 160);

const els = {};
const state = { owned: [], cube: null, proposal: null, holding: false,
  currentSvg: null, currentAnim: null, proposedSvg: null, proposedAnim: null, walletNfts: [] };
// proposal = { kind:'wallet'|'cc0', sourceContract, sourceTokenId, payload:Uint8Array(400), art?:url, label }

// ---------- boot ----------
(async function init() {
  ['strip','art2d','art3d','pane2d','pane3d','tag2d','tag3d','previewbar','pvtext','pvsrc',
   'actions','scrim','sheet','walletgrid','toast','sheet-status'].forEach(id => els[id.replace(/-/g,'_')] = $(id));

  let flags = null;
  try { flags = await contractFlags(); } catch { flags = null; }
  if (flags && flags.customizesEnabled === false) { showGate(); return; } // definitively off -> hide

  let cfg = {};
  try { cfg = await (await fetch('/data/chain-config.json', { cache: 'no-store' })).json(); } catch {}
  mountConnectButton($('wallet-connect'), {
    chainId: cfg.chainId, rpcUrl: cfg.rpcUrl, chainName: 'TheBLOCK', onChange: onWallet,
  });
  wireStatic();
  render();
})();

function showGate() { $('app').style.display = 'none'; $('gate').style.display = 'flex'; }

// ---------- wallet / cubes ----------
async function onWallet(acct) {
  setTransactionSender(acct ? walletSend : null);
  $('wallet-connect').classList.toggle('connected', !!acct);
  if (!acct) { state.owned = []; state.cube = null; state.proposal = null; renderStrip(); render(); return; }
  await loadOwned(acct);
}

async function loadOwned(acct) {
  els.strip.innerHTML = '<span class="empty">loading your cubes…</span>';
  let owned = [];
  try { owned = await loadOwnedCubes(acct); }
  catch (e) { toast('could not load cubes: ' + msg(e), true); }
  state.owned = owned;
  renderStrip();
  if (owned.length) selectCube(owned[0], true);
  else { state.cube = null; render(); }
}

function selectCube(c, force) {
  if (!force && state.proposal && !confirm('Discard unsaved art change?')) return;
  state.cube = c; state.proposal = null; state.holding = false;
  state.currentSvg = null; state.currentAnim = null; state.proposedSvg = null;
  els.art3d.dataset.key = '';
  render();
  loadCurrent(c);
}

async function loadCurrent(c) {
  // 2D = the stored on-chain thumbnail; 3D = the cube's on-chain animation_url (real 3D).
  try { const svg = await cubeThumbnailSVG(c.cubeId); if (state.cube === c) { state.currentSvg = svg; paint2D(); } }
  catch (e) { if (state.cube === c) { state.currentSvg = note('on-chain render unavailable', msg(e)); paint2D(); } }
  try { const anim = await cubeAnimationURI(c.cubeId); if (state.cube === c) { state.currentAnim = anim; paint3D(); } }
  catch (e) { if (state.cube === c) { state.currentAnim = null; paint3D(); } }
}

// ---------- propose ----------
async function setProposalWallet(nft) {
  closeSheet();
  toast('flattening art…');
  try {
    const grid = await imageUrlToBinaryGrid(nft.imageUrl);
    const payload = gridToTonalPayload(grid);
    state.proposal = { kind: 'wallet', sourceContract: nft.contract, sourceTokenId: nft.tokenId,
      payload, art: nft.imageUrl, label: nft.name || ('#' + nft.tokenId) };
    state.proposedSvg = null; state.holding = false;
    render();
    fetchProposed2D(); fetchProposed3D();
  } catch (e) { toast('could not load that art: ' + msg(e), true); }
}

async function fetchProposed2D() {
  const p = state.proposal, c = state.cube; if (!p || !c) return;
  try {
    const svg = await previewThumbnailSVG({ seed: c.seed, slot: c.slot,
      sourceContract: p.sourceContract, sourceTokenId: p.sourceTokenId, payload: p.payload });
    if (state.proposal === p) { state.proposedSvg = svg; paint2D(); }
  } catch (e) { if (state.proposal === p) { state.proposedSvg = note('preview unavailable', msg(e)); paint2D(); } }
}

// True 3D preview of the proposal: the real on-chain engine with the proposed art swapped in.
async function fetchProposed3D() {
  const p = state.proposal, c = state.cube; if (!p || !c) return;
  state.proposedAnim = null; paint3D();
  try {
    const uri = await proposedAnimationURI(c.cubeId, { sourceContract: p.sourceContract, sourceTokenId: p.sourceTokenId, payload: p.payload });
    if (state.proposal === p) { state.proposedAnim = uri; paint3D(); }
  } catch (e) { if (state.proposal === p) { state.proposedAnim = null; paint3D(); } }
}

async function spin() {
  const c = state.cube; if (!c) return;
  toast('spinning…');
  try {
    const sources = await unclaimedPoolSources();
    if (!sources.length) {
      const total = (await poolSources()).length;
      toast(total ? 'every CC0 pool source is already taken — none left to spin' : 'no CC0 pool art committed on this deploy yet', true);
      return;
    }
    // Pick a random UNCLAIMED source, avoiding an immediate repeat of the current proposal.
    let pick, tries = 0;
    do { pick = sources[(Math.random() * sources.length) | 0]; tries++; }
    while (state.proposal && state.proposal.kind === 'cc0'
      && state.proposal.sourceContract === pick.sourceContract
      && String(state.proposal.sourceTokenId) === String(pick.sourceTokenId)
      && tries < 6 && sources.length > 1);
    const payload = await poolSourcePayload(pick);
    if (!payload || !payload.length) { toast('that source has no art — spin again', true); return; }
    state.proposal = { kind: 'cc0', sourceContract: pick.sourceContract, sourceTokenId: pick.sourceTokenId,
      payload, label: (pick.sourceName || ('CC0 ' + short(pick.sourceContract))) + ' #' + pick.sourceTokenId };
    state.proposedSvg = null; state.holding = false;
    render();
    fetchProposed2D(); fetchProposed3D();
  } catch (e) { toast('spin failed: ' + msg(e), true); }
}

function discard() { state.proposal = null; state.holding = false; render(); }

async function commit() {
  const p = state.proposal, c = state.cube; if (!p || !c) return;
  const owner = walletAccount() || c.owner;
  setBusy(true);
  try {
    if (p.kind === 'wallet') {
      await customizeCube({ cubeId: c.cubeId, owner, sourceContract: p.sourceContract, sourceTokenId: p.sourceTokenId, payload: p.payload });
    } else {
      await rebaseToPoolSource({ cubeId: c.cubeId, owner, sourceContract: p.sourceContract, sourceTokenId: p.sourceTokenId });
    }
    state.currentSvg = state.proposedSvg;      // proposed becomes the new current
    state.proposal = null; state.holding = false;
    render();
    toast('✓ Art updated on-chain');
    if (owner) loadOwnedCubes(owner).then(o => { state.owned = o; renderStrip(); }).catch(() => {});
  } catch (e) { toast('update failed: ' + msg(e), true); }
  finally { setBusy(false); }
}

// ---------- render ----------
function render() {
  renderStrip();
  const proposing = !!state.proposal, proposed = proposing && !state.holding;
  const proposed3d = proposed; // every proposal now renders in true 3D (real engine, swapped art)
  els.pane2d.classList.toggle('proposed', proposed);
  els.pane3d.classList.toggle('proposed', proposed3d);
  els.tag2d.textContent = proposed ? '2D · PREVIEW' : (state.holding ? '2D · current' : '2D · thumbnail');
  els.tag3d.textContent = proposed3d ? '3D · PREVIEW' : (state.holding ? '3D · current' : '3D · live');
  els.previewbar.classList.toggle('on', proposing);
  if (proposing) {
    els.pvtext.textContent = state.holding ? 'Showing current — release to preview' : 'Proposed art · unsaved';
    els.pvsrc.textContent = state.holding ? '' : '· ' + state.proposal.label;
  }
  renderActions(proposing);
  paint2D(); paint3D();
}

function paint2D() {
  if (!state.cube) { els.art2d.innerHTML = note('select a cube'); return; }
  const proposed = state.proposal && !state.holding;
  els.art2d.innerHTML = proposed
    ? (state.proposedSvg || note('rendering preview…'))
    : (state.currentSvg || note('rendering…'));
}

function paint3D() {
  const proposed = state.proposal && !state.holding;
  // Proposed art (wallet OR CC0) → the REAL on-chain engine with the proposed art swapped in.
  if (proposed) {
    if (state.proposedAnim) {
      const key = 'p|' + state.cube.cubeId + '|' + state.proposal.sourceContract + ':' + state.proposal.sourceTokenId;
      if (els.art3d.dataset.key === key) return;
      els.art3d.innerHTML = '<iframe title="3D preview"></iframe>';
      els.art3d.querySelector('iframe').src = state.proposedAnim; // large data: URI via property
      els.art3d.dataset.key = key;
      return;
    }
    els.art3d.innerHTML = note('rendering 3D preview…', 'the proposed art in true 3D');
    els.art3d.dataset.key = 'p-loading';
    return;
  }
  // Otherwise (current cube, or held) → the cube's real on-chain animation.
  if (state.cube && state.currentAnim) {
    const key = 'c|' + state.cube.cubeId;
    if (els.art3d.dataset.key === key) return;
    els.art3d.innerHTML = '<iframe title="3D"></iframe>';
    els.art3d.querySelector('iframe').src = state.currentAnim; // large data: URI via property
    els.art3d.dataset.key = key;
    return;
  }
  els.art3d.innerHTML = note(state.cube ? 'loading 3D…' : 'select a cube');
  els.art3d.dataset.key = '';
}

function renderStrip() {
  const s = els.strip;
  if (!state.owned.length) {
    s.innerHTML = `<span class="empty">${walletAccount() ? 'no cubes in this wallet' : 'connect a wallet to load your cubes'}</span>`;
    return;
  }
  s.innerHTML = state.owned.map(c => {
    const h = (Number(c.cubeId) * 47) % 360;
    const sel = state.cube && c.cubeId === state.cube.cubeId ? ' sel' : '';
    return `<div class="thumb${sel}" data-id="${c.cubeId}" style="background:linear-gradient(135deg,hsl(${h} 60% 22%),hsl(${(h + 40) % 360} 55% 12%))"><span class="id">#${c.cubeId}</span></div>`;
  }).join('');
}

function renderActions(proposing) {
  const a = els.actions;
  if (!proposing) {
    // LAUNCH SAFETY: the random CC0 pool spin (rebaseToPoolSource) is REMOVED
    // from the UI — the pool was sized at mint opening, and post-mint pulls
    // would drain sources the mint still needs (unfixable at contract level).
    // Updates come exclusively from art the wallet actually holds.
    a.innerHTML = `<div class="row">
        <button class="act" id="fromwallet">&#128444; From wallet</button></div>
      <div class="hint">${state.cube ? 'editing #' + state.cube.cubeId + ' · changing art costs only gas' : 'select a cube to edit'}</div>`;
    $('fromwallet').onclick = () => { if (!requireCube()) return; openSheet(); };
  } else {
    a.innerHTML = `<div class="row">
        <button class="act ghost" id="discard">Discard</button></div>
      <div class="row"><button class="act primary" id="update">Update art on-chain →</button></div>
      <div class="hint">${state.proposal.kind === 'wallet' ? 'From your wallet · you confirmed rights' : 'Random CC0 pool source'}</div>`;
    // (spin-again removed with the pool-spin flow — launch safety)
    $('discard').onclick = discard;
    $('update').onclick = commit;
  }
}

// ---------- wallet sheet ----------
async function openSheet() {
  els.scrim.classList.add('on'); els.sheet.classList.add('on');
  const acct = walletAccount();
  els.walletgrid.innerHTML = '';
  els.sheet_status.textContent = acct ? 'loading your NFTs…' : 'connect a wallet first';
  if (!acct) return;
  try {
    const nfts = (await loadWalletNftsAcrossChains(acct)).nfts || []; // returns walletState {nfts,…}
    state.walletNfts = nfts;
    els.sheet_status.textContent = nfts.length ? `${nfts.length} items` : 'no NFTs found';
    els.walletgrid.innerHTML = nfts.slice(0, 60).map((n, i) =>
      `<div class="nft" data-i="${i}"><img loading="lazy" src="${esc(n.imageUrl || '')}" alt=""><span class="lab">${esc(n.name || ('#' + n.tokenId))}</span></div>`).join('');
  } catch (e) { els.sheet_status.textContent = 'could not load NFTs: ' + msg(e); }
}
function closeSheet() { els.scrim.classList.remove('on'); els.sheet.classList.remove('on'); }

// ---------- static wiring ----------
function wireStatic() {
  els.strip.addEventListener('click', e => {
    const el = e.target.closest('.thumb'); if (!el) return;
    const id = el.dataset.id; if (state.cube && String(state.cube.cubeId) === id) return;
    const c = state.owned.find(x => String(x.cubeId) === id); if (c) selectCube(c);
  });
  els.walletgrid.addEventListener('click', e => {
    const el = e.target.closest('.nft'); if (el) setProposalWallet(state.walletNfts[+el.dataset.i]);
  });
  els.scrim.onclick = closeSheet;

  const cmp = $('compare');
  const hold = on => {
    if (!state.proposal) return;
    state.holding = on; cmp.classList.toggle('holding', on);
    render();
  };
  cmp.addEventListener('pointerdown', e => { e.preventDefault(); hold(true); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => cmp.addEventListener(ev, () => hold(false)));

  // navigate-away guard
  window.addEventListener('beforeunload', e => { if (state.proposal) { e.preventDefault(); e.returnValue = ''; } });
  document.querySelectorAll('a[href]').forEach(a => a.addEventListener('click', e => {
    if (state.proposal && !confirm('Discard unsaved art change?')) e.preventDefault();
  }));
}

// ---------- helpers ----------
function requireCube() { if (!state.cube) { toast('select a cube first', true); return false; } return true; }
function short(a) { const s = String(a || ''); return s.length > 10 ? s.slice(0, 6) + '…' + s.slice(-4) : s; }
function note(main, sub) { return `<div class="note">${esc(main)}${sub ? '<br><small>' + esc(sub) + '</small>' : ''}</div>`; }
function setBusy(b) { const u = $('update'); if (u) { u.disabled = b; u.textContent = b ? 'Updating…' : 'Update art on-chain →'; } }
let toastT;
function toast(text, err) {
  const t = els.toast; t.textContent = text; t.classList.toggle('err', !!err); t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), err ? 2800 : 1700);
}
