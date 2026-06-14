import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak_256 } from 'js-sha3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const NORMIES = '0x9Eb6E2025B64f340691e424b7fe7022fFDE12438';

function loadDotEnv(text) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^['"]|['"]$/g, '');
  }
}

function argValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function parseIds(value) {
  return String(value || '')
    .split(',')
    .map(part => Number(part.trim()))
    .filter(Number.isSafeInteger);
}

function normalizeAddress(value) {
  const clean = String(value || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(clean)) return '';
  return clean;
}

function extractAgentBinding(raw) {
  const binding = raw?.agent_binding || raw?.nft?.agent_binding || null;
  if (!binding) return { agentic: false, agentId: '0', binding: null };

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
    '0';

  return { agentic: true, agentId: String(agentId || '0'), binding };
}

function word(value) {
  return BigInt(value).toString(16).padStart(64, '0');
}

function addressWord(address) {
  return normalizeAddress(address).toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function boolWord(value) {
  return word(value ? 1 : 0);
}

function setAgentBindingCalldata({ sourceContract, tokenId, agentic, agentId }) {
  const selector = keccak_256('setAgentBinding(address,uint256,bool,uint256)').slice(0, 8);
  return `0x${selector}${addressWord(sourceContract)}${word(tokenId)}${boolWord(agentic)}${word(agentId)}`;
}

async function fetchNormieDetail(apiKey, tokenId) {
  const url = new URL(
    `https://api.opensea.io/api/v2/chain/ethereum/contract/${NORMIES}/nfts/${tokenId}`
  );
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'x-api-key': apiKey,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenSea ${res.status} for Normie ${tokenId}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  await fs.readFile(path.join(ROOT, '.env'), 'utf8').then(loadDotEnv).catch(() => {});

  const apiKey = process.env.OPENSEA_API_KEY;
  if (!apiKey) throw new Error('Set OPENSEA_API_KEY in .env or environment');

  const ids = parseIds(argValue('ids', process.env.BLOCKCASSONE_AGENT_CHECK_IDS || ''));
  if (!ids.length) throw new Error('Pass --ids=5025,6722 or set BLOCKCASSONE_AGENT_CHECK_IDS');

  const configPath = path.join(ROOT, 'data', 'chain-config.json');
  const config = await readJsonIfExists(configPath);
  const registry = normalizeAddress(argValue('registry', config?.agentStatusRegistry || ''));
  const rpcUrl = argValue('rpc-url', config?.rpcUrl || process.env.ETH_RPC_URL || '');

  const rows = [];
  for (const tokenId of ids) {
    const detail = await fetchNormieDetail(apiKey, tokenId);
    const agent = extractAgentBinding(detail);
    const row = {
      sourceContract: NORMIES,
      sourceTokenId: tokenId,
      agentic: agent.agentic,
      agentId: agent.agentId,
      agentBinding: agent.binding,
    };
    row.calldata = setAgentBindingCalldata({
      sourceContract: NORMIES,
      tokenId,
      agentic: row.agentic,
      agentId: row.agentId,
    });
    if (registry) {
      row.castCommand = [
        'cast send',
        registry,
        '"setAgentBinding(address,uint256,bool,uint256)"',
        NORMIES,
        String(tokenId),
        row.agentic ? 'true' : 'false',
        row.agentId,
        rpcUrl ? `--rpc-url ${rpcUrl}` : '',
      ].filter(Boolean).join(' ');
    }
    rows.push(row);
  }

  const outPath = path.join(ROOT, 'data', 'agent-status-updates.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    registry: registry || null,
    updates: rows,
  }, null, 2)}\n`);

  console.log(`Wrote ${path.relative(ROOT, outPath)}`);
  for (const row of rows) {
    console.log(
      `Normie ${row.sourceTokenId}: agentic=${row.agentic ? 'Y' : 'N'} agentId=${row.agentId}`
    );
    if (row.castCommand) console.log(row.castCommand);
  }
}

main().catch(err => {
  console.error(err?.message || err);
  process.exit(1);
});
