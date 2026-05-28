const fs = require('fs');

function loadDotEnv(path) {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function flattenKeys(value, prefix = '', out = new Set()) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    if (value[0] && typeof value[0] === 'object') flattenKeys(value[0], `${prefix}[]`, out);
    return out;
  }
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.add(path);
    if (nested && typeof nested === 'object') flattenKeys(nested, path, out);
  }
  return out;
}

function findAgenticValues(value, prefix = '', out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach((nested, i) => findAgenticValues(nested, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (/agent|binding|entity|character|persona/i.test(path)) {
      out.push({ path, value: nested });
    }
    if (nested && typeof nested === 'object') findAgenticValues(nested, path, out);
  }
  return out;
}

async function fetchJson(path) {
  const url = new URL(`https://api.opensea.io/api/v2/${path}`);
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    const res = await fetch(url, {
      headers: {
        accept: 'application/json',
        'x-api-key': process.env.OPENSEA_API_KEY,
      },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`OpenSea ${res.status}: ${text.slice(0, 240)}`);
    return JSON.parse(text);
  } finally {
    if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
  }
}

async function main() {
  loadDotEnv('.env');
  const apiKey = process.env.OPENSEA_API_KEY;
  const address = process.argv[2] || process.env.OPENSEA_DEFAULT_WALLET;
  const chain = process.argv[3] || 'ethereum';
  if (!apiKey) throw new Error('Missing OPENSEA_API_KEY');
  if (!/^0x[a-fA-F0-9]{40}$/.test(address || '')) {
    throw new Error('Pass a wallet address or set OPENSEA_DEFAULT_WALLET');
  }

  const page = await fetchJson(`chain/${chain}/account/${address}/nfts?limit=20`);
  const nfts = page.nfts || [];
  console.log(`Fetched ${nfts.length} NFTs from ${chain}:${address}`);
  if (!nfts.length) return;

  const allKeys = new Set();
  const agentHits = [];
  for (const nft of nfts) {
    flattenKeys(nft, '', allKeys);
    const hits = findAgenticValues(nft);
    if (hits.length) {
      agentHits.push({
        contract: nft.contract,
        identifier: nft.identifier,
        name: nft.name,
        hits,
      });
    }
  }

  const singleNftHits = [];
  for (const nft of nfts.slice(0, 5)) {
    const detail = await fetchJson(`chain/${chain}/contract/${nft.contract}/nfts/${nft.identifier}`);
    flattenKeys(detail.nft || detail, 'detail', allKeys);
    const hits = findAgenticValues(detail.nft || detail);
    if (hits.length) {
      singleNftHits.push({
        contract: nft.contract,
        identifier: nft.identifier,
        name: nft.name,
        hits,
      });
    }
  }

  console.log('\nTop-level/sample response keys:');
  console.log([...allKeys].sort().join('\n'));

  console.log('\nAgent-looking fields:');
  if (!agentHits.length) console.log('(none found in account NFT page)');
  else console.log(JSON.stringify(agentHits, null, 2));

  console.log('\nAgent-looking fields from single-NFT detail checks:');
  if (!singleNftHits.length) console.log('(none found in first 5 NFT detail responses)');
  else console.log(JSON.stringify(singleNftHits, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
