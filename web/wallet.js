// web/wallet.js
// EIP-6963 Multi Injected Provider Discovery & Connection Manager
// Supports MetaMask, Rabby, OKX, Zerion, Bitget, Binance, Coinbase, Trust, Phantom, etc.

export const FALLBACK_WALLET_ICON = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="%2300d2ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`;

export const WALLET_ICONS = {
  'com.okex.wallet': `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><rect width="28" height="28" rx="6" fill="%23000000"/><rect x="5" y="5" width="6" height="6" fill="%23ffffff"/><rect x="17" y="5" width="6" height="6" fill="%23ffffff"/><rect x="11" y="11" width="6" height="6" fill="%23ffffff"/><rect x="5" y="17" width="6" height="6" fill="%23ffffff"/><rect x="17" y="17" width="6" height="6" fill="%23ffffff"/></svg>`,
  'io.metamask': `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="%23ffffff"/><path d="m27.2 6.6-8.9 4-1.9-4.5z" fill="%23e17726"/><path d="m4.8 6.6 8.8 4 2-4.5z" fill="%23e27625"/><path d="m23.5 21.6-2.5 3.9 5.3 1.5 1.5-5.3z" fill="%23e27625"/><path d="m4.2 21.7 1.5 5.3 5.3-1.5-2.5-3.9z" fill="%23e27625"/><path d="m10.7 14.2-2.1 3.1 5.3.3-.2-5.7z" fill="%23e27625"/><path d="m21.3 14.2-3.1-2.4-.1 5.7 5.3-.3z" fill="%23e27625"/></svg>`,
  'io.rabby': `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><rect width="28" height="28" rx="6" fill="%238697FF"/><circle cx="14" cy="14" r="7" fill="%23ffffff"/></svg>`,
  'app.zerion': `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><rect width="28" height="28" rx="6" fill="%232962FF"/><path d="M7 9h14l-8 10h8" stroke="%23ffffff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

export class WalletManager {
  constructor(options = {}) {
    this.chainId = options.chainId ?? 196;
    this.rpcUrl = options.rpcUrl ?? 'https://rpc.xlayer.tech';
    this.storageKey = 'tapefour_last_wallet_rdns';

    this.discoveredWallets = new Map();
    this.chosenWallet = null;
    this.chosenProvider = null;
    this.walletAddress = null;

    this.accountListener = null;
    this.chainListener = null;

    this.onAccountsChanged = null;
    this.onChainChanged = null;

    this.isDiscoveryInitialized = false;
  }

  /**
   * Initializes EIP-6963 provider announcement listener and requests providers.
   */
  initDiscovery() {
    if (this.isDiscoveryInitialized || typeof window === 'undefined') return;
    this.isDiscoveryInitialized = true;

    window.addEventListener('eip6963:announceProvider', (event) => {
      this.handleAnnounce(event?.detail);
    });

    try {
      window.dispatchEvent(new Event('eip6963:requestProvider'));
    } catch (e) {
      // In non-browser or mock environments
    }
  }

  /**
   * Records an announced provider from EIP-6963.
   */
  handleAnnounce(detail) {
    if (!detail || !detail.info || !detail.provider) return;
    const rdns = detail.info.rdns || '';
    const key = rdns || detail.info.uuid || detail.info.name;
    const icon = detail.info.icon || WALLET_ICONS[rdns] || FALLBACK_WALLET_ICON;

    this.discoveredWallets.set(key, {
      info: {
        uuid: detail.info.uuid || key,
        name: detail.info.name || 'Unnamed Wallet',
        icon,
        rdns: rdns || key,
      },
      provider: detail.provider,
    });
  }

  /**
   * Returns a complete list of all discovered wallets (EIP-6963 + window.okxwallet + legacy injected fallback),
   * flagged with isLastUsed if matching the last used wallet identifier.
   */
  getDiscoveredWallets() {
    // Request again in case late-loading wallet extensions just injected
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new Event('eip6963:requestProvider'));
      } catch (e) {}
    }

    const result = new Map(this.discoveredWallets);

    // Specifically inspect window.okxwallet for OKX Wallet extension
    if (typeof window !== 'undefined' && window.okxwallet && typeof window.okxwallet.request === 'function') {
      const okxRdns = 'com.okex.wallet';
      let alreadyExists = false;
      for (const item of result.values()) {
        if (item.provider === window.okxwallet || item.info.rdns === okxRdns) {
          alreadyExists = true;
          break;
        }
      }
      if (!alreadyExists) {
        result.set(okxRdns, {
          info: {
            uuid: 'injected-okxwallet',
            name: 'OKX Wallet',
            icon: WALLET_ICONS[okxRdns] || FALLBACK_WALLET_ICON,
            rdns: okxRdns,
          },
          provider: window.okxwallet,
        });
      }
    }

    // Fallback: inspect window.ethereum / window.ethereum.providers for legacy extensions
    if (typeof window !== 'undefined' && window.ethereum) {
      const providers = Array.isArray(window.ethereum.providers)
        ? window.ethereum.providers
        : [window.ethereum];

      for (let i = 0; i < providers.length; i++) {
        const p = providers[i];
        if (!p || typeof p.request !== 'function') continue;

        const name = this.identifyProviderName(p);
        const rdns = this.identifyProviderRdns(p) || `injected.${name.toLowerCase().replace(/\s+/g, '')}`;

        // If not already discovered via EIP-6963 or window.okxwallet
        if (!result.has(rdns)) {
          let alreadyExists = false;
          for (const item of result.values()) {
            if (item.provider === p) {
              alreadyExists = true;
              break;
            }
          }
          if (!alreadyExists) {
            result.set(rdns, {
              info: {
                uuid: `legacy-${i}-${rdns}`,
                name,
                icon: WALLET_ICONS[rdns] || FALLBACK_WALLET_ICON,
                rdns,
              },
              provider: p,
            });
          }
        }
      }
    }

    const lastUsedRdns = this.getLastUsedWalletId();
    const list = Array.from(result.values()).map(w => ({
      ...w,
      isLastUsed: Boolean(lastUsedRdns && (w.info.rdns === lastUsedRdns || w.info.name === lastUsedRdns)),
    }));

    // Put last used wallet first
    list.sort((a, b) => (b.isLastUsed ? 1 : 0) - (a.isLastUsed ? 1 : 0));
    return list;
  }

  identifyProviderName(p) {
    if (p.isOKExWallet || p.isOkxWallet || p.isOkx) return 'OKX Wallet';
    if (p.isRabby) return 'Rabby Wallet';
    if (p.isZerion) return 'Zerion';
    if (p.isBitKeep || p.isBitget) return 'Bitget Wallet';
    if (p.isCoinbaseWallet) return 'Coinbase Wallet';
    if (p.isTrust || p.isTrustWallet) return 'Trust Wallet';
    if (p.isPhantom) return 'Phantom';
    if (p.isBraveWallet) return 'Brave Wallet';
    if (p.isBinance || p.isBinanceWallet) return 'Binance Web3 Wallet';
    if (p.isMetaMask) return 'MetaMask';
    return 'Browser Injected Wallet';
  }

  identifyProviderRdns(p) {
    if (p.isOKExWallet || p.isOkxWallet || p.isOkx) return 'com.okex.wallet';
    if (p.isRabby) return 'io.rabby';
    if (p.isZerion) return 'app.zerion';
    if (p.isBitKeep || p.isBitget) return 'com.bitget.web3';
    if (p.isCoinbaseWallet) return 'com.coinbase.wallet';
    if (p.isTrust || p.isTrustWallet) return 'com.trustwallet.app';
    if (p.isPhantom) return 'app.phantom';
    if (p.isMetaMask) return 'io.metamask';
    return null;
  }

  getLastUsedWalletId() {
    try {
      return localStorage.getItem(this.storageKey);
    } catch (e) {
      return null;
    }
  }

  setLastUsedWalletId(id) {
    try {
      localStorage.setItem(this.storageKey, id);
    } catch (e) {}
  }

  /**
   * Connects to a specific chosen wallet.
   * Does NOT auto-connect; only called upon explicit user click on a wallet item.
   */
  async connect(walletDetail) {
    if (!walletDetail || !walletDetail.provider) {
      throw new Error('Invalid wallet detail provided');
    }

    // Clean up previous listeners if switching
    this.removeCurrentListeners();

    this.chosenWallet = walletDetail;
    this.chosenProvider = walletDetail.provider;

    // Request accounts from the chosen provider
    const accounts = await this.chosenProvider.request({
      method: 'eth_requestAccounts',
    });

    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts authorized by user');
    }

    this.walletAddress = accounts[0];
    this.setLastUsedWalletId(walletDetail.info.rdns || walletDetail.info.name);

    // Switch/Add chain to X Layer (196) on the chosen provider
    await this.switchChain(this.chainId, this.rpcUrl);

    // Attach listeners strictly to the chosen provider
    this.accountListener = (accs) => {
      if (accs && accs.length > 0) {
        this.walletAddress = accs[0];
      } else {
        this.walletAddress = null;
      }
      this.onAccountsChanged?.(accs);
    };

    this.chainListener = (cid) => {
      this.onChainChanged?.(cid);
    };

    if (typeof this.chosenProvider.on === 'function') {
      this.chosenProvider.on('accountsChanged', this.accountListener);
      this.chosenProvider.on('chainChanged', this.chainListener);
    }

    return {
      address: this.walletAddress,
      provider: this.chosenProvider,
      wallet: this.chosenWallet,
    };
  }

  /**
   * Switches to target chain ID on the chosen provider with wallet_addEthereumChain fallback.
   */
  async switchChain(targetChainId = 196, rpcUrl = 'https://rpc.xlayer.tech') {
    if (!this.chosenProvider) return;
    const hexChainId = '0x' + targetChainId.toString(16);

    try {
      await this.chosenProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexChainId }],
      });
    } catch (switchErr) {
      const isUnrecognized =
        switchErr?.code === 4902 ||
        switchErr?.data?.originalError?.code === 4902 ||
        /unrecognized|not found|unknown/i.test(switchErr?.message || '');

      if (isUnrecognized) {
        await this.chosenProvider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: hexChainId,
            chainName: 'X Layer Mainnet',
            nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
            rpcUrls: [rpcUrl],
            blockExplorerUrls: ['https://www.oklink.com/xlayer'],
          }],
        });
      } else {
        throw switchErr;
      }
    }
  }

  /**
   * Queries the current chain ID from the chosen provider.
   */
  async getChainId() {
    if (!this.chosenProvider) return null;
    try {
      const hex = await this.chosenProvider.request({ method: 'eth_chainId' });
      return parseInt(hex, 16);
    } catch (e) {
      return null;
    }
  }

  /**
   * Sends a transaction via the chosen provider with an explicit gas limit.
   */
  async sendTransaction(txParams, explicitGasLimit = null) {
    if (!this.chosenProvider || !this.walletAddress) {
      throw new Error('No wallet connected');
    }

    const params = {
      from: this.walletAddress,
      to: txParams.to,
      data: txParams.data,
      value: txParams.value || '0x0',
    };

    if (explicitGasLimit) {
      params.gas =
        typeof explicitGasLimit === 'string' && explicitGasLimit.startsWith('0x')
          ? explicitGasLimit
          : '0x' + BigInt(explicitGasLimit).toString(16);
    }

    try {
      const txHash = await this.chosenProvider.request({
        method: 'eth_sendTransaction',
        params: [params],
      });
      return txHash;
    } catch (err) {
      throw this.formatError(err);
    }
  }

  /**
   * Formats wallet errors into clean, user-friendly messages distinguishing
   * user cancellations from simulation / 403 / network errors.
   */
  formatError(err) {
    const msg = err?.message || String(err);
    const code = err?.code;

    // User rejection (EIP-1193 4001 or rejection text)
    if (code === 4001 || /user rejected|rejected|denied|declined|canceled|User denied/i.test(msg)) {
      const e = new Error('Transaction was canceled in your wallet.');
      e.isUserRejection = true;
      e.originalError = err;
      return e;
    }

    // Zerion 403 simulation or RPC rejection
    if (code === 403 || /403|status code 403|forbidden/i.test(msg)) {
      const e = new Error(
        'Wallet simulation or RPC rejected (HTTP 403). Ensure your wallet is connected to X Layer with sufficient OKB for gas.'
      );
      e.isSimulationError = true;
      e.originalError = err;
      return e;
    }

    return err;
  }

  removeCurrentListeners() {
    if (this.chosenProvider && typeof this.chosenProvider.removeListener === 'function') {
      if (this.accountListener) {
        this.chosenProvider.removeListener('accountsChanged', this.accountListener);
      }
      if (this.chainListener) {
        this.chosenProvider.removeListener('chainChanged', this.chainListener);
      }
    }
    this.accountListener = null;
    this.chainListener = null;
  }

  /**
   * Disconnects the wallet:
   * - Removes event listeners
   * - Clears wallet and provider references
   * - Attempts wallet_revokePermissions where supported (ignoring failures)
   * - Does NOT wipe the last-used label or session keys
   */
  async disconnect() {
    const provider = this.chosenProvider;
    this.removeCurrentListeners();

    if (provider && typeof provider.request === 'function') {
      try {
        await provider.request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }],
        });
      } catch (e) {
        // Silently ignore if wallet doesn't support revokePermissions
      }
    }

    this.chosenWallet = null;
    this.chosenProvider = null;
    this.walletAddress = null;
  }
}
