// scripts/check_live_selectors.ts
// Live read-only verification of botOperator() and rankedFee() using corrected selectors

import { createPublicClient, http, formatEther } from 'viem';
import { SELECTORS } from '../web/abi.js';

const CONTRACT_ADDR = '0x1c319c3bcb9ed1c35507f029c8e7152ab0590c04';
const RPC_URL = 'https://rpc.xlayer.tech';

async function main() {
  console.log('='.repeat(70));
  console.log('Live On-Chain Selector Verification on X Layer (Chain ID 196)');
  console.log('='.repeat(70));
  console.log(`Contract: ${CONTRACT_ADDR}`);
  console.log(`RPC:      ${RPC_URL}`);

  const chain = {
    id: 196,
    name: 'X Layer',
    nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  };

  const client = createPublicClient({ chain: chain as any, transport: http(RPC_URL) });

  // 1. Check botOperator() with 0xbd15b9c1
  console.log(`\n1. Calling botOperator() [selector: ${SELECTORS.botOperator}]...`);
  const opRaw = await client.call({
    to: CONTRACT_ADDR as `0x${string}`,
    data: SELECTORS.botOperator as `0x${string}`,
  });
  if (!opRaw.data || opRaw.data.length < 66) {
    throw new Error(`Unexpected return data for botOperator: ${opRaw.data}`);
  }
  const operatorAddress = ('0x' + opRaw.data.slice(26)).toLowerCase();
  console.log(`   Raw returned hex : ${opRaw.data}`);
  console.log(`   Operator address : ${operatorAddress}`);
  const expectedOperator = '0x3318600906c5f72b02be32aad973de8e206add41'.toLowerCase();
  if (operatorAddress !== expectedOperator) {
    throw new Error(`Mismatch! Expected ${expectedOperator}, got ${operatorAddress}`);
  }
  console.log(`   MATCH: Operator address equals ${expectedOperator}`);

  // 2. Check rankedFee() with 0x2bc2d0e8
  console.log(`\n2. Calling rankedFee() [selector: ${SELECTORS.rankedFee}]...`);
  const feeRaw = await client.call({
    to: CONTRACT_ADDR as `0x${string}`,
    data: SELECTORS.rankedFee as `0x${string}`,
  });
  if (!feeRaw.data || feeRaw.data.length < 66) {
    throw new Error(`Unexpected return data for rankedFee: ${feeRaw.data}`);
  }
  const feeWei = BigInt(feeRaw.data);
  const feeOkb = formatEther(feeWei);
  console.log(`   Raw returned hex : ${feeRaw.data}`);
  console.log(`   Fee in wei       : ${feeWei} wei`);
  console.log(`   Fee in OKB       : ${feeOkb} OKB`);
  if (feeOkb !== '0.005') {
    throw new Error(`Mismatch! Expected 0.005 OKB, got ${feeOkb} OKB`);
  }
  console.log(`   MATCH: Ranked fee equals 0.005 OKB (${feeWei} wei)`);

  console.log('\n' + '='.repeat(70));
  console.log('SUCCESS: All live selector checks returned expected values.');
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Check failed:', err);
  process.exit(1);
});
