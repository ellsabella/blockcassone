// Bridge to the RainbowKit + wagmi wallet island (viewer/vendor/wallet-widget.js) — the SAME
// stack the allowlist uses. The island renders the standard wallet modal (injected +
// WalletConnect + wallet list + QR) into the page's [data-wallet-widget] mount and publishes
// state on window.TheBLOCKWallet. This module keeps the old wallet.js API so the rest of
// the viewer (customize / move / merge txs) is unchanged. The EIP-712 flattening attestation
// is still signed server-side, not by the wallet.

function bridge() { return (typeof window !== 'undefined' && window.TheBLOCKWallet) || null; }

function whenReady(cb) {
  if (bridge()) { cb(); return; }
  if (typeof window !== 'undefined') window.addEventListener('blockcassone-wallet-ready', cb, { once: true });
}

export function hasWallet() { return true; }
export function account() { const b = bridge(); return b ? b.account : null; }
export function chainId() { const b = bridge(); return b ? b.chainId : null; }

export function onAccountChanged(cb) {
  let off = () => {};
  whenReady(() => { off = bridge().subscribe(cb); });
  return () => off();
}
export function onChainChanged() { return () => {}; } // chain changes also fire the account subscribe

export async function sendTransaction(tx) {
  const b = bridge();
  if (!b) throw new Error('Wallet not ready — connect a wallet first.');
  return b.sendTransaction(tx);
}
export async function signTypedDataV4(from, typedData) {
  const b = bridge();
  if (!b) throw new Error('Wallet not ready — connect a wallet first.');
  return b.signTypedDataV4(from, typedData);
}
export async function ensureChain(id) {
  const b = bridge();
  return b ? b.ensureChain(id) : true;
}
export function shortAddress(a) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : ''; }

// The island renders its own connect button into [data-wallet-widget]; this just relays
// account changes to the page's onChange callback. `el` is kept for API compatibility.
export function mountConnectButton(el, { onChange } = {}) {
  const relay = () => onChange && onChange(account());
  onAccountChanged(relay);
  whenReady(relay);
  return { refresh: relay };
}

// wagmi/RainbowKit auto-reconnects; these are kept for API compatibility.
export async function restore() { return account(); }
export const connect = async () => account();
export const switchAccount = async () => account();
