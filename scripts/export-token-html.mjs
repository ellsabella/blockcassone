import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TOKEN_URI_SELECTOR = '0xc87b56dd';
const DEFAULT_CONFIG = 'data/chain-config.json';
const DEFAULT_TOKEN_ID = 1n;

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const entry = process.argv.slice(2).find(arg => arg === name || arg.startsWith(prefix));
  if (!entry) return fallback;
  if (entry === name) return 'true';
  return entry.slice(prefix.length);
}

function stripQuotes(value) {
  const text = String(value || '').trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function hexWord(value) {
  return BigInt(value).toString(16).padStart(64, '0');
}

function calldata(selector, tokenId) {
  return `${selector}${hexWord(tokenId)}`;
}

function words(hex) {
  const clean = String(hex || '').replace(/^0x/, '');
  const out = [];
  for (let i = 0; i + 64 <= clean.length; i += 64) out.push(clean.slice(i, i + 64));
  return out;
}

function wordNumber(word) {
  return Number(BigInt(`0x${word || '0'}`));
}

function decodeAbiString(hex) {
  const row = words(hex);
  if (row.length < 2) throw new Error('eth_call did not return an ABI string');
  const offset = wordNumber(row[0]);
  const lengthWordIndex = Math.floor(offset / 32);
  const byteLength = wordNumber(row[lengthWordIndex]);
  const dataStart = lengthWordIndex + 1;
  const clean = row.slice(dataStart).join('').slice(0, byteLength * 2);
  return Buffer.from(clean, 'hex').toString('utf8');
}

function parseDataUri(uri, expectedPrefix) {
  const text = String(uri || '');
  const comma = text.indexOf(',');
  if (comma < 0) throw new Error(`Missing comma in ${expectedPrefix} data URI`);
  const header = text.slice(0, comma);
  if (!header.startsWith(expectedPrefix) || !/;base64$/i.test(header)) {
    throw new Error(`Expected ${expectedPrefix};base64 data URI`);
  }
  return Buffer.from(text.slice(comma + 1), 'base64');
}

async function rpc(rpcUrl, payload) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result;
}

function validateHtml(html) {
  const checks = [
    { label: 'fetch()', pattern: /\bfetch\s*\(/ },
    { label: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
    { label: 'Normies API', pattern: /api\.normies\.art|\/api\/normies/i },
    { label: 'remote URL', pattern: /https?:\/\//i },
  ];
  return checks.filter(check => check.pattern.test(html)).map(check => check.label);
}

async function main() {
  const configPath = argValue('--config', DEFAULT_CONFIG);
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const rpcUrl = argValue('--rpc-url', process.env.RPC_URL || config.rpcUrl || 'http://127.0.0.1:8545');
  const cubeNft = argValue('--cube-nft', process.env.CUBE_NFT || config.cubeNft || '');
  const tokenId = BigInt(argValue('--token-id', String(DEFAULT_TOKEN_ID)));
  const outDir = path.resolve(argValue(
    '--out-dir',
    path.join(os.tmpdir(), 'blockcassone-token-previews', `cube-${tokenId}`)
  ));

  if (!/^0x[0-9a-fA-F]{40}$/.test(cubeNft)) {
    throw new Error('Missing or invalid cube NFT address. Pass --cube-nft=0x...');
  }

  const tokenURIResult = await rpc(rpcUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to: cubeNft, data: calldata(TOKEN_URI_SELECTOR, tokenId) }, 'latest'],
  });

  const tokenURI = stripQuotes(decodeAbiString(tokenURIResult));
  const metadata = JSON.parse(parseDataUri(tokenURI, 'data:application/json').toString('utf8'));
  const html = parseDataUri(metadata.animation_url, 'data:text/html').toString('utf8');
  const svg = parseDataUri(metadata.image, 'data:image/svg+xml').toString('utf8');

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, `cube-${tokenId}.html`), html);
  await fs.writeFile(path.join(outDir, `cube-${tokenId}.metadata.json`), `${JSON.stringify(metadata, null, 2)}\n`);
  await fs.writeFile(path.join(outDir, `cube-${tokenId}.image.svg`), svg);

  const dependencyWarnings = validateHtml(html);
  const rawMatch = html.match(/raw:'([^']*)'/);

  console.log(`cube ${tokenId} export complete`);
  console.log(`html:     ${path.join(outDir, `cube-${tokenId}.html`)}`);
  console.log(`metadata: ${path.join(outDir, `cube-${tokenId}.metadata.json`)}`);
  console.log(`image:    ${path.join(outDir, `cube-${tokenId}.image.svg`)}`);
  console.log(`raw bytes embedded: ${rawMatch?.[1] ? 'yes' : 'no'}`);
  console.log(`offchain dependency scan: ${dependencyWarnings.length ? dependencyWarnings.join(', ') : 'clean'}`);
}

main().catch(err => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
