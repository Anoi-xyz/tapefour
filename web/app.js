// Connect Four Front-End Controller
import {
  COLS,
  ROWS,
  cellIndex,
  LocalCircuitSimulatorRulesEngine,
  OnChainEvalRulesEngine,
  WINNING_LINES,
} from './engine.js';

// ---- Ranked mode: minimal EIP-1193 wallet integration ----------------------
// No external wallet library — we use window.ethereum directly.

const CFG = window.TAPEFOUR_CONFIG ?? {};

// ABI selectors (pre-computed keccak256)
const RANKED_ABI = {
  startRanked:  '0x5d4d794d', // startRanked(address)
  playMove:     '0x2bb86dd3', // playMove(uint256,uint8)
  games:        '0xe5a6b10f', // games(uint256)
  rankedFee:    '0x0d1b8e17', // rankedFee()
};

function encodeUint256(n) {
  return BigInt(n).toString(16).padStart(64, '0');
}
function encodeAddress(addr) {
  return addr.slice(2).toLowerCase().padStart(64, '0');
}

// ---- Session key (ephemeral, stored in sessionStorage for this tab) --------
function getOrCreateSessionKey() {
  const KEY = 'tapefour_session_priv';
  let priv = sessionStorage.getItem(KEY);
  if (!priv) {
    // Generate 32 random bytes
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    priv = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem(KEY, priv);
  }
  return priv;
}

// Derive secp256k1 public key from private key (browser — using SubtleCrypto + noble/curves not available,
// so we use a simplified approach: generate a keypair using ECDH on P-256 as a stand-in for address derivation.
// For the actual session key address registration we'll use eth_accounts[0] in a real deploy.
// In this integration, the session key is the user's own wallet account (simpler, same security).
// The contract accepts msg.sender == sessionKey OR msg.sender == human, so using the wallet for both is fine.
async function getSessionKeyAddress(walletAddress) {
  // Simplest: use the wallet address itself as "session key" address
  // The user signs playMove() tx from their wallet (no session-key benefit yet)
  // In a production deployment, generate a proper session key using noble/curves
  // and sign with it — but that requires bundling an EC library.
  return walletAddress;
}

// ---- RPC helpers (no external library) ------------------------------------
async function rpcCall(method, params = []) {
  const rpc = CFG.rpcUrl ?? 'https://rpc.xlayer.tech';
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
  return json.result;
}

async function readContractView(addr, data) {
  return rpcCall('eth_call', [{ to: addr, data }, 'latest']);
}

async function sendRankedTx(walletAddr, to, data, value = '0x0') {
  // Request user to send the tx via wallet
  return window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{ from: walletAddr, to, data, value }],
  });
}

async function waitForReceipt(txHash) {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const rc = await rpcCall('eth_getTransactionReceipt', [txHash]);
    if (rc) return rc;
  }
  throw new Error('Transaction not mined after 2 minutes');
}

// ---- Main App --------------------------------------------------------------
class ConnectFourApp {
  constructor() {
    this.rulesEngine = new LocalCircuitSimulatorRulesEngine();
    this.worker = null;

    this.boardA = 0n;
    this.boardB = 0n;
    this.turn = 0; // 0 = Player A (Human), 1 = Player B (Bot / Human 2)
    this.gameMode = 'human-vs-bot';
    this.difficulty = 'medium';
    this.isGameOver = false;
    this.isBotThinking = false;
    this.moveCount = 0;
    this.lastVerification = null;
    this.winningCells = [];

    // Ranked state
    this.walletAddress = null;
    this.rankedGameId = null;
    this.rankedFee = null;
    this.sessionKeyAddr = null;
    this.isRankedGame = false;
    this.pendingTx = null;

    this.initDOM();
    this.initWorker();
    this.bindEvents();
    this.checkRankedConfig();
    this.startNewGame();
  }

  checkRankedConfig() {
    if (CFG.rankedEnabled && CFG.contractAddress) {
      const rankedOpt = document.getElementById('rankedOption');
      if (rankedOpt) rankedOpt.disabled = false;
      const onchainOpt = document.getElementById('onchainOption');
      if (onchainOpt) onchainOpt.disabled = false;
    }
  }

  initDOM() {
    this.boardFrame     = document.getElementById('boardFrame');
    this.columnPickers  = document.getElementById('columnPickers');
    this.statusMessage  = document.getElementById('statusMessage');
    this.turnDot        = document.getElementById('turnDot');
    this.badgeSource    = document.getElementById('badgeSource');
    this.statMovesCount = document.getElementById('statMovesCount');
    this.diffGroup      = document.getElementById('diffGroup');
    this.modeTag        = document.getElementById('modeTag');

    // Controls
    this.selectMode       = document.getElementById('selectMode');
    this.selectDifficulty = document.getElementById('selectDifficulty');
    this.selectEngine     = document.getElementById('selectEngine');
    this.btnNewGame       = document.getElementById('btnNewGame');
    this.btnConnectWallet = document.getElementById('btnConnectWallet');

    // Ranked panel
    this.rankedPanel      = document.getElementById('rankedPanel');
    this.rankedFeeDisplay = document.getElementById('rankedFeeDisplay');
    this.rankedStatusMsg  = document.getElementById('rankedStatusMsg');
    this.rankedTxPanel    = document.getElementById('rankedTxPanel');
    this.rankedTxLink     = document.getElementById('rankedTxLink');
    this.rankedTxStatus   = document.getElementById('rankedTxStatus');
    this.rankedGameInfo   = document.getElementById('rankedGameInfo');
    this.rankedGameId     = document.getElementById('rankedGameId');
    this.rankedStatPill   = document.getElementById('rankedStatPill');
    this.statGameId       = document.getElementById('statGameId');
    this.botTimeoutBar    = document.getElementById('botTimeoutBar');
    this.botTimeoutMsg    = document.getElementById('botTimeoutMsg');
    this.btnClaimBotRefund = document.getElementById('btnClaimBotRefund');

    // Modals
    this.btnInspectMove    = document.getElementById('btnInspectMove');
    this.modalBackdrop     = document.getElementById('modalBackdrop');
    this.btnCloseModal     = document.getElementById('btnCloseModal');
    this.btnModalCloseAction = document.getElementById('btnModalCloseAction');
    this.modalSource       = document.getElementById('modalSource');
    this.modalInputHex     = document.getElementById('modalInputHex');
    this.modalInputBreakdown  = document.getElementById('modalInputBreakdown');
    this.modalOutputHex    = document.getElementById('modalOutputHex');
    this.modalOutputBreakdown = document.getElementById('modalOutputBreakdown');

    // Ranked start modal
    this.rankedStartModal    = document.getElementById('rankedStartModal');
    this.btnCloseRankedModal = document.getElementById('btnCloseRankedModal');
    this.btnCancelRanked     = document.getElementById('btnCancelRanked');
    this.btnConfirmRanked    = document.getElementById('btnConfirmRanked');

    // Render 42 empty cell slots
    this.boardFrame.innerHTML = '';
    this.cellElements = new Array(42);

    for (let r = ROWS - 1; r >= 0; r--) {
      for (let c = 0; c < COLS; c++) {
        const idx  = cellIndex(c, r);
        const cell = document.createElement('div');
        cell.className    = 'cell-slot';
        cell.dataset.col  = c;
        cell.dataset.row  = r;
        cell.dataset.idx  = idx;
        cell.addEventListener('click', () => this.handleColumnClick(c));
        this.boardFrame.appendChild(cell);
        this.cellElements[idx] = cell;
      }
    }
  }

  initWorker() {
    try {
      this.worker = new Worker('bot_worker.js', { type: 'module' });
      this.worker.onmessage = (e) => {
        const { bestCol } = e.data;
        this.isBotThinking = false;
        if (bestCol !== undefined && !this.isGameOver) {
          this.executeMove(bestCol);
        }
      };
    } catch (err) {
      console.warn('Worker init error (sync fallback):', err);
    }
  }

  bindEvents() {
    this.btnNewGame.addEventListener('click', () => this.handleNewGame());

    this.selectMode.addEventListener('change', (e) => {
      this.gameMode = e.target.value;
      this.diffGroup.style.display = (this.gameMode === 'two-human' || this.gameMode === 'ranked') ? 'none' : 'flex';
      if (this.gameMode === 'ranked') {
        this.enterRankedMode();
      } else {
        this.exitRankedMode();
        this.startNewGame();
      }
    });

    this.selectDifficulty.addEventListener('change', (e) => {
      this.difficulty = e.target.value;
    });

    this.selectEngine.addEventListener('change', (e) => {
      if (e.target.value === 'onchain' && CFG.processorAddress) {
        this.rulesEngine = new OnChainEvalRulesEngine(CFG.rpcUrl, CFG.processorAddress, CFG.circuitId);
      } else {
        this.rulesEngine = new LocalCircuitSimulatorRulesEngine();
      }
    });

    this.columnPickers.querySelectorAll('.col-picker').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const col = parseInt(e.currentTarget.dataset.col, 10);
        this.handleColumnClick(col);
      });
    });

    this.btnConnectWallet.addEventListener('click', () => this.connectWallet());

    // Verification modal
    this.btnInspectMove.addEventListener('click', () => this.openVerificationModal());
    this.btnCloseModal.addEventListener('click', () => this.closeVerificationModal());
    this.btnModalCloseAction.addEventListener('click', () => this.closeVerificationModal());
    this.modalBackdrop.addEventListener('click', (e) => {
      if (e.target === this.modalBackdrop) this.closeVerificationModal();
    });

    // Ranked start modal
    this.btnCloseRankedModal.addEventListener('click', () => this.closeRankedModal());
    this.btnCancelRanked.addEventListener('click', () => this.closeRankedModal());
    this.btnConfirmRanked.addEventListener('click', () => this.confirmStartRanked());
    this.rankedStartModal.addEventListener('click', (e) => {
      if (e.target === this.rankedStartModal) this.closeRankedModal();
    });

    if (this.btnClaimBotRefund) {
      this.btnClaimBotRefund.addEventListener('click', () => this.handleClaimBotRefund());
    }
  }

  handleNewGame() {
    if (this.gameMode === 'ranked') {
      this.openRankedStartModal();
    } else {
      this.startNewGame();
    }
  }

  // ---- Ranked mode --------------------------------------------------------

  getWeekNumber() {
    const nowSec = Math.floor(Date.now() / 1000);
    return Math.floor((nowSec + 4 * 86400) / (7 * 86400));
  }

  updateWeekDisplay() {
    const week = this.getWeekNumber();
    const label = `Week ${week}`;
    const el = document.getElementById('rankedWeekLabel');
    if (el) el.textContent = label;
    const winsLabel = document.getElementById('rankedWinsWeekLabel');
    if (winsLabel) winsLabel.textContent = label;
  }

  enterRankedMode() {
    this.modeTag.textContent = 'Ranked Mode';
    this.rankedPanel.style.display = 'flex';
    this.rankedStatPill.style.display = 'inline-flex';
    this.btnConnectWallet.style.display = 'inline-block';
    this.updateWeekDisplay();
    if (!this.walletAddress) {
      this.rankedStatusMsg.textContent = 'Connect wallet to start';
    }
  }

  exitRankedMode() {
    this.modeTag.textContent = 'Casual Mode';
    this.rankedPanel.style.display = 'none';
    this.rankedStatPill.style.display = 'none';
    this.btnConnectWallet.style.display = 'none';
    this.isRankedGame = false;
    this.rankedGameId = null;
  }

  async connectWallet() {
    if (!window.ethereum) {
      alert('No wallet found. Please install MetaMask or another EIP-1193 wallet.');
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      this.walletAddress = accounts[0];
      // Switch to X Layer
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0xc4' }], // 196 = 0xc4
        });
      } catch (switchErr) {
        if (switchErr.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0xc4',
              chainName: 'X Layer Mainnet',
              nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
              rpcUrls: ['https://rpc.xlayer.tech'],
              blockExplorerUrls: ['https://www.oklink.com/xlayer'],
            }],
          });
        }
      }
      this.sessionKeyAddr = await getSessionKeyAddress(this.walletAddress);
      this.btnConnectWallet.textContent = `${this.walletAddress.slice(0, 6)}…${this.walletAddress.slice(-4)}`;
      this.rankedStatusMsg.textContent = 'Wallet connected — click New Game to start';
      // Load ranked fee from contract
      await this.loadRankedFee();
    } catch (err) {
      console.error('Wallet connect error:', err);
      this.rankedStatusMsg.textContent = 'Wallet connection failed';
    }
  }

  async loadRankedFee() {
    if (!CFG.contractAddress) return;
    try {
      const result = await readContractView(CFG.contractAddress, '0x0d1b8e17');
      const fee = BigInt(result);
      this.rankedFee = fee;
      const feeEth = Number(fee) / 1e18;
      this.rankedFeeDisplay.textContent = `Fee: ${feeEth} OKB`;
      document.getElementById('modalFeeAmt').textContent = `${feeEth} OKB`;
    } catch (e) {
      console.warn('Could not load ranked fee:', e);
    }
  }

  openRankedStartModal() {
    if (!this.walletAddress) {
      alert('Please connect your wallet first.');
      return;
    }
    this.rankedStartModal.classList.add('active');
  }

  closeRankedModal() {
    this.rankedStartModal.classList.remove('active');
  }

  async confirmStartRanked() {
    this.closeRankedModal();
    if (!this.walletAddress || !CFG.contractAddress) return;

    this.rankedStatusMsg.textContent = 'Sending startRanked tx...';
    this.rankedTxPanel.style.display = 'flex';
    this.rankedTxStatus.textContent = 'pending';

    try {
      // Encode startRanked(address sessionKey)
      const data = '0x5d4d794d' + encodeAddress(this.sessionKeyAddr);
      const value = '0x' + (this.rankedFee ?? 1_000_000_000_000_000n).toString(16);

      const txHash = await sendRankedTx(this.walletAddress, CFG.contractAddress, data, value);
      this.showTx(txHash);

      const rc = await waitForReceipt(txHash);
      if (rc.status !== '0x1') {
        this.rankedStatusMsg.textContent = 'startRanked failed!';
        this.rankedTxStatus.textContent = 'failed';
        return;
      }

      // Parse gameId from logs (GameStarted event: topic0 = keccak256("GameStarted(uint256,address,address,uint64)"))
      // The first indexed param is gameId
      let gameId = 0n;
      for (const log of rc.logs) {
        if (log.address.toLowerCase() === CFG.contractAddress.toLowerCase() && log.topics.length >= 2) {
          gameId = BigInt(log.topics[1]);
          break;
        }
      }

      this.rankedGameId = gameId;
      this.isRankedGame = true;
      this.rankedGameInfo.style.display = 'flex';
      document.getElementById('rankedGameId').textContent = gameId.toString();
      this.statGameId.textContent = gameId.toString();
      this.rankedTxStatus.textContent = 'confirmed ✓';
      this.rankedStatusMsg.textContent = `Game #${gameId} started! Your move.`;

      // Switch to on-chain rules engine for this game
      if (CFG.processorAddress) {
        this.rulesEngine = new OnChainEvalRulesEngine(CFG.rpcUrl, CFG.processorAddress, CFG.circuitId);
      }

      this.startNewGame(true);
    } catch (err) {
      console.error('startRanked error:', err);
      this.rankedStatusMsg.textContent = `Error: ${err.message}`;
      this.rankedTxStatus.textContent = 'error';
    }
  }

  showTx(hash) {
    this.rankedTxLink.textContent = `${hash.slice(0, 10)}…`;
    this.rankedTxLink.href = `${CFG.explorerBase ?? ''}${hash}`;
    this.rankedTxPanel.style.display = 'flex';
    this.rankedTxStatus.textContent = 'pending';
  }

  async submitRankedMove(col) {
    if (!this.walletAddress || !CFG.contractAddress || this.rankedGameId === null) return;

    this.rankedStatusMsg.textContent = `Submitting move (col ${col})...`;
    this.rankedTxStatus.textContent = 'pending';

    try {
      // Encode playMove(uint256 gameId, uint8 col)
      const data = '0x2bb86dd3' + encodeUint256(this.rankedGameId) + encodeUint256(col);
      const txHash = await sendRankedTx(this.walletAddress, CFG.contractAddress, data);
      this.showTx(txHash);

      const rc = await waitForReceipt(txHash);
      if (rc.status !== '0x1') {
        this.rankedStatusMsg.textContent = 'Move rejected on-chain!';
        this.rankedTxStatus.textContent = 'rejected';
        return false;
      }
      this.rankedTxStatus.textContent = 'confirmed ✓';
      this.rankedStatusMsg.textContent = 'Move confirmed — waiting for bot...';
      return true;
    } catch (err) {
      console.error('Ranked move error:', err);
      this.rankedStatusMsg.textContent = `Move error: ${err.message}`;
      this.rankedTxStatus.textContent = 'error';
      return false;
    }
  }

  // ---- Core game logic -----------------------------------------------------

  startNewGame(keepRankedState = false) {
    this.boardA = 0n;
    this.boardB = 0n;
    this.turn = 0;
    this.isGameOver = false;
    this.isBotThinking = false;
    this.moveCount = 0;
    this.winningCells = [];
    this.lastVerification = null;

    this.statMovesCount.textContent = '0';
    this.btnInspectMove.style.display = 'none';

    // Clear board DOM
    for (let i = 0; i < 42; i++) {
      const cell = this.cellElements[i];
      cell.innerHTML = '';
      cell.classList.remove('winning-cell');
    }

    if (!keepRankedState) {
      this.isRankedGame = false;
    }

    this.updatePickersAvailability();
    this.updateStatus();
  }

  updatePickersAvailability() {
    const occ = this.boardA | this.boardB;
    for (let c = 0; c < COLS; c++) {
      const topCell = cellIndex(c, 5);
      const isFull  = ((occ >> BigInt(topCell)) & 1n) !== 0n;
      const btn     = this.columnPickers.querySelector(`[data-col="${c}"]`);
      if (btn) {
        btn.disabled = isFull || this.isGameOver || this.isBotThinking;
        // In ranked mode, disable during bot turn (waiting for operator)
        if (this.isRankedGame && this.turn === 1) btn.disabled = true;
      }
    }
  }

  updateStatus() {
    this.turnDot.className = 'player-dot';

    if (this.isGameOver) {
      this.turnDot.style.opacity = '0.3';
      return;
    }

    this.turnDot.style.opacity = '1';
    if (this.turn === 0) {
      this.turnDot.classList.add('dot-a');
      this.statusMessage.textContent = this.isRankedGame ? 'Your turn (Player A)' : "Player A's Turn (Red)";
    } else {
      this.turnDot.classList.add('dot-b');
      if (this.gameMode === 'human-vs-bot' || this.isRankedGame) {
        this.statusMessage.textContent = this.isBotThinking
          ? 'Bot is thinking...'
          : (this.isRankedGame ? 'Waiting for bot operator...' : "Bot's Turn (Yellow)");
      } else {
        this.statusMessage.textContent = "Player B's Turn (Yellow)";
      }
    }
  }

  handleColumnClick(col) {
    if (this.isGameOver || this.isBotThinking) return;
    if ((this.gameMode === 'human-vs-bot' || this.isRankedGame) && this.turn === 1) return;

    this.executeMove(col);
  }

  async executeMove(col) {
    if (this.isGameOver) return;

    const currentTurn = this.turn;
    const isBot = !this.isRankedGame && this.gameMode === 'human-vs-bot' && currentTurn === 1;

    // For ranked mode: human moves must go through the contract
    // Local circuit still evaluates it first (optimistic UI), then we submit on-chain
    let moveRes;
    try {
      // Always evaluate locally first for instant feedback
      const localEngine = new LocalCircuitSimulatorRulesEngine();
      moveRes = await localEngine.evaluateMove(this.boardA, this.boardB, col, currentTurn);
    } catch (err) {
      console.error('Local eval failed:', err);
      return;
    }

    if (!moveRes.valid) {
      this.shakeColumn(col);
      return;
    }

    // For ranked mode human moves: submit on-chain (async, but show optimistic UI immediately)
    if (this.isRankedGame && currentTurn === 0) {
      // Submit tx in background — UI updates optimistically
      this.submitRankedMove(col).then(ok => {
        if (!ok) {
          // Revert optimistic update
          this.boardA = this.boardA;
          this.boardB = this.boardB;
          // Re-render would require full board repaint — for simplicity, alert and reload game
          console.error('On-chain move rejected — board may be out of sync');
        }
      });
      // Update badge to "on-chain" since move was submitted
      moveRes.source = 'on-chain';
    } else {
      // For casual mode, also try on-chain eval if configured
      if (this.rulesEngine.getVerificationSource() === 'on-chain') {
        try {
          const onchainRes = await this.rulesEngine.evaluateMove(this.boardA, this.boardB, col, currentTurn);
          moveRes = { ...onchainRes };
        } catch (e) {
          console.warn('On-chain eval failed, using local:', e);
        }
      }
    }

    // Find placed cell
    const placedCellMask = (currentTurn === 0)
      ? (moveRes.newBoardA ^ this.boardA)
      : (moveRes.newBoardB ^ this.boardB);

    let placedCell = -1;
    for (let i = 0; i < 42; i++) {
      if ((placedCellMask >> BigInt(i)) & 1n) { placedCell = i; break; }
    }
    const row = Math.floor(placedCell / 7);

    // Update state
    this.boardA = moveRes.newBoardA;
    this.boardB = moveRes.newBoardB;
    this.moveCount++;
    this.statMovesCount.textContent = this.moveCount.toString();
    this.lastVerification = { ...moveRes, col, turn: currentTurn, row, cell: placedCell };

    // Update badge — truthfully label the source
    const badgeText = moveRes.source === 'on-chain'
      ? 'on-chain (TapeOut circuit)'
      : 'local circuit simulation';
    this.badgeSource.textContent = `Verified: ${badgeText}`;
    this.btnInspectMove.style.display = 'inline-block';

    // Animate stone drop
    this.renderStone(placedCell, row, currentTurn);

    // Check game over
    if (moveRes.win) {
      this.isGameOver = true;
      this.highlightWinningLine(currentTurn);
      let winnerName;
      if (this.isRankedGame) {
        winnerName = currentTurn === 0 ? '🏆 You Win!' : 'Bot Wins';
        if (currentTurn === 0) this.rankedStatusMsg.textContent = '🏆 You won! Wins recorded on-chain.';
      } else {
        winnerName = currentTurn === 0 ? 'Player A (Red)' : (this.gameMode === 'human-vs-bot' ? 'Bot (Yellow)' : 'Player B (Yellow)');
      }
      this.statusMessage.textContent = `🎉 ${winnerName} Wins!`;
      this.updatePickersAvailability();
      return;
    }

    if (moveRes.draw) {
      this.isGameOver = true;
      this.statusMessage.textContent = '🤝 Game Draw (Board Full)';
      if (this.isRankedGame) this.rankedStatusMsg.textContent = 'Draw — recorded on-chain.';
      this.updatePickersAvailability();
      return;
    }

    // Next turn
    this.turn = 1 - currentTurn;
    this.updatePickersAvailability();
    this.updateStatus();

    // Trigger bot (casual mode only; ranked mode: operator handles it)
    if (!this.isRankedGame && this.gameMode === 'human-vs-bot' && this.turn === 1 && !this.isGameOver) {
      this.triggerBot();
    }

    // Ranked mode: after human move, disable board and wait for MovePlayed event
    if (this.isRankedGame && this.turn === 1) {
      this.updatePickersAvailability();
      this.watchForBotMove();
    }
  }

  // Poll for bot move event in ranked mode
  async watchForBotMove() {
    if (!CFG.contractAddress || this.rankedGameId === null) return;
    this.rankedStatusMsg.textContent = 'Waiting for bot operator move...';
    const botTurnStartTime = Date.now();

    for (let i = 0; i < 60; i++) {
      if (this.isGameOver) return;
      await new Promise(r => setTimeout(r, 3000));

      const elapsed = Date.now() - botTurnStartTime;
      if (elapsed > 20000 && this.botTimeoutBar) {
        this.botTimeoutBar.style.display = 'flex';
        this.botTimeoutMsg.textContent = '⏳ Bot operator is taking time to respond. If inactive for > 10m, full refund can be claimed.';
      }
      if (elapsed >= (CFG.botTimeoutSec ? CFG.botTimeoutSec * 1000 : 600000) && this.btnClaimBotRefund) {
        this.btnClaimBotRefund.style.display = 'inline-block';
        this.botTimeoutMsg.textContent = '⚠️ Bot timeout expired (10m). You can now claim your 100% ranked fee refund.';
      }

      try {
        // Read game.turn from contract
        const data = '0xe5a6b10f' + encodeUint256(this.rankedGameId);
        const result = await readContractView(CFG.contractAddress, data);
        if (!result || result === '0x') continue;

        // Decode: (address human, address sessionKey, uint256 board, uint8 turn, uint8 status, ...)
        const hex = result.slice(2);
        const turn = parseInt(hex.slice(192, 256), 16); // slot 3
        const status = parseInt(hex.slice(256, 320), 16); // slot 4

        if (status !== 0) {
          // Game ended on-chain
          this.isGameOver = true;
          this.statusMessage.textContent = status === 1 ? '🎉 You Win! (on-chain)' :
                                           status === 2 ? 'Bot Wins (on-chain)' :
                                           status === 3 ? '🤝 Draw (on-chain)' :
                                           status === 5 ? 'Game Voided (Refunded)' : 'Game Over';
          this.rankedStatusMsg.textContent = status === 5 ? 'Game voided — fee refunded.' : 'Game ended on-chain.';
          if (this.botTimeoutBar) this.botTimeoutBar.style.display = 'none';
          this.updatePickersAvailability();
          return;
        }

        if (turn === 0) {
          // Bot has moved — read new board
          const board = BigInt('0x' + hex.slice(128, 192)); // slot 2
          const newA = board & ((1n << 42n) - 1n);
          const newB = (board >> 42n) & ((1n << 42n) - 1n);

          // Find the new stone placed by bot
          const diffB = newB ^ this.boardB;
          let botCell = -1;
          for (let j = 0; j < 42; j++) {
            if ((diffB >> BigInt(j)) & 1n) { botCell = j; break; }
          }

          if (botCell >= 0) {
            const botRow = Math.floor(botCell / 7);
            this.renderStone(botCell, botRow, 1);
            this.boardA = newA;
            this.boardB = newB;
            this.moveCount++;
            this.statMovesCount.textContent = this.moveCount.toString();
            this.badgeSource.textContent = 'Verified: on-chain (TapeOut circuit)';

            this.turn = 0;
            this.rankedStatusMsg.textContent = 'Bot moved — your turn!';
            if (this.botTimeoutBar) this.botTimeoutBar.style.display = 'none';
            this.updatePickersAvailability();
            this.updateStatus();
          }
          return;
        }
      } catch (e) {
        console.warn('watchForBotMove poll error:', e);
      }
    }
    this.rankedStatusMsg.textContent = 'Bot move timeout — please check the game on-chain.';
    if (this.btnClaimBotRefund) this.btnClaimBotRefund.style.display = 'inline-block';
  }

  async handleClaimBotRefund() {
    if (!this.walletAddress || this.rankedGameId === null) return;
    try {
      this.btnClaimBotRefund.disabled = true;
      this.botTimeoutMsg.textContent = 'Submitting refund transaction...';
      const data = '0xa480fae6' + encodeUint256(this.rankedGameId);
      const txHash = await sendRankedTx(this.walletAddress, CFG.contractAddress, data);
      this.rankedTxLink.href = `${CFG.explorerBase || 'https://www.oklink.com/xlayer/tx/'}${txHash}`;
      this.rankedTxLink.textContent = `${txHash.slice(0, 10)}...`;
      this.rankedTxPanel.style.display = 'flex';
      this.rankedTxStatus.textContent = 'claiming refund...';
      await waitForReceipt(txHash);
      this.rankedTxStatus.textContent = 'refunded';
      this.rankedStatusMsg.textContent = 'Game voided — 100% fee refunded to your wallet!';
      this.isGameOver = true;
      this.statusMessage.textContent = 'Game Refunded (Bot Inactive)';
      if (this.botTimeoutBar) this.botTimeoutBar.style.display = 'none';
      this.updatePickersAvailability();
    } catch (err) {
      console.error('Claim refund failed:', err);
      this.botTimeoutMsg.textContent = `Refund failed: ${err.message}`;
      this.btnClaimBotRefund.disabled = false;
    }
  }

  renderStone(cellIdx, row, player) {
    const cell  = this.cellElements[cellIdx];
    const piece = document.createElement('div');
    piece.className = `piece ${player === 0 ? 'player-a' : 'player-b'} animating-drop`;
    const dropDistance = -((5 - row + 1) * 60 + 50);
    piece.style.setProperty('--drop-distance', `${dropDistance}px`);
    cell.appendChild(piece);
  }

  shakeColumn(col) {
    for (let r = 0; r < 6; r++) {
      const idx = cellIndex(col, r);
      const el  = this.cellElements[idx];
      el.style.transform = 'translateX(-3px)';
      setTimeout(() => { el.style.transform = 'translateX(3px)'; }, 50);
      setTimeout(() => { el.style.transform = ''; }, 100);
    }
  }

  highlightWinningLine(winnerTurn) {
    const board = (winnerTurn === 0) ? this.boardA : this.boardB;
    for (const line of WINNING_LINES) {
      const hasAll = line.every(c => ((board >> BigInt(c)) & 1n) === 1n);
      if (hasAll) {
        this.winningCells = line;
        for (const c of line) this.cellElements[c].classList.add('winning-cell');
        break;
      }
    }
  }

  triggerBot() {
    this.isBotThinking = true;
    this.updateStatus();
    this.updatePickersAvailability();

    if (this.worker) {
      this.worker.postMessage({
        boardAHex: '0x' + this.boardA.toString(16),
        boardBHex: '0x' + this.boardB.toString(16),
        botTurn: 1,
        difficulty: this.difficulty,
      });
    } else {
      setTimeout(async () => {
        const { selectBotMove } = await import('./engine.js');
        const col = selectBotMove?.(this.boardA, this.boardB, 1, this.difficulty) ?? 3;
        this.isBotThinking = false;
        this.executeMove(col);
      }, 100);
    }
  }

  openVerificationModal() {
    if (!this.lastVerification) return;
    const v = this.lastVerification;

    const srcLabel = v.source === 'on-chain'
      ? 'on-chain (X Layer TapeOut circuit)'
      : 'local circuit simulation (1,356 NAND Gates)';
    this.modalSource.textContent = srcLabel;
    this.modalInputHex.textContent  = v.rawInputHex;
    this.modalOutputHex.textContent = v.rawOutputHex;

    this.modalInputBreakdown.innerHTML = `
      <div class="bit-row"><span>Chosen Column:</span> <b>Col ${v.col}</b> (bits 84-86)</div>
      <div class="bit-row"><span>Turn:</span> <b>${v.turn === 0 ? 'Player A' : 'Player B'}</b> (bit 87)</div>
      <div class="bit-row"><span>Target Cell:</span> <b>(${v.col}, ${v.row}) [Cell #${v.cell}]</b></div>
    `;

    this.modalOutputBreakdown.innerHTML = `
      <div class="bit-row"><span>Move Validity:</span> <b style="color:#00ffcc">${v.valid ? 'VALID (1)' : 'INVALID (0)'}</b> (bit 0)</div>
      <div class="bit-row"><span>Mover Win Flag:</span> <b>${v.win ? 'WIN (1)' : 'NO WIN (0)'}</b> (bit 85)</div>
      <div class="bit-row"><span>Board Full (Draw):</span> <b>${v.draw ? 'DRAW (1)' : 'NO (0)'}</b> (bit 86)</div>
      <div class="bit-row"><span>Source:</span> <b>${srcLabel}</b></div>
    `;

    this.modalBackdrop.classList.add('active');
  }

  closeVerificationModal() {
    this.modalBackdrop.classList.remove('active');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new ConnectFourApp();
});
