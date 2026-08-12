import { useState, useEffect, useMemo } from 'react';
import { useAccount, usePublicClient, useSignTypedData } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { CONFIG, entitlementFor } from './config.js';
import { resolveHoldings } from './lib.js';
import { turnstileToken } from './turnstile.js';

const keyOf = h => `${h.collectionId}:${h.tokenId}`;

// The three Hilbert axis colours (x=red, y=green, z=blue) the plane glow cycles through.
const AXES = ['#ff3a4e', '#3a7bff', '#3aff8e'];

// Pre-rendered real cube plane-art (neon lines, frame, forest) baked from the on-chain
// thumbnail renderer, curated into a red → blue → green cycle. See public/planes/.
const PLANES = Array.from({ length: 9 }, (_, i) => `/planes/plane-${i + 1}.svg`);

// Post-registration flourish: a fast slideshow of real 2-D plane art, its glow
// swapping red → blue → green — the "2-D" step between flat art and the 3-D cube.
function PlaneShow() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI(n => n + 1), 620);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="planebox" style={{ '--pc': AXES[i % AXES.length] }}>
      <img className="plane" src={PLANES[i % PLANES.length]} alt="" />
    </div>
  );
}

const LOCAL_KEY = 'blockcassone.allowlist.submissions';

// Has this wallet already registered? Backend is authoritative; fall back to the local
// mirror if the status endpoint is unreachable (e.g. a static deploy with no backend).
async function checkRegistered(wallet) {
  try {
    const r = await fetch(`${CONFIG.statusUrl}?wallet=${wallet}`);
    if (r.ok) return !!(await r.json()).registered;
  } catch { /* fall through to local */ }
  try {
    const prev = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    return prev.some(p => String(p.wallet || '').toLowerCase() === wallet.toLowerCase());
  } catch { return false; }
}

// Keep a local receipt so nothing is lost if the backend was unreachable.
function rememberLocally(payload) {
  try {
    const prev = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    prev.push(payload);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(prev));
  } catch { /* storage unavailable — confirmation still shows */ }
}

export default function App() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [holdings, setHoldings] = useState([]);
  const [vaults, setVaults] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [done, setDone] = useState(null);
  const [finished, setFinished] = useState(false);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [handle, setHandle] = useState('');

  const entitlement = useMemo(() => entitlementFor(holdings), [holdings]);
  const cap = entitlement.spots;

  useEffect(() => {
    if (!isConnected || !address || !publicClient) {
      setHoldings([]); setVaults([]); setSelected(new Set()); setDone(null); setFinished(false); setAlreadyRegistered(false); setStatus(''); setHandle('');
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true); setStatus('');
      try {
        const [{ holdings, vaults }, registered] = await Promise.all([
          resolveHoldings(publicClient, address),
          checkRegistered(address),
        ]);
        if (!alive) return;
        setHoldings(holdings); setVaults(vaults); setSelected(new Set());
        setDone(null); setFinished(false); setAlreadyRegistered(registered);
      } catch (e) {
        if (alive) setStatus(`Holdings read failed — check the Alchemy key in .env (${e.message}).`);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [address, isConnected, publicClient]);

  const counts = useMemo(() => {
    const m = new Map();
    for (const h of holdings) m.set(h.collectionName, (m.get(h.collectionName) || 0) + 1);
    return m;
  }, [holdings]);

  function toggle(k) {
    setSelected(s => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else if (n.size < cap) n.add(k);
      return n;
    });
  }

  async function attest() {
    try {
      setStatus('Waiting for signature…');
      const chosen = holdings.filter(h => selected.has(keyOf(h)));
      const sources = chosen.map(h => ({ collectionId: h.collectionId, tokenId: BigInt(h.tokenId), contractAddr: h.contractAddr }));
      const nonce = '0x' + [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
      const issuedAt = BigInt(Math.floor(Date.now() / 1000));
      const message = { wallet: address, vaults: vaults.map(v => v.address), sources, issuedAt, nonce };

      const signature = await signTypedDataAsync({
        domain: CONFIG.eip712Domain, types: CONFIG.eip712Types, primaryType: 'Attestation', message,
      });

      const payload = {
        wallet: address, kind: 'gtd', vaults: message.vaults,
        sources: chosen.map(h => ({ collectionId: h.collectionId, tokenId: h.tokenId, contractAddr: h.contractAddr })),
        issuedAt: String(issuedAt), nonce, signature,
        // Client-reported entitlement (unsigned) — review triage only; re-verified on-chain.
        entitlement: { normies: entitlement.normies, other: entitlement.other, spots: cap },
      };
      try { payload.turnstileToken = await turnstileToken(); }
      catch { setStatus('Bot check failed — please try again.'); return; }
      setStatus('Submitting…');
      // The backend appends the signed request to the collected dataset (the source of
      // truth for review). A local mirror guards against the backend being unreachable.
      let backendUnreachable = false;
      try {
        const res = await fetch(CONFIG.submitUrl, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (res.status === 409) { setAlreadyRegistered(true); setStatus(''); return; }
        if (!res.ok) throw new Error(`server ${res.status}`);
      } catch (e) {
        backendUnreachable = true;
        console.warn('[allowlist] submit backend unreachable, kept local copy:', e);
      }
      rememberLocally(payload);
      if (backendUnreachable) setStatus('Saved locally — backend was unreachable, we may follow up.');
      setDone(payload);
      if (!backendUnreachable) setStatus('');
    } catch (e) {
      setStatus(e?.shortMessage || e?.message || 'Signature rejected.');
    }
  }

  // Register-interest opt-in for non-holders / sub-threshold holders. A light signed attestation
  // (proves the wallet + is bot friction); optional social handle for outreach.
  async function attestInterest() {
    try {
      setStatus('Waiting for signature…');
      const cleanHandle = handle.trim().replace(/^@+/, '').slice(0, CONFIG.interestHandleMax);
      const nonce = '0x' + [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
      const issuedAt = BigInt(Math.floor(Date.now() / 1000));
      const message = { wallet: address, handle: cleanHandle, issuedAt, nonce };

      const signature = await signTypedDataAsync({
        domain: CONFIG.eip712Domain, types: CONFIG.eip712InterestTypes, primaryType: 'Interest', message,
      });

      const payload = {
        wallet: address, kind: 'interest', handle: cleanHandle,
        issuedAt: String(issuedAt), nonce, signature,
        // Client-reported holdings (unsigned) — triage only; FCFS eligibility re-verified on-chain.
        heldSummary: { normies: entitlement.normies, other: entitlement.other },
      };
      try { payload.turnstileToken = await turnstileToken(); }
      catch { setStatus('Bot check failed — please try again.'); return; }
      setStatus('Submitting…');
      let backendUnreachable = false;
      try {
        const res = await fetch(CONFIG.submitUrl, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (res.status === 409) { setAlreadyRegistered(true); setStatus(''); return; }
        if (!res.ok) throw new Error(`server ${res.status}`);
      } catch (e) {
        backendUnreachable = true;
        console.warn('[allowlist] interest submit unreachable, kept local copy:', e);
      }
      rememberLocally(payload);
      if (backendUnreachable) setStatus('Saved locally — backend was unreachable, we may follow up.');
      setDone(payload);
      if (!backendUnreachable) setStatus('');
    } catch (e) {
      setStatus(e?.shortMessage || e?.message || 'Signature rejected.');
    }
  }

  const interestCTA = (note) => (
    <div className="interest">
      <div className="muted">{note}</div>
      <div className="interest-row">
        <input
          className="handle-input" type="text" spellCheck={false} value={handle}
          placeholder="@yourhandle (optional)" maxLength={CONFIG.interestHandleMax + 1}
          onChange={e => setHandle(e.target.value)}
        />
        <button className="cta small" onClick={attestInterest}>REGISTER INTEREST ▸</button>
      </div>
    </div>
  );

  return (
    <div className="app">
      {/* Zoomed-in close-up of Normie #1252's cube (WebGL), rendered on-chain. */}
      <iframe className="cube-bg" src="/cube-bg.html" title="" scrolling="no" tabIndex={-1} aria-hidden="true" />
      <div className="scrim" />

      {!isConnected ? (
        <div className="hero">
          <h1 className="blockword">THE BLOCK</h1>
          <div className="apply">APPLY FOR ALLOWLIST</div>
          <ConnectButton.Custom>
            {({ openConnectModal }) => <button className="cta" onClick={openConnectModal}>CONNECT WALLET</button>}
          </ConnectButton.Custom>
        </div>
      ) : alreadyRegistered ? (
        <div className="content done">
          <div className="topbar">
            <div className="brand">THE BLOCK</div>
            <ConnectButton showBalance={false} chainStatus="none" accountStatus="avatar" />
          </div>
          <div className="check info">!</div>
          <h2>You have already registered for the allowlist</h2>
          <p className="muted">
            Only one registration per wallet. Final allocations will be published after human review of
            submissions. Follow <a href="https://x.com/bright_lightart" target="_blank" rel="noreferrer">@bright_lightart</a> for
            updates. To register a different wallet, switch accounts above.
          </p>
        </div>
      ) : finished ? (
        <div className="finished">
          <PlaneShow />
          <div className="thanks">thank you for registering</div>
          <div className="dims">1-D ---&gt; 2-D ---&gt; 3-D</div>
        </div>
      ) : done && done.kind === 'interest' ? (
        <div className="content done">
          <div className="check">✓</div>
          <h2>You're on the interest list</h2>
          <p className="muted">
            Thanks for registering{done.handle ? ` (@${done.handle})` : ''}.{' '}
            {(Number(done.heldSummary?.normies || 0) + Number(done.heldSummary?.other || 0)) > 0
              ? 'As a holder of a qualifying asset you\'re eligible for the FCFS phase — '
              : ''}
            we'll announce FCFS + public mint details. Follow{' '}
            <a href="https://x.com/bright_lightart" target="_blank" rel="noreferrer">@bright_lightart</a> for updates.
          </p>
          <button className="cta small close-btn" onClick={() => setFinished(true)}>CLOSE</button>
        </div>
      ) : done ? (
        <div className="content done">
          <div className="check">✓</div>
          <h2>Request submitted</h2>
          <div className="done-summary">
            Requested <b>{done.sources.length}</b> artwork{done.sources.length > 1 ? 's' : ''}:{' '}
            {done.sources.map(s => `${CONFIG.collections[s.collectionId].name} #${s.tokenId}`).join(', ')}
          </div>
          <p className="muted">
            You are eligible to request <b>{cap}</b> allowlist spot{cap > 1 ? 's' : ''}. Final allocations will be
            published after human review of submissions. Follow{' '}
            <a href="https://x.com/bright_lightart" target="_blank" rel="noreferrer">@bright_lightart</a> for updates.
          </p>
          <button className="cta small close-btn" onClick={() => setFinished(true)}>CLOSE</button>
        </div>
      ) : (
        <div className="content">
          <div className="topbar">
            <div className="brand">THE BLOCK</div>
            <ConnectButton showBalance={false} chainStatus="none" accountStatus="avatar" />
          </div>
          <h2>Choose your candidates</h2>

          {loading ? (
            <div className="muted big">Reading your holdings + delegations…</div>
          ) : holdings.length === 0 ? (
            <>
              <div className="muted big">No qualifying assets in this wallet or its delegations.</div>
              {interestCTA('Register your interest to hear about the FCFS + public mint.')}
            </>
          ) : cap === 0 ? (
            <>
              <div className="entitle">
                {[...counts.entries()].map(([name, n]) => <span className="hold" key={name}><b>{n}</b> {name}</span>)}
              </div>
              <div className="muted big">
                That doesn't reach a guaranteed spot yet — a spot needs <b>1 Normie</b>, or <b>4 items</b> from the
                other collections (each worth ¼ spot). Your {entitlement.other} other item{entitlement.other === 1 ? '' : 's'} = {entitlement.raw} spot.
              </div>
              {interestCTA('You still qualify for the FCFS phase — register your interest to be added.')}
            </>
          ) : (
            <>
              <div className="entitle">
                {[...counts.entries()].map(([name, n]) => <span className="hold" key={name}><b>{n}</b> {name}</span>)}
                <span className="entitle-spots">→ <b>{cap}</b> guaranteed spot{cap > 1 ? 's' : ''}</span>
              </div>
              <div className="weighting">1 Normie = 1 spot · each other item = ¼ spot · max {CONFIG.gtdCapPerWallet}. Pick up to {cap}.</div>

              <div className={'art-grid' + (selected.size >= cap ? ' full' : '')}>
                {holdings.map(h => {
                  const k = keyOf(h); const sel = selected.has(k);
                  return (
                    <button key={k} className={'art' + (sel ? ' sel' : '')} onClick={() => toggle(k)}>
                      {h.image ? <img src={h.image} alt="" loading="lazy" /> : <div className="noimg">no image</div>}
                      <span className="cap">{h.collectionName} #{h.tokenId}{h.via === 'delegated' ? ' ◆' : ''}</span>
                    </button>
                  );
                })}
              </div>

              <div className="submitbar">
                <span className="muted">{selected.size} / {cap} selected</span>
                <button className="cta small" disabled={!selected.size} onClick={attest}>SUBMIT ▸</button>
              </div>
            </>
          )}
          {status && <div className="status err">{status}</div>}
        </div>
      )}
    </div>
  );
}

