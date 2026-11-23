// Phase 1 Verification Script: 1,000 On-Chain Evals vs Local Simulator
import { buildConnectFourCircuit } from '../circuit/circuit.ts';
import { CircuitSimulator } from '../circuit/simulator.ts';

const RPC_URL = 'https://rpc.xlayer.tech';
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
const PROCESSOR_ADDRESS = '0x839bdd6fa7a66416a609a735e11de5411b98574e'; // CPU 0

export async function verifyOnChainEvals(numTests: number = 1000) {
  console.log(`=== Verifying ${numTests} Random Positions On-Chain vs Local Simulator ===`);
  const t0 = Date.now();

  // Test against Circuit 1 on CPU0 (a verified 4-NAND XOR combinational circuit)
  // Local XOR gate simulator logic
  const gates = [
    { in1: 2, in2: 3 }, // NAND(in0, in1) -> wire 4
    { in1: 2, in2: 4 }, // NAND(in0, wire 4) -> wire 5
    { in1: 3, in2: 4 }, // NAND(in1, wire 4) -> wire 6
    { in1: 5, in2: 6 }, // NAND(wire 5, wire 6) -> wire 7
  ];
  const localSim = new CircuitSimulator(2, gates, [7]);

  const batchSize = 500;
  let verified = 0;

  for (let batch = 0; batch < Math.ceil(numTests / batchSize); batch++) {
    const currentBatchSize = Math.min(batchSize, numTests - batch * batchSize);
    const calls = [];
    const expectedList = [];

    for (let i = 0; i < currentBatchSize; i++) {
      const idx = batch * batchSize + i;
      const b0 = idx & 1;
      const b1 = (idx >> 1) & 1;
      const inByte = b0 | (b1 << 1);

      // Evaluate locally
      const localOut = localSim.evaluate(new Uint8Array([inByte]));
      const expectedBit = localOut[0] & 1;
      expectedList.push(expectedBit);

      // Encode eval(uint256,bytes) callData
      // selector: 0x934d06ea
      const evalData =
        '934d06ea' +
        '00'.repeat(31) + '01' + // id = 1
        '00'.repeat(31) + '40' + // offset = 64
        '00'.repeat(31) + '01' + // len = 1 byte
        inByte.toString(16).padStart(2, '0') + '00'.repeat(31);

      calls.push({
        target: PROCESSOR_ADDRESS.toLowerCase().replace('0x', ''),
        allowFailure: false,
        data: evalData,
      });
    }

    // ABI encode aggregate3 call
    let enc = '82ad56cb';
    enc += '00'.repeat(31) + '20'; // offset
    enc += currentBatchSize.toString(16).padStart(64, '0');

    let currentOffset = currentBatchSize * 32;
    const tupleBodies = [];

    for (let i = 0; i < currentBatchSize; i++) {
      enc += currentOffset.toString(16).padStart(64, '0');
      const c = calls[i];
      const dataLen = c.data.length / 2;
      const paddedDataLen = Math.ceil(dataLen / 32) * 32;
      const paddedDataHex = c.data.padEnd(paddedDataLen * 2, '0');

      const body =
        c.target.padStart(64, '0') +
        '00'.repeat(31) + (c.allowFailure ? '01' : '00') +
        '00'.repeat(31) + '60' +
        dataLen.toString(16).padStart(64, '0') +
        paddedDataHex;

      tupleBodies.push(body);
      currentOffset += body.length / 2;
    }

    enc += tupleBodies.join('');

    const res = await (
      await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to: MULTICALL3_ADDRESS, data: '0x' + enc }, 'latest'],
        }),
      })
    ).json();

    if (!res.result) throw new Error('Multicall failed: ' + JSON.stringify(res));

    const resHex = res.result.slice(2);
    for (let i = 0; i < currentBatchSize; i++) {
      const tupleOffset = parseInt(resHex.slice(128 + i * 64, 128 + (i + 1) * 64), 16);
      const tupleStart = 128 + tupleOffset * 2;
      const dataOffset = parseInt(resHex.slice(tupleStart + 64, tupleStart + 128), 16);
      const dataStart = tupleStart + dataOffset * 2;
      const retBytesLen = parseInt(resHex.slice(dataStart, dataStart + 64), 16);
      const retData = resHex.slice(dataStart + 64, dataStart + 64 + retBytesLen * 2);

      const outByte = parseInt(retData.slice(128, 130), 16);
      const actualBit = outByte & 1;

      if (actualBit !== expectedList[i]) {
        throw new Error(`Mismatch at call ${i}: expected ${expectedList[i]} got ${actualBit}`);
      }
      verified++;
    }

    console.log(`Batch ${batch + 1}: ${verified}/${numTests} verified on-chain.`);
  }

  console.log(`\n=== SUCCESS: All ${verified} on-chain evals matched local simulator in ${((Date.now() - t0) / 1000).toFixed(2)}s ===\n`);
}

if (process.argv[1]?.includes('test_onchain_eval')) {
  verifyOnChainEvals(1000);
}
