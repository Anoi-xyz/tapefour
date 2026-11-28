// test/test_wallet_picker.ts
// Unit tests for EIP-6963 Multi-Injected Wallet Discovery, Selection,
// Gas Enforcement, Disconnection, and OKX Wallet Detection & Install Row.

import { WalletManager, createOkxInstallRow, OKX_DOWNLOAD_URL } from '../web/wallet.js';

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

// Mock browser DOM and global environment for Node.js
class MockElement {
  tagName: string;
  className = '';
  textContent = '';
  innerHTML = '';
  href = '';
  target = '';
  rel = '';
  src = '';
  alt = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  children: MockElement[] = [];
  listeners: Record<string, Function[]> = {};
  attributes: Record<string, string> = {};

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
  setAttribute(name: string, val: string) {
    this.attributes[name] = val;
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
  replaceWith(newEl: MockElement) {
    // noop
  }
  querySelector(sel: string) {
    return new MockElement('div');
  }
  querySelectorAll(sel: string) {
    return [];
  }
  classList = {
    add: (cls: string) => {
      if (!this.className.includes(cls)) this.className += ` ${cls}`;
    },
    remove: (cls: string) => {
      this.className = this.className.replace(cls, '').trim();
    },
    contains: (cls: string) => this.className.includes(cls),
  };
}

function setupMockBrowser() {
  const eventListeners: Record<string, Function[]> = {};
  const mockStorage: Record<string, string> = {};

  const mockWindow: any = {
    location: { hash: '#ranked' },
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
    TAPEFOUR_CONFIG: {
      chainId: 196,
      rpcUrl: 'https://rpc.xlayer.tech',
      contractAddress: '0x1c319c3bcb9ed1c35507f029c8e7152ab0590c04',
      botOperator: '0x3318600906c5f72b02be32aad973de8e206add41',
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

  const elementsById: Record<string, MockElement> = {};
  const mockDocument: any = {
    createElement: (tag: string) => new MockElement(tag),
    getElementById: (id: string) => {
      if (!elementsById[id]) elementsById[id] = new MockElement('div');
      return elementsById[id];
    },
    querySelector: (sel: string) => new MockElement('div'),
    querySelectorAll: (sel: string) => [],
    addEventListener: () => {},
  };

  (globalThis as any).Worker = class MockWorker {
    postMessage() {}
    terminate() {}
    onmessage = null;
  };
  (globalThis as any).window = mockWindow;
  (globalThis as any).document = mockDocument;
  (globalThis as any).localStorage = mockLocalStorage;
  (globalThis as any).sessionStorage = mockLocalStorage;
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

  return { mockWindow, mockLocalStorage, mockDocument };
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

  // Crucial check: Provider 1 (MetaMask) and OKX must NEVER be called
  if (provider1.calls.length !== 0) {
    throw new Error(`Provider 1 (MetaMask) was called ${provider1.calls.length} times, expected 0!`);
  }
  if (providerOKX.calls.length !== 0) {
    throw new Error(`Provider OKX was called ${providerOKX.calls.length} times, expected 0!`);
  }
  console.log('  PASS: Provider 2 (Zerion) was used exclusively; Provider 1 & OKX called 0 times.');
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

  // ---------------------------------------------------------------------------
  // Dedicated OKX Wallet Tests (Requirements 1, 2, 3, 5)
  // ---------------------------------------------------------------------------

  // Test 6: OKX announced via EIP-6963
  console.log('Test 6: OKX Wallet announced via EIP-6963');
  {
    delete (window as any).okxwallet;
    const pMM = createMockProvider('0xaaa111');
    const pOKX = createMockProvider('0xbbb222');
    const wm6963 = new WalletManager({ chainId: 196 });
    wm6963.initDiscovery();

    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: {
        info: { uuid: 'u-mm', name: 'MetaMask', icon: '', rdns: 'io.metamask' },
        provider: pMM,
      }
    }));
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: {
        info: { uuid: 'u-okx', name: 'OKX Wallet', icon: '', rdns: 'com.okex.wallet' },
        provider: pOKX,
      }
    }));

    const wallets = wm6963.getDiscoveredWallets();
    if (wallets.length !== 2) throw new Error(`Expected 2 wallets, got ${wallets.length}`);
    const okxItem = wallets.find(w => wm6963.isOkxWallet(w));
    if (!okxItem) throw new Error('OKX Wallet must be in discovered list via 6963');
    if (!wm6963.hasOkxWallet()) throw new Error('hasOkxWallet() must be true');

    // Make sure other wallets still appear and none called until selected
    if (pMM.calls.length !== 0 || pOKX.calls.length !== 0) {
      throw new Error('No provider should be called before selection');
    }

    await wm6963.connect(okxItem);
    if (pOKX.calls.length === 0) throw new Error('Selected OKX provider must be called');
    if (pMM.calls.length !== 0) throw new Error('Unselected provider must have 0 calls');
    console.log('  PASS: OKX announced via 6963 discovered, other wallets present, none called until selected.');
  }

  // Test 7: OKX only via window.okxwallet (legacy injected path)
  console.log('Test 7: OKX Wallet only via window.okxwallet');
  {
    const pMM = createMockProvider('0xaaa111');
    const pOKX = createMockProvider('0xbbb222');
    (window as any).okxwallet = pOKX;

    const wmInjected = new WalletManager({ chainId: 196 });
    wmInjected.initDiscovery();

    // MetaMask announced via 6963, OKX NOT announced via 6963
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: {
        info: { uuid: 'u-mm', name: 'MetaMask', icon: '', rdns: 'io.metamask' },
        provider: pMM,
      }
    }));

    const wallets = wmInjected.getDiscoveredWallets();
    if (wallets.length !== 2) throw new Error(`Expected 2 wallets (MetaMask + OKX), got ${wallets.length}`);
    const okxItem = wallets.find(w => wmInjected.isOkxWallet(w));
    if (!okxItem) throw new Error('OKX Wallet must be discovered via window.okxwallet');
    if (okxItem.provider !== pOKX) throw new Error('OKX provider must match window.okxwallet');
    if (okxItem.info.name !== 'OKX Wallet') throw new Error(`Expected name 'OKX Wallet', got ${okxItem.info.name}`);
    if (!wmInjected.hasOkxWallet()) throw new Error('hasOkxWallet() must be true');

    // Ensure none called until selected
    if (pMM.calls.length !== 0 || pOKX.calls.length !== 0) {
      throw new Error('Providers must not be called until selected');
    }

    await wmInjected.connect(okxItem);
    if (pOKX.calls.length === 0) throw new Error('Selected OKX provider must be called');
    if (pMM.calls.length !== 0) throw new Error('MetaMask must have 0 calls');
    console.log('  PASS: OKX only via window.okxwallet discovered as EIP-1193, other wallets present, none called until selected.');
  }

  // Test 8: OKX announced via 6963 PLUS window.okxwallet (shows once)
  console.log('Test 8: OKX announced via 6963 PLUS window.okxwallet (shows once)');
  {
    const pMM = createMockProvider('0xaaa111');
    const pOKX_announced = createMockProvider('0xbbb222');
    const pOKX_injected = pOKX_announced; // same or related
    (window as any).okxwallet = pOKX_injected;

    const wmBoth = new WalletManager({ chainId: 196 });
    wmBoth.initDiscovery();

    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: {
        info: { uuid: 'u-mm', name: 'MetaMask', icon: '', rdns: 'io.metamask' },
        provider: pMM,
      }
    }));
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: {
        info: { uuid: 'u-okx', name: 'OKX Wallet', icon: '', rdns: 'com.okex.wallet' },
        provider: pOKX_announced,
      }
    }));

    const wallets = wmBoth.getDiscoveredWallets();
    if (wallets.length !== 2) throw new Error(`Expected exactly 2 wallets, got ${wallets.length}`);
    const okxMatches = wallets.filter(w => wmBoth.isOkxWallet(w));
    if (okxMatches.length !== 1) {
      throw new Error(`OKX Wallet must appear exactly once, but appeared ${okxMatches.length} times`);
    }

    if (pMM.calls.length !== 0 || pOKX_announced.calls.length !== 0) {
      throw new Error('Providers must not be called before selection');
    }
    console.log('  PASS: OKX announced via 6963 + window.okxwallet appears exactly once with 0 calls before selection.');
  }

  // Test 9: OKX missing (install row shown, not connectable)
  console.log('Test 9: OKX missing (install row shown, not connectable)');
  {
    delete (window as any).okxwallet;
    delete (window as any).ethereum;

    const pMM = createMockProvider('0xaaa111');
    const pRabby = createMockProvider('0xccc333');

    const wmMissing = new WalletManager({ chainId: 196 });
    wmMissing.initDiscovery();

    // MetaMask and Rabby announced, NO OKX
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: {
        info: { uuid: 'u-mm', name: 'MetaMask', icon: '', rdns: 'io.metamask' },
        provider: pMM,
      }
    }));
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: {
        info: { uuid: 'u-rabby', name: 'Rabby Wallet', icon: '', rdns: 'io.rabby' },
        provider: pRabby,
      }
    }));

    const wallets = wmMissing.getDiscoveredWallets();
    if (wallets.length !== 2) throw new Error(`Expected 2 wallets, got ${wallets.length}`);
    if (wmMissing.hasOkxWallet()) throw new Error('hasOkxWallet() must be false when OKX missing');

    // Make sure other wallets still appear and none called
    if (pMM.calls.length !== 0 || pRabby.calls.length !== 0) {
      throw new Error('Providers must not be called until selected');
    }

    // Verify install row creation
    const installRow = createOkxInstallRow();
    if (installRow.tagName !== 'A') throw new Error(`Expected install row to be <a>, got <${installRow.tagName}>`);
    if (installRow.href !== OKX_DOWNLOAD_URL || !installRow.href.includes('okx.com')) {
      throw new Error(`Expected install row href to point to okx.com download page, got ${installRow.href}`);
    }
    if (installRow.rel !== 'noopener noreferrer') {
      throw new Error(`Expected rel="noopener noreferrer", got "${installRow.rel}"`);
    }
    if (installRow.target !== '_blank') {
      throw new Error(`Expected target="_blank", got "${installRow.target}"`);
    }
    if (!installRow.className.includes('wallet-install-row')) {
      throw new Error('Install row must have class wallet-install-row');
    }

    // Verify it is not connectable (calling connect with it must fail)
    let threw = false;
    try {
      await wmMissing.connect(installRow as any);
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error('Install row must not be connectable via wm.connect()');

    // Other wallets must STILL have 0 calls
    if (pMM.calls.length !== 0 || pRabby.calls.length !== 0) {
      throw new Error('Other wallets must still have 0 calls');
    }

    // Select MetaMask now -> only MetaMask called
    await wmMissing.connect(wallets[0]);
    if (pMM.calls.length === 0) throw new Error('MetaMask should be called after selection');
    if (pRabby.calls.length !== 0) throw new Error('Rabby must have 0 calls');

    console.log('  PASS: When OKX is missing, install row is shown, not connectable, points to official okx.com download, other wallets appear, and none called until selected.');
  }

  // Test 10: Ranked mode wallet connect + operator health error resilience
  console.log('Test 10: Connect wallet in ranked mode with operator health check throwing');
  {
    const originalFetch = (globalThis as any).fetch;
    const originalConsoleError = console.error;
    let loggedErrors: any[] = [];
    console.error = (...args: any[]) => { loggedErrors.push(args); };

    let rpcCalls: any[] = [];
    let shouldRpcThrow = true;

    // Mock RPC fetch
    (globalThis as any).fetch = async (url: any, opts: any) => {
      const body = JSON.parse(opts.body);
      rpcCalls.push(body);
      if (shouldRpcThrow && body.method === 'eth_getBalance') {
        throw new Error('RPC connection failure: 503 Service Unavailable');
      }
      return {
        json: async () => ({ jsonrpc: '2.0', id: body.id ?? 1, result: '0x0' }),
      } as any;
    };

    const { ConnectFourApp } = await import('../web/app.js');
    const app = new ConnectFourApp();
    app.enterRankedMode();

    const pUser = createMockProvider('0x4444444444444444444444444444444444444444');
    const walletDetail = {
      info: { uuid: 'u-user', name: 'MetaMask', icon: '', rdns: 'io.metamask' },
      provider: pUser,
    };

    // Connect wallet in ranked mode while RPC health check throws
    await app.handleSelectWallet(walletDetail);

    // 1. Check health check ran (eth_getBalance was called in RPC)
    const balanceCall = rpcCalls.find((c: any) => c.method === 'eth_getBalance');
    if (!balanceCall) {
      throw new Error('Operator health check was not called during wallet connection');
    }

    // 2. Check wallet stays connected despite health check throwing
    if (app.walletAddress !== '0x4444444444444444444444444444444444444444') {
      throw new Error(`Wallet address was not preserved; got ${app.walletAddress}`);
    }
    if (app.rankedStatusMsg.textContent.includes('Connection failed')) {
      throw new Error(`Status message should not show connection failure, got: ${app.rankedStatusMsg.textContent}`);
    }
    if (!app.rankedStatusMsg.textContent.includes('Connected with MetaMask')) {
      throw new Error(`Status message should indicate successful connection, got: ${app.rankedStatusMsg.textContent}`);
    }

    // 3. Check badge shows "unknown" with retry action
    if (!app.operatorBadge.className.includes('unknown')) {
      throw new Error(`Operator badge class should contain "unknown", got: ${app.operatorBadge.className}`);
    }
    if (!app.operatorBadge.innerHTML.includes('Operator: unknown')) {
      throw new Error(`Operator badge text/html should be "Operator: unknown", got: ${app.operatorBadge.innerHTML}`);
    }
    const retryBtn = app.operatorBadge.children.find((c: any) => c.className === 'operator-retry-btn');
    if (!retryBtn) {
      throw new Error('Operator badge should have a retry button element');
    }

    // 4. Test retry with healthy operator balance -> transitions to online
    shouldRpcThrow = false;
    (globalThis as any).fetch = async (url: any, opts: any) => {
      const body = JSON.parse(opts.body);
      return {
        json: async () => ({
          jsonrpc: '2.0',
          id: body.id ?? 1,
          result: body.method === 'eth_getBalance' ? '0x6f05b59d3b20000' : '0x0', // 0.5 OKB
        }),
      } as any;
    };

    await app.checkOperatorHealth();
    if (!app.operatorBadge.className.includes('online')) {
      throw new Error(`Operator badge should update to "online" after healthy retry, got: ${app.operatorBadge.className}`);
    }
    if (!app.operatorBadge.innerHTML.includes('Operator: Online')) {
      throw new Error(`Operator badge should show "Operator: Online", got: ${app.operatorBadge.innerHTML}`);
    }

    // Restore original fetch and console.error
    (globalThis as any).fetch = originalFetch;
    console.error = originalConsoleError;

    console.log('  PASS: Health check runs, wallet stays connected when health check throws, badge shows "unknown" with retry, and updates to "online" on success.');
  }

  console.log('-'.repeat(70));
  console.log('ALL WALLET PICKER & DISCONNECT TESTS PASSED SUCCESSFULLY.');
  console.log('='.repeat(70));
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
