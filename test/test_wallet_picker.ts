// test/test_wallet_picker.ts
// Unit tests for EIP-6963 Multi-Injected Wallet Discovery, Selection,
// Gas Enforcement, and Disconnection.

import { WalletManager } from '../web/wallet.js';

interface MockCall {
  method: string;
  params?: any[];
}

function createMockProvider(address: string, chainId: string = '0xc4') {
  const calls: MockCall[] = [];
  const listeners: Record<string, Function[]> = {};

  const provider = {
    calls,
    listeners,
    request: async ({ method, params }: { method: string; params?: any[] }) => {
      calls.push({ method, params });
      switch (method) {
        case 'eth_requestAccounts':
          return [address];
        case 'eth_accounts':
          return [address];
        case 'eth_chainId':
          return chainId;
        case 'wallet_switchEthereumChain':
          return null;
        case 'wallet_addEthereumChain':
          return null;
        case 'eth_sendTransaction':
          return '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
        case 'wallet_revokePermissions':
          return null;
        default:
          return null;
      }
    },
    on: (event: string, cb: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    },
    removeListener: (event: string, cb: Function) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(fn => fn !== cb);
      }
    },
  };

  return provider;
}

// Mock browser global environment for Node.js
function setupMockBrowser() {
  const eventListeners: Record<string, Function[]> = {};
  const mockStorage: Record<string, string> = {};

  const mockWindow: any = {
    addEventListener: (event: string, cb: Function) => {
      eventListeners[event] = eventListeners[event] || [];
      eventListeners[event].push(cb);
    },
    removeEventListener: (event: string, cb: Function) => {
      if (eventListeners[event]) {
        eventListeners[event] = eventListeners[event].filter(fn => fn !== cb);
      }
    },
    dispatchEvent: (event: any) => {
      const type = event?.type || event;
      const fns = eventListeners[type] || [];
      for (const fn of fns) {
        fn(event);
      }
      return true;
    },
  };

  const mockLocalStorage = {
    getItem: (k: string) => mockStorage[k] ?? null,
    setItem: (k: string, v: string) => { mockStorage[k] = v; },
    removeItem: (k: string) => { delete mockStorage[k]; },
    clear: () => {
      for (const k of Object.keys(mockStorage)) delete mockStorage[k];
    },
  };

  (globalThis as any).window = mockWindow;
  (globalThis as any).localStorage = mockLocalStorage;
  (globalThis as any).Event = class Event {
    type: string;
    constructor(type: string) { this.type = type; }
  };
  (globalThis as any).CustomEvent = class CustomEvent {
    type: string;
    detail: any;
    constructor(type: string, opts: any) {
      this.type = type;
      this.detail = opts?.detail;
    }
  };

  return { mockWindow, mockLocalStorage };
}

async function runTests() {
  console.log('='.repeat(70));
  console.log('Running EIP-6963 Wallet Picker & Disconnect Tests');
  console.log('='.repeat(70));

  setupMockBrowser();

  const provider1 = createMockProvider('0x1111111111111111111111111111111111111111');
  const provider2 = createMockProvider('0x2222222222222222222222222222222222222222');
  const providerOKX = createMockProvider('0x3333333333333333333333333333333333333333');

  const wallet1Detail = {
    info: {
      uuid: 'uuid-wallet-1',
      name: 'MetaMask',
      icon: 'data:image/svg+xml;base64,metamask',
      rdns: 'io.metamask',
    },
    provider: provider1,
  };

  const wallet2Detail = {
    info: {
      uuid: 'uuid-wallet-2',
      name: 'Zerion',
      icon: 'data:image/svg+xml;base64,zerion',
      rdns: 'app.zerion',
    },
    provider: provider2,
  };

  const walletOKXDetail = {
    info: {
      uuid: 'uuid-wallet-okx',
      name: 'OKX Wallet',
      icon: 'data:image/svg+xml;base64,okx',
      rdns: 'com.okex.wallet',
    },
    provider: providerOKX,
  };

  const wm = new WalletManager({ chainId: 196, rpcUrl: 'https://rpc.xlayer.tech' });

  // 1. Discovery Test
  console.log('Test 1: EIP-6963 Provider Announcement and Discovery (including OKX Wallet)');
  wm.initDiscovery();

  // Simulate wallets announcing via eip6963:announceProvider
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: wallet1Detail }));
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: wallet2Detail }));
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: walletOKXDetail }));

  const discovered = wm.getDiscoveredWallets();
  if (discovered.length !== 3) {
    throw new Error(`Expected 3 discovered wallets, got ${discovered.length}`);
  }
  if (!discovered.some(w => w.info.name === 'OKX Wallet') ||
      !discovered.some(w => w.info.name === 'MetaMask') ||
      !discovered.some(w => w.info.name === 'Zerion')) {
    throw new Error('MetaMask, Zerion, and OKX Wallet must all be in discovered list');
  }
  console.log('  PASS: All wallets (including OKX Wallet) discovered via EIP-6963 announcements.');

  // 2. Selection & Isolation Test
  console.log('Test 2: Select Second Wallet (Zerion) & Check Provider Isolation');
  const zerionWallet = discovered.find(w => w.info.name === 'Zerion')!;
  const connResult = await wm.connect(zerionWallet);

  if (connResult.address !== '0x2222222222222222222222222222222222222222') {
    throw new Error(`Expected connected address to be Zerion address, got ${connResult.address}`);
  }

  // Submit transaction with explicit gas limit
  const txHash = await wm.sendTransaction(
    { to: '0x1c319c3bcb9ed1c35507f029c8e7152ab0590c04', data: '0x5d4d794d', value: '0x11c37937e08000' },
    300000 // explicit gas limit
  );

  if (!txHash) throw new Error('Transaction hash should be returned');

  // Verify Provider 2 (Zerion) received eth_requestAccounts, wallet_switchEthereumChain, and eth_sendTransaction
  const p2Methods = provider2.calls.map(c => c.method);
  if (!p2Methods.includes('eth_requestAccounts')) throw new Error('Provider 2 should have received eth_requestAccounts');
  if (!p2Methods.includes('wallet_switchEthereumChain')) throw new Error('Provider 2 should have received wallet_switchEthereumChain');
  if (!p2Methods.includes('eth_sendTransaction')) throw new Error('Provider 2 should have received eth_sendTransaction');

  const sendCall = provider2.calls.find(c => c.method === 'eth_sendTransaction');
  if (sendCall?.params?.[0]?.gas !== '0x493e0') { // 300000 in hex is 0x493e0
    throw new Error(`Expected explicit gas 0x493e0, got ${sendCall?.params?.[0]?.gas}`);
  }

  // Crucial check: Provider 1 (MetaMask) must NEVER be called
  if (provider1.calls.length !== 0) {
    throw new Error(`Provider 1 (MetaMask) was called ${provider1.calls.length} times, expected 0!`);
  }
  console.log('  PASS: Provider 2 (Zerion) was used exclusively; Provider 1 was called 0 times.');
  console.log('  PASS: Explicit gas limit (0x493e0 / 300k gas) was forwarded in eth_sendTransaction.');

  // 3. Disconnect Test
  console.log('Test 3: Disconnect & State Reset');
  if (!provider2.listeners['accountsChanged'] || provider2.listeners['accountsChanged'].length === 0) {
    throw new Error('accountsChanged listener should have been attached');
  }

  await wm.disconnect();

  if (wm.walletAddress !== null) throw new Error('walletAddress should be null after disconnect');
  if (wm.chosenProvider !== null) throw new Error('chosenProvider should be null after disconnect');
  if (wm.chosenWallet !== null) throw new Error('chosenWallet should be null after disconnect');

  // Check wallet_revokePermissions was attempted on Provider 2
  const hasRevoke = provider2.calls.some(c => c.method === 'wallet_revokePermissions');
  if (!hasRevoke) throw new Error('wallet_revokePermissions should have been attempted');

  // Check listeners were detached
  if (provider2.listeners['accountsChanged'] && provider2.listeners['accountsChanged'].length > 0) {
    throw new Error('accountsChanged listener should have been removed');
  }
  if (provider2.listeners['chainChanged'] && provider2.listeners['chainChanged'].length > 0) {
    throw new Error('chainChanged listener should have been removed');
  }
  console.log('  PASS: Disconnect cleared state, detached listeners, and called wallet_revokePermissions.');

  // 4. "Last Used" Label & No Auto-Connect Test
  console.log('Test 4: Last Used Label Preservation without Auto-Connect');
  const lastUsedRdns = wm.getLastUsedWalletId();
  if (lastUsedRdns !== 'app.zerion') {
    throw new Error(`Expected last used rdns to be 'app.zerion', got '${lastUsedRdns}'`);
  }

  // Fresh discovery list check: Zerion should have isLastUsed = true, MetaMask false
  const freshList = wm.getDiscoveredWallets();
  const zerionFresh = freshList.find(w => w.info.name === 'Zerion')!;
  const metamaskFresh = freshList.find(w => w.info.name === 'MetaMask')!;

  if (!zerionFresh.isLastUsed) throw new Error('Zerion should have isLastUsed === true');
  if (metamaskFresh.isLastUsed) throw new Error('MetaMask should have isLastUsed === false');
  if (wm.walletAddress !== null) throw new Error('Wallet must NOT auto-connect on load/discovery');
  console.log('  PASS: Last used wallet properly identified without auto-connecting.');

  // 5. Error Classification Test (User Rejection vs. 403 / Simulation)
  console.log('Test 5: Error Classification (User Rejection vs Zerion 403)');
  const rejectErr = wm.formatError({ code: 4001, message: 'User rejected the transaction' });
  if (!(rejectErr as any).isUserRejection) throw new Error('Error with code 4001 must be flagged as isUserRejection');
  if (rejectErr.message !== 'Transaction was canceled in your wallet.') {
    throw new Error(`Unexpected user rejection message: ${rejectErr.message}`);
  }

  const simErr = wm.formatError({ code: 403, message: 'Request failed with status code 403' });
  if (!(simErr as any).isSimulationError) throw new Error('Error with 403 must be flagged as isSimulationError');
  if (!simErr.message.includes('Wallet simulation or RPC rejected (HTTP 403)')) {
    throw new Error(`Unexpected simulation message: ${simErr.message}`);
  }
  console.log('  PASS: User rejections and 403 simulation errors correctly parsed with user-friendly messages.');

  // 6. OKX Wallet dedicated window.okxwallet injection test
  console.log('Test 6: Dedicated window.okxwallet injection fallback');
  (window as any).okxwallet = createMockProvider('0x3333333333333333333333333333333333333333');
  const freshWM = new WalletManager({ chainId: 196 });
  const okxDiscovered = freshWM.getDiscoveredWallets();
  const okxWallet = okxDiscovered.find(w => w.info.name === 'OKX Wallet');
  if (!okxWallet) throw new Error('OKX Wallet should be discovered via window.okxwallet fallback');
  if (okxWallet.info.rdns !== 'com.okex.wallet') throw new Error('OKX Wallet rdns should be com.okex.wallet');
  const okxConn = await freshWM.connect(okxWallet);
  if (okxConn.address !== '0x3333333333333333333333333333333333333333') throw new Error('Connected to OKX Wallet');
  console.log('  PASS: OKX Wallet discovered via window.okxwallet and successfully connected.');

  console.log('-'.repeat(70));
  console.log('ALL WALLET PICKER & DISCONNECT TESTS PASSED SUCCESSFULLY.');
  console.log('='.repeat(70));
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
