import { imageUrlToBinaryGrid } from './nft-art-grid.js';
import { inflateGrid } from './art-snapshot.js';

export const NORMIES_CONTRACT = '0x9eb6e2025b64f340691e424b7fe7022ffde12438';
export const DEFAULT_WALLET_CHAINS = Object.freeze(['ethereum', 'base', 'shape']);

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
const detailFetchCache = new Map();
const assignmentLogCache = new Set();
const missingImageLogCache = new Set();

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

function extractAgentBinding(raw) {
  const binding = raw?.agent_binding || raw?.nft?.agent_binding || null;
  if (!binding) {
    return { agentic: false, agentId: '', agentBinding: null };
  }

  const agentId =
    binding.agent_id ||
    binding.agentId ||
    binding.identifier ||
    binding.id ||
    binding.token_id ||
    binding.tokenId ||
    binding.agent?.agent_id ||
    binding.agent?.id ||
    binding.agent?.identifier ||
    '';

  return {
    agentic: true,
    agentId: agentId === '' || agentId === undefined || agentId === null ? '' : String(agentId),
    agentBinding: binding,
  };
}

function isLikelySvgArtUrl(url) {
  const clean = String(url || '').trim().toLowerCase();
  if (!clean) return false;
  if (clean.startsWith('data:image/svg')) return true;
  if (/\.svg(?:$|[?#])/.test(clean)) return true;
  if (clean.includes('image/svg+xml')) return true;
  return false;
}

function isLikelyVideoUrl(url) {
  const clean = String(url || '').trim().toLowerCase();
  if (!clean) return false;
  if (clean.startsWith('data:video/')) return true;
  return /\.(?:mp4|webm|mov|m4v|ogv)(?:$|[?#])/i.test(clean);
}

function firstPresent(...values) {
  return values.find(value => String(value || '').trim()) || '';
}

function chooseArtImageUrl(raw) {
  const candidates = [
    raw.display_image_url,
    raw.nft?.display_image_url,
    raw.metadata?.image_url,
    raw.metadata?.display_image_url,
    raw.image_url,
    raw.nft?.image_url,
    raw.metadata?.image,
  ].map(value => String(value || '').trim()).filter(Boolean);

  return candidates.find(url => !isLikelyVideoUrl(url)) || '';
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
  const imageUrl = chooseArtImageUrl(raw);
  const animationUrl = firstPresent(
    raw.animation_url,
    raw.metadata?.animation_url,
    raw.nft?.animation_url,
    isLikelyVideoUrl(raw.image_url) ? raw.image_url : '',
    isLikelyVideoUrl(raw.nft?.image_url) ? raw.nft?.image_url : ''
  );
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
    animationUrl,
    unsupportedMedia: !imageUrl && Boolean(animationUrl),
    agentic: false,
    agentId: '',
    agentBinding: null,
    agentBindingLoaded: false,
  };
  Object.assign(normal, extractAgentBinding(raw));
  normal.agentBindingLoaded = Boolean(normal.agentBinding);
  normal.isNormie = chain === 'ethereum' && normal.contract === NORMIES_CONTRACT;
  normal.normieId = normal.isNormie ? Number(normal.tokenId) : null;
  normal.isSvgArt = !normal.isNormie && isLikelySvgArtUrl(normal.imageUrl);
  return normal;
}

function applyNftDetail(target, raw) {
  const detail = normalizeNft(raw?.nft || raw || {}, target.chain);
  if (detail.imageUrl) target.imageUrl = detail.imageUrl;
  if (detail.animationUrl) target.animationUrl = detail.animationUrl;
  target.unsupportedMedia = !target.imageUrl && Boolean(target.animationUrl);
  if (detail.name && !/^NFT #?$/.test(detail.name)) target.name = detail.name;
  if (detail.collection) target.collection = detail.collection;
  target.isSvgArt = !target.isNormie && isLikelySvgArtUrl(target.imageUrl);

  const agent = extractAgentBinding(raw?.nft || raw || {});
  if (agent.agentic) Object.assign(target, agent);
  Object.assign(target, { agentBindingLoaded: true, detailLoaded: true });
  return target;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// OpenSea's account/nfts endpoint transiently returns 404 (and 429/5xx under
// load) even for valid wallets that succeed on retry. A large wallet paginates
// over several pages, so without retry one flaky page aborts the whole load.
// Retry these statuses with linear backoff before giving up.
const RETRYABLE_STATUS = new Set([404, 408, 425, 429, 500, 502, 503, 504]);
const MAX_PAGE_ATTEMPTS = 4;

async function fetchWalletPage(address, chain, cursor) {
  const url = new URL(`/api/opensea/chain/${chain}/account/${address}/nfts`, window.location.origin);
  url.searchParams.set('limit', '200');
  if (cursor) url.searchParams.set('next', cursor);

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_PAGE_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(url);
    } catch (netErr) {
      lastError = netErr; // network hiccup — retry
      if (attempt < MAX_PAGE_ATTEMPTS) { await sleep(220 * attempt); continue; }
      throw netErr;
    }
    if (res.ok) return res.json();

    const text = await res.text().catch(() => '');
    lastError = new Error(`OpenSea wallet fetch failed ${res.status}: ${text.slice(0, 160)}`);
    if (attempt < MAX_PAGE_ATTEMPTS && RETRYABLE_STATUS.has(res.status)) {
      await sleep(220 * attempt);
      continue;
    }
    throw lastError;
  }
  throw lastError || new Error('OpenSea wallet fetch failed');
}

async function fetchNftDetail(nft) {
  const url = new URL(`/api/opensea/chain/${nft.chain}/contract/${nft.contract}/nfts/${nft.tokenId}`, window.location.origin);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenSea NFT detail fetch failed ${res.status}: ${text.slice(0, 160)}`);
  }
  return res.json();
}

// ONE OpenSea page (≤200 items), normalized — for callers that paginate on demand
// (the Update page's picker) instead of draining the whole inventory up-front.
export async function fetchWalletNftsPage(address, chain = 'ethereum', cursor = null) {
  const cleanAddress = String(address || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(cleanAddress))
    throw new Error('Enter a valid Ethereum wallet address');
  const page = await fetchWalletPage(cleanAddress, chain, cursor);
  return { nfts: (page.nfts || []).map(n => normalizeNft(n, chain)), next: page.next || null };
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
      void (`[wallet-nfts] OpenSea page`, {
        count: (page.nfts || []).length,
        next: page.next || null,
      });
      rawNfts.push(...(page.nfts || []));
      cursor = page.next || null;
    } while (cursor);

    const nfts = rawNfts.map(n => normalizeNft(n, chain));
    void (`[wallet-nfts] loaded ${nfts.length} NFTs`, {
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
        agentic: n.agentic,
        agentId: n.agentId,
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

export async function loadWalletNftsAcrossChains(address, chains = DEFAULT_WALLET_CHAINS) {
  const cleanAddress = String(address || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(cleanAddress))
    throw new Error('Enter a valid Ethereum wallet address');

  const uniqueChains = [...new Set((chains || []).map(c => String(c || '').trim()).filter(Boolean))];
  if (!uniqueChains.length) throw new Error('No chains selected');

  walletState = {
    loaded: false,
    loading: true,
    address: cleanAddress,
    chain: uniqueChains.join(','),
    chains: uniqueChains,
    nfts: [],
    normies: [],
    nonNormies: [],
    chainErrors: {},
    error: null,
  };
  notify();

  const allNfts = [];
  const chainErrors = {};

  await Promise.all(uniqueChains.map(async chain => {
    try {
      const rawNfts = [];
      let cursor = null;
      do {
        const page = await fetchWalletPage(cleanAddress, chain, cursor);
        void (`[wallet-nfts] OpenSea page`, {
          chain,
          count: (page.nfts || []).length,
          next: page.next || null,
        });
        rawNfts.push(...(page.nfts || []));
        cursor = page.next || null;
      } while (cursor);
      allNfts.push(...rawNfts.map(n => normalizeNft(n, chain)));
    } catch (err) {
      chainErrors[chain] = String(err?.message || err);
      console.warn(`[wallet-nfts] ${chain} wallet fetch failed`, err);
    }
  }));

  if (allNfts.length === 0 && Object.keys(chainErrors).length > 0) {
    const first = Object.entries(chainErrors)[0];
    throw new Error(`${first[0]}: ${first[1]}`);
  }

  allNfts.sort((a, b) =>
    a.chain.localeCompare(b.chain) ||
    a.contract.localeCompare(b.contract) ||
    String(a.tokenId).localeCompare(String(b.tokenId), undefined, { numeric: true })
  );

  void (`[wallet-nfts] loaded ${allNfts.length} NFTs across chains`, {
    chains: uniqueChains,
    chainErrors,
    normies: allNfts.filter(n => n.isNormie).length,
    nonNormies: allNfts.filter(n => !n.isNormie).length,
    sample: allNfts.slice(0, 8).map(n => ({
      chain: n.chain,
      contract: n.contract,
      tokenId: n.tokenId,
      isNormie: n.isNormie,
      agentic: n.agentic,
      agentId: n.agentId,
      name: n.name,
    })),
  });

  walletState = {
    loaded: true,
    loading: false,
    address: cleanAddress,
    chain: uniqueChains.join(','),
    chains: uniqueChains,
    nfts: allNfts,
    normies: allNfts.filter(n => n.isNormie),
    nonNormies: allNfts.filter(n => !n.isNormie),
    chainErrors,
    error: null,
  };
  notify();
  return walletState;
}

export async function loadAgentBindingForNft(nft) {
  if (!nft || !nft.contract || !nft.tokenId) return null;
  if (nft.agentBindingLoaded) return nft;

  const detail = await fetchNftDetail(nft);
  applyNftDetail(nft, detail);

  const key = nftKey(nft);
  for (const item of walletState.nfts) {
    if (nftKey(item) === key) applyNftDetail(item, detail);
  }

  notify();
  return nft;
}

export async function hydrateNftDetailForNft(nft) {
  if (!nft || !nft.contract || !nft.tokenId) return null;
  if (nft.detailLoaded || nft.imageUrl) return nft;

  const key = nftKey(nft);
  if (!detailFetchCache.has(key)) {
    detailFetchCache.set(key, fetchNftDetail(nft)
      .then(detail => {
        applyNftDetail(nft, detail);
        for (const item of walletState.nfts) {
          if (nftKey(item) === key) applyNftDetail(item, detail);
        }
        notify();
        return nft;
      })
      .catch(err => {
        nft.detailLoaded = true;
        console.warn(`[wallet-nfts] NFT detail hydration failed for ${key}:`, err);
        notify();
        return nft;
      }));
  }
  return detailFetchCache.get(key);
}

export function getWalletState() {
  return walletState;
}

export function walletInventoryLoaded() {
  return walletState.loaded && walletState.nfts.length > 0;
}

export function getWalletAssignmentForCube(motifIdx) {
  if (window.__PIPELINE_MINT_SOURCE_FOR_SLOT__) {
    const mintedSource = window.__PIPELINE_MINT_SOURCE_FOR_SLOT__(motifIdx);
    if (mintedSource) return mintedSource;
  }
  if (!walletInventoryLoaded()) return null;
  const idx = Math.abs(Number(motifIdx) || 0) % walletState.nfts.length;
  const nft = walletState.nfts[idx];
  const logKey = `${motifIdx}:${nftKey(nft)}`;
  if (!assignmentLogCache.has(logKey)) {
    assignmentLogCache.add(logKey);
    void (`[wallet-nfts] cube ${motifIdx} assigned NFT`, {
      idx,
      contract: nft.contract,
      tokenId: nft.tokenId,
      isNormie: nft.isNormie,
      isSvgArt: nft.isSvgArt,
      imageUrl: nft.imageUrl,
      name: nft.name,
      collection: nft.collection,
      agentic: nft.agentic,
      agentId: nft.agentId,
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

function hydrateGridFromAssignedSnapshot(nft) {
  if (!nft || nft.isNormie || !nft.art || nft.art.k !== 'x') return null;
  const key = nftKey(nft);
  if (!gridCache.has(key)) {
    const grid = inflateGrid(nft.art.g);
    if (grid) gridCache.set(key, grid);
  }
  return gridCache.get(key) || null;
}

export function isAgenticNonNormieCube(motifIdx) {
  const nft = getWalletAssignmentForCube(motifIdx);
  return Boolean(nft && !nft.isNormie && nft.agentic);
}

function gridMediaUrlForNft(nft) {
  return nft?.imageUrl || nft?.animationUrl || '';
}

function gridIsUsable(grid) {
  return Boolean(grid && !grid.error && !grid.discarded && (grid.bits || grid.grayscale));
}

export async function prepareNonNormieGridForNft(nft) {
  if (!nft || nft.isNormie) return null;
  const key = nftKey(nft);
  if (!nft.imageUrl && !nft.animationUrl && !nft.detailLoaded) {
    await hydrateNftDetailForNft(nft);
  }

  const mediaUrl = gridMediaUrlForNft(nft);
  if (!mediaUrl) {
    gridCache.set(key, { error: 'NFT has no usable image or animation media', bits: null });
    return null;
  }

  if (gridCache.has(key)) {
    const cached = gridCache.get(key);
    return gridIsUsable(cached) ? cached : null;
  }
  if (gridFetchCache.has(key)) {
    await gridFetchCache.get(key);
    const cached = gridCache.get(key);
    return gridIsUsable(cached) ? cached : null;
  }

  const p = imageUrlToBinaryGrid(mediaUrl)
    .then(grid => {
      gridCache.set(key, grid);
      return grid;
    })
    .catch(err => {
      gridCache.set(key, { error: String(err?.message || err), bits: null });
      throw err;
    });
  gridFetchCache.set(key, p);
  const grid = await p;
  return gridIsUsable(grid) ? grid : null;
}

export function ensureNonNormieGridFetched(motifIdx) {
  const nft = getWalletAssignmentForCube(motifIdx);
  if (!nft || nft.isNormie) return;
  if (hydrateGridFromAssignedSnapshot(nft)) return;
  if (!gridMediaUrlForNft(nft)) {
    const key = nftKey(nft);
    if (!nft.detailLoaded) {
      hydrateNftDetailForNft(nft);
      if (!missingImageLogCache.has(key)) {
        missingImageLogCache.add(key);
        void (`[wallet-nfts] cube ${motifIdx} hydrating saved non-Normie media`, nft);
      }
      return;
    }
    if (!missingImageLogCache.has(key)) {
      missingImageLogCache.add(key);
      if (nft.unsupportedMedia) {
        void (`[wallet-nfts] cube ${motifIdx} non-Normie has video/animation media only but no usable URL`, nft);
      } else {
        console.warn(`[wallet-nfts] cube ${motifIdx} non-Normie has no image URL`, nft);
      }
    }
    return;
  }
  const key = nftKey(nft);
  if (gridCache.has(key) || gridFetchCache.has(key)) return;
  const mediaUrl = gridMediaUrlForNft(nft);

  void (`[wallet-nfts] cube ${motifIdx} converting artwork grid`, {
    key,
    imageUrl: nft.imageUrl,
    animationUrl: nft.animationUrl || '',
    mediaKind: isLikelyVideoUrl(mediaUrl) ? 'video-frame' : 'image',
    name: nft.name,
    isSvgArt: nft.isSvgArt,
  });
  const p = imageUrlToBinaryGrid(mediaUrl)
    .then(grid => {
      gridCache.set(key, grid);
      void (`[wallet-nfts] artwork grid ready for ${key}`, {
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
      console.warn(`[wallet-nfts] media grid failed for ${key}:`, err);
      notify();
    });
  gridFetchCache.set(key, p);
}

export function getNonNormieGridForCube(motifIdx) {
  const nft = getWalletAssignmentForCube(motifIdx);
  if (!nft || nft.isNormie) return null;
  const hydrated = hydrateGridFromAssignedSnapshot(nft);
  if (hydrated) return hydrated;
  ensureNonNormieGridFetched(motifIdx);
  return gridCache.get(nftKey(nft)) || null;
}
