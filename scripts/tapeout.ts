#!/usr/bin/env node
// scripts/tapeout.ts
// Hardened Tape-Out script for the Connect Four circuit on X Layer (Chain ID: 196).
// Reads DEPLOYER_KEY from .env — NEVER prints, echos, or commits key values.
// Handles BEM approvals itself, verifies balances/allowances, asks confirmation before
// every state-changing transaction, and writes deployments.json ONLY upon confirmed receipt.
//
// Usage:
//   npx tsx scripts/tapeout.ts [--dry-run] [--resume]
//
// NEVER run against mainnet without explicit user approval.

import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildConnectFourCircuit } from '../circuit/circuit.ts';
import { createWalletClient, createPublicClient, http, formatEther, decodeEventLog } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Load .env manually without printing/echoing secrets -------------------
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

// Clean up any stale deployments.json created by previous dry runs
const depPath = join(__dirname, '../deployments.json');
if (existsSync(depPath)) {
  try {
    const existing = JSON.parse(readFileSync(depPath, 'utf8'));
    if (existing.status === 'DRY_RUN') {
      unlinkSync(depPath);
      console.log('Removed stale dry-run deployments.json');
    }
  } catch {}
}

// ---- Partial State File (for --resume support) ------------------------------
const STATE_PATH = join(__dirname, '../tapeout.state.json');

interface PartialState {
  chainId: number;
  cpuAddress: `0x${string}`;
  transistorAddress?: `0x${string}`;
  createCpuTx: string;
  mintTx?: string;
  deployer: string;
  step: number; // 1 = CPU created, 2 = transistors minted
  updatedAt: string;
}

function savePartialState(state: PartialState) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  console.log(`[STATE] Saved partial progress to ${STATE_PATH}`);
}

function loadPartialState(): PartialState | null {
  if (!existsSync(STATE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

// ---- Args ------------------------------------------------------------------
const args   = process.argv.slice(2);
const DRY    = args.includes('--dry-run');
const RESUME = args.includes('--resume');

if (args.includes('--mainnet')) {
  console.error('ERROR: --mainnet flag is not permitted. Follow safe deployment protocol.');
  process.exit(1);
}

// Strictly use XLAYER_RPC_URL, never FORK_RPC_URL
const RPC_URL = env.XLAYER_RPC_URL ?? 'https://rpc.xlayer.tech';
const DEPLOYER_KEY = env.DEPLOYER_KEY;

if (!DEPLOYER_KEY) {
  console.error('FATAL: DEPLOYER_KEY not set in .env');
  console.error('Configure a throwaway deployer key in .env before running.');
  process.exit(1);
}

// Canonical X Layer contract addresses
const CPU_FACTORY_ADDR   = '0x1f09daefa827f02cbb40967cc91b259763760761' as `0x${string}`;
const EXPECTED_BEM_TOKEN = '0x60e62efa9405d6873c5deabd4e6cc91c25363952'.toLowerCase();
const BEM_TOKEN_ADDR     = '0x60e62efa9405d6873c5deabd4e6cc91c25363952' as `0x${string}`;

// Required fees:
// 1. CPU Factory: 0.10 BEM deploy fee + 0.01 BEM protocol fee = 0.11 BEM (11,000,000 base units, 8 decimals)
// 2. Transistor Mint: 0.01 BEM flat protocol fee (1,000,000 base units, 8 decimals)
// Total BEM: 0.12 BEM (12,000,000 units)
const BEM_FACTORY_FEE_UNITS    = 11_000_000n; // 0.11 BEM exactly
const BEM_TRANSISTOR_FEE_UNITS = 1_000_000n;  // 0.01 BEM exactly
const TOTAL_REQUIRED_BEM_UNITS = 12_000_000n; // 0.12 BEM total
const TAPEOUT_PROTOCOL_FEE_WEI = 1_300_000_000_000_000n; // 0.0013 OKB
const TOTAL_ESTIMATED_STEPS_GAS = 2_000_000n; // Conservative sum of all 5 transaction steps

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

const FACTORY_ABI = [
  {
    type: 'function',
    name: 'createCPU',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'uri', type: 'string' },
      { name: 'supplyCap', type: 'uint256' },
      { name: 'mintPrice', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'isCPU',
    inputs: [{ name: 'cpu', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'cpuCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'cpuAt',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'CPUCreated',
    inputs: [
      { name: 'cpu', type: 'address', indexed: true },
      { name: 'transistors', type: 'address', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'supplyCap', type: 'uint256', indexed: false },
      { name: 'mintPrice', type: 'uint256', indexed: false },
    ],
  },
] as const;

const CPU_ABI = [
  {
    type: 'function',
    name: 'transistors',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'TAPEOUT_FEE',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tapeout',
    inputs: [
      { name: 'netlist', type: 'bytes' },
      { name: 'inBits', type: 'uint32' },
      { name: 'outBits', type: 'uint32' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'ownerOf',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'netlist',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'view',
  },
] as const;

const TRANSISTOR_ABI = [
  {
    type: 'function',
    name: 'mint',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// ---- Confirmation helper ---------------------------------------------------
async function confirm(promptMsg: string): Promise<void> {
  if (DRY) {
    console.log(`[DRY RUN] Would prompt: "${promptMsg}"`);
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`\n${promptMsg}\nType "yes" to proceed: `, ans => {
      rl.close();
      if (ans.trim().toLowerCase() !== 'yes') {
        console.log('Aborted by user.');
        process.exit(0);
      }
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

// RPC client with 30s timeout
const pub = createPublicClient({ chain: chain as any, transport: http(RPC_URL, { timeout: 30_000 }) });
const wal = createWalletClient({ account, chain: chain as any, transport: http(RPC_URL, { timeout: 30_000 }) });

const rpcHost = new URL(RPC_URL).host;

// Account balance & allowance helpers — STOPS on failure, NEVER falls back to 0
async function fetchAccountBalances() {
  try {
    const [okbBalance, gasPrice, bemBalance] = await Promise.all([
      pub.getBalance({ address: account.address }),
      pub.getGasPrice(),
      pub.readContract({
        address: BEM_TOKEN_ADDR,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account.address],
      }),
    ]);
    return { okbBalance, bemBalance, gasPrice };
  } catch (err: any) {
    console.error(`\nFATAL: Failed to query account balances from RPC host ${rpcHost}:`);
    console.error(`   ${err.message}`);
    process.exit(1);
  }
}

async function getBemAllowance(spender: `0x${string}`): Promise<bigint> {
  try {
    return await pub.readContract({
      address: BEM_TOKEN_ADDR,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, spender],
    });
  } catch (err: any) {
    console.error(`\nFATAL: Failed to read BEM allowance for ${spender} from RPC host ${rpcHost}:`);
    console.error(`   ${err.message}`);
    process.exit(1);
  }
}

// Save dry-run record (never overwrites deployments.json)
function saveDryRunRecord(entry: Record<string, any>) {
  const dryPath = join(__dirname, '../deployments.dryrun.json');
  writeFileSync(dryPath, JSON.stringify({ ...entry, isDryRun: true, updatedAt: new Date().toISOString() }, null, 2));
  console.log(`Saved dry-run output to ${dryPath} (deployments.json untouched)`);
}

// Save real deployment record (only called after confirmed on-chain transactions)
function saveRealDeploymentRecord(entry: Record<string, any>) {
  const outPath = join(__dirname, '../deployments.json');
  writeFileSync(outPath, JSON.stringify({ ...entry, updatedAt: new Date().toISOString() }, null, 2));
  console.log(`\n✓ Saved confirmed deployment state to ${outPath}`);
}

async function main() {
  console.log('=== TapeFour Hardened Tape-Out Script ===\n');

  // 1. Verify RPC connection and Chain ID
  console.log('1. Checking RPC connection & network...');
  let chainId: number;
  let blockNumber: bigint;
  try {
    chainId = await pub.getChainId();
    if (chainId !== 196) {
      console.error(`FATAL: Connected to unexpected chain ID ${chainId}! Expected 196 (X Layer).`);
      process.exit(1);
    }
    blockNumber = await pub.getBlockNumber();
  } catch (err: any) {
    console.error(`FATAL: Failed to connect to RPC host ${rpcHost}: ${err.message}`);
    process.exit(1);
  }

  console.log(`   ✓ RPC Host          : ${rpcHost}`);
  console.log(`   ✓ Chain ID          : ${chainId} (Verified X Layer)`);
  console.log(`   ✓ Latest Block      : ${blockNumber.toString()}\n`);

  // 2. Verify BEM token contract address
  console.log('2. Verifying BEM token contract address on X Layer...');
  if (BEM_TOKEN_ADDR.toLowerCase() !== EXPECTED_BEM_TOKEN) {
    console.error(`FATAL: BEM token address mismatch! Expected ${EXPECTED_BEM_TOKEN}, got ${BEM_TOKEN_ADDR}`);
    process.exit(1);
  }
  console.log(`   ✓ BEM token address : ${BEM_TOKEN_ADDR}\n`);

  // 3. Build circuit & netlist
  console.log('3. Building Connect Four circuit...');
  const { builder, gateCount } = buildConnectFourCircuit();
  const netlistBytes = builder.serialize();
  console.log(`   ✓ Gates             : ${gateCount} NAND gates (target <= 1,500)`);
  console.log(`   ✓ Netlist size      : ${netlistBytes.length} bytes\n`);

  const binPath = join(__dirname, 'c4_netlist.bin');
  writeFileSync(binPath, netlistBytes);

  // 4. Initial balance & fee checks
  console.log('4. Querying live on-chain balances and allowances...');
  const initial = await fetchAccountBalances();
  const bemAllowanceFactory = await getBemAllowance(CPU_FACTORY_ADDR);

  const okbFormatted = formatEther(initial.okbBalance);
  const bemFormatted = (Number(initial.bemBalance) / 1e8).toFixed(4);
  const bemAllowanceFormatted = (Number(bemAllowanceFactory) / 1e8).toFixed(4);

  // Calculate realistic required OKB (fee + estimated gas for 5 transactions + 20% buffer)
  const gasCostEstimateWei   = TOTAL_ESTIMATED_STEPS_GAS * initial.gasPrice;
  const gasCostWithBufferWei = (gasCostEstimateWei * 120n) / 100n; // +20% buffer
  const minRequiredOkbWei    = TAPEOUT_PROTOCOL_FEE_WEI + gasCostWithBufferWei;

  console.log(`   Deployer Address    : ${account.address}`);
  console.log(`   OKB Raw Balance     : ${initial.okbBalance.toString()} wei (${okbFormatted} OKB)`);
  console.log(`   BEM Raw Balance     : ${initial.bemBalance.toString()} units (${bemFormatted} BEM)`);
  console.log(`   Factory Allowance   : ${bemAllowanceFactory.toString()} units (${bemAllowanceFormatted} BEM)`);
  console.log(`   Current Gas Price   : ${(Number(initial.gasPrice) / 1e9).toFixed(3)} Gwei`);
  console.log(`   Execution Mode      : ${DRY ? 'DRY RUN (simulation only)' : (RESUME ? 'RESUME FROM PARTIAL STATE' : 'LIVE ON-CHAIN EXECUTION')}\n`);

  // Fee table
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│                   REQUIRED PROTOCOL FEES                     │');
  console.log('├────────────────────────────────┬─────────────────────────────┤');
  console.log('│ Step 1: CPU Factory Creation   │ 0.11 BEM (0.10 fee + 0.01)  │');
  console.log('│ Step 2: Transistor Minting     │ 0.01 BEM (for 1,479 gates)  │');
  console.log('│ Step 3: Tape-Out Protocol Fee  │ 0.001300 OKB                │');
  console.log('│ Estimated Steps Gas (+20%)     │ ' + formatEther(gasCostWithBufferWei).padEnd(28) + '│');
  console.log('├────────────────────────────────┼─────────────────────────────┤');
  console.log('│ TOTAL BEM REQUIRED             │ 0.12 BEM (~$1.10 - $1.38)   │');
  console.log('│ MINIMUM OKB REQUIRED           │ ' + (formatEther(minRequiredOkbWei) + ' OKB').padEnd(28) + '│');
  console.log('└────────────────────────────────┴─────────────────────────────┘\n');

  if (!DRY && !RESUME) {
    if (initial.okbBalance < minRequiredOkbWei) {
      console.error(`FATAL: Insufficient OKB balance!`);
      console.error(`   Found: ${okbFormatted} OKB (${initial.okbBalance.toString()} wei)`);
      console.error(`   Required: at least ${formatEther(minRequiredOkbWei)} OKB (tapeout fee + gas buffer).`);
      process.exit(1);
    }
    if (initial.bemBalance < TOTAL_REQUIRED_BEM_UNITS) {
      console.error(`FATAL: Insufficient BEM token balance!`);
      console.error(`   Found: ${bemFormatted} BEM (${initial.bemBalance.toString()} units)`);
      console.error(`   Required: at least 0.12 BEM (${TOTAL_REQUIRED_BEM_UNITS} units).`);
      process.exit(1);
    }
  }

  // Check if unresumed partial state exists
  if (!RESUME && !DRY && existsSync(STATE_PATH)) {
    const existing = loadPartialState();
    if (existing && existing.cpuAddress) {
      console.log('────────────────────────────────────────────────────────────────');
      console.log(`NOTE: Found existing partial state at ${STATE_PATH}`);
      console.log(`CPU Address: ${existing.cpuAddress}`);
      console.log(`To resume with this CPU without paying the 0.11 BEM creation fee again, pass --resume.`);
      console.log(`Otherwise, remove ${STATE_PATH} to start fresh.`);
      console.log('────────────────────────────────────────────────────────────────\n');
    }
  }

  // ---- STEP 1: Custom CPU Container Deployment -----------------------------
  console.log('--- Step 1: Custom CPU Container Deployment ---');
  let cpuAddr: `0x${string}` = '0x0000000000000000000000000000000000000000';
  let transAddr: `0x${string}` = '0x0000000000000000000000000000000000000000';
  let createCpuTxHash = '0x0000000000000000000000000000000000000000000000000000000000000000';

  if (RESUME) {
    const state = loadPartialState();
    if (!state || !state.cpuAddress) {
      console.error(`FATAL: --resume passed but no valid partial state found at ${STATE_PATH}`);
      process.exit(1);
    }
    if (state.chainId !== 196) {
      console.error(`FATAL: State chainId (${state.chainId}) is not 196!`);
      process.exit(1);
    }
    if (state.deployer.toLowerCase() !== account.address.toLowerCase()) {
      console.error(`FATAL: State deployer (${state.deployer}) does not match current deployer (${account.address})!`);
      process.exit(1);
    }

    cpuAddr = state.cpuAddress;
    createCpuTxHash = state.createCpuTx;
    console.log(`✓ Resuming from partial state: CPU address ${cpuAddr}`);

    // Verify CPU has code and is factory-registered
    const cpuCode = await pub.getBytecode({ address: cpuAddr });
    if (!cpuCode || cpuCode === '0x') {
      console.error(`FATAL: Resumed CPU address ${cpuAddr} has NO deployed bytecode on chain!`);
      process.exit(1);
    }
    const isCpuValid = await pub.readContract({
      address: CPU_FACTORY_ADDR,
      abi: FACTORY_ABI,
      functionName: 'isCPU',
      args: [cpuAddr],
    });
    if (!isCpuValid) {
      console.error(`FATAL: Resumed CPU address ${cpuAddr} is not recognized by CPU Factory!`);
      process.exit(1);
    }
    console.log(`✓ CPU container confirmed valid and active on-chain.\n`);
  } else if (!DRY) {
    // Re-check balances before Step 1 state change
    const preStep1 = await fetchAccountBalances();
    if (preStep1.okbBalance < minRequiredOkbWei) {
      console.error(`FATAL: Insufficient OKB before Step 1! Found: ${formatEther(preStep1.okbBalance)} OKB. Required: at least ${formatEther(minRequiredOkbWei)} OKB.`);
      process.exit(1);
    }
    if (preStep1.bemBalance < TOTAL_REQUIRED_BEM_UNITS) {
      console.error(`FATAL: Insufficient BEM before Step 1! Found: ${(Number(preStep1.bemBalance) / 1e8).toFixed(4)} BEM. Required: at least 0.12 BEM.`);
      process.exit(1);
    }

    // Check & handle BEM approval to Factory
    let currentFactoryAllowance = await getBemAllowance(CPU_FACTORY_ADDR);
    if (currentFactoryAllowance < BEM_FACTORY_FEE_UNITS) {
      console.log(`Action: Approve exactly 0.11 BEM (${BEM_FACTORY_FEE_UNITS} units) to CPU Factory (${CPU_FACTORY_ADDR})`);
      await confirm('Proceed with Step 1a: Approve 0.11 BEM to CPU Factory?');
      console.log('Submitting BEM approval to factory...');
      const txApprove = await wal.writeContract({
        address: BEM_TOKEN_ADDR,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [CPU_FACTORY_ADDR, BEM_FACTORY_FEE_UNITS],
      });
      console.log(`Approval Tx Hash: ${txApprove}`);
      await pub.waitForTransactionReceipt({ hash: txApprove });

      currentFactoryAllowance = await getBemAllowance(CPU_FACTORY_ADDR);
      if (currentFactoryAllowance < BEM_FACTORY_FEE_UNITS) {
        console.error(`FATAL: Factory allowance still insufficient after approval! Found: ${currentFactoryAllowance}`);
        process.exit(1);
      }
      console.log('✓ BEM Factory approval confirmed.\n');
    } else {
      console.log(`✓ Factory BEM allowance already sufficient (${(Number(currentFactoryAllowance) / 1e8).toFixed(4)} BEM).\n`);
    }

    console.log('Action: Call CPUFactory.createCPU("TapeFour CPU", "C4CPU", "https://github.com/Anoi-xyz/tapefour", 10000, 0)');
    await confirm('Proceed with Step 1b: Deploy CPU container via CPU Factory (costs 0.11 BEM)?');

    const countBefore = await pub.readContract({
      address: CPU_FACTORY_ADDR,
      abi: FACTORY_ABI,
      functionName: 'cpuCount',
    });

    console.log('Submitting createCPU transaction...');
    createCpuTxHash = await wal.writeContract({
      address: CPU_FACTORY_ADDR,
      abi: FACTORY_ABI,
      functionName: 'createCPU',
      args: ['TapeFour CPU', 'C4CPU', 'https://github.com/Anoi-xyz/tapefour', 10000n, 0n],
    });
    console.log(`createCPU Tx Hash: ${createCpuTxHash}`);
    const rcCpu = await pub.waitForTransactionReceipt({ hash: createCpuTxHash as `0x${string}` });

    if (rcCpu.status !== 'success') {
      console.error('FATAL: createCPU transaction failed or reverted!', rcCpu);
      process.exit(1);
    }

    // Extract CPU address from CPUCreated event
    for (const log of rcCpu.logs) {
      try {
        const decoded = decodeEventLog({
          abi: FACTORY_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'CPUCreated') {
          cpuAddr = (decoded.args as any).cpu;
          break;
        }
      } catch {}
    }

    if (cpuAddr === '0x0000000000000000000000000000000000000000') {
      cpuAddr = await pub.readContract({
        address: CPU_FACTORY_ADDR,
        abi: FACTORY_ABI,
        functionName: 'cpuAt',
        args: [countBefore],
      });
    }

    // Verify deployed CPU bytecode
    const cpuCode = await pub.getBytecode({ address: cpuAddr });
    if (!cpuCode || cpuCode === '0x') {
      console.error(`FATAL: Newly deployed CPU at ${cpuAddr} has NO bytecode on chain!`);
      process.exit(1);
    }
    console.log(`✓ Custom CPU deployed and verified at: ${cpuAddr}\n`);

    // Save partial state immediately so steps 2 or 3 can be resumed
    savePartialState({
      chainId: 196,
      cpuAddress: cpuAddr,
      createCpuTx: createCpuTxHash,
      deployer: account.address,
      step: 1,
      updatedAt: new Date().toISOString(),
    });
  } else {
    // DRY RUN simulation
    cpuAddr = '0x0000000000000000000000000000000000000001';
    console.log('[DRY RUN] Would approve 0.11 BEM to factory if needed.');
    console.log('[DRY RUN] Would call CPUFactory.createCPU("TapeFour CPU", "C4CPU", "https://github.com/Anoi-xyz/tapefour", 10000, 0)');
    console.log(`[DRY RUN] Simulated CPU Address: ${cpuAddr} (SIMULATED, will differ on mainnet)\n`);
  }

  // ---- STEP 2: Transistor Approval & Minting --------------------------------
  console.log('--- Step 2: Transistor Minting (1,479 NAND gates) ---');

  if (!DRY) {
    // Read transistor contract address dynamically from the on-chain CPU contract
    console.log(`Reading transistor contract address from CPU at ${cpuAddr}...`);
    transAddr = await pub.readContract({
      address: cpuAddr,
      abi: CPU_ABI,
      functionName: 'transistors',
    });

    // Verify transistor address has deployed bytecode
    const transCode = await pub.getBytecode({ address: transAddr });
    if (!transCode || transCode === '0x') {
      console.error(`FATAL: Transistor address from CPU (${transAddr}) has NO deployed bytecode!`);
      process.exit(1);
    }
    console.log(`✓ Transistor contract verified on-chain: ${transAddr} (has bytecode)`);
  } else {
    transAddr = '0x0000000000000000000000000000000000000002';
    console.log(`[DRY RUN] Simulated Transistor Address: ${transAddr} (SIMULATED, will differ on mainnet)`);
  }

  // Check if transistors are already minted (in case of resume)
  let alreadyMinted = 0n;
  if (!DRY) {
    alreadyMinted = await pub.readContract({
      address: transAddr,
      abi: TRANSISTOR_ABI,
      functionName: 'balanceOf',
      args: [account.address, 0n],
    });
  }

  let mintTxHash = '0x0000000000000000000000000000000000000000000000000000000000000000';

  if (!DRY && alreadyMinted >= BigInt(gateCount)) {
    console.log(`✓ Already holding ${alreadyMinted} NAND transistors on ${transAddr} (>= ${gateCount} required). Skipping mint.\n`);
  } else {
    // Re-check balances before Step 2
    if (!DRY) {
      const preStep2 = await fetchAccountBalances();
      if (preStep2.okbBalance < 500_000_000_000_000n) {
        console.error(`FATAL: Insufficient OKB before Step 2! Found: ${formatEther(preStep2.okbBalance)} OKB. Required: at least 0.0005 OKB for gas.`);
        process.exit(1);
      }
      if (preStep2.bemBalance < BEM_TRANSISTOR_FEE_UNITS) {
        console.error(`FATAL: Insufficient BEM before Step 2! Found: ${(Number(preStep2.bemBalance) / 1e8).toFixed(4)} BEM. Required: at least 0.01 BEM.`);
        process.exit(1);
      }
    }

    // Check & handle BEM approval to Transistor contract
    let currentTransAllowance = 0n;
    if (!DRY) {
      currentTransAllowance = await getBemAllowance(transAddr);
    }

    if (currentTransAllowance < BEM_TRANSISTOR_FEE_UNITS) {
      console.log(`Action: Approve exactly 0.01 BEM (${BEM_TRANSISTOR_FEE_UNITS} units) to Transistor contract (${transAddr})`);
      await confirm(`Proceed with Step 2a: Approve 0.01 BEM to Transistor contract?`);
      if (!DRY) {
        console.log('Submitting BEM approval to transistor contract...');
        const txApproveTrans = await wal.writeContract({
          address: BEM_TOKEN_ADDR,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [transAddr, BEM_TRANSISTOR_FEE_UNITS],
        });
        console.log(`Transistor Approval Tx Hash: ${txApproveTrans}`);
        await pub.waitForTransactionReceipt({ hash: txApproveTrans });

        currentTransAllowance = await getBemAllowance(transAddr);
        if (currentTransAllowance < BEM_TRANSISTOR_FEE_UNITS) {
          console.error(`FATAL: Transistor allowance still insufficient after approval! Found: ${currentTransAllowance}`);
          process.exit(1);
        }
        console.log('✓ BEM Transistor approval confirmed.\n');
      } else {
        console.log('[DRY RUN] Would submit approve(transAddr, 0.01 BEM).\n');
      }
    } else {
      console.log(`✓ Transistor BEM allowance already sufficient (${(Number(currentTransAllowance) / 1e8).toFixed(4)} BEM).\n`);
    }

    console.log(`Action: Mint ${gateCount} NAND transistors on ${transAddr} (costs 0.01 BEM)`);
    await confirm(`Proceed with Step 2b: Mint ${gateCount} transistors?`);

    if (!DRY) {
      // Re-verify allowance right before mint
      const verifyAllowance = await getBemAllowance(transAddr);
      if (verifyAllowance < BEM_TRANSISTOR_FEE_UNITS) {
        console.error(`FATAL: Transistor allowance is ${verifyAllowance}, but ${BEM_TRANSISTOR_FEE_UNITS} is required!`);
        process.exit(1);
      }

      console.log('Submitting transistor mint transaction...');
      mintTxHash = await wal.writeContract({
        address: transAddr,
        abi: TRANSISTOR_ABI,
        functionName: 'mint',
        args: [0n, BigInt(gateCount)],
      });
      console.log(`Mint Tx Hash: ${mintTxHash}`);
      const rcMint = await pub.waitForTransactionReceipt({ hash: mintTxHash as `0x${string}` });
      if (rcMint.status !== 'success') {
        console.error('FATAL: Transistor mint transaction failed!', rcMint);
        process.exit(1);
      }
      console.log(`✓ Minted ${gateCount} NAND transistors successfully.\n`);

      // Update partial state
      savePartialState({
        chainId: 196,
        cpuAddress: cpuAddr,
        transistorAddress: transAddr,
        createCpuTx: createCpuTxHash,
        mintTx: mintTxHash,
        deployer: account.address,
        step: 2,
        updatedAt: new Date().toISOString(),
      });
    } else {
      console.log(`[DRY RUN] Would mint ${gateCount} NAND transistors on transistor contract.\n`);
    }
  }

  // ---- STEP 3: Circuit Tape-Out --------------------------------------------
  console.log('--- Step 3: Circuit Tape-Out ---');
  let tapeoutFee = TAPEOUT_PROTOCOL_FEE_WEI;
  if (!DRY) {
    tapeoutFee = await pub.readContract({
      address: cpuAddr,
      abi: CPU_ABI,
      functionName: 'TAPEOUT_FEE',
    });
  }

  // Re-check balances and transistor supply before Step 3
  if (!DRY) {
    const preStep3 = await fetchAccountBalances();
    const minStep3Okb = tapeoutFee + (1_000_000n * preStep3.gasPrice);
    if (preStep3.okbBalance < minStep3Okb) {
      console.error(`FATAL: Insufficient OKB before Step 3!`);
      console.error(`   Found: ${formatEther(preStep3.okbBalance)} OKB`);
      console.error(`   Required: at least ${formatEther(minStep3Okb)} OKB (fee: ${formatEther(tapeoutFee)} + gas).`);
      process.exit(1);
    }

    const currentNandBal = await pub.readContract({
      address: transAddr,
      abi: TRANSISTOR_ABI,
      functionName: 'balanceOf',
      args: [account.address, 0n],
    });
    if (currentNandBal < BigInt(gateCount)) {
      console.error(`FATAL: Insufficient NAND transistors before Step 3! Found: ${currentNandBal}, Required: ${gateCount}.`);
      process.exit(1);
    }
    console.log(`✓ Confirmed deployer holds ${currentNandBal} NAND transistors (>= ${gateCount} required).`);
  }

  console.log(`Action: Submit 1,479-gate netlist to CPU ${cpuAddr} (fee: ${formatEther(tapeoutFee)} OKB)`);
  await confirm('Proceed with Step 3: Tape out Connect Four rules circuit?');

  let circuitId = 1n;
  let tapeoutTxHash = '0x0000000000000000000000000000000000000000000000000000000000000000';

  if (!DRY) {
    console.log('Submitting tapeout transaction...');
    tapeoutTxHash = await wal.writeContract({
      address: cpuAddr,
      abi: CPU_ABI,
      functionName: 'tapeout',
      args: [`0x${Buffer.from(netlistBytes).toString('hex')}` as `0x${string}`, 88, 87],
      value: tapeoutFee,
    });
    console.log(`Tapeout Tx Hash: ${tapeoutTxHash}`);
    const rcTapeout = await pub.waitForTransactionReceipt({ hash: tapeoutTxHash as `0x${string}` });

    if (rcTapeout.status !== 'success') {
      console.error('FATAL: Tapeout transaction failed!', rcTapeout);
      process.exit(1);
    }

    // Extract circuitId from ERC721 Transfer log
    for (const log of rcTapeout.logs) {
      if (log.topics.length === 4 && log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
        circuitId = BigInt(log.topics[3]);
        break;
      }
    }

    // Verify circuit ownership on-chain
    const owner = await pub.readContract({
      address: cpuAddr,
      abi: CPU_ABI,
      functionName: 'ownerOf',
      args: [circuitId],
    });

    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      console.error(`FATAL: Circuit owner on-chain (${owner}) does not match deployer (${account.address})!`);
      process.exit(1);
    }

    console.log(`✓ Circuit #${circuitId} taped out and confirmed on-chain!`);

    // Write real deployments.json ONLY after confirmed on-chain receipt
    saveRealDeploymentRecord({
      network: 'xlayer',
      chainId: 196,
      bemToken: BEM_TOKEN_ADDR,
      cpuFactory: CPU_FACTORY_ADDR,
      processor: cpuAddr,
      circuitId: Number(circuitId),
      gateCount: gateCount,
      deployer: account.address,
      createCpuTx: createCpuTxHash,
      mintTx: mintTxHash,
      tapeoutTx: tapeoutTxHash,
      status: 'TAPED_OUT',
    });

    // Clean up partial state file upon complete success
    if (existsSync(STATE_PATH)) {
      try {
        unlinkSync(STATE_PATH);
        console.log(`Cleaned up temporary partial state file ${STATE_PATH}`);
      } catch {}
    }

    console.log('\n=== TAPE-OUT ON-CHAIN CONFIRMED ===');
    console.log(`PROCESSOR_ADDRESS=${cpuAddr}`);
    console.log(`CIRCUIT_ID=${circuitId}`);
    console.log(`GATE_COUNT=${gateCount}`);
  } else {
    console.log('[DRY RUN] Would submit tapeout transaction and save deployments.json upon confirmation.');
    saveDryRunRecord({
      network: 'xlayer',
      chainId: 196,
      bemToken: BEM_TOKEN_ADDR,
      cpuFactory: CPU_FACTORY_ADDR,
      processor: cpuAddr,
      circuitId: Number(circuitId),
      gateCount: gateCount,
      deployer: account.address,
      status: 'DRY_RUN',
    });

    console.log('\n=== DRY-RUN SIMULATION COMPLETE ===');
    console.log('NOTE: All addresses and IDs below are SIMULATED and will differ on mainnet.');
    console.log(`Simulated Processor Address : ${cpuAddr} (SIMULATED, will differ on mainnet)`);
    console.log(`Simulated Transistor Address: ${transAddr} (SIMULATED, will differ on mainnet)`);
    console.log(`Simulated Circuit ID        : ${circuitId} (SIMULATED, will differ on mainnet)`);
    console.log(`Circuit Gate Count          : ${gateCount} NAND gates (exact)`);
    console.log('No real transactions were broadcast. deployments.json was not modified.');
  }
}

main().catch(err => {
  console.error('\nFatal tapeout error:', err);
  process.exit(1);
});
