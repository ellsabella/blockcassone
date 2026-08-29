// Update Cube page.
// Pick one of YOUR cubes, then propose new art from your wallet (customizeCube) or a random
// CC0 pool source (rebaseToPoolSource — stubbed until an on-chain pool index exists). The 2D
// pane is the real on-chain thumbnail (previewThumbnailSVG / cubeThumbnailSVG); the 3D pane is
// the dev preview iframe. Hold-to-compare flips current vs proposed. The whole page is hidden
// when customizesEnabled is off on-chain (the contract is the real gate; this is UX only).

import { fetchWalletNftsPage, resolveCollectionSlug, DEFAULT_WALLET_CHAINS } from './wallet-nfts.js';
import { loadSnapshotOwnership } from './chain-cubes.js';
import { GENESIS_SOURCE_CONTRACTS } from './mint-simulator.js';
// Versioned import: the flattener changes behaviour (MoonCat fixes) and a stale
// cached copy silently produces garbage payloads — pin the version so a deploy
// always reaches the browser. Keep in lockstep with wallet-nfts.js's import.
import { imageUrlToBinaryGrid, gridToTonalPayload } from './nft-art-grid.js?v=20260826-3';
import {
  previewThumbnailSVG, cubeThumbnailSVG, cubeAnimationURI, proposedAnimationURI, loadOwnedCubes,
  customizeCube, rebaseToPoolSource, contractFlags, setTransactionSender,
  poolSources, unclaimedPoolSources, poolSourcePayload,
  checkSourceAvailable, checkSourceUsable,
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
  // ?preview=1 skips the UI hide for design/dev work — the contract still
  // rejects any actual commit while customizesEnabled is off, so this only
  // reveals the page, it cannot enable the mechanic.
  const _previewGate = (() => { try { return new URLSearchParams(location.search).has('preview'); } catch (_) { return false; } })();
  if (!_previewGate && flags && flags.customizesEnabled === false) { showGate(); return; } // definitively off -> hide

  let cfg = {};
  try { cfg = await (await fetch('/data/chain-config.json', { cache: 'no-store' })).json(); } catch {}
  setEmptyState('connect'); // default view until a wallet reports in
  mountConnectButton($('wallet-connect'), {
    chainId: cfg.chainId, rpcUrl: cfg.rpcUrl, chainName: 'TheBLOCK', onChange: onWallet,
  });
  wireStatic();
  render();
})();

function showGate() {
  $('app').style.display = 'none';
  $('nocubes').classList.remove('on');
  $('gate').style.display = 'flex';
}

// Page state: 'connect' (no wallet yet) | 'none' (wallet owns no cubes) | null (has cubes → app).
function setEmptyState(kind) {
  const app = $('app'), no = $('nocubes');
  if (!kind) { no.classList.remove('on'); app.style.display = 'flex'; return; }
  app.style.display = 'none';
  $('nocubes-msg').textContent = kind === 'connect'
    ? 'Connect a wallet to load your cubes.'
    : 'To update a cube, you must first own one.';
  $('nocubes-link').style.display = kind === 'connect' ? 'none' : '';
  no.classList.add('on');
}

// ---------- wallet / cubes ----------
async function onWallet(acct) {
  setTransactionSender(acct ? walletSend : null);
  $('wallet-connect').classList.toggle('connected', !!acct);
  if (!acct) { state.owned = []; state.cube = null; state.proposal = null; renderStrip(); render(); setEmptyState('connect'); return; }
  await loadOwned(acct);
}

async function loadOwned(acct) {
  els.strip.innerHTML = '<span class="empty">loading your cubes…</span>';
  let owned = [];
  try { owned = await loadOwnedCubes(acct); }
  catch (e) { toast('could not load cubes: ' + msg(e), true); }
  state.owned = owned;
  renderStrip();
  if (owned.length) { setEmptyState(null); selectCube(owned[0], true); }
  else { state.cube = null; render(); setEmptyState('none'); }
}

function selectCube(c, force) {
  if (!force && state.proposal && !confirm('Discard unsaved art change?')) return;
  state.cube = c; state.proposal = null; state.holding = false;
  state.currentSvg = null; state.currentAnim = null; state.proposedSvg = null;
  els.art3d.dataset.key = '';
  render();
  loadCurrent(c);
}

// Cache-first thumbnail: the server's /api/thumbnail is disk-first (indexer-baked
// SVGs) with a TTL memory cache — no browser-side eth_call. Only if that route
// fails do we pay for the live on-chain render.
async function cachedThumbnailSVG(cubeId) {
  try {
    const r = await fetch('/api/thumbnail?cube=' + Number(cubeId), { cache: 'default' });
    if (r.ok) { const t = await r.text(); if (t && t.includes('<svg')) return t; }
  } catch (_) { /* fall through */ }
  return cubeThumbnailSVG(cubeId);
}

// Per-session memo of each cube's current art — flicking between cubes in the
// strip must not re-pay the render eth_calls. Invalidated on a successful commit.
const _cubeArtCache = new Map(); // cubeId -> { svg?, anim? }

async function loadCurrent(c) {
  // 2D = the stored on-chain thumbnail; 3D = the cube's on-chain animation_url (real 3D).
  const hit = _cubeArtCache.get(c.cubeId) || {};
  if (hit.svg) { state.currentSvg = hit.svg; paint2D(); }
  else {
    try {
      const svg = await cachedThumbnailSVG(c.cubeId);
      _cubeArtCache.set(c.cubeId, { ..._cubeArtCache.get(c.cubeId), svg });
      if (state.cube === c) { state.currentSvg = svg; paint2D(); }
    } catch (e) { if (state.cube === c) { state.currentSvg = note('on-chain render unavailable', msg(e)); paint2D(); } }
  }
  if (hit.anim) { state.currentAnim = hit.anim; paint3D(); return; }
  try {
    const anim = await cubeAnimationURI(c.cubeId);
    _cubeArtCache.set(c.cubeId, { ..._cubeArtCache.get(c.cubeId), anim });
    if (state.cube === c) { state.currentAnim = anim; paint3D(); }
  } catch (e) { if (state.cube === c) { state.currentAnim = null; paint3D(); } }
}

// ---------- propose ----------
// LAUNCH SAFETY: both rules are UI-enforced (no contract guard exists) — a source
// must not be mint-pool art, and vault-held art must carry a live delegation.
async function guardProposal(nft) {
  const acct = walletAccount();
  const avail = await checkSourceAvailable(nft.contract, nft.tokenId);
  if (!avail.ok) return avail.reason;
  if (nft.viaVault) {
    if (String(nft.chain || 'ethereum') !== 'ethereum') return 'vault art is mainnet-only for now';
    const usable = await checkSourceUsable(acct, nft.contract, nft.tokenId, nft.vault);
    if (!usable.ok) return usable.reason;
  }
  return null;
}

async function setProposalWallet(nft) {
  closeSheet();
  toast('checking source…');
  const blocked = await guardProposal(nft).catch(e => 'source check failed: ' + msg(e));
  if (blocked) { toast(blocked, true); return; }
  toast('flattening art…');
  try {
    const grid = await imageUrlToBinaryGrid(nft.imageUrl);
    const payload = gridToTonalPayload(grid);
    state.proposal = { kind: 'wallet', sourceContract: nft.contract, sourceTokenId: nft.tokenId,
      payload, art: nft.imageUrl, label: (nft.name || ('#' + nft.tokenId)) + (nft.viaVault ? ' (vault)' : ''),
      viaVault: !!nft.viaVault, vault: nft.vault || null, chain: nft.chain || 'ethereum' };
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
      // Re-run the launch-safety guard right before the tx — pool claims and
      // delegations can change between picking the art and committing it.
      const blocked = await guardProposal({ contract: p.sourceContract, tokenId: p.sourceTokenId, viaVault: p.viaVault, vault: p.vault, chain: p.chain })
        .catch(e => 'source re-check failed: ' + msg(e));
      if (blocked) { toast(blocked, true); return; }
      await customizeCube({ cubeId: c.cubeId, owner, sourceContract: p.sourceContract, sourceTokenId: p.sourceTokenId, payload: p.payload, vault: p.vault });
    } else {
      await rebaseToPoolSource({ cubeId: c.cubeId, owner, sourceContract: p.sourceContract, sourceTokenId: p.sourceTokenId });
    }
    _cubeArtCache.delete(c.cubeId);            // art changed on-chain — drop the memo
    state.currentSvg = state.proposedSvg;      // proposed becomes the new current
    state.proposal = null; state.holding = false;
    render();
    toast('✓ Art updated on-chain');
    if (owner) loadOwnedCubes(owner).then(o => { state.owned = o; renderStrip(); }).catch(() => {});
    watchForIndex(c, p.sourceContract, p.sourceTokenId);
  } catch (e) { toast('update failed: ' + msg(e), true); }
  finally { setBusy(false); }
}

// After a commit: poll the indexer snapshot (cache-bypassed, every 5s, up to 4 min)
// until this cube reflects the new source, then hand out a cache-bypassing Explorer
// deep link — turns the "is it live yet?" wait into a green light. Only ever runs
// after a real on-chain commit, so it costs nothing on the browse path.
async function watchForIndex(cube, sourceContract, sourceTokenId) {
  const setHint = (html) => { const h = els.actions.querySelector('.hint'); if (h) h.innerHTML = html; };
  setHint('⏳ waiting for the indexer to pick up your update (usually under a minute)…');
  const want = String(sourceContract).toLowerCase() + '|' + String(sourceTokenId);
  for (let i = 0; i < 48; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const snap = await (await fetch('/data/world-snapshot.json', { cache: 'reload' })).json();
      const r = (snap.records || []).find(x => Number(x.cubeId) === Number(cube.cubeId));
      const have = r ? String(r.source?.contract || '').toLowerCase() + '|' + String(r.source?.tokenId) : '';
      if (have === want) {
        setHint(`✓ indexed · <a href="/viewer/?cube=${cube.slot}&fresh=1" style="color:var(--pink);font-weight:800;text-decoration:none">see it live in the Explorer →</a>`);
        return;
      }
    } catch (_) { /* transient — keep polling */ }
  }
  setHint('the indexer is taking longer than usual — the Explorer will show your update once it catches up');
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
  await listSheetNfts(acct, false);
}

// List an address's NFTs into the sheet grid. viaVault marks delegate.xyz art:
// listed from the VAULT's inventory, committed by the CONNECTED wallet — each
// pick is validated against the registry (guardProposal) before use.
//
// EFFICIENCY: strictly on-demand pagination. One OpenSea page (≤200 items) per
// LOAD MORE press, working down the chain queue (ethereum → base → shape) — the
// old flow drained the ENTIRE inventory of all three chains up-front (a page per
// 200 NFTs × 3 chains) before a single tile rendered.
// Search modes:
//   textFilter — instant CLIENT-side filter over already-loaded items (0 API calls);
//                LOAD MORE keeps fetching pages, the filter re-applies as they land.
//   contract   — a pasted 0x address flips to a SERVER-side targeted listing:
//                contract → collection slug (1 light call per chain, cached on the
//                queue entry), then the wallet's NFTs in JUST that collection.
//                Cheapest possible way to find one collection in a huge wallet.
// The six GENESIS source collections are hidden from the picker entirely: their
// tokens are mint-pool art and can never be a customize source (the pool guard
// would reject them), so showing them just sets users up for a rejection.
// Explicit table, NOT derived from the snapshot: once customizes land, arbitrary
// collections become "source contracts" of live cubes, and a snapshot-derived
// set wrongly hid those whole collections (cube #213 → 0x724d…5774 did exactly
// that). The pick/commit guards still enforce the real rule per token.
let _hiddenContractsP = null;
function hiddenSourceContracts() {
  if (!_hiddenContractsP) {
    _hiddenContractsP = (async () => {
      const set = new Set(GENESIS_SOURCE_CONTRACTS);
      try {
        const snap = await loadSnapshotOwnership();
        if (snap && snap.config && snap.config.normies) set.add(String(snap.config.normies).toLowerCase());
      } catch (_) { /* table alone is complete; config just double-checks Normies */ }
      return set;
    })();
  }
  return _hiddenContractsP;
}

const SHEET_INITIAL = 24; // tiles shown on open — calm, fast first paint
const SHEET_STEP = 48;    // tiles revealed per LOAD MORE press
const sheetPager = { owner: null, viaVault: false, queue: [], items: [], busy: false,
  textFilter: '', contract: null, visible: SHEET_INITIAL };

function resetSheetQueue() {
  sheetPager.queue = DEFAULT_WALLET_CHAINS.map(chain => ({ chain, cursor: null, done: false, slug: undefined }));
  sheetPager.items = [];
  sheetPager.visible = SHEET_INITIAL;
  state.walletNfts = [];
  els.walletgrid.innerHTML = '';
}

function sheetFiltered() {
  const q = sheetPager.textFilter;
  return q ? sheetPager.items.filter(n => sheetMatchesText(n, q)) : sheetPager.items;
}

async function listSheetNfts(address, viaVault) {
  sheetPager.owner = address;
  sheetPager.viaVault = !!viaVault;
  sheetPager.textFilter = '';
  sheetPager.contract = null;
  const si = $('art-search'); if (si) si.value = '';
  const sc = $('art-search-clear'); if (sc) sc.style.display = 'none';
  resetSheetQueue();
  els.sheet_status.textContent = viaVault ? 'loading vault NFTs…' : 'loading your NFTs…';
  await loadMoreSheetArt(true);
}

async function loadMoreSheetArt(initial) {
  if (sheetPager.busy) return;
  // Reveal already-loaded tiles first — a LOAD MORE press costs an API call
  // ONLY once everything fetched so far is on screen.
  if (!initial && sheetFiltered().length > sheetPager.visible) {
    sheetPager.visible += SHEET_STEP;
    renderSheetGrid();
    return;
  }
  sheetPager.busy = true;
  const btn = $('sheet-more');
  if (btn) { btn.disabled = true; btn.textContent = 'LOADING…'; }
  try {
    // Fetch ONE page; if it contributed nothing (empty chain), roll straight on
    // to the next chain so a base/shape-only wallet isn't stuck behind clicks —
    // but never more than one page per chain in a single press.
    const hidden = await hiddenSourceContracts();
    if (sheetPager.contract && hidden.has(sheetPager.contract)) {
      sheetPager.queue.forEach(c => { c.done = true; });
      renderSheetGrid();
      els.sheet_status.textContent = 'that collection is genesis source art — its tokens cannot be used for updates';
      return;
    }
    for (let hops = 0; hops < DEFAULT_WALLET_CHAINS.length; hops++) {
      const entry = sheetPager.queue.find(c => !c.done);
      if (!entry) break;
      let collection = null;
      if (sheetPager.contract) {
        if (entry.slug === undefined) entry.slug = await resolveCollectionSlug(sheetPager.contract, entry.chain);
        if (entry.slug === null) { entry.done = true; continue; } // contract unknown on this chain
        collection = entry.slug;
      }
      const page = await fetchWalletNftsPage(sheetPager.owner, entry.chain, entry.cursor, collection);
      entry.cursor = page.next;
      entry.done = !page.next;
      const add = page.nfts
        .filter(n => n.imageUrl) // no image → nothing to flatten, don't show it
        .filter(n => !hidden.has(String(n.contract).toLowerCase())) // genesis source collections — never usable
        .filter(n => !sheetPager.contract || String(n.contract).toLowerCase() === sheetPager.contract) // belt-and-braces
        .map(n => (sheetPager.viaVault ? { ...n, viaVault: true, vault: sheetPager.owner } : n));
      sheetPager.items.push(...add);
      if (add.length) break;
    }
    if (!initial) sheetPager.visible += SHEET_STEP; // a fetch press must reveal, too
    renderSheetGrid();
  } catch (e) { els.sheet_status.textContent = 'could not load NFTs: ' + msg(e); }
  finally {
    sheetPager.busy = false;
    const b = $('sheet-more');
    if (b) { b.disabled = false; b.textContent = 'LOAD MORE ART ↓'; }
  }
}

function sheetMatchesText(n, q) {
  return String(n.name || '').toLowerCase().includes(q)
    || String(n.collection || '').toLowerCase().includes(q)
    || String(n.contract || '').toLowerCase().includes(q);
}

function renderSheetGrid() {
  const q = sheetPager.textFilter;
  const filtered = sheetFiltered();
  const shown = filtered.slice(0, sheetPager.visible);
  const more = sheetPager.queue.some(c => !c.done) || filtered.length > shown.length;
  state.walletNfts = shown; // grid indexes must match what's rendered
  els.walletgrid.innerHTML = shown.map((n, i) =>
    `<div class="nft" data-i="${i}"><img loading="lazy" src="${esc(n.imageUrl || '')}" alt=""><span class="lab">${n.viaVault ? '🔗 ' : ''}${esc(n.name || ('#' + n.tokenId))}</span></div>`).join('');
  let label;
  if (q) label = `${shown.length} of ${filtered.length} matching “${q}”`;
  else if (sheetPager.contract) label = filtered.length
    ? `showing ${shown.length} of ${filtered.length} in that collection`
    : 'none of that collection in this wallet';
  else label = sheetPager.items.length
    ? `showing ${shown.length} of ${sheetPager.items.length} loaded`
    : (sheetPager.viaVault ? 'no NFTs found in that vault' : 'no NFTs found');
  els.sheet_status.textContent = label
    + (sheetPager.viaVault ? ' · via vault ' + short(sheetPager.owner) + ' — delegation checked on pick' : '')
    + (more ? (q ? ' · LOAD MORE scans further' : ' · more available') : '');
  const btn = $('sheet-more');
  if (btn) btn.style.display = more ? '' : 'none';
}

// Search box: 0x address → targeted server-side collection listing; anything
// else → instant client-side filter (no API spend at all).
async function runArtSearch() {
  const raw = String($('art-search').value || '').trim();
  $('art-search-clear').style.display = raw ? '' : 'none';
  if (!raw) { await clearArtSearch(); return; }
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    sheetPager.contract = raw.toLowerCase();
    sheetPager.textFilter = '';
    resetSheetQueue();
    els.sheet_status.textContent = 'searching that collection…';
    await loadMoreSheetArt(true); // fresh listing — start at the initial tile count
  } else {
    sheetPager.textFilter = raw.toLowerCase();
    if (sheetPager.contract) { // leaving contract mode — reload the normal listing
      sheetPager.contract = null;
      resetSheetQueue();
      await loadMoreSheetArt(true); // fresh listing — start at the initial tile count
    } else {
      renderSheetGrid();
    }
  }
}

async function clearArtSearch() {
  $('art-search').value = '';
  $('art-search-clear').style.display = 'none';
  sheetPager.textFilter = '';
  if (sheetPager.contract) { // contract mode replaced the item list — reload page 1
    sheetPager.contract = null;
    resetSheetQueue();
    els.sheet_status.textContent = 'loading…';
    await loadMoreSheetArt(true); // fresh listing — start at the initial tile count
  } else {
    renderSheetGrid();
  }
}
function closeSheet() { els.scrim.classList.remove('on'); els.sheet.classList.remove('on'); }

// ---------- static wiring ----------
function wireStatic() {
  // Mouse wheel over the cube strip scrolls it sideways (a vertical wheel on a
  // horizontal scroller otherwise does nothing useful on desktop).
  els.strip.addEventListener('wheel', e => {
    if (els.strip.scrollWidth <= els.strip.clientWidth) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); els.strip.scrollLeft += e.deltaY; }
  }, { passive: false });
  els.strip.addEventListener('click', e => {
    const el = e.target.closest('.thumb'); if (!el) return;
    const id = el.dataset.id; if (state.cube && String(state.cube.cubeId) === id) return;
    const c = state.owned.find(x => String(x.cubeId) === id); if (c) selectCube(c);
  });
  els.walletgrid.addEventListener('click', e => {
    const el = e.target.closest('.nft'); if (el) setProposalWallet(state.walletNfts[+el.dataset.i]);
  });
  els.scrim.onclick = closeSheet;

  // Delegate.xyz vault flow: list a vault's NFTs without connecting it.
  $('vault-load').onclick = async () => {
    const addr = String($('vault-addr').value || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { toast('enter a valid vault address (0x…)', true); return; }
    if (addr.toLowerCase() === String(walletAccount() || '').toLowerCase()) { toast('that is the connected wallet — its art is already listed', true); return; }
    $('vault-clear').style.display = '';
    await listSheetNfts(addr, true);
  };
  $('vault-clear').onclick = async () => {
    $('vault-addr').value = ''; $('vault-clear').style.display = 'none';
    const acct = walletAccount(); if (acct) await listSheetNfts(acct, false);
  };
  $('sheet-more').onclick = () => loadMoreSheetArt(); // wrap: the click Event must not read as `initial`
  $('art-search-go').onclick = runArtSearch;
  $('art-search-clear').onclick = clearArtSearch;
  $('art-search').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runArtSearch(); } });
  // Text filtering is FREE (client-side) — apply it live as they type.
  $('art-search').addEventListener('input', () => {
    const raw = String($('art-search').value || '').trim();
    $('art-search-clear').style.display = raw ? '' : 'none';
    if (/^0x[0-9a-fA-F]{40}$/.test(raw)) return; // full address → wait for Search/Enter
    if (!sheetPager.contract) { sheetPager.textFilter = raw.toLowerCase(); renderSheetGrid(); }
  });

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
