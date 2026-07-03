import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_RPC_URL = 'http://127.0.0.1:8545';
const DEFAULT_SENDER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const DEFAULT_PREVIEW_RECIPIENT = '0x000000000000000000000000000000000000bEEF';
const DEFAULT_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function argValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function parseUint(value, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Invalid ${label}: ${value}`);
  return n;
}

function commandText(command, args) {
  return [command, ...args].join(' ');
}

function run(command, args, options = {}) {
  console.log(`\n$ ${commandText(command, args)}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...(options.env || {}) },
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

async function main() {
  const normieId = parseUint(
    argValue('normie-id', argValue('id', process.env.BLOCKCASSONE_PREVIEW_NORMIE_ID || '')),
    'Normie ID'
  );
  const rpcUrl = argValue('rpc-url', process.env.BLOCKCASSONE_RPC_URL || DEFAULT_RPC_URL);
  const sender = argValue('sender', process.env.BLOCKCASSONE_SENDER || DEFAULT_SENDER);
  const recipient = argValue(
    'recipient',
    process.env.BLOCKCASSONE_PREVIEW_RECIPIENT || DEFAULT_PREVIEW_RECIPIENT
  );
  const privateKey = argValue('private-key', process.env.BLOCKCASSONE_PRIVATE_KEY || DEFAULT_PRIVATE_KEY);
  const forge = process.env.FORGE || 'forge';
  // Frame/figure colour is a pure function of the slot, and genesis assigns slots
  // in mint order. So to land this Normie on slot N we mint N filler cubes (the N
  // Normie ids just below it) first, then export the last cube (slot N). slot 0 is
  // the default single-mint preview. Use this to compare colour combinations.
  const slot = parseUint(argValue('slot', '0'), 'slot');
  const sampleStart = normieId - slot;
  if (sampleStart < 1) {
    throw new Error(
      `--slot=${slot} is too large for Normie ${normieId}: it needs ${slot} filler Normie id(s) below it.`
    );
  }
  const tokenId = slot + 1;

  const agentIdRaw = argValue('agent-id', '');
  const agentId = agentIdRaw ? parseUint(agentIdRaw, 'agent ID') : (hasFlag('agentic') ? normieId : 0);
  const outDir = path.resolve(
    argValue(
      'out-dir',
      path.join(
        os.tmpdir(),
        'blockcassone-token-previews',
        slot === 0 ? `normie-${normieId}` : `normie-${normieId}-slot${slot}`
      )
    )
  );
  await fs.rm(outDir, { recursive: true, force: true });

  const deployEnv = {
    BLOCKCASSONE_SAMPLE_MINTS: String(slot + 1),
    BLOCKCASSONE_SAMPLE_NORMIE_START: String(sampleStart),
    BLOCKCASSONE_PREVIEW_RECIPIENT: recipient,
  };
  if (agentId) {
    deployEnv.BLOCKCASSONE_SAMPLE_AGENT_NORMIE_ID = String(normieId);
    deployEnv.BLOCKCASSONE_SAMPLE_AGENT_ID = String(agentId);
  }

  await run(forge, [
    'script',
    'contracts/script/DeployMainnetNormiePreview.s.sol:DeployMainnetNormiePreview',
    '--rpc-url',
    rpcUrl,
    '--sender',
    sender,
    '--private-key',
    privateKey,
    '--broadcast',
  ], { env: deployEnv });

  await run('npm', ['run', 'build:token-renderer']);
  await run('npm', ['run', 'upload:token-renderer'], { env: { BLOCKCASSONE_RPC_URL: rpcUrl } });
  await run('npm', [
    'run',
    'export:token-html',
    '--',
    `--token-id=${tokenId}`,
    '--source=token-uri',
    `--rpc-url=${rpcUrl}`,
    `--out-dir=${outDir}`,
  ]);

  const metadataPath = path.join(outDir, `cube-${tokenId}.metadata.json`);
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  const sourceToken = metadata.attributes?.find(a => a.trait_type === 'Source Token ID')?.value;
  const agentic = metadata.attributes?.find(a => a.trait_type === 'Agentic')?.value;
  const agent = metadata.attributes?.find(a => a.trait_type === 'Agent ID')?.value;
  if (String(sourceToken) !== String(normieId)) {
    throw new Error(
      `Preview exported Normie ${sourceToken || 'unknown'}, expected ${normieId}. ` +
      'The deploy/export state is stale; restart Anvil and rerun the preview command.'
    );
  }

  const htmlPath = path.join(outDir, `cube-${tokenId}.html`);
  const imagePath = path.join(outDir, `cube-${tokenId}.image.svg`);
  const namedHtmlPath = path.join(outDir, `normie-${normieId}.html`);
  const namedMetadataPath = path.join(outDir, `normie-${normieId}.metadata.json`);
  const namedImagePath = path.join(outDir, `normie-${normieId}.image.svg`);
  await fs.copyFile(htmlPath, namedHtmlPath);
  await fs.copyFile(metadataPath, namedMetadataPath);
  await fs.copyFile(imagePath, namedImagePath);

  console.log('\nPreview ready');
  console.log(`Normie:   ${sourceToken}`);
  console.log(`Slot:     ${slot}`);
  console.log(`Agentic:  ${agentic || 'N'}${agent && agent !== '0' ? ` / ${agent}` : ''}`);
  console.log(`HTML:     ${namedHtmlPath}`);
  console.log(`Image:    ${namedImagePath}`);
  console.log(`Cube HTML:${htmlPath}`);
  console.log(`Metadata: ${metadataPath}`);
}

main().catch(err => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
