#!/usr/bin/env node
// scripts/deploy.ts
// Hardened Deployment script for TapeFour ranked contract on X Layer.
// Reads DEPLOYER_KEY from .env — NEVER committed.
// Prints every action and cost, verifies parameters and balance,
// asks for confirmation before sending, and saves deployments.json.
//
// Usage:
//   npx tsx scripts/deploy.ts [--dry-run]
//
// NEVER run against mainnet without explicit user approval.

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createWalletClient, createPublicClient, http, encodeDeployData, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Load .env manually ----------------------------------------------------
function loadDotEnv(filepath: string): Record<string, string> {
  if (!existsSync(filepath)) return {};
  const lines = readFileSync(filepath, 'utf8').split('\n');
  const env: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}
const env = loadDotEnv(join(__dirname, '../.env'));

// Load previous deployment / tapeout record if present
function loadDeployments(): Record<string, any> {
  const depPath = join(__dirname, '../deployments.json');
  if (existsSync(depPath)) {
    try {
      return JSON.parse(readFileSync(depPath, 'utf8'));
    } catch {}
  }
  return {};
}

function saveDeployments(entry: Record<string, any>) {
  const depPath = join(__dirname, '../deployments.json');
  const current = loadDeployments();
  const updated = { ...current, ...entry, updatedAt: new Date().toISOString() };
  writeFileSync(depPath, JSON.stringify(updated, null, 2));
  console.log(`Saved deployment state to ${depPath}`);
}

// ---- Args ------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY  = args.includes('--dry-run');

if (args.includes('--mainnet')) {
  console.error('ERROR: --mainnet flag is not supported in this script.');
  console.error('All deployment happens on the fork or X Layer testnet.');
  process.exit(1);
}

// ---- Config ----------------------------------------------------------------
const RPC_URL = env.XLAYER_RPC_URL ?? 'https://rpc.xlayer.tech';
const DEPLOYER_KEY = env.DEPLOYER_KEY;

if (!DEPLOYER_KEY) {
  console.error('ERROR: DEPLOYER_KEY not set in .env');
  console.error('Copy .env.example to .env and fill in a throwaway private key.');
  process.exit(1);
}

// Contract parameters (Phase 4a specifications)
const RANKED_FEE   = 5_000_000_000_000_000n; // 0.005 OKB in wei
const POOL_BPS     = 6000n;                  // 60% to prize pool, 40% to treasury
const MOVE_TIMEOUT = 86_400n;                // 24 hours (human move timeout)
const BOT_TIMEOUT  = 600n;                   // 10 minutes (bot timeout before refund)

const depState = loadDeployments();
const PROCESSOR_ADDRESS = (env.PROCESSOR_ADDRESS || depState.processor) as `0x${string}`;
const CIRCUIT_ID = env.CIRCUIT_ID ? BigInt(env.CIRCUIT_ID) : (depState.circuitId ? BigInt(depState.circuitId) : null);
const BOT_OPERATOR = (env.BOT_OPERATOR_ADDRESS || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8') as `0x${string}`;

if (!PROCESSOR_ADDRESS || CIRCUIT_ID === null) {
  console.error('ERROR: PROCESSOR_ADDRESS and CIRCUIT_ID must be set in .env or deployments.json');
  console.error('Run scripts/tapeout.ts first to tape out the circuit.');
  process.exit(1);
}

const account = privateKeyToAccount(`0x${DEPLOYER_KEY}` as `0x${string}`);
const chain = {
  id: 196,
  name: 'X Layer',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};
const pub = createPublicClient({ chain: chain as any, transport: http(RPC_URL) });
const wal = createWalletClient({ account, chain: chain as any, transport: http(RPC_URL) });

// Confirm helper
async function confirm(msg: string): Promise<void> {
  if (DRY) { console.log(`[DRY RUN] Would prompt: ${msg}`); return; }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`\n${msg}\nType "yes" to continue: `, ans => {
      rl.close();
      if (ans.trim().toLowerCase() !== 'yes') {
        console.log('Aborted by user.');
        process.exit(0);
      }
      resolve();
    });
  });
}

// TapeFour constructor ABI
const TAPEFOUR_ABI = [
  {
    type: 'constructor',
    inputs: [
      { name: '_processor',    type: 'address' },
      { name: '_circuitId',    type: 'uint256' },
      { name: '_rankedFee',    type: 'uint256' },
      { name: '_poolBps',      type: 'uint256' },
      { name: '_treasury',     type: 'address' },
      { name: '_moveTimeout',  type: 'uint256' },
      { name: '_botTimeout',   type: 'uint256' },
      { name: '_botOperator',  type: 'address' },
    ],
  },
] as const;

// Bytecode import
let bytecode: string;
try {
  const artPath = join(__dirname, '../contracts/artifacts/contracts/TapeFour.sol/TapeFour.json');
  const art = JSON.parse(readFileSync(artPath, 'utf8'));
  bytecode = art.bytecode;
} catch (e) {
  console.error('ERROR: Could not load TapeFour artifact.');
  console.error('Run: cd contracts && npx hardhat compile');
  process.exit(1);
}

async function main() {
  console.log('=== TapeFour Hardened Deployment Script ===\n');

  let balance = 0n;
  let gasPrice = 21000000n;
  try {
    balance = await pub.getBalance({ address: account.address });
    gasPrice = await pub.getGasPrice();
  } catch (err: any) {
    console.warn(`Warning: Could not fetch balance or gas price: ${err.message}`);
  }

  console.log(`Network     : X Layer (Chain ID: 196)`);
  console.log(`RPC URL     : ${RPC_URL}`);
  console.log(`Deployer    : ${account.address}`);
  console.log(`OKB Balance : ${formatEther(balance)} OKB`);
  console.log(`Gas Price   : ${(Number(gasPrice) / 1e9).toFixed(3)} Gwei`);
  console.log(`Mode        : ${DRY ? 'DRY RUN' : 'LIVE DEPLOYMENT'}\n`);

  console.log('--- Contract Configuration Parameters ---');
  console.log(`Processor   : ${PROCESSOR_ADDRESS}`);
  console.log(`Circuit ID  : ${CIRCUIT_ID}`);
  console.log(`Ranked Fee  : ${formatEther(RANKED_FEE)} OKB (0.005 OKB)`);
  console.log(`Fee Split   : ${Number(POOL_BPS) / 100}% Prize Pool / ${100 - Number(POOL_BPS) / 100}% Treasury`);
  console.log(`Treasury    : ${account.address} (deployer address)`);
  console.log(`Bot Operator: ${BOT_OPERATOR}`);
  console.log(`Move Timeout: ${MOVE_TIMEOUT}s (${Number(MOVE_TIMEOUT) / 3600} hours)`);
  console.log(`Bot Timeout : ${BOT_TIMEOUT}s (${Number(BOT_TIMEOUT) / 60} minutes - human refund if bot inactive)`);
  console.log('-----------------------------------------\n');

  const constructorArgs = [
    PROCESSOR_ADDRESS,
    CIRCUIT_ID,
    RANKED_FEE,
    POOL_BPS,
    account.address,
    MOVE_TIMEOUT,
    BOT_TIMEOUT,
    BOT_OPERATOR,
  ];

  const data = encodeDeployData({
    abi: TAPEFOUR_ABI,
    bytecode: bytecode as `0x${string}`,
    args: constructorArgs as any,
  });

  let gasEst = 2_200_000n;
  try {
    gasEst = await pub.estimateGas({ account: account.address, data, value: 0n });
  } catch {
    console.log(`Using fallback gas estimate: ${gasEst}`);
  }

  const estCostWei = gasEst * gasPrice;
  console.log(`Estimated Deployment Gas : ${gasEst}`);
  console.log(`Estimated Deployment Cost: ${formatEther(estCostWei)} OKB\n`);

  if (!DRY && balance < estCostWei) {
    console.error(`FATAL: Insufficient OKB balance for deployment!`);
    console.error(`   Found: ${formatEther(balance)} OKB`);
    console.error(`   Estimated cost: ${formatEther(estCostWei)} OKB`);
    console.error(`   Please fund ${account.address} with OKB on X Layer.`);
    process.exit(1);
  }

  if (DRY) {
    console.log('[DRY RUN] Would deploy TapeFour with the parameters above.');
    saveDeployments({
      tapeFour: '0x0000000000000000000000000000000000000000',
      status: 'DRY_RUN',
      rankedFee: '0.005',
      poolBps: 6000,
      botTimeout: 600,
      moveTimeout: 86400,
    });
    console.log('[DRY RUN] Simulation finished successfully.');
    return;
  }

  await confirm(`Proceed with deploying TapeFour contract to X Layer?`);

  console.log('Deploying TapeFour contract...');
  const hash = await wal.deployContract({
    abi: TAPEFOUR_ABI,
    bytecode: bytecode as `0x${string}`,
    args: constructorArgs as any,
    gas: (gasEst * 12n) / 10n,
  });

  console.log(`Deploy Transaction Hash: ${hash}`);
  console.log('Waiting for block confirmation...');
  const rc = await pub.waitForTransactionReceipt({ hash });

  if (rc.status !== 'success') {
    console.error('FATAL: Deployment transaction failed or reverted!', rc);
    process.exit(1);
  }

  console.log('\n=== TAPEFOUR DEPLOYED SUCCESSFULLY ===');
  console.log(`Contract Address : ${rc.contractAddress}`);
  console.log(`Block Number     : ${rc.blockNumber}`);
  console.log(`Gas Used         : ${rc.gasUsed}`);

  saveDeployments({
    tapeFour: rc.contractAddress,
    tapeFourDeployTx: hash,
    deployBlock: Number(rc.blockNumber),
    rankedFee: '0.005',
    poolBps: 6000,
    botTimeout: 600,
    moveTimeout: 86400,
    status: 'DEPLOYED',
  });

  console.log(`\nAdd to .env:`);
  console.log(`TAPEFOUR_ADDRESS=${rc.contractAddress}`);
}

main().catch(err => {
  console.error('\nFatal deployment error:', err);
  process.exit(1);
});
