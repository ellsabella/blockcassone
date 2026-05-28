import { imageUrlToBinaryGrid } from './nft-art-grid.js';

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
  if (detail.name && !/^NFT #?$/.test(detail.name)) target.name = detail.name;
  if (detail.collection) target.collection = detail.collection;
  target.isSvgArt = !target.isNormie && isLikelySvgArtUrl(target.imageUrl);

  const agent = extractAgentBinding(raw?.nft || raw || {});
  if (agent.agentic) Object.assign(target, agent);
  Object.assign(target, { agentBindingLoaded: true, detailLoaded: true });
  return target;
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

async function fetchNftDetail(nft) {
  const url = new URL(`/api/opensea/chain/${nft.chain}/contract/${nft.contract}/nfts/${nft.tokenId}`, window.location.origin);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenSea NFT detail fetch failed ${res.status}: ${text.slice(0, 160)}`);
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
        console.debug(`[wallet-nfts] OpenSea page`, {
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

  console.info(`[wallet-nfts] loaded ${allNfts.length} NFTs across chains`, {
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

export function isAgenticNonNormieCube(motifIdx) {
  const nft = getWalletAssignmentForCube(motifIdx);
  return Boolean(nft && !nft.isNormie && nft.agentic);
}

export function ensureNonNormieGridFetched(motifIdx) {
  const nft = getWalletAssignmentForCube(motifIdx);
  if (!nft || nft.isNormie) return;
  if (!nft.imageUrl) {
    const key = nftKey(nft);
    if (!nft.detailLoaded) {
      hydrateNftDetailForNft(nft);
      if (!missingImageLogCache.has(key)) {
        missingImageLogCache.add(key);
        console.info(`[wallet-nfts] cube ${motifIdx} hydrating saved non-Normie media`, nft);
      }
      return;
    }
    if (!missingImageLogCache.has(key)) {
      missingImageLogCache.add(key);
      console.warn(`[wallet-nfts] cube ${motifIdx} non-Normie has no image URL`, nft);
    }
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
