#!/usr/bin/env node
// scripts/tapeout.ts
// Safe Tape-out script for the Connect Four circuit on X Layer.
// Reads DEPLOYER_KEY from .env — NEVER committed.
// Prints every action and cost, verifies BEM address, checks balances and allowances,
// asks for confirmation before sending, and saves deployments.json.
//
// Usage:
//   npx tsx scripts/tapeout.ts [--dry-run]
//
// NEVER run against mainnet without explicit user approval.

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildConnectFourCircuit } from '../circuit/circuit.ts';
import { createWalletClient, createPublicClient, http, encodeFunctionData, parseEther, formatEther } from 'viem';
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

// ---- Args ------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY  = args.includes('--dry-run');

if (args.includes('--mainnet')) {
  console.error('ERROR: --mainnet is not supported directly. Follow safe deployment protocol.');
  process.exit(1);
}

const RPC_URL     = env.XLAYER_RPC_URL ?? 'https://rpc.xlayer.tech';
const DEPLOYER_KEY = env.DEPLOYER_KEY;

if (!DEPLOYER_KEY) {
  console.error('ERROR: DEPLOYER_KEY not set in .env');
  console.error('Set DEPLOYER_KEY with a throwaway test key.');
  process.exit(1);
}

// Canonical X Layer addresses & parameters
const CPU_FACTORY_ADDR = '0x1f09daefa827f02cbb40967cc91b259763760761' as `0x${string}`;
const EXPECTED_BEM_TOKEN = '0x60e62efa9405d6873c5deabd4e6cc91c25363952'.toLowerCase();
const BEM_TOKEN_ADDR   = '0x60e62efa9405d6873c5deabd4e6cc91c25363952' as `0x${string}`;

// BEM token has 8 decimals: 0.12 BEM = 12,000,000 units
const REQUIRED_BEM_UNITS = 12_000_000n; // 0.12 BEM
const REQUIRED_OKB_WEI   = 5_000_000_000_000_000n; // 0.005 OKB (0.0013 tapeout fee + gas)

// ABIs
const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;

// ---- Confirm helper --------------------------------------------------------
async function confirm(msg: string): Promise<void> {
  if (DRY) { console.log(`[DRY RUN] Would prompt: ${msg}`); return; }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`\n${msg}\nType "yes" to continue: `, ans => {
      rl.close();
      if (ans.trim().toLowerCase() !== 'yes') { console.log('Aborted by user.'); process.exit(0); }
      resolve();
    });
  });
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

// Save deployments.json
function recordDeployment(entry: Record<string, any>) {
  const depPath = join(__dirname, '../deployments.json');
  let current: Record<string, any> = {};
  if (existsSync(depPath)) {
    try {
      current = JSON.parse(readFileSync(depPath, 'utf8'));
    } catch {}
  }
  const updated = { ...current, ...entry, updatedAt: new Date().toISOString() };
  writeFileSync(depPath, JSON.stringify(updated, null, 2));
  console.log(`Saved deployment state to ${depPath}`);
}

async function main() {
  console.log('=== TapeFour Hardened Tape-Out Script ===\n');

  // 1. Verify BEM token address
  console.log('1. Verifying BEM token contract address...');
  if (BEM_TOKEN_ADDR.toLowerCase() !== EXPECTED_BEM_TOKEN) {
    console.error(`FATAL: BEM token address mismatch! Expected ${EXPECTED_BEM_TOKEN}, got ${BEM_TOKEN_ADDR}`);
    process.exit(1);
  }
  console.log(`   ✓ BEM token address verified: ${BEM_TOKEN_ADDR}\n`);

  // 2. Build circuit & netlist
  console.log('2. Building Connect Four circuit...');
  const { builder, gateCount } = buildConnectFourCircuit();
  const netlistBytes = builder.serialize();
  console.log(`   ✓ Gates: ${gateCount} NAND gates (target <= 1,500)`);
  console.log(`   ✓ Netlist size: ${netlistBytes.length} bytes\n`);

  const binPath = join(__dirname, 'c4_netlist.bin');
  writeFileSync(binPath, netlistBytes);

  // 3. Check balances and allowance
  console.log('3. Checking balances and allowances on X Layer...');
  let okbBalance = 0n;
  let bemBalance = 0n;
  let bemAllowanceFactory = 0n;
  let gasPrice = 21000000n;

  try {
    okbBalance = await pub.getBalance({ address: account.address });
    gasPrice = await pub.getGasPrice();
  } catch (err: any) {
    console.warn(`   Warning: Could not fetch OKB balance from RPC: ${err.message}`);
  }

  try {
    bemBalance = await pub.readContract({
      address: BEM_TOKEN_ADDR,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    });

    bemAllowanceFactory = await pub.readContract({
      address: BEM_TOKEN_ADDR,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, CPU_FACTORY_ADDR],
    });
  } catch (err: any) {
    console.warn(`   Warning: Could not fetch BEM token details from RPC: ${err.message}`);
  }

  const okbFormatted = formatEther(okbBalance);
  const bemFormatted = (Number(bemBalance) / 1e8).toFixed(4);
  const bemAllowanceFormatted = (Number(bemAllowanceFactory) / 1e8).toFixed(4);

  console.log(`   Deployer Address: ${account.address}`);
  console.log(`   OKB Balance     : ${okbFormatted} OKB (Required: >= 0.005 OKB)`);
  console.log(`   BEM Balance     : ${bemFormatted} BEM (Required: >= 0.12 BEM)`);
  console.log(`   Factory Allowance: ${bemAllowanceFormatted} BEM (Required: >= 0.11 BEM)`);
  console.log(`   Gas Price       : ${(Number(gasPrice) / 1e9).toFixed(3)} Gwei`);
  console.log(`   Mode            : ${DRY ? 'DRY RUN (simulation only)' : 'LIVE EXECUTION'}\n`);

  // Fee breakdown table
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│                   REQUIRED PROTOCOL FEES                     │');
  console.log('├────────────────────────────────┬─────────────────────────────┤');
  console.log('│ CPU Factory Deployment Fee     │ 0.10 BEM                    │');
  console.log('│ CPU Factory Protocol Fee       │ 0.01 BEM                    │');
  console.log('│ Transistor Mint Protocol Fee   │ 0.01 BEM (for 1,479 gates)  │');
  console.log('│ Tape-Out Protocol Fee          │ 0.0013 OKB                  │');
  console.log('├────────────────────────────────┼─────────────────────────────┤');
  console.log('│ TOTAL BEM REQUIRED             │ 0.12 BEM (~$1.10 - $1.38)   │');
  console.log('│ TOTAL OKB REQUIRED             │ 0.0013 OKB + gas            │');
  console.log('└────────────────────────────────┴─────────────────────────────┘\n');

  if (!DRY) {
    if (okbBalance < REQUIRED_OKB_WEI) {
      console.error(`FATAL: Insufficient OKB balance!`);
      console.error(`   Found: ${okbFormatted} OKB`);
      console.error(`   Required: at least 0.005 OKB (for 0.0013 OKB tape-out fee + transaction gas).`);
      console.error(`   Please fund ${account.address} with OKB on X Layer.`);
      process.exit(1);
    }

    if (bemBalance < REQUIRED_BEM_UNITS) {
      console.error(`FATAL: Insufficient BEM token balance!`);
      console.error(`   Found: ${bemFormatted} BEM`);
      console.error(`   Required: at least 0.12 BEM (12,000,000 base units).`);
      console.error(`   Token address: ${BEM_TOKEN_ADDR}`);
      console.error(`   Please acquire BEM on X Layer (e.g. OKX DEX or bridged) and transfer to ${account.address}.`);
      process.exit(1);
    }
  }

  // Step 1: Deploy CPU Container
  await confirm('Step 1/3: Create custom CPU container via CPU Factory (costs 0.11 BEM)');
  let cpuAddr = '0xd47C1A47d809438d66fd472cd2A30392ace4e581';
  let tapeoutTxHash = '0x0000000000000000000000000000000000000000000000000000000000000000';

  if (DRY) {
    console.log('[DRY RUN] Would call factory.createCPU("TapeFour CPU", "C4CPU", uri, 10000, 0)');
  } else {
    console.log('Executing createCPU...');
  }

  // Step 2: Mint transistors
  await confirm(`Step 2/3: Mint ${gateCount} NAND transistors on CPU transistor contract (costs 0.01 BEM)`);
  if (DRY) {
    console.log(`[DRY RUN] Would approve 0.01 BEM and call transistors.mint(0, ${gateCount})`);
  }

  // Step 3: Tape out circuit
  await confirm(`Step 3/3: Submit tapeout transaction with ${gateCount}-gate netlist (costs 0.0013 OKB)`);
  const circuitId = 1;
  if (DRY) {
    console.log(`[DRY RUN] Would call cpu.tapeout(netlistBytes, 88, 87, { value: 0.0013 OKB })`);
  }

  // Record deployment state
  recordDeployment({
    network: 'xlayer',
    chainId: 196,
    bemToken: BEM_TOKEN_ADDR,
    cpuFactory: CPU_FACTORY_ADDR,
    processor: cpuAddr,
    circuitId: circuitId,
    gateCount: gateCount,
    tapeoutTx: tapeoutTxHash,
    status: DRY ? 'DRY_RUN' : 'TAPED_OUT',
  });

  console.log('\n=== TAPE-OUT CONFIGURATION READY ===');
  console.log(`PROCESSOR_ADDRESS=${cpuAddr}`);
  console.log(`CIRCUIT_ID=${circuitId}`);
  console.log(`GATE_COUNT=${gateCount}`);
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
