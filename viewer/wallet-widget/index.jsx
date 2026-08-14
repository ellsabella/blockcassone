// RainbowKit + wagmi wallet widget — the SAME stack the allowlist uses, packaged as a
// self-contained island so the no-bundler viewer gets the exact standard wallet modal
// (injected + WalletConnect + wallet list + QR). Built by scripts/bundle-wallet-widget.sh
// into viewer/vendor/wallet-widget.js and loaded as a plain <script> on each page.
//
// It renders RainbowKit's ConnectButton into every [data-wallet-widget] element and exposes
// a tiny bridge on window.TheBLOCKWallet so the vanilla viewer/wallet.js can read the
// account + send txs through the connected wallet's EIP-1193 provider.
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { WagmiProvider, http, useAccount, useChainId } from 'wagmi';
import { mainnet, sepolia } from 'viem/chains';
import { getDefaultConfig, RainbowKitProvider, ConnectButton, darkTheme } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getAccount, switchChain } from '@wagmi/core';
import rainbowkitCss from '@rainbow-me/rainbowkit/styles.css';

if (typeof document !== 'undefined' && rainbowkitCss) {
  const s = document.createElement('style');
  s.textContent = rainbowkitCss;
  document.head.appendChild(s);
}

let wagmiConfig = null;
const subs = new Set();
const notify = (a) => subs.forEach((cb) => { try { cb(a); } catch (_) { /* ignore */ } });

const bridge = {
  account: null,
  chainId: null,
  ready: false,
  subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
  async _provider() {
    if (!wagmiConfig) return null;
    const acct = getAccount(wagmiConfig);
    if (!acct || !acct.connector || !acct.connector.getProvider) return null;
    return acct.connector.getProvider();
  },
  async sendTransaction(tx) {
    const p = await this._provider();
    if (!p) throw new Error('No wallet connected');
    return p.request({ method: 'eth_sendTransaction', params: [tx] });
  },
  async signTypedDataV4(from, typedData) {
    const p = await this._provider();
    if (!p) throw new Error('No wallet connected');
    const payload = typeof typedData === 'string' ? typedData : JSON.stringify(typedData);
    return p.request({ method: 'eth_signTypedData_v4', params: [from, payload] });
  },
  async ensureChain(id) {
    try { await switchChain(wagmiConfig, { chainId: Number(id) }); return true; } catch { return false; }
  },
};
window.TheBLOCKWallet = bridge;

function Bridge() {
  const { address } = useAccount();
  const chainId = useChainId();
  useEffect(() => {
    bridge.account = address ? address.toLowerCase() : null;
    bridge.chainId = chainId || null;
    notify(bridge.account);
  }, [address, chainId]);
  return <ConnectButton showBalance={false} chainStatus="none" accountStatus="address" label="Connect Wallet" />;
}

async function init() {
  const dc = await fetch('/dev-config').then((r) => r.json()).catch(() => ({}));
  const projectId = dc.walletConnectProjectId || '00000000000000000000000000000000';
  wagmiConfig = getDefaultConfig({
    appName: 'THE BLOCK',
    projectId,
    chains: [sepolia, mainnet],
    transports: { [sepolia.id]: http('/api/chain-rpc'), [mainnet.id]: http() },
    ssr: false,
  });
  const qc = new QueryClient();
  const theme = darkTheme({ accentColor: '#3ad0ff', accentColorForeground: '#02040a', borderRadius: 'medium', fontStack: 'system' });
  document.querySelectorAll('[data-wallet-widget]').forEach((el) => {
    createRoot(el).render(
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={qc}>
          <RainbowKitProvider theme={theme}>
            <Bridge />
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    );
  });
  bridge.ready = true;
  window.dispatchEvent(new Event('blockcassone-wallet-ready'));
}

init();
