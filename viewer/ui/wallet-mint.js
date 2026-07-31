// UI — wallet status and mint simulation controls.

import { getWalletState } from '../wallet-nfts.js';
import { mintedStateSource, mintSimulationSummary } from '../mint-simulator.js';

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
  // Show the genesis multi-source mix (Normie + CC0 pools) by collection.
  const mix = (summary.byCollection || [])
    .map(row => `${row.name} ${row.count}`)
    .join(' · ');
  const other = summary.other ? ` | other ${summary.other}` : '';
  el.textContent = `${mintedStateSource()}: minted ${summary.total}${mix ? ` | ${mix}` : ''}${other} | empty slots: ${empty}`;
}
