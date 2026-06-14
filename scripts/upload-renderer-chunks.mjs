import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sha3 from 'js-sha3';

const { keccak_256 } = sha3;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const configPath = path.join(repoRoot, 'data', 'chain-config.json');
const chunksPath = path.join(repoRoot, 'dist', 'token-renderer', 'renderer-chunks.json');

function selector(signature) {
  return keccak_256(signature).slice(0, 8);
}

function word(value) {
  return BigInt(value).toString(16).padStart(64, '0');
}

function bytesHex(value) {
  return Buffer.from(value, 'utf8').toString('hex');
}

function encodeSetChunk(chunkId, content) {
  const data = bytesHex(content);
  const paddedLength = Math.ceil(data.length / 64) * 64;
  return `0x${selector('setChunk(uint256,string)')}${word(chunkId)}${word(64)}${word(data.length / 2)}${data.padEnd(paddedLength, '0')}`;
}

function encodeSetChunkCount(count) {
  return `0x${selector('setChunkCount(uint256)')}${word(count)}`;
}

function encodeNoArgs(signature) {
  return `0x${selector(signature)}`;
}

function decodeUint(hex) {
  return Number(BigInt(hex || '0x0'));
}

async function rpc(rpcUrl, payload) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

async function sendTx(rpcUrl, from, to, data) {
  const hash = await rpc(rpcUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_sendTransaction',
    params: [{ from, to, data }],
  });
  for (;;) {
    const receipt = await rpc(rpcUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionReceipt',
      params: [hash],
    });
    if (receipt) {
      if (receipt.status !== '0x1') throw new Error(`tx reverted: ${hash}`);
      return hash;
    }
    await new Promise(resolve => setTimeout(resolve, 120));
  }
}

async function ethCall(rpcUrl, to, data) {
  return rpc(rpcUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to, data }, 'latest'],
  });
}

async function main() {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const manifest = JSON.parse(await fs.readFile(chunksPath, 'utf8'));
  const rpcUrl = process.env.BLOCKCASSONE_RPC_URL || config.rpcUrl || 'http://127.0.0.1:8545';
  const assetStore = config.rendererAssetStore;
  if (!/^0x[0-9a-fA-F]{40}$/.test(assetStore || '')) {
    throw new Error('data/chain-config.json is missing rendererAssetStore');
  }

  const accounts = await rpc(rpcUrl, { jsonrpc: '2.0', id: 1, method: 'eth_accounts', params: [] });
  const from = process.env.BLOCKCASSONE_OWNER || config.owner || accounts[0];
  if (!/^0x[0-9a-fA-F]{40}$/.test(from || '')) throw new Error('No sender account available');

  console.log(`uploading ${manifest.chunks.length} renderer chunks to ${assetStore}`);
  for (let i = 0; i < manifest.chunks.length; i++) {
    const chunkId = manifest.scriptStartChunkId + i;
    const content = manifest.chunks[i];
    const hash = await sendTx(rpcUrl, from, assetStore, encodeSetChunk(chunkId, content));
    console.log(`chunk ${chunkId}/${manifest.chunkCount - 1}: ${Buffer.byteLength(content)} bytes ${hash}`);
  }
  const currentCount = decodeUint(await ethCall(rpcUrl, assetStore, encodeNoArgs('chunkCount()')));
  if (currentCount === manifest.chunkCount) {
    console.log(`chunkCount already ${manifest.chunkCount}`);
  } else {
    const countHash = await sendTx(rpcUrl, from, assetStore, encodeSetChunkCount(manifest.chunkCount));
    console.log(`chunkCount ${manifest.chunkCount}: ${countHash}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
