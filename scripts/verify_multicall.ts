#!/usr/bin/env node
// scripts/verify_multicall.ts
// Post-deploy read-only verification script for Connect Four on X Layer (Chain ID: 196).
// Verifies on-chain netlist byte-identity against scripts/c4_netlist.bin,
// then evaluates 5,000 positions using canonical Multicall3 against the deployed
// TapeOut circuit and compares bit-for-bit with the local CircuitSimulator.
//
// Usage:
//   npx tsx scripts/verify_multicall.ts [--count 5000] [--batch 100]

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildConnectFourCircuit } from '../circuit/circuit.ts';
import { CircuitSimulator } from '../circuit/simulator.ts';
import {
  packInputs,
  applyMove,
  cellIndex,
  isOccupied,
  COLS,
  ROWS,
} from '../engine/connect4.ts';
import {
  createPublicClient,
  http,
  encodeFunctionData,
  decodeFunctionResult,
} from 'viem';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Multicall3 canonical address (X Layer & multi-chain)
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as `0x${string}`;

// Max evals per single eth_call (each eval consumes ~3.6M gas; X Layer limit is 50M gas)
const MAX_EVALS_PER_CALL = 10;

// ABIs
const PROCESSOR_ABI = [
  {
    type: 'function',
    name: 'netlist',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'eval',
    inputs: [
      { name: 'circuitId', type: 'uint256' },
      { name: 'inputs', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'view',
  },
] as const;

const MULTICALL3_ABI = [
  {
    type: 'function',
    name: 'aggregate3',
    inputs: [
      {
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'callData', type: 'bytes' },
        ],
        name: 'calls',
        type: 'tuple[]',
      },
    ],
    outputs: [
      {
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' },
        ],
        name: 'returnData',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
  },
] as const;

// Load deployment config strictly from deployments.json (chainId 196)
function loadDeploymentConfig() {
  const depPath = join(__dirname, '../deployments.json');
  if (!existsSync(depPath)) {
    console.error('FATAL: deployments.json not found!');
    console.error('Run tape-out on X Layer first before verifying on-chain.');
    process.exit(1);
  }

  let dep: any;
  try {
    dep = JSON.parse(readFileSync(depPath, 'utf8'));
  } catch (err: any) {
    console.error(`FATAL: Could not parse deployments.json: ${err.message}`);
    process.exit(1);
  }

  if (dep.chainId !== 196) {
    console.error(`FATAL: deployments.json chainId is ${dep.chainId}, expected 196 (X Layer)!`);
    process.exit(1);
  }

  if (!dep.processor || dep.processor === '0x0000000000000000000000000000000000000000') {
    console.error('FATAL: deployments.json has no valid processor address!');
    process.exit(1);
  }

  if (dep.circuitId === undefined || dep.circuitId === null) {
    console.error('FATAL: deployments.json has no valid circuitId!');
    process.exit(1);
  }

  // Load RPC URL from .env if available, without printing/echoing secrets
  let rpcUrl = 'https://rpc.xlayer.tech';
  const envPath = join(__dirname, '../.env');
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m && m[1] === 'XLAYER_RPC_URL') {
        rpcUrl = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  }

  return {
    processor: dep.processor as `0x${string}`,
    circuitId: BigInt(dep.circuitId),
    rpcUrl,
  };
}

// Generate rich, varied test positions:
// - Normal opening/midgame legal moves
// - Winning moves (all 4 directions, both players)
// - Full column rejection moves (illegal)
// - Column 7 out-of-bounds rejection moves (illegal)
// - Terminal draw positions
function generateTestPositions(targetCount: number, sim: CircuitSimulator) {
  const testCases: { inputBytes: Uint8Array; expectedBytes: Uint8Array; desc: string }[] = [];

  function addCase(boardA: bigint, boardB: bigint, col: number, turn: number, desc: string) {
    const inBytes = packInputs(boardA, boardB, col, turn);
    const expBytes = sim.evaluate(inBytes);
    testCases.push({ inputBytes: inBytes, expectedBytes: expBytes, desc });
  }

  // 1. Full Column Rejection Tests (both players, all 7 columns)
  for (let c = 0; c < 7; c++) {
    let colFullA = 0n;
    let colFullB = 0n;
    for (let r = 0; r < 6; r++) {
      if (r % 2 === 0) colFullA |= (1n << BigInt(cellIndex(c, r)));
      else colFullB |= (1n << BigInt(cellIndex(c, r)));
    }
    addCase(colFullA, colFullB, c, 0, `Full column ${c} player A rejection`);
    addCase(colFullA, colFullB, c, 1, `Full column ${c} player B rejection`);
  }

  // 2. Out of bounds column 7 tests
  for (let t = 0; t <= 1; t++) {
    addCase(0n, 0n, 7, t, `Column 7 out-of-bounds player ${t}`);
    addCase(0x15n, 0x2an, 7, t, `Column 7 out-of-bounds populated board player ${t}`);
  }

  // 3. Handcrafted winning positions (Horizontal, Vertical, Diagonals for both players)
  // Horizontal win: row 0, cols 0,1,2 with col 3 played
  let bA_h = (1n << 0n) | (1n << 1n) | (1n << 2n);
  addCase(bA_h, 0n, 3, 0, 'Horizontal win Player A');
  let bB_h = (1n << 7n) | (1n << 8n) | (1n << 9n);
  addCase(0n, bB_h, 3, 1, 'Horizontal win Player B');

  // Vertical win: col 0, rows 0,1,2 with col 0 played
  let bA_v = (1n << BigInt(cellIndex(0, 0))) | (1n << BigInt(cellIndex(0, 1))) | (1n << BigInt(cellIndex(0, 2)));
  addCase(bA_v, 0n, 0, 0, 'Vertical win Player A');

  // Diagonal / win: (0,0), (1,1), (2,2) with col 3 played onto row 3
  let bA_d1 = (1n << BigInt(cellIndex(0, 0))) | (1n << BigInt(cellIndex(1, 1))) | (1n << BigInt(cellIndex(2, 2)));
  let bB_fill = (1n << BigInt(cellIndex(1, 0))) |
                (1n << BigInt(cellIndex(2, 0))) | (1n << BigInt(cellIndex(2, 1))) |
                (1n << BigInt(cellIndex(3, 0))) | (1n << BigInt(cellIndex(3, 1))) | (1n << BigInt(cellIndex(3, 2)));
  addCase(bA_d1, bB_fill, 3, 0, 'Diagonal up-right win Player A');

  // Diagonal \ win: (3,0), (2,1), (1,2) with col 0 played onto row 3
  let bA_d2 = (1n << BigInt(cellIndex(3, 0))) | (1n << BigInt(cellIndex(2, 1))) | (1n << BigInt(cellIndex(1, 2)));
  let bB_fill2 = (1n << BigInt(cellIndex(2, 0))) |
                 (1n << BigInt(cellIndex(1, 0))) | (1n << BigInt(cellIndex(1, 1))) |
                 (1n << BigInt(cellIndex(0, 0))) | (1n << BigInt(cellIndex(0, 1))) | (1n << BigInt(cellIndex(0, 2)));
  addCase(bA_d2, bB_fill2, 0, 0, 'Diagonal down-right win Player A');

  // 4. Known Draw Position (41 stones played, 42nd stone placed in last column with no win)
  let drawA = 0n;
  let drawB = 0n;
  for (let c = 0; c < 7; c++) {
    for (let r = 0; r < 6; r++) {
      if (c === 6 && r === 5) continue; // Final cell empty
      const bit = 1n << BigInt(cellIndex(c, r));
      const isA = ((c + Math.floor(r / 2)) % 2 === 0);
      if (isA) drawA |= bit;
      else drawB |= bit;
    }
  }
  addCase(drawA, drawB, 6, 1, 'Final cell draw move');

  // 5. Random Simulated Games to fill up to targetCount
  while (testCases.length < targetCount) {
    let boardA = 0n;
    let boardB = 0n;
    let turn = 0;
    let gameOver = false;

    for (let m = 0; m < 42 && !gameOver; m++) {
      const legalCols: number[] = [];
      const fullCols: number[] = [];
      for (let c = 0; c < 7; c++) {
        if (!isOccupied(boardA, boardB, c, 5)) legalCols.push(c);
        else fullCols.push(c);
      }

      if (legalCols.length === 0) break;

      // Occasionally test an illegal full column move during active gameplay
      if (fullCols.length > 0 && Math.random() < 0.05) {
        const fullCol = fullCols[Math.floor(Math.random() * fullCols.length)];
        addCase(boardA, boardB, fullCol, turn, `Midgame full col ${fullCol} rejection`);
        if (testCases.length >= targetCount) break;
      }

      const col = legalCols[Math.floor(Math.random() * legalCols.length)];
      const res = applyMove(boardA, boardB, col, turn);
      addCase(boardA, boardB, col, turn, `Random game move ${m + 1} col ${col}`);
      if (testCases.length >= targetCount) break;

      if (!res.valid || res.win || res.draw) {
        gameOver = true;
      } else {
        boardA = res.newBoardA;
        boardB = res.newBoardB;
        turn = 1 - turn;
      }
    }
  }

  return testCases;
}

async function main() {
  const config = loadDeploymentConfig();
  const args = process.argv.slice(2);

  let targetCount = 5000;
  let chunkSize = 100;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) targetCount = parseInt(args[i + 1], 10);
    if (args[i] === '--batch' && args[i + 1]) chunkSize = parseInt(args[i + 1], 10);
  }

  console.log('=== TapeFour Multicall3 Circuit Verification ===\n');
  console.log(`Processor Address  : ${config.processor}`);
  console.log(`Circuit ID         : ${config.circuitId}`);
  console.log(`Multicall3 Address : ${MULTICALL3_ADDRESS}`);
  console.log(`RPC Endpoint       : ${new URL(config.rpcUrl).host}`);
  console.log(`Target Count       : ${targetCount.toLocaleString()} positions (chunk size: ${chunkSize})\n`);

  // 1. Build local circuit simulator
  console.log('1. Building local Connect Four circuit...');
  const { builder, outputWires, gateCount } = buildConnectFourCircuit();
  const sim = new CircuitSimulator(88, builder.gates, outputWires);
  console.log(`   ✓ Local simulator initialized (${gateCount} NAND gates)\n`);

  // 2. Setup Viem Public Client
  const client = createPublicClient({
    transport: http(config.rpcUrl, { retryCount: 3, timeout: 30000 }),
  });

  // 3. Verify on-chain netlist byte-identity against scripts/c4_netlist.bin
  console.log('2. Verifying on-chain netlist byte-identity...');
  const binPath = join(__dirname, 'c4_netlist.bin');
  if (!existsSync(binPath)) {
    console.error(`FATAL: Local netlist binary not found at ${binPath}!`);
    process.exit(1);
  }
  const localNetlist = readFileSync(binPath);

  let onChainNetlistHex: `0x${string}`;
  try {
    onChainNetlistHex = await client.readContract({
      address: config.processor,
      abi: PROCESSOR_ABI,
      functionName: 'netlist',
      args: [config.circuitId],
    });
  } catch (err: any) {
    console.error(`FATAL: Failed to read netlist(${config.circuitId}) from processor ${config.processor}: ${err.message}`);
    process.exit(1);
  }

  const onChainNetlist = Buffer.from(onChainNetlistHex.slice(2), 'hex');
  if (localNetlist.length !== onChainNetlist.length || !localNetlist.equals(onChainNetlist)) {
    console.error('FATAL: On-chain netlist does NOT match scripts/c4_netlist.bin!');
    console.error(`   Local length   : ${localNetlist.length} bytes`);
    console.error(`   On-chain length: ${onChainNetlist.length} bytes`);
    process.exit(1);
  }
  console.log(`   ✓ On-chain netlist (Circuit #${config.circuitId}) is 100% byte-identical to scripts/c4_netlist.bin (${localNetlist.length} bytes)\n`);

  // 4. Generate test positions
  console.log(`3. Generating ${targetCount.toLocaleString()} varied positions (wins, full cols, draws, random moves)...`);
  const testCases = generateTestPositions(targetCount, sim);
  console.log(`   ✓ Generated ${testCases.length.toLocaleString()} test cases\n`);

  // 5. Evaluate on-chain via Multicall3
  console.log('4. Evaluating on-chain via Multicall3 aggregate3...');
  let matched = 0;
  let mismatched = 0;
  let callFailures = 0;
  const startTime = Date.now();

  // Helper to execute a single multicall batch (up to MAX_EVALS_PER_CALL)
  async function executeSubBatch(subChunk: typeof testCases) {
    const calls = subChunk.map(tc => {
      const callData = encodeFunctionData({
        abi: PROCESSOR_ABI,
        functionName: 'eval',
        args: [config.circuitId, `0x${Buffer.from(tc.inputBytes).toString('hex')}` as `0x${string}`],
      });
      return {
        target: config.processor,
        allowFailure: false,
        callData,
      };
    });

    const multicallData = encodeFunctionData({
      abi: MULTICALL3_ABI,
      functionName: 'aggregate3',
      args: [calls],
    });

    const rawResult = await client.call({
      to: MULTICALL3_ADDRESS,
      data: multicallData,
    });

    if (!rawResult.data) {
      throw new Error('Empty return data from Multicall3');
    }

    const results = decodeFunctionResult({
      abi: MULTICALL3_ABI,
      functionName: 'aggregate3',
      data: rawResult.data,
    }) as { success: boolean; returnData: `0x${string}` }[];

    return results;
  }

  // Process in chunks of chunkSize, running sub-batches of 10 in parallel
  for (let b = 0; b < testCases.length; b += chunkSize) {
    const chunk = testCases.slice(b, b + chunkSize);

    // Partition chunk into sub-batches of MAX_EVALS_PER_CALL (10)
    const subBatches: typeof testCases[] = [];
    for (let s = 0; s < chunk.length; s += MAX_EVALS_PER_CALL) {
      subBatches.push(chunk.slice(s, s + MAX_EVALS_PER_CALL));
    }

    try {
      // Execute sub-batches concurrently
      const batchResults = await Promise.all(subBatches.map(sb => executeSubBatch(sb)));
      const flattenedResults = batchResults.flat();

      if (flattenedResults.length !== chunk.length) {
        console.error(`\nFATAL: Results count (${flattenedResults.length}) does not match chunk length (${chunk.length})!`);
        process.exit(1);
      }

      for (let i = 0; i < chunk.length; i++) {
        const res = flattenedResults[i];
        if (!res.success) {
          console.error(`\nFATAL: Call at index ${b + i} failed on-chain!`);
          callFailures++;
          mismatched++;
          continue;
        }

        // Decode eval return bytes
        const evalReturn = decodeFunctionResult({
          abi: PROCESSOR_ABI,
          functionName: 'eval',
          data: res.returnData,
        }) as `0x${string}`;

        const actualBytes = Buffer.from(evalReturn.slice(2), 'hex');
        const expectedBytes = Buffer.from(chunk[i].expectedBytes);

        if (actualBytes.equals(expectedBytes)) {
          matched++;
        } else {
          mismatched++;
          console.error(`\nMISMATCH at test index ${b + i} (${chunk[i].desc}):`);
          console.error(`  Expected: ${expectedBytes.toString('hex')}`);
          console.error(`  Actual  : ${actualBytes.toString('hex')}`);
        }
      }
    } catch (err: any) {
      console.error(`\nFATAL: Multicall3 query failed at index ${b}: ${err.message}`);
      callFailures += chunk.length;
      process.exit(1);
    }

    const completed = Math.min(b + chunkSize, testCases.length);
    const pct = ((completed / testCases.length) * 100).toFixed(1);
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (completed / Math.max(1, (Date.now() - startTime) / 1000)).toFixed(1);
    process.stdout.write(`\rProgress: [${completed}/${testCases.length}] ${pct}% (${elapsedSec}s, ${rate} pos/s) | Matched: ${matched} | Mismatched: ${mismatched}`);
  }

  console.log('\n');
  console.log('=== VERIFICATION SUMMARY ===');
  console.log(`Total Positions Verified : ${testCases.length.toLocaleString()}`);
  console.log(`Matched Local Simulator  : ${matched.toLocaleString()}`);
  console.log(`Mismatches               : ${mismatched}`);
  console.log(`Call Failures            : ${callFailures}`);

  if (mismatched === 0 && callFailures === 0 && matched === testCases.length) {
    console.log('\n✓ RESULT: PASS (100% bit-for-bit match between on-chain circuit and local simulator)');
  } else {
    console.error('\n✗ RESULT: FAIL (Verification encountered mismatches or failures)');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\nFatal verification error:', err);
  process.exit(1);
});
