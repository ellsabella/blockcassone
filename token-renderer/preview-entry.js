// Dev-only preview entry for the Update Cube page. Adds the non-Normie art
// pipeline (buildNonNormieArtworkPlane + wallet-nfts grid fetch/flatten), so this
// bundle is NOT network-free and must never be used as an on-chain animation_url —
// it is only loaded by viewer/cube-preview.html in the dev viewer.
import { main } from './entry.js';
import {
  buildNonNormieArtworkPlane,
  buildNonNormieWalker,
  buildNonNormieBanner,
} from '../viewer/non-normie-art-plane.js';
import { prepareNonNormieGridForNft } from '../viewer/wallet-nfts.js';

main({
  nonNormie: {
    buildArtworkPlane: buildNonNormieArtworkPlane,
    buildWalker: buildNonNormieWalker,
    buildBanner: buildNonNormieBanner,
    prepareGrid: prepareNonNormieGridForNft,
  },
}).catch(err => {
  const label = document.getElementById('h');
  if (label) label.textContent = String(err?.message || err);
  console.error(err);
});
