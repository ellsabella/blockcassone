import { imageUrlToBinaryGrid } from './nft-art-grid.js';

export const NORMIES_CONTRACT = '0x9eb6e2025b64f340691e424b7fe7022ffde12438';

let walletState = {
  loaded: false,
  loading: false,
  address: '',
  chain: 'ethereum',
  nfts: [],
  normies: [],
  nonNormies: [],
  error: null,
};

let onDataReady = null;
const gridCache = new Map();
const gridFetchCache = new Map();
const assignmentLogCache = new Set();

export function setWalletDataReadyCallback(cb) {
  onDataReady = cb;
}

function notify() {
  if (onDataReady) onDataReady();
}

function nftKey(nft) {
  return `${nft.chain}:${nft.contract}:${nft.tokenId}`;
}

export { nftKey };

function normalizeAddress(addr) {
  return String(addr || '').toLowerCase();
}

function isLikelySvgArtUrl(url) {
  const clean = String(url || '').trim().toLowerCase();
  if (!clean) return false;
  if (clean.startsWith('data:image/svg')) return true;
  if (/\.svg(?:$|[?#])/.test(clean)) return true;
  if (clean.includes('image/svg+xml')) return true;
  return false;
}

function normalizeNft(raw, chain) {
  const contract =
    raw.contract ||
    raw.contract_address ||
    raw.asset_contract?.address ||
    raw.nft?.contract ||
    raw.nft?.contract_address ||
    '';
  const tokenId =
    raw.identifier ||
    raw.token_id ||
    raw.tokenId ||
    raw.nft?.identifier ||
    raw.nft?.token_id ||
    '';
  const imageUrl =
    raw.image_url ||
    raw.display_image_url ||
    raw.metadata?.image ||
    raw.nft?.image_url ||
    raw.nft?.display_image_url ||
    '';
  const collectionSlug =
    raw.collection ||
    raw.collection_slug ||
    raw.collection?.slug ||
    raw.nft?.collection ||
    '';

  const normal = {
    raw,
    chain,
    contract: normalizeAddress(contract),
    tokenId: String(tokenId),
    name: raw.name || raw.nft?.name || `${collectionSlug || 'NFT'} #${tokenId}`,
    collection: collectionSlug,
    imageUrl,
  };
  normal.isNormie = normal.contract === NORMIES_CONTRACT;
  normal.normieId = normal.isNormie ? Number(normal.tokenId) : null;
  normal.isSvgArt = !normal.isNormie && isLikelySvgArtUrl(normal.imageUrl);
  return normal;
}

async function fetchWalletPage(address, chain, cursor) {
  const url = new URL(`/api/opensea/chain/${chain}/account/${address}/nfts`, window.location.origin);
  url.searchParams.set('limit', '200');
  if (cursor) url.searchParams.set('next', cursor);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenSea wallet fetch failed ${res.status}: ${text.slice(0, 160)}`);
  }
  return res.json();
}

export async function loadWalletNfts(address, chain = 'ethereum') {
  const cleanAddress = String(address || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(cleanAddress))
    throw new Error('Enter a valid Ethereum wallet address');

  walletState = {
    loaded: false,
    loading: true,
    address: cleanAddress,
    chain,
    nfts: [],
    normies: [],
    nonNormies: [],
    error: null,
  };
  notify();

  try {
    const rawNfts = [];
    let cursor = null;
    do {
      const page = await fetchWalletPage(cleanAddress, chain, cursor);
      console.debug(`[wallet-nfts] OpenSea page`, {
        count: (page.nfts || []).length,
        next: page.next || null,
      });
      rawNfts.push(...(page.nfts || []));
      cursor = page.next || null;
    } while (cursor);

    const nfts = rawNfts.map(n => normalizeNft(n, chain));
    console.info(`[wallet-nfts] loaded ${nfts.length} NFTs`, {
      normies: nfts.filter(n => n.isNormie).length,
      nonNormies: nfts.filter(n => !n.isNormie).length,
      sample: nfts.slice(0, 6).map(n => ({
        contract: n.contract,
        tokenId: n.tokenId,
        isNormie: n.isNormie,
        isSvgArt: n.isSvgArt,
        imageUrl: n.imageUrl,
        collection: n.collection,
        name: n.name,
      })),
    });
    walletState = {
      loaded: true,
      loading: false,
      address: cleanAddress,
      chain,
      nfts,
      normies: nfts.filter(n => n.isNormie),
      nonNormies: nfts.filter(n => !n.isNormie),
      error: null,
    };
    notify();
    return walletState;
  } catch (err) {
    walletState = {
      ...walletState,
      loaded: false,
      loading: false,
      error: String(err?.message || err),
    };
    notify();
    throw err;
  }
}

export function getWalletState() {
  return walletState;
}

export function walletInventoryLoaded() {
  return walletState.loaded && walletState.nfts.length > 0;
}

export function getWalletAssignmentForCube(motifIdx) {
  if (!walletInventoryLoaded()) return null;
  if (window.__PIPELINE_MINT_SOURCE_FOR_SLOT__) {
    const mintedSource = window.__PIPELINE_MINT_SOURCE_FOR_SLOT__(motifIdx);
    if (!mintedSource) return null;
    return mintedSource;
  }
  const idx = Math.abs(Number(motifIdx) || 0) % walletState.nfts.length;
  const nft = walletState.nfts[idx];
  const logKey = `${motifIdx}:${nftKey(nft)}`;
  if (!assignmentLogCache.has(logKey)) {
    assignmentLogCache.add(logKey);
    console.debug(`[wallet-nfts] cube ${motifIdx} assigned NFT`, {
      idx,
      contract: nft.contract,
      tokenId: nft.tokenId,
      isNormie: nft.isNormie,
      isSvgArt: nft.isSvgArt,
      imageUrl: nft.imageUrl,
      name: nft.name,
      collection: nft.collection,
    });
  }
  return nft;
}

export function isAssignedNormieCube(motifIdx) {
  const nft = getWalletAssignmentForCube(motifIdx);
  return nft ? nft.isNormie : null;
}

export function normieIdFromAssignedNft(motifIdx) {
  const nft = getWalletAssignmentForCube(motifIdx);
  return nft?.isNormie ? nft.normieId : null;
}

export function ensureNonNormieGridFetched(motifIdx) {
  const nft = getWalletAssignmentForCube(motifIdx);
  if (!nft || nft.isNormie) return;
  if (!nft.imageUrl) {
    console.warn(`[wallet-nfts] cube ${motifIdx} non-Normie has no image URL`, nft);
    return;
  }
  const key = nftKey(nft);
  if (gridCache.has(key) || gridFetchCache.has(key)) return;

  console.info(`[wallet-nfts] cube ${motifIdx} converting artwork grid`, {
    key,
    imageUrl: nft.imageUrl,
    name: nft.name,
    isSvgArt: nft.isSvgArt,
  });
  const p = imageUrlToBinaryGrid(nft.imageUrl)
    .then(grid => {
      gridCache.set(key, grid);
      console.info(`[wallet-nfts] artwork grid ready for ${key}`, {
        discarded: !!grid.discarded,
        reason: grid.reason || null,
        kind: grid.kind || null,
        gridSize: grid.gridSize || null,
        depthLayers: grid.depthLayers || null,
        depthMode: grid.depthMode || null,
        inferredGrid: grid.pixelGrid ? `${grid.pixelGrid.gridW}x${grid.pixelGrid.gridH}` : null,
        ones: grid.ones,
        zeros: ((grid.gridSize || 40) * (grid.gridSize || 40)) - grid.ones,
        normalizedUrl: grid.normalizedUrl,
      });
      notify();
    })
    .catch(err => {
      gridCache.set(key, { error: String(err?.message || err), bits: null });
      console.warn(`[wallet-nfts] image grid failed for ${key}:`, err);
      notify();
    });
  gridFetchCache.set(key, p);
}

export function getNonNormieGridForCube(motifIdx) {
  const nft = getWalletAssignmentForCube(motifIdx);
  if (!nft || nft.isNormie) return null;
  ensureNonNormieGridFetched(motifIdx);
  return gridCache.get(nftKey(nft)) || null;
}
