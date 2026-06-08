import { NORMIES_CONTRACT } from './wallet-nfts.js';

const SELECTORS = {
  nextCubeId: '0xfee34352',
  cubeData: '0xd88ff669',
  ownerOf: '0x6352211e',
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

async function loadChainConfig() {
  if (configCache) return configCache;
  configCache = fetch('/data/chain-config.json')
    .then(res => res.ok ? res.json() : null)
    .then(raw => {
      const cubeNft = normalizeAddress(raw?.cubeNft);
      return {
        enabled: Boolean(raw?.enabled && cubeNft),
        rpcUrl: String(raw?.rpcUrl || 'http://127.0.0.1:8545'),
        chainId: Number(raw?.chainId || 0),
        cubeNft,
        genesisMinter: normalizeAddress(raw?.genesisMinter),
        normies: normalizeAddress(raw?.normies) || NORMIES_CONTRACT,
        maxCubes: Math.max(1, Math.min(4096, Number(raw?.maxCubes || 4096))),
        directRpc: Boolean(raw?.directRpc),
      };
    })
    .catch(() => ({ enabled: false }));
  return configCache;
}

async function rpc(config, payload) {
  const res = await fetch(config.directRpc ? config.rpcUrl : '/api/chain-rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const data = await res.json();
  if (Array.isArray(payload)) {
    const rows = data.slice().sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0));
    return rows.map(row => {
      if (row?.error) throw new Error(row.error.message || JSON.stringify(row.error));
      return row.result;
    });
  }
  if (data?.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result;
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

  return {
    cubeId,
    slot,
    wallet: owner,
    sourceKind,
    source: {
      chain: numberWord(row[7]) === 1 ? 'ethereum' : `chain-${numberWord(row[7])}`,
      chainId: numberWord(row[7]),
      contract: sourceContract,
      tokenId: String(sourceTokenId),
    },
    cc0: null,
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

export async function loadChainMintRecords() {
  const config = await loadChainConfig();
  if (!config.enabled) return { enabled: false, records: [] };

  const nextHex = await call(config, config.cubeNft, SELECTORS.nextCubeId);
  const nextCubeId = Math.max(1, Math.min(config.maxCubes + 1, numberWord(words(nextHex)[0])));
  const cubeIds = [];
  for (let cubeId = 1; cubeId < nextCubeId; cubeId++) cubeIds.push(cubeId);

  const records = [];
  const chunkSize = 100;
  for (let offset = 0; offset < cubeIds.length; offset += chunkSize) {
    const chunk = cubeIds.slice(offset, offset + chunkSize);
    const dataCalls = chunk.map(cubeId => ({ to: config.cubeNft, data: calldata(SELECTORS.cubeData, cubeId) }));
    const ownerCalls = chunk.map(cubeId => ({ to: config.cubeNft, data: calldata(SELECTORS.ownerOf, cubeId) }));
    const [dataRows, ownerRows] = await Promise.all([
      batchCall(config, dataCalls),
      batchCall(config, ownerCalls),
    ]);

    for (let i = 0; i < chunk.length; i++) {
      const owner = addressWord(words(ownerRows[i])[0]);
      const record = recordFromChain(config, chunk[i], owner, dataRows[i]);
      if (record) records.push(record);
    }
  }

  return { enabled: true, config, records };
}
