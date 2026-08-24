import { NORMIES_CONTRACT } from './wallet-nfts.js';
import { compactNormieArtFromRaw, compactNonNormieArt } from './art-snapshot.js';
import { startRpc, recordHydration } from './perf-metrics.js';
import { fetchWorldSnapshot } from './snapshot-fetch.js';

const SELECTORS = {
  nextCubeId: '0xfee34352',
  cubeData: '0xd88ff669',
  resolvedCubeData: '0xc7f1b0a2',
  ownerOf: '0x6352211e',
  rawImageData: '0x6985bf3c',
  payloadForCube: '0x28d846fa', // NonNormieArtStore.payloadForCube(uint256)
};

let configCache = null;

function normalizeAddress(value) {
  const clean = String(value || '').trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(clean) ? clean : '';
}

function padWord(value) {
  return BigInt(value).toString(16).padStart(64, '0');
}

function calldata(selector, value) {
  return `${selector}${padWord(value)}`;
}

function words(hex) {
  const clean = String(hex || '').replace(/^0x/, '');
  const out = [];
  for (let i = 0; i + 64 <= clean.length; i += 64) out.push(clean.slice(i, i + 64));
  return out;
}

function numberWord(word) {
  return Number(BigInt(`0x${word || '0'}`));
}

function addressWord(word) {
  const clean = String(word || '').padStart(64, '0');
  return `0x${clean.slice(-40)}`.toLowerCase();
}

function bytes32Word(word) {
  return `0x${String(word || '').padStart(64, '0')}`;
}

function decodeAbiBytes(hex) {
  const row = words(hex);
  if (row.length < 2) return new Uint8Array();
  const offset = numberWord(row[0]);
  const lengthWordIndex = Math.floor(offset / 32);
  const length = numberWord(row[lengthWordIndex]);
  const dataStart = lengthWordIndex + 1;
  const clean = row.slice(dataStart).join('').slice(0, length * 2);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2) || '00', 16);
  }
  return out;
}

async function loadChainConfig() {
  if (configCache) return configCache;
  configCache = fetch('/data/chain-config.json', { cache: 'no-store' })
    .then(res => res.ok ? res.json() : null)
    .then(raw => {
      const cubeNft = normalizeAddress(raw?.cubeNft);
      return {
        enabled: Boolean(raw?.enabled && cubeNft),
        rpcUrl: String(raw?.rpcUrl || 'http://127.0.0.1:8545'),
        chainId: Number(raw?.chainId || 0),
        cubeNft,
        genesisMinter: normalizeAddress(raw?.genesisMinter),
        nonNormieStore: normalizeAddress(raw?.nonNormieStore),
        cc0Pool: Array.isArray(raw?.cc0Pool) ? raw.cc0Pool : [],
        normies: normalizeAddress(raw?.normies) || NORMIES_CONTRACT,
        normieStorage: normalizeAddress(raw?.normieStorage) || normalizeAddress(raw?.normies) || NORMIES_CONTRACT,
        maxCubes: Math.max(1, Math.min(4096, Number(raw?.maxCubes || 4096))),
        directRpc: Boolean(raw?.directRpc),
        agentStatusRegistry: normalizeAddress(raw?.agentStatusRegistry),
        useSnapshot: Boolean(raw?.useSnapshot),
      };
    })
    .catch(() => ({ enabled: false }));
  return configCache;
}

async function rpc(config, payload) {
  const done = startRpc(
    Array.isArray(payload) ? (payload[0]?.method || 'batch') : (payload?.method || 'rpc'),
    Array.isArray(payload) ? payload.length : 1,
  );
  let ok = false;
  try {
    const res = await fetch(config.directRpc ? config.rpcUrl : '/api/chain-rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(payload)) {
      // Tolerant: a reverting call (e.g. ownerOf/resolvedCubeData of a burned cube
      // after a merge) yields null for that row, so the caller can skip it rather
      // than failing the whole batch.
      const rows = data.slice().sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0));
      ok = true;
      return rows.map(row => (row?.error ? null : row.result));
    }
    if (data?.error) throw new Error(data.error.message || JSON.stringify(data.error));
    ok = true;
    return data.result;
  } finally {
    done(ok);
  }
}

async function call(config, to, data) {
  return rpc(config, {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to, data }, 'latest'],
  });
}

async function batchCall(config, calls) {
  if (!calls.length) return [];
  const payload = calls.map((entry, index) => ({
    jsonrpc: '2.0',
    id: index + 1,
    method: 'eth_call',
    params: [{ to: entry.to, data: entry.data }, 'latest'],
  }));
  return rpc(config, payload);
}

function recordFromChain(config, cubeId, owner, dataHex) {
  const row = words(dataHex);
  if (row.length < 11) return null;

  const slot = numberWord(row[0]);
  const sourceKindNumber = numberWord(row[1]);
  const sourceContract = addressWord(row[8]);
  const sourceTokenId = numberWord(row[9]);
  const sourceKind = sourceKindNumber === 1 ? 'normie' : 'external';
  // Resolve the CC0 collection name (Chain Runners / Nouns / …) from the deploy-declared
  // cc0Pool so cubes label as "Nouns #3001" instead of a bare "Source #…".
  const poolName = sourceKind === 'external'
    ? (config.cc0Pool || []).find(p => String(p.contract || '').toLowerCase() === sourceContract)?.name
    : '';

  return {
    cubeId,
    slot,
    wallet: owner,
    sourceKind,
    sourceKindNumber, // 1=normie, 2=external, 3=merged street
    source: {
      chain: numberWord(row[7]) === 1 ? 'ethereum' : `chain-${numberWord(row[7])}`,
      chainId: numberWord(row[7]),
      contract: sourceContract,
      tokenId: String(sourceTokenId),
    },
    cc0: poolName ? { projectName: poolName } : null,
    agentic: numberWord(row[4]) !== 0,
    agentId: numberWord(row[5]) ? String(numberWord(row[5])) : '',
    seed: bytes32Word(row[10]),
    art: null,
    _chain: {
      rendererVersion: numberWord(row[2]),
      payloadVersion: numberWord(row[3]),
      mintedAt: numberWord(row[6]),
    },
  };
}

// Read the indexer's cached world snapshot (data/world-snapshot.json). Returns
// the record array, or null if missing/unusable so the caller falls back to a
// live chain scan. Guards against a stale snapshot from a different deployment.
async function loadSnapshotRecords(config) {
  try {
    const snap = await fetchWorldSnapshot();
    if (!snap || !Array.isArray(snap.records)) return null;
    if (snap.cubeNft && config.cubeNft &&
        String(snap.cubeNft).toLowerCase() !== String(config.cubeNft).toLowerCase()) {
      console.warn('[chain-cubes] snapshot cubeNft mismatch — ignoring stale snapshot');
      return null;
    }
    return snap.records;
  } catch (err) {
    console.warn('[chain-cubes] snapshot read failed', err);
    return null;
  }
}

// Ownership-only view of the indexer snapshot: which wallet owns which cube.
// NO art hydration, NO chain calls — one cached static fetch. Used by pages
// (Update Cube) that must know ownership before spending any RPC at all.
// Returns null when there is no usable snapshot (caller decides the fallback).
export async function loadSnapshotOwnership() {
  const config = await loadChainConfig();
  if (!config.enabled || !config.useSnapshot) return null;
  const records = await loadSnapshotRecords(config);
  return records ? { config, records } : null;
}

// Hydrate .art for normie-sourced records by batching rawImageData (immutable
// per normieId). Shared by the snapshot fast-path; the chain scan hydrates
// inline. Goes away once the indexer serves art (M4).
async function hydrateNormieArt(config, records) {
  // Skip records the indexer already baked art into (M4) — those need no RPC.
  const normieRecords = records.filter(r =>
    r && r.sourceKind === 'normie' && !r.art && Number.isInteger(Number(r.source?.tokenId))
  );
  const chunkSize = 100;
  for (let offset = 0; offset < normieRecords.length; offset += chunkSize) {
    const chunk = normieRecords.slice(offset, offset + chunkSize);
    const rawCalls = chunk.map(record => ({
      to: config.normieStorage,
      data: calldata(SELECTORS.rawImageData, record.source.tokenId),
    }));
    try {
      const rawRows = await batchCall(config, rawCalls);
      for (let i = 0; i < chunk.length; i++) {
        const id = Number(chunk[i].source.tokenId);
        const raw = decodeAbiBytes(rawRows[i]);
        chunk[i].art = compactNormieArtFromRaw({
          id, raw, traits: null,
          agentic: Boolean(chunk[i]?.agentic),
          agentId: chunk[i]?.agentId || '',
        });
      }
    } catch (err) {
      console.warn('[chain-cubes] snapshot Normie art hydration failed', err);
    }
  }
}

// Hydrate .art for external (CC0) cubes by batching payloadForCube(cubeId) from the
// NonNormieArtStore and packing the 400-byte 2-bit tonal into the compact art shape the
// scene builder consumes. Mirrors hydrateNormieArt. A stub/absent payload (length != 400)
// is skipped, so a cube with no committed art just renders blank rather than erroring.
async function hydrateNonNormieArt(config, records) {
  if (!config.nonNormieStore) return;
  const ext = records.filter(r => r && r.sourceKind === 'external' && !r.art);
  const chunkSize = 60;
  for (let offset = 0; offset < ext.length; offset += chunkSize) {
    const chunk = ext.slice(offset, offset + chunkSize);
    const calls = chunk.map(r => ({ to: config.nonNormieStore, data: calldata(SELECTORS.payloadForCube, r.cubeId) }));
    try {
      const rows = await batchCall(config, calls);
      for (let i = 0; i < chunk.length; i++) {
        const tonal = decodeAbiBytes(rows[i]);
        if (tonal.length !== 400) continue;
        chunk[i].art = compactNonNormieArt({ id: Number(chunk[i].source?.tokenId) || chunk[i].cubeId, tonal });
      }
    } catch (err) {
      console.warn('[chain-cubes] non-normie art hydration failed', err);
    }
  }
}

export async function loadChainMintRecords() {
  const config = await loadChainConfig();
  if (!config.enabled) return { enabled: false, records: [] };
  const hydrateStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // Fast path: read the indexer's cached snapshot instead of scanning the chain
  // (~3 eth_calls/cube). Falls back to the scan if it's missing or stale.
  if (config.useSnapshot) {
    const snapRecords = await loadSnapshotRecords(config);
    if (snapRecords) {
      await hydrateNormieArt(config, snapRecords);
      await hydrateNonNormieArt(config, snapRecords);
      const snapEnd = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      recordHydration(snapEnd - hydrateStart, snapRecords.length);
      return { enabled: true, config, records: snapRecords };
    }
    console.warn('[chain-cubes] useSnapshot set but no usable snapshot — scanning chain');
  }

  const nextHex = await call(config, config.cubeNft, SELECTORS.nextCubeId);
  const nextCubeId = Math.max(1, Math.min(config.maxCubes + 1, numberWord(words(nextHex)[0])));
  const cubeIds = [];
  for (let cubeId = 1; cubeId < nextCubeId; cubeId++) cubeIds.push(cubeId);

  const records = [];
  const chunkSize = 100;
  for (let offset = 0; offset < cubeIds.length; offset += chunkSize) {
    const chunk = cubeIds.slice(offset, offset + chunkSize);
    const dataCalls = chunk.map(cubeId => ({
      to: config.cubeNft,
      data: calldata(SELECTORS.resolvedCubeData, cubeId),
    }));
    const ownerCalls = chunk.map(cubeId => ({ to: config.cubeNft, data: calldata(SELECTORS.ownerOf, cubeId) }));
    const [dataRows, ownerRows] = await Promise.all([
      batchCall(config, dataCalls),
      batchCall(config, ownerCalls),
    ]);

    const recordStart = records.length;
    for (let i = 0; i < chunk.length; i++) {
      if (!ownerRows[i] || !dataRows[i]) continue; // burned/nonexistent (e.g. merged-away) cube
      const owner = addressWord(words(ownerRows[i])[0]);
      const record = recordFromChain(config, chunk[i], owner, dataRows[i]);
      if (record) records.push(record);
    }

    const chunkRecords = records.slice(recordStart);
    const normieRecords = chunkRecords.filter(record =>
      record.sourceKind === 'normie' && Number.isInteger(Number(record.source.tokenId))
    );

    if (normieRecords.length) {
      const rawCalls = normieRecords.map(record => ({
        to: config.normieStorage,
        data: calldata(SELECTORS.rawImageData, record.source.tokenId),
      }));

      try {
        const rawRows = await batchCall(config, rawCalls);
        for (let i = 0; i < normieRecords.length; i++) {
          const id = Number(normieRecords[i].source.tokenId);
          const raw = decodeAbiBytes(rawRows[i]);
          normieRecords[i].art = compactNormieArtFromRaw({
            id,
            raw,
            traits: null,
            agentic: Boolean(normieRecords[i]?.agentic),
            agentId: normieRecords[i]?.agentId || '',
          });
        }
      } catch (err) {
        console.warn('[chain-cubes] Normie raw art hydration failed; falling back to API fetches', err);
      }
    }
  }

  await hydrateNonNormieArt(config, records);
  const hydrateEnd = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  recordHydration(hydrateEnd - hydrateStart, records.length);
  return { enabled: true, config, records };
}
