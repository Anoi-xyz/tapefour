// test/test_abi_and_preflight.ts
// Verifies generated ABI selectors against Hardhat TapeFour artifact,
// checks calldata byte encodings, and tests preflight simulation (eth_call / eth_estimateGas).

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { toFunctionSelector, encodeFunctionData, type AbiFunction } from 'viem';
import {
  SELECTORS,
  encodeStartRanked,
  encodePlayMove,
  encodePlayBotMove,
  encodeClaimBotTimeout,
  encodeClaimForfeit,
  encodeLockWeeklyPool,
  encodeClaimPrize,
  encodeGames,
  decodeRevertReason,
} from '../web/abi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Setup DOM mock for ConnectFourApp test
class MockElement {
  tagName: string;
  className = '';
  textContent = '';
  innerHTML = '';
  style: Record<string, string> = {};
  children: MockElement[] = [];
  listeners: Record<string, Function[]> = {};
  attributes: Record<string, string> = {};
  dataset: Record<string, string> = {};

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }
  appendChild(child: MockElement) {
    this.children.push(child);
    return child;
  }
  addEventListener(evt: string, cb: Function) {
    this.listeners[evt] = this.listeners[evt] || [];
    this.listeners[evt].push(cb);
  }
  setAttribute(k: string, v: string) { this.attributes[k] = v; }
  getAttribute(k: string) { return this.attributes[k] ?? null; }
  querySelector() { return new MockElement('div'); }
  querySelectorAll() { return []; }
  classList = {
    add: (cls: string) => { if (!this.className.includes(cls)) this.className += ` ${cls}`; },
    remove: (cls: string) => { this.className = this.className.replace(cls, '').trim(); },
    contains: (cls: string) => this.className.includes(cls),
  };
}

function setupMockEnv() {
  const elementsById: Record<string, MockElement> = {};
  const mockStorage: Record<string, string> = {};
  const mockDoc: any = {
    createElement: (tag: string) => new MockElement(tag),
    getElementById: (id: string) => {
      if (!elementsById[id]) elementsById[id] = new MockElement('div');
      return elementsById[id];
    },
    querySelector: () => new MockElement('div'),
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  const mockWin: any = {
    location: { hash: '' },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    TAPEFOUR_CONFIG: {
      chainId: 196,
      rpcUrl: 'https://rpc.xlayer.tech',
      contractAddress: '0x1c319c3bcb9ed1c35507f029c8e7152ab0590c04',
      botOperator: '0x3318600906c5f72b02be32aad973de8e206add41',
    },
  };
  (globalThis as any).window = mockWin;
  (globalThis as any).document = mockDoc;
  (globalThis as any).localStorage = {
    getItem: (k: string) => mockStorage[k] ?? null,
    setItem: (k: string, v: string) => { mockStorage[k] = v; },
    removeItem: (k: string) => { delete mockStorage[k]; },
  };
  (globalThis as any).sessionStorage = (globalThis as any).localStorage;
  (globalThis as any).Worker = class {
    postMessage() {}
    terminate() {}
    onmessage = null;
  };
}

async function runTests() {
  console.log('='.repeat(70));
  console.log('Running TapeFour ABI Selector & Preflight Simulation Tests');
  console.log('='.repeat(70));

  // 1. Read compiled Hardhat artifact
  const artifactPath = join(__dirname, '../contracts/artifacts/contracts/TapeFour.sol/TapeFour.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const abi = artifact.abi;

  console.log('Test 1: Assert function selectors against compiled Hardhat artifact');
  const expectedSelectors: Record<string, string> = {
    startRanked:     '0x173bda98',
    playMove:        '0xcdc6317f',
    playBotMove:     '0x112c15b0',
    claimBotTimeout: '0x6fde5f36',
    claimForfeit:    '0xd4c147e2',
    lockWeeklyPool:  '0x68484eea',
    claimPrize:      '0xe67194d2',
    botOperator:     '0xbd15b9c1',
    rankedFee:       '0x2bc2d0e8',
    games:           '0x117a5b90',
  };

  for (const [name, expectedHex] of Object.entries(expectedSelectors)) {
    const fnDef: AbiFunction | undefined = abi.find((x: any) => x.type === 'function' && x.name === name);
    if (!fnDef) throw new Error(`Function ${name} not found in Hardhat artifact ABI!`);
    const canonicalHex = toFunctionSelector(fnDef);
    if (canonicalHex !== expectedHex) {
      throw new Error(`Selector mismatch for ${name}: artifact produces ${canonicalHex}, expected ${expectedHex}`);
    }
    const webHex = (SELECTORS as any)[name];
    if (webHex !== expectedHex) {
      throw new Error(`web/abi.js SELECTORS.${name} is ${webHex}, expected ${expectedHex}`);
    }
  }
  console.log('  PASS: All 10 front-end function selectors match the compiled Hardhat artifact exactly.');

  // 2. Argument Encoding Verification against Viem canonical encoding
  console.log('Test 2: Assert argument encodings match canonical ABI encoding');
  const sampleKey = '0x3318600906c5f72b02be32aad973de8e206add41';
  const sampleGameId = 12345n;
  const sampleCol = 3;
  const sampleWeek = 202648n;

  // startRanked(address)
  const encodedStart = encodeStartRanked(sampleKey);
  const canonicalStart = encodeFunctionData({ abi, functionName: 'startRanked', args: [sampleKey] });
  if (encodedStart.toLowerCase() !== canonicalStart.toLowerCase()) {
    throw new Error(`encodeStartRanked mismatch! Got ${encodedStart}, expected ${canonicalStart}`);
  }

  // playMove(uint256,uint8)
  const encodedMove = encodePlayMove(sampleGameId, sampleCol);
  const canonicalMove = encodeFunctionData({ abi, functionName: 'playMove', args: [sampleGameId, sampleCol] });
  if (encodedMove.toLowerCase() !== canonicalMove.toLowerCase()) {
    throw new Error(`encodePlayMove mismatch! Got ${encodedMove}, expected ${canonicalMove}`);
  }

  // playBotMove(uint256,uint8)
  const encodedBotMove = encodePlayBotMove(sampleGameId, sampleCol);
  const canonicalBotMove = encodeFunctionData({ abi, functionName: 'playBotMove', args: [sampleGameId, sampleCol] });
  if (encodedBotMove.toLowerCase() !== canonicalBotMove.toLowerCase()) {
    throw new Error(`encodePlayBotMove mismatch! Got ${encodedBotMove}, expected ${canonicalBotMove}`);
  }

  // claimBotTimeout(uint256)
  const encodedTimeout = encodeClaimBotTimeout(sampleGameId);
  const canonicalTimeout = encodeFunctionData({ abi, functionName: 'claimBotTimeout', args: [sampleGameId] });
  if (encodedTimeout.toLowerCase() !== canonicalTimeout.toLowerCase()) {
    throw new Error(`encodeClaimBotTimeout mismatch! Got ${encodedTimeout}, expected ${canonicalTimeout}`);
  }

  // claimForfeit(uint256)
  const encodedForfeit = encodeClaimForfeit(sampleGameId);
  const canonicalForfeit = encodeFunctionData({ abi, functionName: 'claimForfeit', args: [sampleGameId] });
  if (encodedForfeit.toLowerCase() !== canonicalForfeit.toLowerCase()) {
    throw new Error(`encodeClaimForfeit mismatch! Got ${encodedForfeit}, expected ${canonicalForfeit}`);
  }

  // lockWeeklyPool(uint64)
  const encodedLock = encodeLockWeeklyPool(sampleWeek);
  const canonicalLock = encodeFunctionData({ abi, functionName: 'lockWeeklyPool', args: [sampleWeek] });
  if (encodedLock.toLowerCase() !== canonicalLock.toLowerCase()) {
    throw new Error(`encodeLockWeeklyPool mismatch! Got ${encodedLock}, expected ${canonicalLock}`);
  }

  // claimPrize(uint64)
  const encodedPrize = encodeClaimPrize(sampleWeek);
  const canonicalPrize = encodeFunctionData({ abi, functionName: 'claimPrize', args: [sampleWeek] });
  if (encodedPrize.toLowerCase() !== canonicalPrize.toLowerCase()) {
    throw new Error(`encodeClaimPrize mismatch! Got ${encodedPrize}, expected ${canonicalPrize}`);
  }

  // games(uint256)
  const encodedGamesCall = encodeGames(sampleGameId);
  const canonicalGames = encodeFunctionData({ abi, functionName: 'games', args: [sampleGameId] });
  if (encodedGamesCall.toLowerCase() !== canonicalGames.toLowerCase()) {
    throw new Error(`encodeGames mismatch! Got ${encodedGamesCall}, expected ${canonicalGames}`);
  }

  console.log('  PASS: All argument encodings are byte-identical to viem encodeFunctionData.');

  // 3. Exact Calldata Bytes for confirmStartRanked()
  console.log('Test 3: Verify exact calldata bytes for confirmStartRanked() with sample session key');
  const expectedCalldata = '0x173bda980000000000000000000000003318600906c5f72b02be32aad973de8e206add41';
  if (encodedStart.toLowerCase() !== expectedCalldata.toLowerCase()) {
    throw new Error(`Calldata mismatch! Expected ${expectedCalldata}, got ${encodedStart}`);
  }
  if (encodedStart.length !== 74) {
    throw new Error(`Calldata hex string length must be 74 characters (36 bytes), got ${encodedStart.length}`);
  }
  if (!encodedStart.startsWith('0x173bda98')) {
    throw new Error(`Calldata must begin with 0x173bda98, got ${encodedStart.slice(0, 10)}`);
  }
  if (encodedStart.includes('5d4d794d')) {
    throw new Error('Calldata MUST NOT contain the invalid selector 0x5d4d794d!');
  }
  console.log(`  PASS: Exact calldata bytes verified: ${encodedStart} (36 bytes, starts with 0x173bda98).`);

  // 4. Preflight Simulation & Gas Margin Tests
  console.log('Test 4: Preflight simulation reverts block wallet dispatch & extract revert reason');
  setupMockEnv();

  const { ConnectFourApp } = await import('../web/app.js');
  const app = new ConnectFourApp();
  app.walletAddress = '0x1111111111111111111111111111111111111111';

  let walletTxCalled = false;
  app.sendRankedTx = async () => {
    walletTxCalled = true;
    return '0xtxhash123';
  };

  // 4a. eth_call reverts with encoded string error
  const originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: any, opts: any) => {
    const body = JSON.parse(opts.body);
    if (body.method === 'eth_call') {
      return {
        json: async () => ({
          jsonrpc: '2.0',
          id: body.id,
          error: {
            code: 3,
            message: 'execution reverted: invalid fee amount',
            data: '0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000012696e76616c69642066656520616d6f756e740000000000000000000000000000',
          },
        }),
      } as any;
    }
    return { json: async () => ({ jsonrpc: '2.0', id: body.id, result: '0x0' }) } as any;
  };

  walletTxCalled = false;
  let revertCaught = false;
  try {
    await app.simulateAndSendTx({
      to: '0x1c319c3bcb9ed1c35507f029c8e7152ab0590c04',
      data: encodedStart,
      value: '0x1',
    });
  } catch (err: any) {
    revertCaught = true;
    if (!err.isSimulationRevert) throw new Error('Expected err.isSimulationRevert to be true');
    if (!err.revertReason.includes('invalid fee amount')) {
      throw new Error(`Expected decoded revert reason "invalid fee amount", got "${err.revertReason}"`);
    }
  }
  if (!revertCaught) throw new Error('Expected simulateAndSendTx to throw when eth_call reverts');
  if (walletTxCalled) throw new Error('Wallet sendTransaction MUST NOT be called when preflight reverts!');
  console.log('  PASS: Simulation revert prevented wallet popup and decoded reason "invalid fee amount".');

  // 4b. Preflight succeeds and passes gas estimate + 25% margin to wallet
  console.log('Test 5: Preflight success calculates gas limit with safety margin and prompts wallet');
  let passedGasLimit: bigint | null = null;
  app.sendRankedTx = async (to: string, data: string, value: string, gasLimit: any) => {
    walletTxCalled = true;
    passedGasLimit = BigInt(gasLimit);
    return '0xtxhash456';
  };

  (globalThis as any).fetch = async (url: any, opts: any) => {
    const body = JSON.parse(opts.body);
    if (body.method === 'eth_call') {
      return { json: async () => ({ jsonrpc: '2.0', id: body.id, result: '0x0' }) } as any;
    }
    if (body.method === 'eth_estimateGas') {
      return { json: async () => ({ jsonrpc: '2.0', id: body.id, result: '0x61a80' }) } as any; // 400,000 gas
    }
    return { json: async () => ({ jsonrpc: '2.0', id: body.id, result: '0x0' }) } as any;
  };

  walletTxCalled = false;
  const hash = await app.simulateAndSendTx(
    { to: '0x1c319c3bcb9ed1c35507f029c8e7152ab0590c04', data: encodedStart, value: '0x11c37937e08000' },
    300000
  );

  if (!walletTxCalled) throw new Error('Wallet should be called when preflight succeeds');
  if (hash !== '0xtxhash456') throw new Error(`Expected tx hash 0xtxhash456, got ${hash}`);
  // Estimated 400,000 * 1.25 = 500,000 gas
  if (passedGasLimit !== 500000n) {
    throw new Error(`Expected gas limit with +25% safety margin (500,000), got ${passedGasLimit}`);
  }
  console.log('  PASS: Preflight success estimated gas and forwarded gas limit with +25% safety margin (500,000 gas).');

  (globalThis as any).fetch = originalFetch;

  console.log('-'.repeat(70));
  console.log('ALL ABI AND PREFLIGHT SIMULATION TESTS PASSED.');
  console.log('='.repeat(70));
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
