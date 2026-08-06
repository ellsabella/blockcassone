// Streets page. Your streets (grouped from the chain records), sorted closest-to-merge;
// fill a vacant / evict a rival (displacement) / merge, wired to the payable moveCube +
// mergeStreet with on-chain quotes. Biome per street comes from the verified CubeEnv mirror.
// Gated when both movesEnabled and mergesEnabled are off on-chain (contract is the real gate).

import { loadChainMintRecords } from './chain-cubes.js';
import {
  moveCube, mergeStreet, quoteMove, quoteMerge, cubeThumbnailSVG, cubeAnimationURI,
  contractFlags, setTransactionSender,
} from './preview-chain.js';
import { mountConnectButton, sendTransaction as walletSend, account as walletAccount } from './wallet.js?v=20260806-1';
import { biomeForStreet } from './cube-env.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const msg = e => String((e && e.message) || e).slice(0, 160);
const fmtEth = wei => { const n = Number(wei) / 1e18; return (n < 0.00005 ? '0' : n.toFixed(4).replace(/0+$/,'').replace(/\.$/,'')) + ' Ξ'; };
const short = a => { const s = String(a || ''); return s.length > 10 ? s.slice(0,6)+'…'+s.slice(-4) : s; };

// on-brand cube glyph from a seed (fast; the detail view swaps in the real on-chain SVG)
function rng(seed){let a=(seed>>>0)||1;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function glyph(seed){const s=(typeof seed==='string'?parseInt(String(seed).slice(2,10),16):seed)>>>0;const r=rng(s),h=(r()*360)|0;let c='';for(let y=0;y<8;y++)for(let x=0;x<8;x++){if(r()<.4){const a=(.22+r()*.5).toFixed(2),l=44+((r()*26)|0);c+=`<rect x="${x*12+1}" y="${y*12+1}" width="10" height="10" rx="1" fill="hsl(${(h+(r()*44-22))|0} 92% ${l}%)" fill-opacity="${a}"/>`;}}
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#060608"/>${c}<path d="M5 5H91M5 5V91M5 91H91" stroke="hsl(${(h+185)%360} 100% 62%)" stroke-width="2.4" fill="none" opacity=".9"/></svg>`;}

const els = {};
const S = { mode:'mine', me:null, flags:null, recs:[], bySlot:new Map(), merged:new Set(),
  myStreets:[], myCubes:[], detail:null, staged:null, moveCube:null, filters:new Set(), thumbCache:new Map() };

// ---------- boot ----------
(async function init(){
  ['view','scrim','sheet','sheetbody','toast'].forEach(id=>els[id]=$(id));
  let flags=null; try{ flags=await contractFlags(); }catch{}
  S.flags=flags;
  if (flags && !flags.movesEnabled && !flags.mergesEnabled){ $('app').style.display='none'; $('gate').style.display='flex'; return; }
  let cfg={}; try{ cfg=await (await fetch('/data/chain-config.json',{cache:'no-store'})).json(); }catch{}
  mountConnectButton($('wallet-connect'), { chainId:cfg.chainId, rpcUrl:cfg.rpcUrl, chainName:'Blockcassone', onChange:onWallet });
  wireStatic();
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
  S.recs=recs; S.bySlot=new Map(); S.merged=new Set();
  for (const r of recs){ S.bySlot.set(Number(r.slot), r); if (r.sourceKindNumber===3) S.merged.add(Math.floor(Number(r.slot)/8)); }
  S.myCubes = recs.filter(r=>r.sourceKindNumber!==3 && String(r.wallet||'').toLowerCase()===S.me)
    .map(r=>({cubeId:r.cubeId, slot:Number(r.slot), seed:r.seed, biome:biomeForStreet(Math.floor(Number(r.slot)/8))}));
  // Merged streets you own — a whole street collapsed into one token (sourceKind 3). Shown
  // as their own highlighted cards, not in the active-street list (they can't merge again).
  S.myMerged = recs.filter(r=>r.sourceKindNumber===3 && String(r.wallet||'').toLowerCase()===S.me)
    .map(r=>({sid:Math.floor(Number(r.slot)/8), cubeId:r.cubeId, seed:r.seed, biome:biomeForStreet(Math.floor(Number(r.slot)/8))}));
  const sids=new Set(S.myCubes.map(c=>Math.floor(c.slot/8)).filter(sid=>!S.merged.has(sid)));
  S.myStreets=[...sids].map(streetData);
  S.mode==='mine'?renderMine():renderMove();
}

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
function actionLine(s){const c=count(s),m=analyze(s),wf=s.biome.weight;
  if(m.kind==='ready') return {lead:'MERGE NOW → merged street',fee:'free'};
  if(m.kind==='fill') return {lead:`move in ${m.need} more → MERGE`,fee:''};
  if(m.kind==='evict') return {lead:`evict ${c.rival} rival${c.rival>1?'s':''} → MERGE`,fee:'from '+fmtEth(1e15+(wf-1)*1e16)};
  if(m.kind==='grow') return {lead:`move in ${m.need} to take control`,fee:''};
  return {lead:`you ${c.me}/8 · acquire more to act`,fee:''};}

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
  loadMergedThumbs();
}
// A merged street: one token that IS the whole street. Highlighted gold, badged, not clickable
// into the merge flow (nothing left to do). Shows its on-chain thumbnail once loaded.
function mergedCardHTML(s){ const anim=S.animCache&&S.animCache.get(s.cubeId);
  const media = anim
    ? `<iframe class="m3d" src="${anim}" sandbox="allow-scripts" loading="lazy" title="Street ${s.sid} live"></iframe>`
    : `<div class="mart">${S.thumbCache.get(s.cubeId)||glyph(s.seed)}</div>`;
  return `<div class="card merged" data-sid="${s.sid}">
    <div class="hd"><span>✦ Street ${s.sid}</span><span class="biome">${s.biome.emoji} ${s.biome.name}</span><span class="count mbadge">MERGED</span></div>
    ${media}
    <div class="act"><span class="lead" style="color:#ffd479">one token · the whole street · cube #${s.cubeId}</span></div></div>`; }
// 2D thumbnail first (fast), then the live on-chain 3D engine for each merged street.
async function loadMergedThumbs(){ if(!S.animCache) S.animCache=new Map();
  for (const s of (S.myMerged||[])){
    if (!S.thumbCache.has(s.cubeId)){ try{ S.thumbCache.set(s.cubeId, await cubeThumbnailSVG(s.cubeId)); if(S.mode==='mine') renderMine(); }catch{} }
    if (!S.animCache.has(s.cubeId)){ try{ S.animCache.set(s.cubeId, await cubeAnimationURI(s.cubeId)); if(S.mode==='mine') renderMine(); }catch{ S.animCache.set(s.cubeId,null); } }
  } }
function cardHTML(s){const c=count(s),m=analyze(s),a=actionLine(s),cls=m.kind==='ready'?'ready':(m.kind==='locked'?'locked':'');
  return `<div class="card ${cls}" data-sid="${s.sid}">
    <div class="hd"><span>Street ${s.sid}</span><span class="biome">${s.biome.emoji} ${s.biome.name}</span><span class="count">you <b>${c.me}</b>/8</span></div>
    <div class="plots">${s.plots.map(plotChip).join('')}</div>
    <div class="act"><span class="lead">▸ ${a.lead}</span><span class="fee">${a.fee}</span></div></div>`;}
function plotChip(p){ if(!p) return `<div class="plot vac">+</div>`; return `<div class="plot ${p.owner}">${glyph(p.seed)}</div>`;}

// ---------- STREET DETAIL ----------
function openDetail(s){ S.detail=s; S.staged=null; renderDetail(); openSheet(); loadThumbs(s); }
async function loadThumbs(s){
  for (const p of s.plots){ if (!p || S.thumbCache.has(p.cubeId)) continue;
    try{ const svg=await cubeThumbnailSVG(p.cubeId); S.thumbCache.set(p.cubeId,svg); if(S.detail===s) renderDetail(); }catch{} }
}
function renderDetail(){
  const s=S.detail,c=count(s),m=analyze(s);
  els.sheetbody.innerHTML=`
    <div class="dhd"><span class="t">Street ${s.sid}</span><span class="b">${s.biome.emoji} ${s.biome.name} · you ${c.me}/8</span><button class="close">✕</button></div>
    <div class="detwrap">
      <div><div class="dplots">${s.plots.map((p,i)=>dplot(p,i)).join('')}</div></div>
      <div class="loc"><div class="cap">where in the block</div>${locator(s.sid)}<div class="where">region ${(s.sid/64|0)} · nbhd ${(s.sid/8|0)%8} · street ${s.sid%8}</div></div>
    </div>
    ${statusHTML(s,c,m)}${stagedHTML()}
    <div class="actions" id="det-actions"></div>`;
  els.sheetbody.querySelector('.close').onclick=closeSheet;
  els.sheetbody.querySelectorAll('.dplot').forEach(el=>el.onclick=()=>onPlot(+el.dataset.i));
  renderDetActions(s,m);
}
function dplot(p,i){const st=S.staged&&S.staged.slotIdx===i?' staged':'';
  if(!p) return `<div class="dplot vac${st}" data-i="${i}">${st?'◆':'+'}<span class="pin">vacant</span></div>`;
  const artHtml=S.thumbCache.get(p.cubeId)||glyph(p.seed);
  return `<div class="dplot ${p.owner}${st}" data-i="${i}">${artHtml}<span class="pin">${p.owner==='me'?'you':'rival'}</span></div>`;}
function statusHTML(s,c,m){
  if(m.kind==='ready') return `<div class="status ready">✦ Sole occupier of ${c.me} plots, no rivals — <b>merge now</b> into one merged street. The ${c.vac} vacant plot${c.vac!==1?'s':''} lock into the street; you don't fill them.</div>`;
  if(m.kind==='fill') return `<div class="status">Sole occupier but only ${c.me} filled. Move in <b>${m.need} more</b> of your cubes (tap a vacant plot) to reach 5, then merge.</div>`;
  if(m.kind==='evict') return `<div class="status">You <b>control</b> this street (${c.me}/8). <b>Evict</b> the ${c.rival} rival${c.rival>1?'s':''} — tap a red plot — then merge.</div>`;
  if(m.kind==='grow') return `<div class="status">You hold ${c.me}/8. Move <b>${m.need} more</b> in (tap vacant plots) to reach 5/8 control, then evict.</div>`;
  return `<div class="status">You hold ${c.me}/8 and can't reach 5/8 control here yet.</div>`;}
function renderDetActions(s,m){
  const a=$('det-actions');
  if(S.staged){ a.innerHTML=''; return; } // a confirm sheet is showing — don't double the button
  if(m.kind==='ready'){ const on=S.flags?S.flags.mergesEnabled:true;
    a.innerHTML=`<button class="act merge" id="merge" ${on?'':'disabled'}>⬧ Merge into one street</button><div class="hint">${on?'free · irreversible':'merging is paused on-chain'}</div>`;
    if(on)$('merge').onclick=()=>stageMerge(); return; }
  a.innerHTML=`<div class="hint">tap a ${count(s).me>=5?'red plot to evict, or a ':''}vacant plot to move a cube in</div>`;
}
function onPlot(i){ const s=S.detail,p=s.plots[i];
  if(!(S.flags?S.flags.movesEnabled:true)) return toast('moving is paused on-chain',true);
  if(!p) startFill(i);
  else if(p.owner==='rival'){ if(count(s).me>=5) startEvict(i); else toast('need 5/8 control to evict',true); }
  else toast('that plot is already yours');
}

// ---------- stage: merge / fill / evict → confirm ----------
function stageMerge(){ S.staged={type:'merge'}; renderDetail();
  quoteMerge({street:S.detail.sid}).then(q=>{ if(S.staged&&S.staged.type==='merge'){ S.staged.fee=q.fee; renderDetail(); } }).catch(()=>{}); }
function startFill(i){ const s=S.detail; pickCube('Move which cube here?', s, cube=>{ S.staged={type:'fill',slotIdx:i,incoming:cube,slot:s.base+i}; renderDetail();
  quoteMove({cubeId:cube.cubeId,newSlot:s.base+i}).then(q=>{ if(S.staged&&S.staged.incoming===cube){ S.staged.fee=q.fee; renderDetail(); } }).catch(()=>{}); }); }
function startEvict(i){ const s=S.detail; pickCube('Which of your cubes swaps in?', s, cube=>{ S.staged={type:'evict',slotIdx:i,incoming:cube,slot:s.base+i}; renderDetail();
  quoteMove({cubeId:cube.cubeId,newSlot:s.base+i}).then(q=>{ if(S.staged&&S.staged.incoming===cube){ Object.assign(S.staged,{fee:q.fee,victim:q.victim,victimShare:q.victimShare,houseShare:q.houseShare}); renderDetail(); } }).catch(()=>{}); }); }

function stagedHTML(){ if(!S.staged) return ''; const st=S.staged,s=S.detail;
  const quoting='<span style="color:var(--faint)">quoting…</span>';
  if(st.type==='merge') return `<div class="confirm"><h3>Confirm merge</h3>
    <div class="kv"><span>collapse into 1 merged street</span><b>7 slots burned</b></div>
    <div class="kv"><span>fee</span><b>${st.fee==null?quoting:fmtEth(st.fee)}</b></div>
    <div class="row" style="margin-top:10px"><button class="act ghost" id="discard">Discard</button><button class="act merge" id="commit">Merge on-chain →</button></div></div>`;
  if(st.type==='fill') return `<div class="confirm"><h3>Confirm move</h3>
    <div class="kv"><span>move</span><b>#${st.incoming.cubeId} → street ${s.sid}</b></div>
    <div class="kv"><span>fee (to the house)</span><b>${st.fee==null?quoting:fmtEth(st.fee)}</b></div>
    <div class="row" style="margin-top:10px"><button class="act ghost" id="discard">Discard</button><button class="act primary" id="commit">Confirm move →</button></div></div>`;
  return `<div class="confirm"><h3>Confirm eviction</h3>
    <div class="kv"><span>swap in</span><b>#${st.incoming.cubeId}</b></div>
    <div class="kv"><span>displaced owner goes to</span><b>your old slot</b></div>
    <div class="kv"><span>fee</span><b>${st.fee==null?quoting:fmtEth(st.fee)}</b></div>
    ${st.victimShare!=null?`<div class="kv"><span class="pay">→ paid to displaced owner</span><b class="pay">${fmtEth(st.victimShare)}</b></div>`:''}
    ${st.houseShare?`<div class="kv"><span>→ house cut (tier upgrade)</span><b>${fmtEth(st.houseShare)}</b></div>`:''}
    <div class="kv"><span class="cool">cooldown</span><b class="cool">that owner can't be re-evicted 15 min</b></div>
    <div class="row" style="margin-top:10px"><button class="act ghost" id="discard">Discard</button><button class="act warn2" id="commit">Evict + pay →</button></div></div>`;}

function wireStaged(){ const d=$('discard'),c=$('commit'); if(d)d.onclick=()=>{S.staged=null;renderDetail();}; if(c)c.onclick=commitStaged; }
async function commitStaged(){ const st=S.staged,s=S.detail,owner=walletAccount()||S.me;
  const btn=$('commit'); if(btn){btn.disabled=true;btn.textContent='confirming…';}
  try{
    if(st.type==='merge') await mergeStreet({street:s.sid,owner});
    else await moveCube({cubeId:st.incoming.cubeId,owner,newSlot:st.slot});
    toast(st.type==='merge'?'✦ Merged into one street':(st.type==='evict'?'✓ Rival evicted + paid':'✓ Moved in'), st.type==='merge'?'gold':undefined);
    S.staged=null; closeSheet();
    await loadWorld();
    // The read RPC can lag the just-mined tx by a block — reload again shortly so the new
    // merged street / displacement always appears without a manual refresh.
    setTimeout(loadWorld, 2500);
  }catch(e){ toast((st.type||'action')+' failed: '+msg(e),true); if(btn){btn.disabled=false;renderDetail();} }
}

// ---------- pick-cube (nested in the sheet) ----------
function pickCube(title, street, cb){
  const avail=S.myCubes.filter(c=>Math.floor(c.slot/8)!==street.sid); // a cube from ELSEWHERE swaps in
  if(!avail.length){ toast('you have no cube elsewhere to move in',true); return; }
  const grid=avail.map(c=>`<div class="pcube" data-id="${c.cubeId}">${glyph(c.seed)}<span class="lab">#${c.cubeId} ${c.biome.emoji}</span></div>`).join('');
  const back=els.sheetbody.innerHTML;
  els.sheetbody.innerHTML=`<div class="dhd"><span class="t">${esc(title)}</span><button class="close">✕</button></div>
    <div style="color:var(--faint);font-size:11px;padding:0 0 8px">a cube you hold elsewhere swaps in; the displaced owner takes its old slot</div>
    <div class="cubegrid">${grid}</div>`;
  els.sheetbody.querySelector('.close').onclick=()=>{ els.sheetbody.innerHTML=back; renderDetail(); };
  els.sheetbody.querySelectorAll('.pcube').forEach(el=>el.onclick=()=>{ const cube=avail.find(c=>c.cubeId==el.dataset.id); renderDetail(); cb(cube); });
}

// ---------- MOVE A CUBE finder ----------
function renderMove(){
  if(!S.me){ els.view.innerHTML=`<div class="empty">connect a wallet first</div>`; return; }
  els.view.innerHTML=`<div class="barrow">1 · pick a cube to move</div>
    <div class="strip" id="mstrip">${S.myCubes.map(c=>`<div class="thumb ${S.moveCube&&S.moveCube.cubeId===c.cubeId?'sel':''}" data-id="${c.cubeId}">${glyph(c.seed)}<span class="id">#${c.cubeId}</span></div>`).join('')||'<span class="empty">no cubes in this wallet</span>'}</div>
    <div class="barrow">2 · where to? filter the world</div>
    <div class="chips">${['near my streets','low population','affordable','🌊 water','🏔️ mountain','🧊 ice','🌿 grass','🏜️ desert','🌲 forest'].map(f=>`<div class="fchip ${S.filters.has(f)?'on':''}" data-f="${f}">${f}</div>`).join('')}</div>
    <div class="cands" id="cands"></div>`;
  els.view.querySelectorAll('#mstrip .thumb').forEach(el=>el.onclick=()=>{ S.moveCube=S.myCubes.find(c=>c.cubeId==el.dataset.id); renderMove(); });
  els.view.querySelectorAll('.fchip').forEach(el=>el.onclick=()=>{ const f=el.dataset.f; S.filters.has(f)?S.filters.delete(f):S.filters.add(f); renderMove(); });
  renderCands();
}
function renderCands(){
  const F=S.filters, mine=new Set(S.myStreets.map(s=>s.sid));
  const biomeF=[...F].filter(f=>/water|mountain|ice|grass|desert|forest/.test(f)).map(f=>f.split(' ')[1]);
  const out=[];
  for(let sid=0; sid<512 && out.length<48; sid++){
    if(S.merged.has(sid)) continue;
    const bi=biomeForStreet(sid); if(biomeF.length && !biomeF.includes(bi.name)) continue;
    if(F.has('affordable') && bi.weight>3) continue;
    if(F.has('near my streets') && !mine.has(sid)) continue;
    let pop=0, firstVac=-1;
    for(let k=0;k<8;k++){ if(S.bySlot.get(sid*8+k)) pop++; else if(firstVac<0) firstVac=sid*8+k; }
    if(firstVac<0) continue;
    if(F.has('low population') && pop>3) continue;
    out.push({sid, biome:bi, pop, slot:firstVac});
  }
  const grid=$('cands'); if(!grid) return;
  grid.innerHTML = out.length ? out.map(candHTML).join('') : `<div class="empty" style="grid-column:1/-1">no open slots match — loosen the filters</div>`;
  grid.querySelectorAll('.cand').forEach(el=>el.onclick=()=>{ if(!S.moveCube){toast('pick a cube first',true);return;} moveToSlot(+el.dataset.slot); });
}
function candHTML(c){ return `<div class="cand" data-slot="${c.slot}"><div class="art">+</div>
  <div class="meta"><div class="b">${c.biome.emoji} ${c.biome.name}</div><div>vacant · pop ${c.pop}/8</div><div class="fee">~${fmtEth(1e15)}</div></div></div>`;}
async function moveToSlot(slot){
  if(!(S.flags?S.flags.movesEnabled:true)) return toast('moving is paused on-chain',true);
  const cube=S.moveCube, owner=walletAccount()||S.me;
  try{ const q=await quoteMove({cubeId:cube.cubeId,newSlot:slot});
    if(!confirm(`Move #${cube.cubeId} to slot ${slot} for ${fmtEth(q.fee)}?`)) return;
    await moveCube({cubeId:cube.cubeId,owner,newSlot:slot});
    toast('✓ Moved'); await loadWorld(); setTab('mine'); setTimeout(loadWorld, 2500);
  }catch(e){ toast('move failed: '+msg(e),true); }
}

// world locator (stylized iso cube with a glowing region)
function locator(sid){const r=rng((sid*2654435761)>>>0);const px=100+((r()*100|0)-(r()*100|0))*0.7,py=70+((r()*160|0))*0.34-30;
  return `<svg viewBox="0 0 200 150"><g stroke="#2a2a36" stroke-width="1.5" fill="none"><path d="M100 12 L188 60 L100 108 L12 60 Z"/><path d="M12 60 L12 96 L100 144 L100 108"/><path d="M100 144 L100 108 L188 60 L188 96 L100 144"/></g>
    <circle cx="${px.toFixed(0)}" cy="${py.toFixed(0)}" r="6" fill="#ff7dcc"/><circle cx="${px.toFixed(0)}" cy="${py.toFixed(0)}" r="11" fill="none" stroke="#ff7dcc" stroke-width="1.5" opacity=".5"/></svg>`;}

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
