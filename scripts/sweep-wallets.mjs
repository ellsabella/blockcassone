// Sweep leftover Sepolia ETH from a driver run's ephemeral wallets back to the
// funder. Usage: node scripts/sweep-wallets.mjs <rehearsal|sepolia-full>
import fs from 'node:fs';
import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const dir = process.argv[2] || 'rehearsal';
const RPC = process.env.BLOCKCASSONE_RPC_URL;
const funder = privateKeyToAccount(process.env.DEV_THROWAWAY_PRIVATE.startsWith('0x')
  ? process.env.DEV_THROWAWAY_PRIVATE : `0x${process.env.DEV_THROWAWAY_PRIVATE}`);
const pub = createPublicClient({ transport: http(RPC) });
const state = JSON.parse(fs.readFileSync(new URL(`../data/${dir}/state.json`, import.meta.url), 'utf8'));

let swept = 0n;
for (const [name, info] of Object.entries(state.wallets || {})) {
  const bal = await pub.getBalance({ address: info.addr });
  const gasPrice = await pub.getGasPrice();
  const fee = 21000n * gasPrice * 2n; // generous fee allowance
  if (bal <= fee) { console.log(`${name}: dust (${formatEther(bal)}), skip`); continue; }
  const w = createWalletClient({ account: privateKeyToAccount(info.pk), transport: http(RPC) });
  const hash = await w.sendTransaction({ to: funder.address, value: bal - fee, gas: 21000n, chain: null });
  await pub.waitForTransactionReceipt({ hash });
  swept += bal - fee;
  console.log(`${name}: swept ${formatEther(bal - fee)}`);
}
console.log(`total swept: ${formatEther(swept)} ETH -> ${funder.address}`);
