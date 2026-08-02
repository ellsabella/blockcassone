// Production token-renderer entry (the on-chain animation_url bundle).
// The non-Normie art builders are now network-free (their grid comes from the
// embedded 2-bit tonal via injected resolvers), so importing them keeps the bundle
// forbiddenPatterns-clean while letting external cubes render band contours + voxels.
import { main } from './entry.js';
import {
  buildNonNormieArtworkPlane,
  buildNonNormieWalker,
  buildNonNormieBanner,
  buildNonNormieIdLabel,
} from '../viewer/non-normie-art-plane.js';

main({
  nonNormie: {
    buildArtworkPlane: buildNonNormieArtworkPlane,
    buildWalker: buildNonNormieWalker,
    buildBanner: buildNonNormieBanner,
    buildIdLabel: buildNonNormieIdLabel,
  },
}).catch(err => {
  const label = document.getElementById('h');
  if (label) label.textContent = String(err?.message || err);
  console.error(err);
});
