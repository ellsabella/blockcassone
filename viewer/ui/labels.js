// UI — NFT info label and lights-panel label updates.

import { getMintedCubeForSlot } from '../mint-simulator.js';
import { getWalletAssignmentForCube } from '../wallet-nfts.js';

export function updateLightsLabel(el, mode, selectedMotifIdx) {
  if (!el) return;
  if (mode === 'BIG' && selectedMotifIdx !== null)
    el.textContent = `Lights — cube ${selectedMotifIdx}`;
  else
    el.textContent = 'Lights';
}

export function updateNftLabel(el, motifIdx) {
  if (!el) return;
  if (motifIdx === null || motifIdx === undefined) {
    el.textContent = 'NFT: none';
    return;
  }
  const mintedCube = getMintedCubeForSlot(motifIdx);
  const nft        = mintedCube?.nft || getWalletAssignmentForCube(motifIdx);
  if (!nft) {
    el.textContent = `slot ${motifIdx} | empty`;
    return;
  }
  const kind     = nft.isNormie ? 'Normie' : 'Non-normie';
  const name     = nft.name || `#${nft.tokenId || '?'}`;
  const contract = nft.contract ? `${nft.contract.slice(0, 6)}...${nft.contract.slice(-4)}` : 'unknown';
  const prefix   = mintedCube ? `cube ${mintedCube.cubeId} @ slot ${motifIdx}` : `slot ${motifIdx}`;
  const agent = nft.agentic ? ` | Agent ${nft.agentId || '?'}` : '';
  el.textContent = `${prefix} | ${nft.chain || '?'} | ${kind}${agent} | ${name} | ${contract}:${nft.tokenId || '?'}`;
}
