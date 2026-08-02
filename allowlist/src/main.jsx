import React from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider, http } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { getDefaultConfig, RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@rainbow-me/rainbowkit/styles.css';
import './styles.css';
import App from './App.jsx';
import { CONFIG } from './config.js';

// Reads go through the keyless dev proxy → mainnet ETH_RPC_URL. RainbowKit's default
// config wires up injected wallets (MetaMask, Phantom, Rabby, …) + WalletConnect.
// The WalletConnect project id (needed for mobile / QR wallets) is injected from the
// repo-root .env (WALLETCONNECT_PROJECT_ID) at build time; injected wallets work without it.
const projectId = import.meta.env.VITE_WC_PROJECT_ID || CONFIG.walletConnectProjectId;
if (!projectId || projectId.startsWith('REPLACE_')) {
  console.warn('[allowlist] No WalletConnect project id set (WALLETCONNECT_PROJECT_ID in .env) — mobile/QR wallets will not connect. Injected extension wallets still work.');
}
const wagmiConfig = getDefaultConfig({
  appName: 'Blockcassone Allowlist',
  projectId,
  chains: [mainnet],
  transports: { [mainnet.id]: http('/api/mainnet-rpc') },
  ssr: false,
});

const queryClient = new QueryClient();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({ accentColor: '#ff3ab8', accentColorForeground: '#0a0a0e', borderRadius: 'none', fontStack: 'system' })}>
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
);
