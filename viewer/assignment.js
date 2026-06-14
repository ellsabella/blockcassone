let cubeAssignmentResolver = null;

export function setCubeAssignmentResolver(resolver) {
  cubeAssignmentResolver = typeof resolver === 'function' ? resolver : null;
}

export function getCubeAssignmentForRender(motifIdx) {
  if (cubeAssignmentResolver) {
    const assigned = cubeAssignmentResolver(motifIdx);
    if (assigned) return assigned;
  }
  if (typeof window !== 'undefined' && window.__PIPELINE_MINT_SOURCE_FOR_SLOT__) {
    return window.__PIPELINE_MINT_SOURCE_FOR_SLOT__(motifIdx) || null;
  }
  return null;
}

export function isAssignedNormieCube(motifIdx) {
  const nft = getCubeAssignmentForRender(motifIdx);
  return nft ? nft.isNormie : null;
}

export function normieIdFromAssignedNft(motifIdx) {
  const nft = getCubeAssignmentForRender(motifIdx);
  return nft?.isNormie ? nft.normieId : null;
}
