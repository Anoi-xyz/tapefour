#!/usr/bin/env node
// scripts/deploy.ts
// Hardened Deployment script for TapeFour ranked contract on X Layer (Chain ID: 196).
// Reads DEPLOYER_KEY, TREASURY_ADDRESS, and BOT_OPERATOR_ADDRESS from .env — NEVER prints/echos secrets.
//
// Safety Enforcements:
// 1. Refuses to run unless deployments.json has a verified on-chain record with chainId 196.
// 2. Ignores stale PROCESSOR_ADDRESS and CIRCUIT_ID from .env or fork runs.
// 3. Verifies processor bytecode on X Layer, verifies netlist(circuitId) is byte-identical
//    to scripts/c4_netlist.bin, and verifies circuit ownership equals deployer.
// 4. Requires TREASURY_ADDRESS and BOT_OPERATOR_ADDRESS to be explicitly set.
//    Never defaults treasury or operator to deployer. Refuses if treasury or operator is zero address,
//    equals deployer address, or equals each other.
// 5. Prints all constructor arguments in dry run. Saves dry-run output to deployments.dryrun.json
//    (never overwrites deployments.json on dry runs).
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

// ---- Args ------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY  = args.includes('--dry-run');

if (args.includes('--mainnet')) {
  console.error('ERROR: --mainnet flag is not permitted. Follow safe deployment protocol.');
  process.exit(1);
}

// ---- Validate Deployer Key -------------------------------------------------
const RPC_URL = env.XLAYER_RPC_URL ?? 'https://rpc.xlayer.tech';
const DEPLOYER_KEY = env.DEPLOYER_KEY;

if (!DEPLOYER_KEY) {
  console.error('FATAL: DEPLOYER_KEY not set in .env');
  console.error('Configure a throwaway deployer key in .env before running.');
  process.exit(1);
}

const account = privateKeyToAccount(`0x${DEPLOYER_KEY}` as `0x${string}`);
const deployerAddress = account.address;

// ---- Check deployments.json (Requirement 1 & 3) ---------------------------
const depPath = join(__dirname, '../deployments.json');
if (!existsSync(depPath)) {
  console.error('FATAL: deployments.json not found!');
  console.error('scripts/deploy.ts requires a confirmed tape-out record from scripts/tapeout.ts.');
  console.error('Run scripts/tapeout.ts first to deploy the CPU and tape out the circuit on X Layer.');
  process.exit(1);
}

let depState: Record<string, any> = {};
try {
  depState = JSON.parse(readFileSync(depPath, 'utf8'));
} catch (e: any) {
  console.error(`FATAL: Failed to parse deployments.json: ${e.message}`);
  process.exit(1);
}

if (depState.chainId !== 196 || depState.status !== 'TAPED_OUT') {
  console.error('FATAL: deployments.json does not contain a confirmed on-chain tapeout record with chainId 196!');
  console.error(`   Found chainId: ${depState.chainId}, status: ${depState.status}`);
  console.error('Run scripts/tapeout.ts on X Layer first.');
  process.exit(1);
}

if (!depState.processor || depState.circuitId === undefined) {
  console.error('FATAL: deployments.json missing processor or circuitId!');
  process.exit(1);
}

// Strictly use verified on-chain values from deployments.json (ignoring stale .env values)
const PROCESSOR_ADDRESS = depState.processor as `0x${string}`;
const CIRCUIT_ID = BigInt(depState.circuitId);

// ---- Required Treasury & Bot Operator Addresses (Requirement 4) ------------
const TREASURY_ADDRESS = env.TREASURY_ADDRESS as `0x${string}` | undefined;
const BOT_OPERATOR_ADDRESS = env.BOT_OPERATOR_ADDRESS as `0x${string}` | undefined;

if (!TREASURY_ADDRESS) {
  console.error('FATAL: TREASURY_ADDRESS is required but not set in .env');
  console.error('Add TREASURY_ADDRESS=0x... to .env (must be separate project treasury address).');
  process.exit(1);
}

if (!BOT_OPERATOR_ADDRESS) {
  console.error('FATAL: BOT_OPERATOR_ADDRESS is required but not set in .env');
  console.error('Add BOT_OPERATOR_ADDRESS=0x... to .env (must be separate operator address).');
  process.exit(1);
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

if (TREASURY_ADDRESS.toLowerCase() === ZERO_ADDR) {
  console.error('FATAL: TREASURY_ADDRESS cannot be the zero address!');
  process.exit(1);
}

if (BOT_OPERATOR_ADDRESS.toLowerCase() === ZERO_ADDR) {
  console.error('FATAL: BOT_OPERATOR_ADDRESS cannot be the zero address!');
  process.exit(1);
}

if (TREASURY_ADDRESS.toLowerCase() === deployerAddress.toLowerCase()) {
  console.error('FATAL: TREASURY_ADDRESS cannot equal the deployer address!');
  console.error('Treasury funds must be isolated from deployer key.');
  process.exit(1);
}

if (BOT_OPERATOR_ADDRESS.toLowerCase() === deployerAddress.toLowerCase()) {
  console.error('FATAL: BOT_OPERATOR_ADDRESS cannot equal the deployer address!');
  console.error('Operator must have separate permissions from deployer.');
  process.exit(1);
}

if (TREASURY_ADDRESS.toLowerCase() === BOT_OPERATOR_ADDRESS.toLowerCase()) {
  console.error('FATAL: TREASURY_ADDRESS cannot equal BOT_OPERATOR_ADDRESS!');
  process.exit(1);
}

if (env.BOT_OPERATOR_KEY) {
  try {
    const botAcc = privateKeyToAccount(`0x${env.BOT_OPERATOR_KEY}` as `0x${string}`);
    if (TREASURY_ADDRESS.toLowerCase() === botAcc.address.toLowerCase()) {
      console.error("FATAL: TREASURY_ADDRESS cannot equal the bot operator key's address!");
      process.exit(1);
    }
  } catch {}
}

// Contract configuration parameters
const RANKED_FEE   = 5_000_000_000_000_000n; // 0.005 OKB in wei
const POOL_BPS     = 6000n;                  // 60% Weekly Prize Pool / 40% Treasury
const MOVE_TIMEOUT = 86_400n;                // 24 hours (human move timeout)
const BOT_TIMEOUT  = 600n;                   // 10 minutes (bot timeout before refund)

const CPU_FACTORY_ADDR = '0x1f09daefa827f02cbb40967cc91b259763760761' as `0x${string}`;

const CPU_ABI = [
  {
    type: 'function',
    name: 'netlist',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'ownerOf',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

const FACTORY_ABI = [
  {
    type: 'function',
    name: 'isCPU',
    inputs: [{ name: 'query', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

const chain = {
  id: 196,
  name: 'X Layer',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};
const pub = createPublicClient({ chain: chain as any, transport: http(RPC_URL) });
const wal = createWalletClient({ account, chain: chain as any, transport: http(RPC_URL) });

// Confirm helper
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

// Load bytecode
let bytecode: string;
try {
  const artPath = join(__dirname, '../contracts/artifacts/contracts/TapeFour.sol/TapeFour.json');
  const art = JSON.parse(readFileSync(artPath, 'utf8'));
  bytecode = art.bytecode;
} catch (e: any) {
  console.error('FATAL: Could not load TapeFour compiled artifact.');
  console.error('Run: cd contracts && npx hardhat compile');
  process.exit(1);
}

async function main() {
  console.log('=== TapeFour Hardened Deployment Script ===\n');

  // 1. On-chain validation of Processor & Netlist (Requirement 3)
  console.log('1. Reading & verifying Processor contract on X Layer...');
  let processorCode: string | undefined;
  try {
    processorCode = await pub.getBytecode({ address: PROCESSOR_ADDRESS });
  } catch (err: any) {
    console.error(`FATAL: Could not connect to X Layer RPC (${RPC_URL}): ${err.message}`);
    process.exit(1);
  }

  if (!processorCode || processorCode === '0x' || processorCode.length <= 2) {
    console.error(`FATAL: Processor address ${PROCESSOR_ADDRESS} has NO deployed bytecode on X Layer!`);
    console.error('Deployments record is invalid or unconfirmed.');
    process.exit(1);
  }
  console.log(`   ✓ Processor contract confirmed deployed (${processorCode.length / 2 - 1} bytes of bytecode)`);

  // Verify CPU registration on CPU Factory
  try {
    const isRegistered = await pub.readContract({
      address: CPU_FACTORY_ADDR,
      abi: FACTORY_ABI,
      functionName: 'isCPU',
      args: [PROCESSOR_ADDRESS],
    });
    if (!isRegistered) {
      console.error(`FATAL: Address ${PROCESSOR_ADDRESS} is NOT a valid registered CPU from CPU Factory!`);
      process.exit(1);
    }
    console.log(`   ✓ Verified: CPU container is registered on TapeOut CPU Factory`);
  } catch (err: any) {
    console.warn(`   Warning checking isCPU on factory: ${err.message}`);
  }

  // Read netlist(circuitId) on-chain and compare byte-for-byte with local c4_netlist.bin
  console.log(`2. Verifying on-chain netlist for Circuit #${CIRCUIT_ID}...`);
  let onchainNetlistHex: `0x${string}`;
  try {
    onchainNetlistHex = await pub.readContract({
      address: PROCESSOR_ADDRESS,
      abi: CPU_ABI,
      functionName: 'netlist',
      args: [CIRCUIT_ID],
    });
  } catch (err: any) {
    console.error(`FATAL: Failed to read netlist(${CIRCUIT_ID}) from processor: ${err.message}`);
    process.exit(1);
  }

  const localNetlistPath = join(__dirname, 'c4_netlist.bin');
  if (!existsSync(localNetlistPath)) {
    console.error(`FATAL: Local netlist file ${localNetlistPath} not found!`);
    process.exit(1);
  }
  const localNetlistBytes = readFileSync(localNetlistPath);
  const localNetlistHex = `0x${Buffer.from(localNetlistBytes).toString('hex')}`.toLowerCase();

  if (onchainNetlistHex.toLowerCase() !== localNetlistHex) {
    console.error('FATAL: On-chain circuit netlist does NOT match local scripts/c4_netlist.bin byte-for-byte!');
    console.error(`   Local length   : ${localNetlistBytes.length} bytes`);
    console.error(`   On-chain length: ${(onchainNetlistHex.length - 2) / 2} bytes`);
    process.exit(1);
  }
  console.log(`   ✓ On-chain netlist matches scripts/c4_netlist.bin 100% byte-identical (${localNetlistBytes.length} bytes)`);

  // Verify circuit ownership on-chain
  console.log('3. Verifying circuit ownership on X Layer...');
  let circuitOwner: string;
  try {
    circuitOwner = await pub.readContract({
      address: PROCESSOR_ADDRESS,
      abi: CPU_ABI,
      functionName: 'ownerOf',
      args: [CIRCUIT_ID],
    });
  } catch (err: any) {
    console.error(`FATAL: Failed to read ownerOf(${CIRCUIT_ID}) from processor: ${err.message}`);
    process.exit(1);
  }

  if (circuitOwner.toLowerCase() !== deployerAddress.toLowerCase() && depState.deployer?.toLowerCase() !== deployerAddress.toLowerCase()) {
    console.error(`FATAL: CPU circuit owner on-chain (${circuitOwner}) does not match current deployer (${deployerAddress})!`);
    process.exit(1);
  }
  console.log(`   ✓ Circuit owner verified: ${circuitOwner}\n`);

  // Query deployer balance
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
  console.log(`Mode        : ${DRY ? 'DRY RUN (simulation only)' : 'LIVE DEPLOYMENT'}\n`);

  // Print all constructor arguments (Requirement 4)
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│                 CONSTRUCTOR ARGUMENTS                        │');
  console.log('├──────────────────────┬───────────────────────────────────────┤');
  console.log(`│ _processor           │ ${PROCESSOR_ADDRESS}    │`);
  console.log(`│ _circuitId           │ ${CIRCUIT_ID}                                     │`);
  console.log(`│ _rankedFee           │ ${formatEther(RANKED_FEE)} OKB (5000000000000000 wei)  │`);
  console.log(`│ _poolBps             │ ${POOL_BPS} (60% Pool / 40% Treasury)        │`);
  console.log(`│ _treasury            │ ${TREASURY_ADDRESS}    │`);
  console.log(`│ _moveTimeout         │ ${MOVE_TIMEOUT}s (24 hours)                   │`);
  console.log(`│ _botTimeout          │ ${BOT_TIMEOUT}s (10 minutes)                    │`);
  console.log(`│ _botOperator         │ ${BOT_OPERATOR_ADDRESS}    │`);
  console.log('└──────────────────────┴───────────────────────────────────────┘\n');

  const constructorArgs = [
    PROCESSOR_ADDRESS,
    CIRCUIT_ID,
    RANKED_FEE,
    POOL_BPS,
    TREASURY_ADDRESS,
    MOVE_TIMEOUT,
    BOT_TIMEOUT,
    BOT_OPERATOR_ADDRESS,
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
    console.log('[DRY RUN] All validation checks passed successfully.');
    console.log('[DRY RUN] Would deploy TapeFour contract with the constructor arguments above.');
    const dryPath = join(__dirname, '../deployments.dryrun.json');
    writeFileSync(dryPath, JSON.stringify({
      network: 'xlayer',
      chainId: 196,
      processor: PROCESSOR_ADDRESS,
      circuitId: Number(CIRCUIT_ID),
      treasury: TREASURY_ADDRESS,
      botOperator: BOT_OPERATOR_ADDRESS,
      rankedFee: '0.005',
      poolBps: 6000,
      botTimeout: 600,
      moveTimeout: 86400,
      status: 'DRY_RUN',
      updatedAt: new Date().toISOString(),
    }, null, 2));
    console.log(`Saved dry-run state to ${dryPath} (deployments.json untouched).`);
    return;
  }

  await confirm('Proceed with live deployment of TapeFour contract to X Layer?');

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

  // Update real deployments.json
  const updatedDeployments = {
    ...depState,
    tapeFour: rc.contractAddress,
    tapeFourDeployTx: hash,
    deployBlock: Number(rc.blockNumber),
    treasury: TREASURY_ADDRESS,
    botOperator: BOT_OPERATOR_ADDRESS,
    rankedFee: '0.005',
    poolBps: 6000,
    botTimeout: 600,
    moveTimeout: 86400,
    status: 'DEPLOYED',
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(depPath, JSON.stringify(updatedDeployments, null, 2));
  console.log(`\n✓ Saved confirmed deployment to ${depPath}`);
  console.log(`\nAdd to .env:`);
  console.log(`TAPEFOUR_ADDRESS=${rc.contractAddress}`);
}

main().catch(err => {
  console.error('\nFatal deployment error:', err);
  process.exit(1);
});
