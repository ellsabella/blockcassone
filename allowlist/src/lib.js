// Holdings + delegation helpers.

import { CONFIG, DELEGATE_ABI } from './config.js';

// Alchemy NFT API (via the dev proxy) — owned tokens for `owner`, filtered to `contracts`.
export async function fetchOwnedNfts(owner, contracts) {
  const out = [];
  let pageKey = '';
  do {
    const p = new URLSearchParams({ owner, withMetadata: 'true', pageSize: '100' });
    for (const c of contracts) p.append('contractAddresses[]', c);
    if (pageKey) p.set('pageKey', pageKey);
    const res = await fetch(`/api/alchemy-nft/getNFTsForOwner?${p}`);
    if (!res.ok) throw new Error(`Alchemy ${res.status}`);
    const data = await res.json();
    out.push(...(data.ownedNfts || []));
    pageKey = data.pageKey || '';
  } while (pageKey && out.length < 500);
  return out;
}

// delegate.xyz v2: vaults that delegated TO `account`, scoped to our collections.
// type_ 1 ALL (whole wallet) · 2 CONTRACT · 3 ERC721 (token-scoped) · others ignored.
export async function resolveVaults(publicClient, account) {
  try {
    const rows = await publicClient.readContract({
      address: CONFIG.delegateRegistryV2,
      abi: DELEGATE_ABI,
      functionName: 'getIncomingDelegations',
      args: [account],
    });
    const ours = new Set(CONFIG.collections.map(c => c.address.toLowerCase()));
    const all = CONFIG.collections.map(c => c.address);
    const out = [];
    for (const d of rows) {
      const type_ = Number(d.type_);
      if (type_ === 1) {
        out.push({ address: d.from, contracts: all, via: 'delegated' });
      } else if ((type_ === 2 || type_ === 3) && ours.has(d.contract_.toLowerCase())) {
        const v = { address: d.from, contracts: [d.contract_], via: 'delegated' };
        if (type_ === 3) v.tokenIds = [String(d.tokenId)];
        out.push(v);
      }
    }
    console.log('[allowlist] incoming delegations →', rows, '\n  vaults:', out);
    return out;
  } catch (e) {
    console.warn('[allowlist] delegation lookup failed:', e);
    return [];
  }
}

// Aggregate holdings across the connected wallet + delegated vaults, deduped.
export async function resolveHoldings(publicClient, account) {
  const byAddr = new Map(CONFIG.collections.map(c => [c.address.toLowerCase(), c]));
  const vaults = await resolveVaults(publicClient, account);
  const scans = [{ address: account, contracts: CONFIG.collections.map(c => c.address), via: 'wallet' }, ...vaults];

  const seen = new Set();
  const holdings = [];
  for (const scan of scans) {
    const nfts = await fetchOwnedNfts(scan.address, scan.contracts);
    for (const nft of nfts) {
      const col = byAddr.get((nft.contract?.address || '').toLowerCase());
      if (!col) continue;
      const tokenId = String(BigInt(nft.tokenId));
      if (scan.tokenIds && !scan.tokenIds.includes(tokenId)) continue; // token-scoped delegation
      const k = `${col.collectionId}:${tokenId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      holdings.push({
        collectionId: col.collectionId,
        collectionName: col.name,
        contractAddr: col.address,
        tokenId,
        image: nft.image?.thumbnailUrl || nft.image?.cachedUrl || nft.image?.originalUrl || '',
        via: scan.via,
      });
    }
  }
  return { holdings, vaults };
}
