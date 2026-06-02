// UI — wallet status and mint simulation controls.

import { getWalletState } from '../wallet-nfts.js';
import { mintSimulationSummary } from '../mint-simulator.js';

function shortAddress(address) {
  const value = String(address || '');
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value || 'unknown';
}

export function updateWalletStatus(el) {
  if (!el) return;
  const state = getWalletState();
  if (state.loading)       el.textContent = 'wallet: loading...';
  else if (state.error)    el.textContent = `wallet: ${state.error}`;
  else if (state.loaded) {
    const chains = state.chains?.join('+') || state.chain || 'unknown';
    const failed = Object.keys(state.chainErrors || {});
    el.textContent = `minting as ${shortAddress(state.address)} | ${state.nfts.length} NFTs @ ${chains} | normies ${state.normies.length} | non ${state.nonNormies.length}${failed.length ? ` | failed ${failed.join(',')}` : ''}`;
  }
  else                     el.textContent = 'wallet: not loaded';
}

export function mintCountValue(input) {
  return Math.max(1, Math.min(64, Math.floor(Number(input?.value) || 1)));
}

export function setMintCountValue(input, next) {
  if (!input) return;
  input.value = String(Math.max(1, Math.min(64, Math.floor(Number(next) || 1))));
}

export function updateMintStatus(el, uniqueMotifs) {
  if (!el) return;
  const summary = mintSimulationSummary();
  const empty   = Math.max(0, uniqueMotifs.length - summary.slots);
  const legacy = (summary.cc0 || 0) + (summary.external || 0);
  el.textContent = `minted: ${summary.total} | normie ${summary.normies}${legacy ? ` | legacy ${legacy}` : ''} | empty slots: ${empty}`;
}
