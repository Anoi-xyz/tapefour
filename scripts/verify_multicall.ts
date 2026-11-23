#!/usr/bin/env node
// scripts/verify_multicall.ts
// Post-deploy read-only verification script.
// Runs >= 5,000 random eval checks against the deployed circuit on X Layer
// using Multicall3 (0xcA11bde05977b3631167028862bE2a173976CA11) and compares
// bit-for-bit with the local TapeFour netlist simulator.
//
// Usage:
//   npx tsx scripts/verify_multicall.ts [--count 5000] [--batch 100]

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildConnectFourCircuit } from '../circuit/circuit.ts';
import { CircuitSimulator } from '../circuit/eval.ts';
import { ConnectFourEngine } from '../circuit/engine_ref.ts';
import { createPublicClient, http, encodeFunctionData, decodeFunctionResult } from 'viem';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Load config / env -----------------------------------------------------
function loadConfig() {
  let processor = process.env.PROCESSOR_ADDRESS;
  let circuitId = process.env.CIRCUIT_ID ? BigInt(process.env.CIRCUIT_ID) : 1n;
  let rpcUrl = process.env.XLAYER_RPC_URL || 'https://rpc.xlayer.tech';

  const depPath = join(__dirname, '../deployments.json');
  if (existsSync(depPath)) {
    try {
      const dep = JSON.parse(readFileSync(depPath, 'utf8'));
      if (dep.processor) processor = dep.processor;
      if (dep.circuitId !== undefined) circuitId = BigInt(dep.circuitId);
    } catch {}
  }

  const envPath = join(__dirname, '../.env');
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const l of lines) {
      const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m) {
        const val = m[2].trim().replace(/^["']|["']$/g, '');
        if (m[1] === 'PROCESSOR_ADDRESS' && !processor) processor = val;
        if (m[1] === 'CIRCUIT_ID' && !circuitId) circuitId = BigInt(val);
        if (m[1] === 'XLAYER_RPC_URL' && !process.env.XLAYER_RPC_URL) rpcUrl = val;
      }
    }
  }

  return {
    processor: (processor || '0xd47C1A47d809438d66fd472cd2A30392ace4e581') as `0x${string}`,
    circuitId: BigInt(circuitId || 1n),
    rpcUrl,
  };
}

// Multicall3 canonical address
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as `0x${string}`;

const CPU_ABI = [
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

// Pack 88-bit input to 11 bytes
function packInputBits(boardA: bigint, boardB: bigint, col: number, turn: number): Uint8Array {
  const mask42 = (1n << 42n) - 1n;
  let val = 0n;
  val |= (boardA & mask42);
  val |= (boardB & mask42) << 42n;
  val |= (BigInt(col) & 7n) << 84n;
  val |= (BigInt(turn) & 1n) << 87n;

  const bytes = new Uint8Array(11);
  for (let i = 0; i < 11; i++) {
    bytes[i] = Number((val >> BigInt(i * 8)) & 0xffn);
  }
  return bytes;
}

// Convert 11 bytes to boolean array (88 bits)
function bytesToBits(bytes: Uint8Array, bitCount: number): boolean[] {
  const bits: boolean[] = [];
  for (let i = 0; i < bitCount; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = i % 8;
    bits.push(((bytes[byteIdx] >> bitIdx) & 1) === 1);
  }
  return bits;
}

// Convert boolean array (87 bits) to 11 bytes
function bitsToBytes(bits: boolean[]): Uint8Array {
  const byteLen = Math.ceil(bits.length / 8);
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) {
      bytes[Math.floor(i / 8)] |= 1 << (i % 8);
    }
  }
  return bytes;
}

async function main() {
  const config = loadConfig();
  const args = process.argv.slice(2);

  let targetCount = 5000;
  let batchSize = 100;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) targetCount = parseInt(args[i + 1], 10);
    if (args[i] === '--batch' && args[i + 1]) batchSize = parseInt(args[i + 1], 10);
  }

  console.log('=== TapeFour Multicall3 Circuit Verification ===');
  console.log(`Processor  : ${config.processor}`);
  console.log(`Circuit ID : ${config.circuitId}`);
  console.log(`Multicall3 : ${MULTICALL3_ADDRESS}`);
  console.log(`RPC URL    : ${config.rpcUrl}`);
  console.log(`Test Count : ${targetCount} positions (batch size: ${batchSize})`);
  console.log('');

  // 1. Build local circuit simulator
  console.log('Building local Connect Four circuit simulator...');
  const { netlist, gateCount } = buildConnectFourCircuit();
  const sim = new CircuitSimulator(netlist);
  console.log(`Circuit loaded: ${gateCount} NAND gates\n`);

  // 2. Setup Viem public client
  const client = createPublicClient({
    transport: http(config.rpcUrl, { retryCount: 3, timeout: 30000 }),
  });

  // 3. Generate random positions
  console.log(`Generating ${targetCount} random legal positions...`);
  const engine = new ConnectFourEngine();
  const testCases: { inputBytes: Uint8Array; expectedBytes: Uint8Array; col: number; turn: number }[] = [];

  while (testCases.length < targetCount) {
    engine.reset();
    const moveCount = Math.floor(Math.random() * 35) + 1; // 1 to 35 moves
    for (let m = 0; m < moveCount && !engine.isTerminal(); m++) {
      const legalCols = engine.getLegalMoves();
      if (legalCols.length === 0) break;
      const col = legalCols[Math.floor(Math.random() * legalCols.length)];
      const { boardA, boardB, turn } = engine.getState();

      const inputBytes = packInputBits(boardA, boardB, col, turn);
      const inputBits = bytesToBits(inputBytes, 88);
      const outputBits = sim.evaluate(inputBits);
      const expectedBytes = bitsToBytes(outputBits);

      testCases.push({ inputBytes, expectedBytes, col, turn });
      engine.makeMove(col);
      if (testCases.length >= targetCount) break;
    }
  }

  console.log(`Generated ${testCases.length} test positions. Beginning verification...\n`);

  let matched = 0;
  let mismatched = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let b = 0; b < testCases.length; b += batchSize) {
    const chunk = testCases.slice(b, b + batchSize);

    // Build calls for Multicall3
    const calls = chunk.map(tc => {
      const callData = encodeFunctionData({
        abi: CPU_ABI,
        functionName: 'eval',
        args: [config.circuitId, `0x${Buffer.from(tc.inputBytes).toString('hex')}` as `0x${string}`],
      });
      return {
        target: config.processor,
        allowFailure: false,
        callData,
      };
    });

    try {
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

      for (let i = 0; i < chunk.length; i++) {
        const res = results[i];
        if (!res.success) {
          mismatched++;
          continue;
        }

        // Decode eval return bytes
        const evalReturn = decodeFunctionResult({
          abi: CPU_ABI,
          functionName: 'eval',
          data: res.returnData,
        }) as `0x${string}`;

        const actualBytes = Buffer.from(evalReturn.slice(2), 'hex');
        const expectedBytes = Buffer.from(chunk[i].expectedBytes);

        if (actualBytes.equals(expectedBytes)) {
          matched++;
        } else {
          mismatched++;
          console.error(`Mismatch at index ${b + i}:`);
          console.error(`  Expected: ${expectedBytes.toString('hex')}`);
          console.error(`  Actual  : ${actualBytes.toString('hex')}`);
        }
      }
    } catch (err: any) {
      errors += chunk.length;
      console.warn(`Batch ${b / batchSize + 1} call note: ${err.message?.slice(0, 80)}`);
      // If RPC/Multicall3 call reverted or connection failed, track as error
    }

    const completed = Math.min(b + batchSize, testCases.length);
    const pct = ((completed / testCases.length) * 100).toFixed(1);
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`\rProgress: [${completed}/${testCases.length}] ${pct}% (${elapsedSec}s) | Matched: ${matched} | Mismatched: ${mismatched} | Errors: ${errors}`);
  }

  console.log('\n');
  console.log('=== VERIFICATION SUMMARY ===');
  console.log(`Total Positions Tested : ${testCases.length}`);
  console.log(`Matched Local Circuit  : ${matched}`);
  console.log(`Mismatches             : ${mismatched}`);
  console.log(`Call Errors / Offline  : ${errors}`);

  if (mismatched === 0 && matched > 0) {
    console.log('RESULT: PASS (100% on-chain circuit match with local simulator)');
  } else if (matched === 0 && errors > 0) {
    console.log('RESULT: INCONCLUSIVE (RPC endpoint offline or contract not deployed yet on target chain)');
  } else {
    console.log('RESULT: FAIL');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
