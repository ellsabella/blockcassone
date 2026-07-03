// Injected-wallet (EIP-1193) connection for the viewer. Dependency-free: talks to
// window.ethereum directly, so it fits the no-bundler ESM viewer. Replaces the dev
// "you are" perspective / unlocked-Anvil account so a holder signs + sends their own
// customize / move / merge txs. NOTE: the EIP-712 flattening attestation is still
// signed by the backend attestationSigner (a service), not the wallet — this module
// only covers account selection + transaction sending. Works with MetaMask pointed
// at local Anvil (add the network / chainId 31337).

const listeners = { account: new Set(), chain: new Set() };
const state = { account: null, chainId: null };
let wired = false;

export function hasWallet() {
  return typeof window !== 'undefined' && !!window.ethereum;
}

function provider() {
  if (!hasWallet()) {
    throw new Error('No injected wallet found. Install MetaMask (or a compatible wallet).');
  }
  return window.ethereum;
}

function normalizeChainId(cid) {
  if (cid == null) return null;
  return typeof cid === 'string' ? parseInt(cid, 16) : Number(cid);
}

function setAccount(accts) {
  state.account = accts && accts[0] ? String(accts[0]).toLowerCase() : null;
  return state.account;
}

function emit(kind, value) {
  listeners[kind].forEach((cb) => {
    try { cb(value); } catch (e) { console.warn('wallet listener threw', e); }
  });
}

function wireEvents() {
  if (wired || !hasWallet()) return;
  const p = window.ethereum;
  if (typeof p.on !== 'function') return;
  wired = true;
  p.on('accountsChanged', (accts) => emit('account', setAccount(accts)));
  p.on('chainChanged', (cid) => {
    state.chainId = normalizeChainId(cid);
    emit('chain', state.chainId);
  });
}

export function account() { return state.account; }
export function chainId() { return state.chainId; }

export function onAccountChanged(cb) {
  listeners.account.add(cb);
  return () => listeners.account.delete(cb);
}

export function onChainChanged(cb) {
  listeners.chain.add(cb);
  return () => listeners.chain.delete(cb);
}

// Silent: pick up an already-authorized account on load (no popup). Returns the
// connected account or null.
export async function restore() {
  if (!hasWallet()) return null;
  wireEvents();
  try {
    setAccount(await window.ethereum.request({ method: 'eth_accounts' }));
    state.chainId = normalizeChainId(await window.ethereum.request({ method: 'eth_chainId' }));
  } catch { /* not connected yet */ }
  return state.account;
}

// Prompt the wallet to connect (shows the wallet popup on first authorization).
export async function connect() {
  const p = provider();
  wireEvents();
  setAccount(await p.request({ method: 'eth_requestAccounts' }));
  state.chainId = normalizeChainId(await p.request({ method: 'eth_chainId' }));
  return state.account;
}

// Best-effort: make the wallet's active chain match `expected` (decimal chainId).
// Tries switch, then add (for a local/custom chain the wallet doesn't know yet, e.g.
// Anvil 31337). Returns true iff the wallet ends up on the expected chain.
export async function ensureChain(expected, { rpcUrl, chainName } = {}) {
  if (!expected || !hasWallet()) return true;
  const want = Number(expected);
  const cur = normalizeChainId(await window.ethereum.request({ method: 'eth_chainId' }));
  state.chainId = cur;
  if (cur === want) return true;

  const hexId = '0x' + want.toString(16);
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexId }],
    });
    state.chainId = want;
    return true;
  } catch (e) {
    const unknownChain = e?.code === 4902 || /Unrecognized chain|not.*added/i.test(String(e?.message || ''));
    if (unknownChain && rpcUrl) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: hexId,
            chainName: chainName || `Chain ${want}`,
            rpcUrls: [rpcUrl],
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          }],
        });
        state.chainId = want;
        return true;
      } catch { return false; }
    }
    return false;
  }
}

// Send a tx through the connected wallet (the wallet signs). Returns the tx hash.
export async function sendTransaction(tx) {
  return provider().request({ method: 'eth_sendTransaction', params: [tx] });
}

// EIP-712 typed-data signature from the connected account (available if the drop
// ever moves attestation signing to the holder; unused by the current backend flow).
export async function signTypedDataV4(from, typedData) {
  const payload = typeof typedData === 'string' ? typedData : JSON.stringify(typedData);
  return provider().request({ method: 'eth_signTypedData_v4', params: [from, payload] });
}

export function shortAddress(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

// Convenience: turn `el` (a <button>) into a connect/disconnect toggle. Renders the
// short address when connected, "Connect Wallet" otherwise, "No Wallet" if none is
// injected. Fires onChange(account) on connect + external account changes. Silently
// restores an already-authorized session on load.
export function mountConnectButton(el, { onChange, chainId: wantChain, rpcUrl, chainName } = {}) {
  if (!el) return null;

  const render = () => {
    const a = account();
    el.textContent = a ? shortAddress(a) : hasWallet() ? 'Connect Wallet' : 'No Wallet';
    el.disabled = !hasWallet();
    el.classList.toggle('connected', !!a);
    el.title = a || (hasWallet() ? 'Connect an injected wallet' : 'No injected wallet detected');
  };

  el.addEventListener('click', async () => {
    if (!hasWallet()) return;
    try {
      await connect();
      if (wantChain) await ensureChain(wantChain, { rpcUrl, chainName });
      render();
      onChange && onChange(account());
    } catch (e) {
      console.warn('wallet connect failed', e);
    }
  });

  onAccountChanged((a) => { render(); onChange && onChange(a); });
  restore().then((a) => { render(); if (a) onChange && onChange(a); });
  render();

  return { refresh: render };
}
