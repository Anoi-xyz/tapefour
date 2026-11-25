// scripts/read_contract.ts
// Read-only inspection of the deployed TapeFour contract on X Layer mainnet.
// Verifies immutable parameters and currentWeek against expected values.

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createPublicClient, http, parseAbi, formatEther } from 'viem';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotEnv(filepath: string): Record<string, string> {
  if (!existsSync(filepath)) return {};
  return Object.fromEntries(
    readFileSync(filepath, 'utf8')
      .split('\n')
      .flatMap(line => {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
        return m ? [[m[1], m[2].trim().replace(/^["']|["']$/g, '')]] : [];
      })
  );
}

const env = loadDotEnv(join(__dirname, '../.env'));

const RPC_URL = process.env.XLAYER_RPC_URL ?? env.XLAYER_RPC_URL ?? 'https://rpc.xlayer.tech';
const rpcHost = new URL(RPC_URL).host;

// Contract address resolution
let contractAddress = process.env.TAPEFOUR_ADDRESS ?? env.TAPEFOUR_ADDRESS;
if (!contractAddress && existsSync(join(__dirname, '../deployments.json'))) {
  try {
    const d = JSON.parse(readFileSync(join(__dirname, '../deployments.json'), 'utf8'));
    if (d.tapeFour) contractAddress = d.tapeFour;
  } catch {}
}
if (!contractAddress) {
  contractAddress = '0x1c319c3bcb9ed1c35507f029c8e7152ab0590c04';
}

const EXPECTED = {
  processor: '0xc849714d70A5c1bE8A456C47c644fe90D5B1625C'.toLowerCase(),
  circuitId: 1n,
  rankedFee: 5000000000000000n, // 0.005 ether
  poolBps: 6000n, // 60%
  treasury: '0xb1c17d49869b79dc8f96e01078cf6799db1b3ccc'.toLowerCase(),
  moveTimeout: 86400n, // 24 hours
  botTimeout: 600n, // 10 minutes
  botOperator: '0x3318600906c5f72b02be32aad973de8e206add41'.toLowerCase(),
};

const ABI = parseAbi([
  'function processor() view returns (address)',
  'function circuitId() view returns (uint256)',
  'function rankedFee() view returns (uint256)',
  'function poolBps() view returns (uint256)',
  'function treasury() view returns (address)',
  'function moveTimeout() view returns (uint256)',
  'function botTimeout() view returns (uint256)',
  'function botOperator() view returns (address)',
  'function currentWeek() view returns (uint64)',
]);

async function main() {
  console.log('='.repeat(70));
  console.log('TapeFour Contract Read-Only Verification');
  console.log('='.repeat(70));
  console.log(`RPC Host:         ${rpcHost}`);
  console.log(`Contract Address: ${contractAddress}`);

  const chain = {
    id: 196,
    name: 'X Layer',
    nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  };

  const client = createPublicClient({ chain: chain as any, transport: http(RPC_URL) });

  const chainId = await client.getChainId();
  if (chainId !== 196) {
    throw new Error(`Unexpected chainId: got ${chainId}, expected 196`);
  }
  const blockNum = await client.getBlockNumber();
  console.log(`Connected:        Chain ID ${chainId} (block #${blockNum})`);

  const code = await client.getCode({ address: contractAddress as `0x${string}` });
  if (!code || code === '0x') {
    throw new Error(`No code found at address ${contractAddress}`);
  }
  console.log(`Contract Code:    ${Math.floor((code.length - 2) / 2)} bytes deployed`);
  console.log('-'.repeat(70));

  // Query on-chain settings
  const [
    processor,
    circuitId,
    rankedFee,
    poolBps,
    treasury,
    moveTimeout,
    botTimeout,
    botOperator,
    currentWeek,
  ] = await Promise.all([
    client.readContract({ address: contractAddress as `0x${string}`, abi: ABI, functionName: 'processor' }),
    client.readContract({ address: contractAddress as `0x${string}`, abi: ABI, functionName: 'circuitId' }),
    client.readContract({ address: contractAddress as `0x${string}`, abi: ABI, functionName: 'rankedFee' }),
    client.readContract({ address: contractAddress as `0x${string}`, abi: ABI, functionName: 'poolBps' }),
    client.readContract({ address: contractAddress as `0x${string}`, abi: ABI, functionName: 'treasury' }),
    client.readContract({ address: contractAddress as `0x${string}`, abi: ABI, functionName: 'moveTimeout' }),
    client.readContract({ address: contractAddress as `0x${string}`, abi: ABI, functionName: 'botTimeout' }),
    client.readContract({ address: contractAddress as `0x${string}`, abi: ABI, functionName: 'botOperator' }),
    client.readContract({ address: contractAddress as `0x${string}`, abi: ABI, functionName: 'currentWeek' }),
  ]);

  let allPassed = true;

  function report(name: string, onChain: string | bigint, expected: string | bigint, displayOnChain?: string, displayExpected?: string) {
    const isAddr = typeof onChain === 'string' && onChain.startsWith('0x');
    const match = isAddr
      ? (onChain as string).toLowerCase() === (expected as string).toLowerCase()
      : onChain === expected;

    const status = match ? 'PASS [MATCH]' : 'FAIL [MISMATCH]';
    if (!match) allPassed = false;

    console.log(`${name.padEnd(16)} : ${displayOnChain ?? onChain}`);
    console.log(`  Expected       : ${displayExpected ?? expected}`);
    console.log(`  Status         : ${status}`);
    console.log('');
  }

  console.log('Contract Immutable Settings:');
  console.log('');

  report('processor', processor, EXPECTED.processor);
  report('circuitId', circuitId, EXPECTED.circuitId);
  report('rankedFee', rankedFee, EXPECTED.rankedFee, `${formatEther(rankedFee)} OKB (${rankedFee} wei)`, `${formatEther(EXPECTED.rankedFee)} OKB (${EXPECTED.rankedFee} wei)`);
  report('poolBps', poolBps, EXPECTED.poolBps, `${poolBps} (${Number(poolBps) / 100}%)`, `${EXPECTED.poolBps} (${Number(EXPECTED.poolBps) / 100}%)`);
  report('treasury', treasury, EXPECTED.treasury);
  report('moveTimeout', moveTimeout, EXPECTED.moveTimeout, `${moveTimeout}s (${Number(moveTimeout) / 3600}h)`, `${EXPECTED.moveTimeout}s (${Number(EXPECTED.moveTimeout) / 3600}h)`);
  report('botTimeout', botTimeout, EXPECTED.botTimeout, `${botTimeout}s (${Number(botTimeout) / 60}m)`, `${EXPECTED.botTimeout}s (${Number(EXPECTED.botTimeout) / 60}m)`);
  report('botOperator', botOperator, EXPECTED.botOperator);

  console.log(`currentWeek      : ${currentWeek} (ISO week integer: ${currentWeek})`);
  console.log('-'.repeat(70));

  if (!allPassed) {
    console.error('ERROR: One or more settings do not match expected values!');
    process.exit(1);
  } else {
    console.log('SUCCESS: All contract parameters match expected values exactly.');
  }
}

main().catch(err => {
  console.error(`Execution failed: ${err.message ?? err}`);
  process.exit(1);
});
