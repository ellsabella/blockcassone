// Streets page. Your streets (grouped from the chain records), sorted closest-to-merge;
// fill a vacant / evict a rival (displacement) / merge, wired to the payable moveCube +
// mergeStreet with on-chain quotes. Biome per street comes from the verified CubeEnv mirror.
// Gated when both movesEnabled and mergesEnabled are off on-chain (contract is the real gate).

import { loadChainMintRecords } from './chain-cubes.js';
import {
  moveCube, mergeStreet, quoteMove, quoteMerge, cubeThumbnailSVG, cubeAnimationURI,
  thumbnailAtSlotSVG, movedAnimationURI,
  contractFlags, setTransactionSender,
} from './preview-chain.js';
import { mountConnectButton, sendTransaction as walletSend, account as walletAccount } from './wallet.js?v=20260806-1';
import { biomeForStreet } from './cube-env.js';
import { locatorSVG } from './block-locator.js';
import { invalidateWorldSnapshot } from './snapshot-fetch.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const msg = e => String((e && e.message) || e).slice(0, 160);
const fmtEth = wei => { const n = Number(wei) / 1e18; return (n < 0.00005 ? '0' : n.toFixed(4).replace(/0+$/,'').replace(/\.$/,'')) + ' Ξ'; };
const short = a => { const s = String(a || ''); return s.length > 10 ? s.slice(0,6)+'…'+s.slice(-4) : s; };
// Live fee knobs from chain (contractFlags), so displayed estimates track any owner re-price.
// Fallbacks match the post-mint schedule (baseFee 0.0005, premiumPerPoint 0.003).
const feeBase = () => Number(S.flags?.baseFee ?? 5e14);
const feePremium = () => Number(S.flags?.premiumPerPoint ?? 3e15);
// Biome rarity = share of the block's 512 streets that carry this biome (lower = rarer). Cached.
let _biomeDist=null;
function biomePct(name){ if(!_biomeDist){ _biomeDist={}; for(let sid=0;sid<512;sid++){ const b=biomeForStreet(sid).name; _biomeDist[b]=(_biomeDist[b]||0)+1; } } return Math.round((_biomeDist[name]||0)/512*100); }
const capWord = s => String(s||'').replace(/^./,c=>c.toUpperCase());

// on-brand cube glyph from a seed (fast; the detail view swaps in the real on-chain SVG)
function rng(seed){let a=(seed>>>0)||1;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function glyph(seed){const s=(typeof seed==='string'?parseInt(String(seed).slice(2,10),16):seed)>>>0;const r=rng(s),h=(r()*360)|0;let c='';for(let y=0;y<8;y++)for(let x=0;x<8;x++){if(r()<.4){const a=(.22+r()*.5).toFixed(2),l=44+((r()*26)|0);c+=`<rect x="${x*12+1}" y="${y*12+1}" width="10" height="10" rx="1" fill="hsl(${(h+(r()*44-22))|0} 92% ${l}%)" fill-opacity="${a}"/>`;}}
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#060608"/>${c}<path d="M5 5H91M5 5V91M5 91H91" stroke="hsl(${(h+185)%360} 100% 62%)" stroke-width="2.4" fill="none" opacity=".9"/></svg>`;}

// Fast, distinct cube art: the pre-baked /api/thumbnail SVG (instant, per-cube) layered over the
// seed glyph — the glyph shows until the image loads and stays if the fetch fails. Avoids the heavy
// multi-second per-cube live on-chain render that was leaving all chips on the same placeholder.
function chipArt(cubeId, seed, atSlot){
  // atSlot (optional): preview the cube AS IF at that slot (a proposed move) — its destination
  // colours/geometry — via /api/thumbnail?atslot=. Omitted → its art at its current slot.
  const src = atSlot!=null ? `/api/thumbnail?cube=${cubeId}&atslot=${atSlot}` : `/api/thumbnail?cube=${cubeId}`;
  return `<div class="chipart">${glyph(seed)}<img src="${src}" loading="lazy" decoding="async" onerror="this.remove()"></div>`;
}

const els = {};
const S = { mode:'mine', me:null, flags:null, recs:[], bySlot:new Map(), merged:new Set(),
  myStreets:[], myCubes:[], detail:null, staged:null, leaderPick:null, moveCube:null, moveTarget:null, moveQueue:[], previewTok:0, filters:new Set(), terrBiome:null, thumbCache:new Map() };
const BIOME_EMOJI={grass:'🌿',forest:'🌲',water:'🌊',desert:'🏜️',mountain:'🏔️',ice:'🧊'};
const BIOMES_RARE_FIRST=['ice','mountain','desert','water','forest','grass'];

// ---------- boot ----------
(async function init(){
  ['view','scrim','sheet','sheetbody','toast'].forEach(id=>els[id]=$(id));
  // Local review: `?preview` renders the full UI even while the on-chain switches are off
  // (buttons active for layout/flow review). The contract is still the real gate — any actual
  // move/merge tx reverts until movesEnabled/mergesEnabled are flipped on. Live fees preserved.
  const PREVIEW = new URLSearchParams(location.search).has('preview');
  let flags=null; try{ flags=await contractFlags(); }catch{}
  S.flags = (PREVIEW && flags) ? { ...flags, movesEnabled:true, mergesEnabled:true } : flags;
  if (!PREVIEW && flags && !flags.movesEnabled && !flags.mergesEnabled){ $('app').style.display='none'; $('gate').style.display='flex'; return; }
  let cfg={}; try{ cfg=await (await fetch('/data/chain-config.json',{cache:'no-store'})).json(); }catch{}
  mountConnectButton($('wallet-connect'), { chainId:cfg.chainId, rpcUrl:cfg.rpcUrl, chainName:'TheBLOCK', onChange:onWallet });
  wireStatic();
  // Fork test only: ?as=<addr> acts as that wallet WITHOUT a real wallet — txs go through the
  // server proxy's eth_sendTransaction to the (auto-impersonated) fork. Never use against mainnet.
  const AS=new URLSearchParams(location.search).get('as');
  if(AS && /^0x[0-9a-fA-F]{40}$/.test(AS)){
    S.me=AS.toLowerCase(); setTransactionSender(null);
    $('wallet-connect').innerHTML=`<span style="font-size:12px;color:#ffd479;font-weight:700">⛓ test as ${AS.slice(0,6)}…${AS.slice(-4)}</span>`;
    loadWorld(); return;
  }
  renderMine();
})();

async function onWallet(acct){
  setTransactionSender(acct?walletSend:null);
  $('wallet-connect').classList.toggle('connected',!!acct);
  S.me = acct ? acct.toLowerCase() : null;
  if (!acct){ S.recs=[]; S.myStreets=[]; renderMine(); return; }
  await loadWorld();
}

async function loadWorld(){
  els.view.innerHTML=`<div class="empty">loading the world…</div>`;
  let recs=[]; try{ recs=((await loadChainMintRecords())||{}).records||[]; }catch(e){ toast('could not load cubes: '+msg(e),true); }
  deriveWorld(recs);
  S.mode==='mine'?renderMine():renderMove();
}
// Rebuild every derived view (bySlot, my cubes/streets/merged) from the raw records — the chain
// snapshot on a load, or the locally-edited records after an optimistic move/merge.
function deriveWorld(recs){
  const mine=r=>String(r.wallet||'').toLowerCase()===S.me;
  S.recs=recs; S.bySlot=new Map(); S.merged=new Set();
  for (const r of recs){ S.bySlot.set(Number(r.slot), r); if (r.sourceKindNumber===3) S.merged.add(Math.floor(Number(r.slot)/8)); }
  S.myCubes = recs.filter(r=>r.sourceKindNumber!==3 && mine(r))
    .map(r=>({cubeId:r.cubeId, slot:Number(r.slot), seed:r.seed, biome:biomeForStreet(Math.floor(Number(r.slot)/8))}));
  S.myMerged = recs.filter(r=>r.sourceKindNumber===3 && mine(r))
    .map(r=>({sid:Math.floor(Number(r.slot)/8), cubeId:r.cubeId, seed:r.seed, biome:biomeForStreet(Math.floor(Number(r.slot)/8)), pending:!!r._optimistic}));
  const sids=new Set(S.myCubes.map(c=>Math.floor(c.slot/8)).filter(sid=>!S.merged.has(sid)));
  S.myStreets=[...sids].map(streetData);
}
function renderCurrent(){ S.mode==='mine'?renderMine():renderMove(); }

// ---------- optimistic local updates (instant, indexer-independent) ----------
// The acting user's own move/merge is reflected the moment the tx CONFIRMS, by editing the local
// records — no wait for the indexer snapshot. reconcileAfter() then keeps the optimistic state
// on screen (it does NOT let a stale snapshot overwrite it) until the snapshot actually reflects
// the change, then adopts the real data. So: instant for the person acting, correct for everyone.
function optimisticMove(cubeId, toSlot){
  const rec=S.recs.find(r=>Number(r.cubeId)===Number(cubeId)); if(!rec) return;
  const from=Number(rec.slot);
  const occ=S.recs.find(r=>Number(r.slot)===Number(toSlot) && Number(r.cubeId)!==Number(cubeId));
  if(occ) occ.slot=from;            // displacement → the occupant swaps to the mover's old slot
  rec.slot=Number(toSlot);
}
function optimisticMerge(sid, leaderCubeId){
  const plots=S.recs.filter(r=>Math.floor(Number(r.slot)/8)===Number(sid) && r.sourceKindNumber!==3);
  if(!plots.length) return;
  const leader=plots.find(r=>Number(r.cubeId)===Number(leaderCubeId)) || plots[0];
  const ids=new Set(plots.map(r=>Number(r.cubeId)));
  S.recs=S.recs.filter(r=>!ids.has(Number(r.cubeId)));   // plots are burned
  // Placeholder merged token so the street shows as MERGED immediately (glyph art until the real
  // token — with baked art — arrives on reconcile). Real id is unknown client-side; leader's is fine.
  S.recs.push({ cubeId:leader.cubeId, slot:Number(sid)*8, wallet:S.me, sourceKind:'external',
    sourceKindNumber:3, seed:leader.seed, source:leader.source||{chain:'ethereum',chainId:1,contract:'',tokenId:''}, art:null, _optimistic:true });
}
// True once the snapshot records reflect every pending op (so we can safely adopt the snapshot).
function opsReflected(recs, ops){
  const bySlot=new Map(), byCube=new Map();
  for(const r of recs){ bySlot.set(Number(r.slot),r); byCube.set(Number(r.cubeId),r); }
  for(const op of ops){
    if(op.type==='move'){ const r=byCube.get(Number(op.cubeId)); if(!r || Number(r.slot)!==Number(op.toSlot)) return false; }
    else if(op.type==='merge'){ const base=op.sid*8; for(let k=0;k<8;k++){ const r=bySlot.get(base+k); if(r && r.sourceKindNumber!==3) return false; } }
  }
  return true;
}
// Apply ops to the local records + render now (instant). Callers apply per-tx for progressive
// feedback, or all at once, then call startReconcile once.
function applyOps(ops){
  for(const op of ops){ if(op.type==='move') optimisticMove(op.cubeId, op.toSlot); else if(op.type==='merge') optimisticMerge(op.sid, op.leaderCubeId); }
  deriveWorld(S.recs); renderCurrent();
}
// Poll the snapshot in the background; KEEP the optimistic view until the snapshot reflects every
// op (never let a stale snapshot overwrite it), then adopt the real data (picking up anyone else's
// changes too). Gives up after ~2.5 min (covers the 120s indexer timer + slack).
async function worldVersion(){ try{ const r=await fetch('/api/world-version',{cache:'no-store'}); return (await r.json()).version||0; }catch{ return 0; } }
function startReconcile(ops){
  // Poll the tiny /api/world-version marker every 5s (a few bytes, no RPC). Only when the snapshot
  // ACTUALLY changed do we download the multi-MB file and check whether it reflects our ops — then
  // adopt it. Keeps the optimistic view up meanwhile; gives up after ~3.5 min.
  let tries=0, baseVer=null;
  const tick=async()=>{
    tries++;
    const ver=await worldVersion();
    if(baseVer==null){ baseVer=ver; setTimeout(tick,5000); return; }
    const timedOut = tries>=42;
    if((ver && ver!==baseVer) || timedOut){
      invalidateWorldSnapshot();
      let recs=null; try{ recs=((await loadChainMintRecords())||{}).records||[]; }catch{}
      if(recs && (opsReflected(recs, ops) || timedOut)){ deriveWorld(recs); renderCurrent(); return; }
      baseVer=ver; // this snapshot didn't include our change yet — wait for the next version
    }
    setTimeout(tick, 5000);
  };
  setTimeout(tick, 3000);
}
function commitOptimistic(ops){ applyOps(ops); startReconcile(ops); }

function streetData(sid){
  const base=sid*8, plots=[];
  for (let k=0;k<8;k++){ const r=S.bySlot.get(base+k);
    plots.push(r ? { owner:String(r.wallet||'').toLowerCase()===S.me?'me':'rival', cubeId:r.cubeId, seed:r.seed, slot:base+k } : null); }
  return { sid, base, plots, biome:biomeForStreet(sid) };
}
const count = s => ({ me:s.plots.filter(p=>p&&p.owner==='me').length, rival:s.plots.filter(p=>p&&p.owner==='rival').length, vac:s.plots.filter(p=>!p).length });

// merge = sole occupier of >= 5 filled; you merge WITH vacants (never fill them for a merge you can do)
function analyze(s){const c=count(s),me=c.me,rival=c.rival,vac=c.vac;
  if(rival===0){ if(me>=5) return {kind:'ready',d:0}; return {kind:'fill',need:5-me,d:5-me}; }
  if(me>=5) return {kind:'evict',need:rival,d:rival};
  if(me+vac>=5) return {kind:'grow',need:5-me,d:(5-me)+rival};
  return {kind:'locked',d:100};}
// Merge fee = empty plots × baseFee (each vacant plot the merge absorbs). Only truly free at 8/8.
function mergeFeeEst(s){ return count(s).vac * feeBase(); }
function mergeFeeLabel(s){ const f=mergeFeeEst(s); return f>0 ? fmtEth(f) : 'free'; }
function actionLine(s){const c=count(s),m=analyze(s),wf=s.biome.weight;
  if(m.kind==='ready') return {lead:'MERGE NOW → merged street',fee:mergeFeeLabel(s)};
  if(m.kind==='fill') return {lead:`move in ${m.need} more → MERGE`,fee:''};
  if(m.kind==='evict') return {lead:`evict ${c.rival} rival${c.rival>1?'s':''} → MERGE`,fee:'from '+fmtEth(feeBase()+(wf-1)*feePremium())};
  if(m.kind==='grow') return {lead:`move in ${m.need} to take control`,fee:''};
  return {lead:`you ${c.me}/8 · acquire more to act`,fee:''};}

// ---------- batch plan (multi move / multi evict → merge) ----------
// Your cubes on OTHER streets — the pool you draw from to fill vacants and to swap-in for evicts.
function spareCubes(s){ return S.myCubes.filter(c=>Math.floor(c.slot/8)!==s.sid); }
// Full sequence that takes a street to merge-ready: fill vacants to reach 5/8, THEN evict rivals
// (order matters — you need majority before you can displace), then merge. Assigns your off-street
// cubes in order. If you don't have enough, returns ok:false with the partial it CAN do + the shortfall.
function buildPlan(s){
  const c=count(s), me=c.me, rival=c.rival, vac=c.vac, spare=spareCubes(s);
  const vacantSlots=s.plots.map((p,i)=>p?null:s.base+i).filter(x=>x!==null);
  const rivalPlots=s.plots.map((p,i)=>p&&p.owner==='rival'?{slot:s.base+i,cubeId:p.cubeId}:null).filter(Boolean);
  if(rival===0 && me>=5) return {kind:'ready',steps:[],mergeAfter:true,ok:true,need:0,have:spare.length,needFill:0,needEvict:0,me,rival,vac};
  let kind, needFill=0, needEvict=0;
  if(rival===0 && me<5){ kind='fill'; needFill=Math.min(5-me,vacantSlots.length); }
  else if(me>=5 && rival>0){ kind='evict'; needEvict=rival; }
  else if(me<5 && me+vac>=5 && rival>0){ kind='grow'; needFill=5-me; needEvict=rival; }
  else return {kind:'locked',steps:[],mergeAfter:false,ok:false,need:0,have:spare.length,needFill:0,needEvict:0,me,rival,vac};
  const need=needFill+needEvict, steps=[]; let si=0;
  for(let i=0;i<needFill && si<spare.length;i++) steps.push({type:'fill',cube:spare[si++],slot:vacantSlots[i]});
  const reaches5 = me>=5 || (me + Math.min(needFill,spare.length))>=5; // evicts need majority first
  if(reaches5) for(let i=0;i<needEvict && si<spare.length;i++) steps.push({type:'evict',cube:spare[si++],slot:rivalPlots[i].slot,rivalCubeId:rivalPlots[i].cubeId});
  const ok = spare.length>=need;
  return {kind,steps,mergeAfter:ok,ok,need,have:spare.length,needFill,needEvict,me,rival,vac};
}
// The clear "what to do" when you can't finish — the user asked for this to be explicit.
function planWarn(s,plan){
  if(plan.kind==='ready'||plan.ok) return '';
  if(plan.kind==='locked') return `You hold <b>${plan.me}/8</b> with <b>${plan.rival}</b> rival${plan.rival>1?'s':''} and only <b>${plan.vac}</b> open plot${plan.vac!==1?'s':''}. You can't reach 5/8 control, so you can't evict or merge this street. To act you need more of your OWN cubes here — mint into this street or wait for plots to open. Rivals can't be displaced without majority.`;
  const short=plan.need-plan.have;
  let what;
  if(plan.kind==='fill') what=`Move or mint <b>${short}</b> more cube${short>1?'s':''} (onto any other street), then come back and finish.`;
  else if(plan.kind==='evict') what=`Each eviction swaps in one of your cubes from elsewhere. You need <b>${plan.needEvict}</b> and have <b>${plan.have}</b> — bring/mint <b>${short}</b> more.`;
  else what=`You need <b>${plan.needFill}</b> to reach 5/8 control + <b>${plan.needEvict}</b> to evict = <b>${plan.need}</b> cubes from other streets. You have <b>${plan.have}</b>. Get <b>${short}</b> more.`;
  return `⚠ Not enough cubes to merge this street. ${what}${plan.steps.length?` You can do <b>${plan.steps.length}</b> now — it won't merge yet, but gets you closer.`:''}`;
}

// ---------- MY STREETS ----------
function renderMine(){
  if (!S.me){ els.view.innerHTML=`<div class="empty">connect a wallet to see your streets</div>`; return; }
  const merged=S.myMerged||[];
  if (!S.myStreets.length && !merged.length){ els.view.innerHTML=`<div class="empty">you don't hold a cube on any street yet.<br>use “Move a cube” to stake one.</div>`; return; }
  const sorted=[...S.myStreets].sort((a,b)=>analyze(a).d-analyze(b).d);
  const mergedSec = merged.length ? `<div class="barrow">✦ your <b style="color:#ffd479;margin-left:4px">merged streets</b></div>
    <div class="list">${merged.map(mergedCardHTML).join('')}</div>` : '';
  const streetsSec = sorted.length ? `<div class="barrow">your streets · sorted by <b style="color:var(--ink);margin-left:4px">closest to merge</b></div>
    <div class="list">${sorted.map(cardHTML).join('')}</div>` : '';
  els.view.innerHTML=`${mergedSec}${streetsSec}
    <div class="legend"><span><i class="me"></i>yours</span><span><i class="rv"></i>rival</span><span><i class="vc"></i>vacant</span></div>`;
  els.view.querySelectorAll('.card:not(.merged)').forEach(el=>el.onclick=()=>openDetail(S.myStreets.find(s=>s.sid==el.dataset.sid)));
}
// A merged street: one token that IS the whole street. Highlighted gold, badged, not clickable
// into the merge flow (nothing left to do). Shows its on-chain thumbnail once loaded.
function mergedCardHTML(s){
  // The merged token's server-rendered art fills the card as a background (reliable — the
  // on-chain 3D animation currently reverts for merged-street tokens). MERGED label + street
  // id overlaid; no merge button (nothing left to do). See loadMergedThumbs (disabled).
  // `pending` = just merged this session, real token not in the snapshot yet → glyph art +
  // "finalizing" (the burned leader can't be rendered on-chain); the reconcile swaps in the real card.
  const bg = s.pending
    ? `<div class="mgbg pendingart">${glyph(s.seed)}</div>`
    : `<img class="mgbg" src="/api/thumbnail?cube=${s.cubeId}" alt="Street ${s.sid} merged" loading="lazy" decoding="async">`;
  return `<div class="card merged" data-sid="${s.sid}">
    ${bg}
    <div class="mgveil"></div>
    <div class="mgtop"><span class="mbadge">✦ MERGED</span><span class="mgbiome">${s.biome.emoji} ${capWord(s.biome.name)}</span></div>
    <div class="mgbot"><span class="mgttl">Street ${s.sid}</span><span class="mgsub">${s.pending?'merged · finalizing…':`one token · the whole street · #${s.cubeId}`}</span></div>
  </div>`; }
function cardHTML(s){const c=count(s),m=analyze(s),a=actionLine(s),cls=m.kind==='ready'?'ready':(m.kind==='locked'?'locked':'');
  return `<div class="card ${cls}" data-sid="${s.sid}">
    <div class="hd"><span>Street ${s.sid}</span><span class="biome">${s.biome.emoji} ${s.biome.name}</span><span class="count">you <b>${c.me}</b>/8</span></div>
    <div class="plots">${s.plots.map(plotChip).join('')}</div>
    <div class="act"><span class="lead">▸ ${a.lead}</span><span class="fee">${a.fee}</span></div></div>`;}
function plotChip(p){ if(!p) return `<div class="plot vac">+</div>`; return `<div class="plot ${p.owner}">${chipArt(p.cubeId,p.seed)}</div>`;}

// ---------- STREET DETAIL ----------
function openDetail(s){ S.detail=s; S.staged=null; const mine=s.plots.find(p=>p&&p.owner==='me'); S.leaderPick=mine?mine.cubeId:null; renderDetail(); openSheet(); }
function isMergeReady(){ const s=S.detail; if(!s) return false; const c=count(s); return c.rival===0 && c.me>=5; }
async function loadThumbs(s){
  for (const p of s.plots){ if (!p || S.thumbCache.has(p.cubeId)) continue;
    try{ const svg=await cubeThumbnailSVG(p.cubeId); S.thumbCache.set(p.cubeId,svg); if(S.detail===s) renderDetail(); }catch{} }
}
// Lazily fetch each cube's REAL on-chain thumbnail into S.thumbCache, then re-render once so
// the finder strip + pick-cube popup show the same art as the detail sheet (the `glyph` is only
// a placeholder shown while loading). Cached → each cube is fetched at most once.
async function ensureCubeThumbs(cubes, onLoaded){
  let any=false;
  for(const c of cubes){ const id=c&&c.cubeId; if(id==null||S.thumbCache.has(id)) continue;
    try{ S.thumbCache.set(id, await cubeThumbnailSVG(id)); any=true; }catch{} }
  if(any && onLoaded) onLoaded();
}
function renderDetail(){
  const s=S.detail,c=count(s),m=analyze(s);
  els.sheetbody.innerHTML=`
    <div class="dhd"><span class="t">Street ${s.sid}</span><span class="b">${s.biome.emoji} ${s.biome.name} · you ${c.me}/8</span><button class="close">✕</button></div>
    <div class="dplots">${s.plots.map((p,i)=>dplot(p,i)).join('')}</div>
    <div class="locbar">
      <div class="locinfo"><div class="biomehead">${s.biome.emoji} ${capWord(s.biome.name)} · <span class="rar">${biomePct(s.biome.name)}%</span></div><div class="where">region ${(s.sid/64|0)} · nbhd ${(s.sid/8|0)%8} · street ${s.sid%8}</div></div>
      <div class="locmini">${locatorSVG(s.sid)}</div>
    </div>
    ${statusHTML(s,c,m)}${stagedHTML()}
    <div class="actions" id="det-actions"></div>`;
  els.sheetbody.querySelector('.close').onclick=closeSheet;
  els.sheetbody.querySelectorAll('.dplot').forEach(el=>el.onclick=()=>onPlot(+el.dataset.i));
  renderDetActions(s,m);
}
// Is plot i part of the current staged action? 'fill' | 'evict' | null (single-tap or batch).
function stagedActionAt(i){
  if(!S.staged) return null;
  if(S.staged.type==='evict') return S.staged.steps.some(x=>x.slotIdx===i)?'evict':null;
  if(S.staged.slotIdx===i) return S.staged.type;
  if(S.staged.type==='batch' && S.detail){ const step=S.staged.plan.steps.find(x=>x.slot===S.detail.base+i); return step?step.type:null; }
  return null;
}
function dplot(p,i){ const sa=stagedActionAt(i);
  const lead = isMergeReady() && p && p.owner==='me' && p.cubeId===((S.staged&&S.staged.type==='merge')?S.staged.leader:S.leaderPick);
  const st=(sa==='fill'||sa==='evict')?' staged':(lead?' lead':'');
  const pin = sa==='evict'?'evicting →':(sa==='fill'?'moving in →':(lead?'★ face':(!p?'vacant':(p.owner==='me'?'you':'rival'))));
  if(!p) return `<div class="dplot vac${st}" data-i="${i}">${st?'◆':'+'}<span class="pin">${pin}</span></div>`;
  return `<div class="dplot ${p.owner}${st}" data-i="${i}">${chipArt(p.cubeId,p.seed)}<span class="pin">${pin}</span></div>`;}
function statusHTML(s,c,m){
  if(m.kind==='ready') return `<div class="status ready">✦ Sole occupier of ${c.me} plots, no rivals — <b>merge now</b> into one merged street. ${c.vac>0?`The ${c.vac} vacant plot${c.vac!==1?'s':''} lock into the street for <b>${mergeFeeLabel(s)}</b> (${feeBase()/1e18} Ξ each); you don't fill them.`:`All 8 plots filled — merge is <b>free</b>.`}</div>`;
  if(m.kind==='fill') return `<div class="status">Sole occupier but only ${c.me} filled. Move in <b>${m.need} more</b> of your cubes (tap a vacant plot) to reach 5, then merge.</div>`;
  if(m.kind==='evict') return `<div class="status">You <b>control</b> this street (${c.me}/8). <b>Evict</b> the ${c.rival} rival${c.rival>1?'s':''} — tap a red plot — then merge.</div>`;
  if(m.kind==='grow') return `<div class="status">You hold ${c.me}/8. Move <b>${m.need} more</b> in (tap vacant plots) to reach 5/8 control, then evict.</div>`;
  return `<div class="status">You hold ${c.me}/8 and can't reach 5/8 control here yet.</div>`;}
const WARNBOX='color:#ffcf9e;border:1px solid #7a4420;background:#1c1206;padding:9px 11px;border-radius:8px;line-height:1.55;font-size:12px';
function renderDetActions(s,m){
  const a=$('det-actions');
  if(S.staged){ a.innerHTML=''; return; } // a confirm sheet is showing — don't double the button
  const movesOn=S.flags?S.flags.movesEnabled:true, mergesOn=S.flags?S.flags.mergesEnabled:true;
  const plan=buildPlan(s);
  if(plan.kind==='ready'){
    const feeLbl = mergeFeeEst(s)>0 ? `${mergeFeeLabel(s)} (${count(s).vac} empty plot${count(s).vac!==1?'s':''}) · irreversible` : 'free · irreversible';
    a.innerHTML=`<button class="act merge" id="merge" ${mergesOn?'':'disabled'}>⬧ Merge into one street</button><div class="hint">${mergesOn?feeLbl:'merging is paused on-chain'}</div>`;
    if(mergesOn)$('merge').onclick=()=>stageMerge(); return; }
  if(plan.kind==='locked' || (!plan.ok && plan.steps.length===0)){ a.innerHTML=`<div style="${WARNBOX}">${planWarn(s,plan)}</div>`; return; }
  const label = plan.kind==='evict' ? `Evict ${plan.needEvict} rival${plan.needEvict>1?'s':''} & merge`
    : plan.kind==='fill' ? `Move in ${plan.needFill} & merge`
    : `Take control & merge`;
  const cnt = plan.ok ? `${plan.need} move${plan.need>1?'s':''}${plan.mergeAfter?' + merge':''}` : `${plan.steps.length} of ${plan.need} — not enough cubes`;
  a.innerHTML=`<button class="act ${plan.ok?'primary':'warn2'}" id="batch" ${movesOn?'':'disabled'}>${plan.ok?'⬧ ':'▸ '}${label}</button>
    <div class="hint">${!movesOn?'moving is paused on-chain':`one flow · ${cnt}`}</div>
    <div class="hint" style="opacity:.55">or tap a ${plan.me>=5?'red plot to evict, or a ':''}vacant plot to do one at a time</div>`;
  if(movesOn)$('batch').onclick=()=>stageBatch(s);
}
function onPlot(i){ const s=S.detail,p=s.plots[i];
  // On a merge-ready street, tapping one of your plots picks it as the "face" (leader).
  if(isMergeReady() && p && p.owner==='me'){ S.leaderPick=p.cubeId; if(S.staged&&S.staged.type==='merge') S.staged.leader=p.cubeId; renderDetail(); return; }
  if(!(S.flags?S.flags.movesEnabled:true)) return toast('moving is paused on-chain',true);
  if(!p) startFill(i);
  else if(p.owner==='rival'){ if(count(s).me>=5) addEvict(i); else toast('need 5/8 control to evict',true); }
  else toast('that plot is already yours');
}

// ---------- stage: merge / fill / evict → confirm ----------
function stageMerge(){ const s=S.detail;
  S.staged={type:'merge', leader:S.leaderPick||0}; renderDetail();
  quoteMerge({street:s.sid}).then(q=>{ if(S.staged&&S.staged.type==='merge'){ S.staged.fee=q.fee; renderDetail(); } }).catch(()=>{}); }
function startFill(i){ const s=S.detail; pickCube('Move which cube here?', s, s.base+i, false, cube=>{ S.staged={type:'fill',slotIdx:i,incoming:cube,slot:s.base+i}; renderDetail();
  quoteMove({cubeId:cube.cubeId,newSlot:s.base+i}).then(q=>{ if(S.staged&&S.staged.incoming===cube){ S.staged.fee=q.fee; renderDetail(); } }).catch(()=>{}); }); }
// Accumulate evictions: each red-plot tap picks a cube to swap in and ADDS to the staged list
// (multi-select), so you clear several rivals — and merge — in one guided flow. A cube can only
// be staged once (excluded from later picks); when all rivals are staged the flow offers merge.
function addEvict(i){ const s=S.detail, p=s.plots[i], slot=s.base+i;
  if(S.staged && S.staged.type!=='evict') return toast('finish the current action first',true);
  if(S.staged && S.staged.steps.some(x=>x.slot===slot)) return toast('that rival is already staged',true);
  const used=new Set((S.staged&&S.staged.steps)?S.staged.steps.map(x=>x.incoming.cubeId):[]);
  pickCube('Which of your cubes swaps in?', s, slot, true, cube=>{
    if(!S.staged||S.staged.type!=='evict') S.staged={type:'evict', steps:[], leader:S.leaderPick||0};
    const step={slot, slotIdx:i, incoming:cube, rivalCubeId:p.cubeId, fee:null, victim:null, victimShare:null, houseShare:null};
    S.staged.steps.push(step); renderDetail();
    quoteMove({cubeId:cube.cubeId,newSlot:slot}).then(q=>{ Object.assign(step,{fee:q.fee,victim:q.victim,victimShare:q.victimShare,houseShare:q.houseShare}); renderDetail(); }).catch(()=>{});
  }, used); }

// "Pick the face" — which of your cubes on the street becomes the merged token's primary
// thumbnail (the OpenSea view). Passed to mergeStreet(street, leaderCubeId).
function leaderPickerHTML(leaders, selected){
  if(!leaders || leaders.length<2) return '';
  return `<div style="font-size:11px;color:var(--faint);margin:8px 0 5px">pick the <b style="color:var(--ink)">face</b> — this cube's art becomes the merged token's thumbnail</div>
    <div class="leadgrid">${leaders.map(p=>`<div class="lead ${selected===p.cubeId?'sel':''}" data-lead="${p.cubeId}">${chipArt(p.cubeId,p.seed,p.atSlot)}<span class="ll">#${p.cubeId}</span></div>`).join('')}</div>`;
}
function stagedHTML(){ if(!S.staged) return ''; const st=S.staged,s=S.detail;
  const quoting='<span style="color:var(--faint)">quoting…</span>';
  if(st.type==='batch'){ const p=st.plan, q=st.quoted;
    const rows=(q||p.steps).map(x=>{ const ev=x.type==='evict'; const fee=(x.q!==undefined)?(x.q?fmtEth(x.q.fee):'—'):quoting;
      return `<div class="kv"><span>${ev?'evict rival':'move to vacant'} · cube #${x.cube.cubeId}</span><b>${fee}</b></div>`; }).join('');
    let total=null, vpay=0n;
    if(q){ total=q.reduce((a,x)=>a+(x.q?BigInt(x.q.fee):0n),0n)+(st.mergeFee||0n); vpay=q.reduce((a,x)=>a+(x.q&&x.q.victimShare?BigInt(x.q.victimShare):0n),0n); }
    const warn = st.warn?`<div style="${WARNBOX};margin:2px 0 10px">${st.warn}</div>`:'';
    const canGo = p.steps.length>0 && (S.flags?S.flags.movesEnabled:true);
    const go = p.ok?`Do it → (${p.steps.length}${p.mergeAfter?' + merge':''})`:`Do ${p.steps.length} now →`;
    return `<div class="confirm"><h3>${p.kind==='evict'?'Evict rivals & merge':p.kind==='fill'?'Move in & merge':'Take control & merge'}</h3>
      ${warn}
      <div class="kv"><span>your cubes used (from other streets)</span><b>${p.steps.length} · you have ${p.have}</b></div>
      ${rows}
      ${p.mergeAfter?leaderPickerHTML(st.leaders, st.leader):''}
      ${p.mergeAfter?`<div class="kv"><span>then merge → 1 token</span><b>${st.mergeFee==null?quoting:fmtEth(st.mergeFee)}</b></div>`:''}
      <div class="kv" style="border-top:1px solid #ffffff1f;margin-top:4px;padding-top:6px"><span>total to pay</span><b>${total==null?quoting:fmtEth(total)}</b></div>
      ${vpay>0n?`<div class="kv"><span class="pay">→ of which paid to displaced owners</span><b class="pay">${fmtEth(vpay)}</b></div>`:''}
      ${p.needEvict>0?`<div class="kv"><span class="cool">cooldown</span><b class="cool">each evicted owner is protected 15 min</b></div>`:''}
      <div class="row" style="margin-top:10px"><button class="act ghost" id="discard">Discard</button>${canGo?`<button class="act ${p.ok?'primary':'warn2'}" id="commitbatch">${go}</button>`:''}</div></div>`;
  }
  if(st.type==='merge') return `<div class="confirm"><h3>Confirm merge</h3>
    <div class="kv"><span>collapse into 1 merged street</span><b>${count(s).me} cubes → 1 token</b></div>
    <div class="kv"><span>face (thumbnail)</span><b>#${st.leader} <span style="color:var(--faint);font-weight:400">· tap a plot to change</span></b></div>
    <div class="kv"><span>fee</span><b>${st.fee==null?quoting:fmtEth(st.fee)}</b></div>
    <div class="row" style="margin-top:10px"><button class="act ghost" id="discard">Discard</button><button class="act merge" id="commit">Merge on-chain →</button></div></div>`;
  if(st.type==='fill') return `<div class="confirm"><h3>Confirm move</h3>
    <div class="kv"><span>move</span><b>#${st.incoming.cubeId} → street ${s.sid}</b></div>
    <div class="kv"><span>fee (to the house)</span><b>${st.fee==null?quoting:fmtEth(st.fee)}</b></div>
    <div class="row" style="margin-top:10px"><button class="act ghost" id="discard">Discard</button><button class="act primary" id="commit">Confirm move →</button></div></div>`;
  // Accumulating multi-evict: each staged rival listed; tap more red plots to add. When every
  // rival is staged and you'll hold 5/8, the flow finishes with a merge (pick the face).
  const c=count(s), rivalsLeft=c.rival-st.steps.length, willMerge=rivalsLeft<=0 && c.me>=5;
  const total=st.steps.reduce((a,x)=>a+(x.fee?BigInt(x.fee):0n),0n);
  const vpay=st.steps.reduce((a,x)=>a+(x.victimShare?BigInt(x.victimShare):0n),0n);
  // Face options after the swaps: your existing cubes (current slot art) + each swapping-in
  // cube previewed at the slot it'll land on (atSlot → destination colours in the picker).
  const leaders=[...s.plots.filter(p=>p&&p.owner==='me').map(p=>({cubeId:p.cubeId,seed:p.seed})),
    ...st.steps.map(x=>({cubeId:x.incoming.cubeId, seed:x.incoming.seed, atSlot:x.slot}))];
  const rows=st.steps.map((x,i)=>`<div class="kv"><span>evict rival → swap in #${x.incoming.cubeId}</span><b>${x.fee!=null?fmtEth(x.fee):quoting} <button class="evx" data-ev="${i}" title="remove">✕</button></b></div>`).join('');
  return `<div class="confirm"><h3>Evict ${st.steps.length} rival${st.steps.length!==1?'s':''}${willMerge?' & merge':''}</h3>
    ${rows}
    <div class="kv" style="border-top:1px solid #ffffff1f;margin-top:4px;padding-top:6px"><span>total to pay</span><b>${fmtEth(total)}</b></div>
    ${vpay>0n?`<div class="kv"><span class="pay">→ of which paid to displaced owners</span><b class="pay">${fmtEth(vpay)}</b></div>`:''}
    <div class="kv"><span class="cool">cooldown</span><b class="cool">each evicted owner protected 15 min</b></div>
    ${willMerge?leaderPickerHTML(leaders, st.leader):''}
    <div class="hint" style="opacity:.6;margin-top:6px">${rivalsLeft>0?`tap ${rivalsLeft} more red plot${rivalsLeft>1?'s':''} to stage ${rivalsLeft>1?'them':'it'} too`:'all rivals staged — ready to merge'}</div>
    <div class="row" style="margin-top:10px"><button class="act ghost" id="discard">Discard</button><button class="act warn2" id="commitevict">${willMerge?`Evict ${st.steps.length} + merge →`:`Evict ${st.steps.length} →`}</button></div></div>`;}

// After a move/merge mines, the snapshot only reflects it once the indexer folds the new
// event (it polls ~1s). Reload now + a few staggered times so the merged card / new state
// reliably appears without a manual refresh, whatever the indexer lag.
// Re-read the snapshot now + a few staggered times, INVALIDATING the memoized fetch each
// time (else fetchWorldSnapshot returns the page's first snapshot forever and the UI never
// reflects the just-mined move/merge). Staggered so the indexer (polls ~1s) has folded it.
function reloadWorldRepeatedly(){ const go=()=>{ invalidateWorldSnapshot(); if(S.me) loadWorld(); };
  go(); [1500,3500,6000,9500,13000].forEach(ms=>setTimeout(go,ms)); }
function wireStaged(){ const d=$('discard'),c=$('commit'),b=$('commitbatch'),e=$('commitevict');
  if(d)d.onclick=()=>{S.staged=null;renderDetail();}; if(c)c.onclick=commitStaged; if(b)b.onclick=commitBatch; if(e)e.onclick=commitEvict;
  document.querySelectorAll('.evx').forEach(el=>el.onclick=()=>{ if(S.staged&&S.staged.steps){ S.staged.steps.splice(+el.dataset.ev,1); if(!S.staged.steps.length) S.staged=null; renderDetail(); } });
  document.querySelectorAll('.lead').forEach(el=>el.onclick=()=>{ if(S.staged){ S.staged.leader=Number(el.dataset.lead); renderDetail(); } }); }
// Run the staged evictions in order (each displacement is its own tx — no on-chain multicall),
// then merge if that leaves you sole owner of 5+. Reloads reliably via the invalidating refresh.
async function commitEvict(){ const st=S.staged,s=S.detail,owner=walletAccount()||S.me,btn=$('commitevict');
  if(btn)btn.disabled=true; let done=0;
  const c=count(s), willMerge=(c.rival-st.steps.length)<=0 && c.me>=5;
  try{
    for(const step of st.steps){ if(btn)btn.textContent=`evicting ${done+1}/${st.steps.length}…`; await moveCube({cubeId:step.incoming.cubeId,owner,newSlot:step.slot}); done++; }
    if(willMerge){ if(btn)btn.textContent='merging…'; await mergeStreet({street:s.sid,owner,leaderCubeId:st.leader}); }
    const ops=st.steps.map(step=>({type:'move', cubeId:step.incoming.cubeId, toSlot:step.slot}));
    if(willMerge) ops.push({type:'merge', sid:s.sid, leaderCubeId:st.leader});
    toast(willMerge?'✦ Rivals evicted + merged':`✓ ${done} rival${done!==1?'s':''} evicted`, willMerge?'gold':undefined);
    S.staged=null; closeSheet(); commitOptimistic(ops);
  }catch(err){ S.staged=null; toast(`stopped after ${done}/${st.steps.length}: ${msg(err)}`,true); closeSheet(); reloadWorldRepeatedly(); }
}
async function commitStaged(){ const st=S.staged,s=S.detail,owner=walletAccount()||S.me;
  const btn=$('commit'); if(btn){btn.disabled=true;btn.textContent='confirming…';}
  try{
    if(st.type==='merge') await mergeStreet({street:s.sid,owner,leaderCubeId:st.leader});
    else await moveCube({cubeId:st.incoming.cubeId,owner,newSlot:st.slot});
    const op = st.type==='merge' ? {type:'merge', sid:s.sid, leaderCubeId:st.leader} : {type:'move', cubeId:st.incoming.cubeId, toSlot:st.slot};
    toast(st.type==='merge'?'✦ Merged into one street':(st.type==='evict'?'✓ Rival evicted + paid':'✓ Moved in'), st.type==='merge'?'gold':undefined);
    S.staged=null; closeSheet();
    commitOptimistic([op]);
  }catch(e){ toast((st.type||'action')+' failed: '+msg(e),true); if(btn){btn.disabled=false;renderDetail();} }
}

// ---------- batch: stage the whole plan, quote every step, run it as one guided flow ----------
function stageBatch(s){
  const plan=buildPlan(s);
  const mine=s.plots.filter(p=>p&&p.owner==='me').map(p=>({cubeId:p.cubeId,seed:p.seed}));
  // your cubes on the street after the batch; moved-in cubes preview at their destination slot
  const leaders=[...mine, ...plan.steps.map(st=>({cubeId:st.cube.cubeId, seed:st.cube.seed, atSlot:st.slot}))];
  S.staged={type:'batch',plan,quoted:undefined,mergeFee:null,warn:planWarn(s,plan), leaders, leader:leaders[0]?leaders[0].cubeId:0};
  renderDetail();
  const qs=plan.steps.map(st=>quoteMove({cubeId:st.cube.cubeId,newSlot:st.slot}).then(q=>({...st,q})).catch(()=>({...st,q:null})));
  Promise.all(qs).then(async quoted=>{
    let mergeFee=0n; if(plan.mergeAfter){ try{ mergeFee=(await quoteMerge({street:s.sid})).fee; }catch{ mergeFee=0n; } }
    if(S.staged&&S.staged.type==='batch'){ S.staged.quoted=quoted; S.staged.mergeFee=mergeFee; renderDetail(); }
  });
}
// Sequential runner: each move must confirm before the next (fills must land before evicts get
// majority). On a mid-flow failure we stop, say how far we got, reload, and re-open the re-planned
// street so the user just taps again to finish.
async function commitBatch(){
  const st=S.staged,s=S.detail,owner=walletAccount()||S.me,p=st.plan;
  const btn=$('commitbatch'); if(btn)btn.disabled=true;
  let done=0;
  try{
    for(const step of p.steps){
      if(btn)btn.textContent=`${step.type==='evict'?'evicting':'moving'} ${done+1}/${p.steps.length}…`;
      await moveCube({cubeId:step.cube.cubeId,owner,newSlot:step.slot}); done++;
    }
    if(p.mergeAfter){ if(btn)btn.textContent='merging…'; await mergeStreet({street:s.sid,owner,leaderCubeId:st.leader}); }
    const ops=p.steps.map(step=>({type:'move', cubeId:step.cube.cubeId, toSlot:step.slot}));
    if(p.mergeAfter) ops.push({type:'merge', sid:s.sid, leaderCubeId:st.leader});
    toast(p.mergeAfter?'✦ Street merged into one token':`✓ ${done} move${done>1?'s':''} done`, p.mergeAfter?'gold':undefined);
    S.staged=null; closeSheet(); commitOptimistic(ops);
  }catch(e){
    S.staged=null;
    toast(`stopped after ${done}/${p.steps.length}: ${msg(e)}`,true);
    await loadWorld();
    const again=S.myStreets.find(x=>x.sid===s.sid);
    if(again){ S.detail=again; renderDetail(); } else closeSheet();
  }
}

// ---------- pick-cube (nested in the sheet) ----------
function pickCube(title, street, slot, displacement, cb, exclude){
  // a cube from ELSEWHERE moves in; `exclude` hides cubes already staged in this batch
  const avail=S.myCubes.filter(c=>Math.floor(c.slot/8)!==street.sid && !(exclude&&exclude.has(c.cubeId)));
  if(!avail.length){ toast(exclude&&exclude.size?'no more spare cubes to swap in':'you have no cube elsewhere to move in',true); return; }
  const back=els.sheetbody.innerHTML;
  // Only the DISPLACEMENT (evict) case involves a swap; filling a vacant plot does not.
  const sub=displacement
    ? 'the cube you pick swaps in; the rival you displace takes your cube&rsquo;s old slot'
    : 'pick one of your cubes to move into this vacant plot';
  let feeTxt='quoting…';
  function paint(){
    const grid=avail.map(c=>`<div class="pcube" data-id="${c.cubeId}">${chipArt(c.cubeId,c.seed)}<span class="lab">#${c.cubeId} ${c.biome.emoji}</span></div>`).join('');
    els.sheetbody.innerHTML=`<div class="dhd"><span class="t">${esc(title)}</span><button class="close">✕</button></div>
      <div style="color:var(--faint);font-size:11px;padding:0 0 6px">${sub}</div>
      <div style="font-size:11px;padding:0 0 8px">est. fee <b>${feeTxt}</b> <span style="color:var(--faint)">· exact shown on confirm</span></div>
      <div class="cubegrid">${grid}</div>`;
    els.sheetbody.querySelector('.close').onclick=()=>{ els.sheetbody.innerHTML=back; renderDetail(); };
    els.sheetbody.querySelectorAll('.pcube').forEach(el=>el.onclick=()=>{ const cube=avail.find(c=>c.cubeId==el.dataset.id); renderDetail(); cb(cube); });
  }
  paint();
  // Representative fee for THIS slot (the move fee is slot/biome-driven; the exact per-cube
  // quote appears in the staged confirm). Shown in all cases — fill and evict alike.
  quoteMove({cubeId:avail[0].cubeId,newSlot:slot})
    .then(q=>{ feeTxt='≈ '+fmtEth(q.fee); if(els.sheetbody.querySelector('.cubegrid')) paint(); })
    .catch(()=>{ feeTxt='~'+fmtEth(feeBase()); if(els.sheetbody.querySelector('.cubegrid')) paint(); });
}

// ---------- MOVE tab: your blocks grouped by biome → tap a green plot to batch-move ----------
// Rarest biome first (so rare stock/streets surface at the top of each list).
function groupCubesByBiome(cubes){ const g=new Map();
  for(const c of cubes){ const n=c.biome.name; if(!g.has(n)) g.set(n,{biome:c.biome,cubes:[]}); g.get(n).cubes.push(c); }
  return [...g.values()].sort((a,b)=>biomePct(a.biome.name)-biomePct(b.biome.name)); }
function groupStreetsByBiome(streets){ const g=new Map();
  for(const s of streets){ const n=s.biome.name; if(!g.has(n)) g.set(n,{biome:s.biome,streets:[]}); g.get(n).streets.push(s); }
  return [...g.values()].sort((a,b)=>biomePct(a.biome.name)-biomePct(b.biome.name)); }
const isRareBiome = name => biomePct(name) <= 11; // desert / mountain / ice
// How many of a cube's own street are yours with no rivals — the "near merge" badge on movers.
function streetNearMerge(slot){ const sid=Math.floor(slot/8); let me=0,rival=0;
  for(let k=0;k<8;k++){ const r=S.bySlot.get(sid*8+k); if(r){ String(r.wallet||'').toLowerCase()===S.me?me++:rival++; } }
  return (me>=4&&rival===0)?me:0; }
// The 8 plot cells of any street as little cubes: green vacant (tappable when armed) · gold yours · red taken.
function plotCells(sid, armed, queuedSlots){ const base=sid*8; let h='';
  for(let k=0;k<8;k++){ const slot=base+k, r=S.bySlot.get(slot);
    if(!r){ h+=`<div class="tp vac${queuedSlots.has(slot)?' queued':(armed?' arm':'')}" data-slot="${slot}" data-sid="${sid}" title="vacant">${queuedSlots.has(slot)?'◆':'+'}</div>`; }
    else { const mine=String(r.wallet||'').toLowerCase()===S.me; h+=`<div class="tp ${mine?'mine':'rival'}" title="${mine?'yours':'taken'}">${mine?'●':'✕'}</div>`; } }
  return h; }
// Streets you DON'T own that still have room — strategic new-territory targets. Emptiest first
// (easiest to build a fresh merge), then rarest biome. Optional biome filter (the chips).
function candidateStreets(filterBiome, limit){ const mine=new Set(S.myStreets.map(s=>s.sid)); const out=[];
  for(let sid=0; sid<512; sid++){ if(mine.has(sid)||S.merged.has(sid)) continue;
    const bi=biomeForStreet(sid); if(filterBiome && bi.name!==filterBiome) continue;
    let pop=0; for(let k=0;k<8;k++) if(S.bySlot.get(sid*8+k)) pop++;
    if(pop>=8) continue; out.push({sid, biome:bi, pop}); }
  out.sort((a,b)=> (a.pop-b.pop) || (biomePct(a.biome.name)-biomePct(b.biome.name)) || (a.sid-b.sid));
  return out.slice(0, limit||18); }

function renderMove(){
  if(!S.me){ els.view.innerHTML=`<div class="empty">connect a wallet first</div>`; return; }
  const queuedIds=new Set(S.moveQueue.map(m=>m.cube.cubeId));
  const queuedSlots=new Set(S.moveQueue.map(m=>m.slot));
  const avail=S.myCubes.filter(c=>!queuedIds.has(c.cubeId));
  const armed=(S.moveCube && !queuedIds.has(S.moveCube.cubeId)) ? S.moveCube : (S.moveCube=null);
  const movesOn=S.flags?S.flags.movesEnabled:true;

  const qtotal=S.moveQueue.reduce((a,m)=>a+(m.fee?BigInt(m.fee):0n),0n);
  const queueHTML=S.moveQueue.length?`<div class="barrow">batch · <b style="color:#ffd479;margin-left:4px">${S.moveQueue.length} move${S.moveQueue.length>1?'s':''} queued</b></div>
    <div class="mqueue">${S.moveQueue.map((m,i)=>`<div class="mqi"><span>#${m.cube.cubeId} → street ${m.sid} ${m.biome.emoji} ${capWord(m.biome.name)}</span><span>${m.fee!=null?fmtEth(m.fee):'…'} <button class="mqx" data-i="${i}" title="remove">✕</button></span></div>`).join('')}</div>
    <div class="mqbar"><span>total <b>${fmtEth(qtotal)}</b></span><button class="act primary" id="mqsend" ${movesOn?'':'disabled'}>Send all ${S.moveQueue.length} →</button></div>`:'';

  // 1 — your blocks, grouped + labelled by biome (rare biomes flagged, near-merge badged)
  const moverGroups=groupCubesByBiome(avail);
  const moversHTML = moverGroups.length ? moverGroups.map(g=>`<div class="bgroup">
      <div class="bghd">${g.biome.emoji} ${capWord(g.biome.name)} <span class="bgrar">${biomePct(g.biome.name)}%</span>${isRareBiome(g.biome.name)?'<span class="bgtag rare">★ rare</span>':''}<span class="bgcount">${g.cubes.length}</span></div>
      <div class="mgrid">${g.cubes.map(c=>{ const near=streetNearMerge(c.slot);
        return `<div class="mcube${armed&&armed.cubeId===c.cubeId?' armed':''}" data-id="${c.cubeId}">${chipArt(c.cubeId,c.seed)}<span class="mid">#${c.cubeId}</span>${near?`<span class="nearbadge" title="street ${Math.floor(c.slot/8)}: ${near}/8 yours">${near}/8</span>`:''}</div>`; }).join('')}</div>
    </div>`).join('') : `<div class="empty">all your cubes are queued</div>`;

  // 2a — destinations: your streets grouped by biome (build toward merges on streets you hold)
  const destGroups=groupStreetsByBiome(S.myStreets);
  const destHTML = destGroups.length ? destGroups.map(g=>`<div class="bgroup">
      <div class="bghd">${g.biome.emoji} ${capWord(g.biome.name)} <span class="bgrar">${biomePct(g.biome.name)}%</span>${isRareBiome(g.biome.name)?'<span class="bgtag rare">★ rare</span>':''}</div>
      ${g.streets.map(s=>{ const c=count(s); return `<div class="dstreet">
        <div class="dslab">Street ${s.sid} <span class="dsyou">you ${c.me}/8</span>${c.me>=4&&c.rival===0?'<span class="dsnear">near merge</span>':''}</div>
        <div class="dplotrow">${plotCells(s.sid, armed, queuedSlots)}</div>
      </div>`; }).join('')}
    </div>`).join('') : `<div class="empty">you're not on any street yet</div>`;

  // 2b — new territory: streets you DON'T own, emptiest+rarest first; biome chips to target a
  // rare type. Claim fresh ground to start a new merge or grab a scarce biome.
  const terrChips=`<div class="tchips"><div class="tchip${!S.terrBiome?' on':''}" data-terr="">all</div>${
    BIOMES_RARE_FIRST.map(n=>`<div class="tchip${S.terrBiome===n?' on':''}${isRareBiome(n)?' rare':''}" data-terr="${n}">${BIOME_EMOJI[n]} ${capWord(n)} ${biomePct(n)}%</div>`).join('')}</div>`;
  const cands=candidateStreets(S.terrBiome, 18);
  const terrHTML=`<div class="bgroup">${terrChips}
    ${cands.length ? cands.map(cs=>`<div class="dstreet">
        <div class="dslab">${cs.biome.emoji} ${capWord(cs.biome.name)} · Street ${cs.sid} <span class="dsyou">pop ${cs.pop}/8</span>${isRareBiome(cs.biome.name)?'<span class="dsnear">rare</span>':''}</div>
        <div class="dplotrow">${plotCells(cs.sid, armed, queuedSlots)}</div>
      </div>`).join('') : `<div class="empty">no open streets match</div>`}</div>`;

  els.view.innerHTML=`${queueHTML}
    <div class="barrow">1 · your blocks${armed?` — <b style="color:#ffd479">#${armed.cubeId} armed</b>`:' · tap one to move it'}</div>
    ${moversHTML}
    <div class="barrow">2 · ${armed?'tap a <b style="color:#48d19a">green</b> plot to send it there':'pick a block above first'}</div>
    ${!movesOn?'<div class="status">moving is paused on-chain — this is a preview.</div>':''}
    <div class="barrow" style="opacity:.75">your streets · build toward a merge</div>
    ${destHTML}
    <div class="barrow" style="opacity:.75">＋ new territory · claim fresh ground (emptiest + rarest first)</div>
    ${terrHTML}`;

  els.view.querySelectorAll('.mcube').forEach(el=>el.onclick=()=>{ const id=+el.dataset.id; S.moveCube=(armed&&armed.cubeId===id)?null:avail.find(c=>c.cubeId===id); renderMove(); });
  els.view.querySelectorAll('.tp.vac.arm').forEach(el=>el.onclick=()=>queueMoveTo(+el.dataset.slot,+el.dataset.sid));
  els.view.querySelectorAll('.tchip').forEach(el=>el.onclick=()=>{ S.terrBiome=el.dataset.terr||null; renderMove(); });
  els.view.querySelectorAll('.mqx').forEach(el=>el.onclick=()=>{ S.moveQueue.splice(+el.dataset.i,1); renderMove(); });
  const send=$('mqsend'); if(send) send.onclick=commitMoveQueue;
}
// Queue: armed block → a vacant slot. Fee quoted async; the queue is sent as one guided flow.
function queueMoveTo(slot,sid){
  const c=S.moveCube; if(!c) return toast('pick a block first',true);
  if(Math.floor(c.slot/8)===sid) return toast('that block is already on this street',true);
  if(S.moveQueue.some(m=>m.slot===slot)) return toast('already queued to that plot',true);
  const item={cube:c, slot, sid, biome:biomeForStreet(sid), fee:null};
  S.moveQueue.push(item); S.moveCube=null; renderMove();
  quoteMove({cubeId:c.cubeId,newSlot:slot}).then(q=>{ item.fee=q.fee; if(S.mode==='move') renderMove(); })
    .catch(()=>{ item.fee=Number(feeBase()); if(S.mode==='move') renderMove(); });
}
async function commitMoveQueue(){
  if(!(S.flags?S.flags.movesEnabled:true)) return toast('moving is paused on-chain',true);
  const owner=walletAccount()||S.me, q=S.moveQueue.slice(), btn=$('mqsend'); if(btn)btn.disabled=true;
  let done=0;
  try{
    for(const m of q){ if(btn)btn.textContent=`moving ${done+1}/${q.length}…`; await moveCube({cubeId:m.cube.cubeId,owner,newSlot:m.slot}); done++; S.moveQueue.shift(); }
    const ops=q.map(m=>({type:'move', cubeId:m.cube.cubeId, toSlot:m.slot}));
    toast(`✓ ${done} move${done>1?'s':''} done`); setTab('mine'); commitOptimistic(ops);
  }catch(e){ toast(`stopped after ${done}/${q.length}: ${msg(e)}`,true); await loadWorld(); renderMove(); }
}

// ---------- plumbing ----------
function setTab(mode){ document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.mode===mode)); S.mode=mode; mode==='mine'?renderMine():renderMove(); }
function wireStatic(){
  document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>setTab(b.dataset.mode));
  els.scrim.onclick=closeSheet;
  new MutationObserver(wireStaged).observe(els.sheetbody,{childList:true});
  window.addEventListener('beforeunload',e=>{ if(S.staged){ e.preventDefault(); e.returnValue=''; } });
  document.querySelectorAll('a[href]').forEach(a=>a.addEventListener('click',e=>{ if(S.staged && !confirm('Discard the staged action?')) e.preventDefault(); }));
}
function openSheet(){ els.scrim.classList.add('on'); els.sheet.classList.add('on'); setTimeout(wireStaged,0); }
function closeSheet(){ if(S.staged && !confirm('Discard the staged action?')) return; S.staged=null; S.detail=null; els.scrim.classList.remove('on'); els.sheet.classList.remove('on'); }
let toastT; function toast(t,k){ const el=els.toast; el.textContent=t; el.className='toast on'+(k?' '+k:''); clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('on'), k==='gold'?2400:1700); }
