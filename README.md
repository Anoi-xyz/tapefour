# TapeFour 🔴🟡
### Connect Four on TapeOut On-Chain Circuits (X Layer)

TapeFour is an on-chain Connect Four game powered by **TapeOut** custom processor circuits on **X Layer** (Chain ID: `196`). 

Every ranked move is validated directly by a **1,479 NAND gate** combinational circuit taped out on-chain. The game features an immutable rules engine, a zero-wallet-friction session key architecture, bot-timeout refund guarantees, and a weekly claim-based prize pool.

---

## 🏛️ Architecture Overview

```
                               ┌──────────────────────────────────────────────┐
                               │             TapeFour Contract                │
┌──────────────┐   Ranked Tx   │  • Escrows 0.005 OKB fee per game            │
│ Human Player │ ────────────> │  • Registers ephemeral session key address   │
└──────────────┘               │  • Forwards gas stipend (capped at 0.05 OKB) │
                               └──────────────────────┬───────────────────────┘
                                                      │ calls eval()
                                                      ▼
┌──────────────┐   playBotMove ┌──────────────────────────────────────────────┐
│ Bot Operator │ ────────────> │           TapeOut CPU Container              │
└──────────────┘               │  • 1,479 NAND Gates (TAP-02 Netlist)         │
                               │  • Circuit ID: 1                             │
                               │  • Evaluates 88-bit input -> 87-bit output   │
                               │  • Validates move, updates board, checks win │
                               └──────────────────────────────────────────────┘
```

1. **Circuit Engine (`circuit/`)**:
   * **1,479 NAND gates** (well below the $\le 1,500$ optimization target and 3,000 hard limit).
   * Purely combinational logic: no random elements, no clock cycles, 100% deterministic.
   * Input: **88 bits** (Player A stones: 42 bits, Player B stones: 42 bits, Column: 3 bits, Turn: 1 bit).
   * Output: **87 bits** (`valid`: 1 bit, `newBoardA`: 42 bits, `newBoardB`: 42 bits, `win`: 1 bit, `draw`: 1 bit).
   * All 87 output gates are pinned in exact topological order to match TapeOut EVM runtime conventions.

2. **Smart Contracts (`contracts/contracts/TapeFour.sol`)**:
   * Immutable processor address and circuit ID pinned at deployment.
   * **Fee Escrow Model**: Each game's 0.005 OKB fee is held in contract escrow during play and settled only when the game concludes (`_settleFee`).
   * **Bot-Timeout Refund (`claimBotTimeout`)**: If the bot operator fails to submit a move within `botTimeout` (default 10 minutes), the player can void the game and reclaim a **100% full refund**.
   * **Per-Week Prize Pool Architecture**:
     * Replaced global prize pool with isolated `mapping(uint64 => uint256) weeklyPool`.
     * Wins and fees are credited to the week the game **ends** (`_isoWeek()` at settlement).
     * `lockWeeklyPool(week)` requires `week < currentWeek` and locks the week:
       * If `weeklyTotalWins > 0`: snapshots `weeklySnapshot[week]`, zeroes `weeklyPool[week]`, and enables proportional claims.
       * If `weeklyTotalWins == 0`: automatically rolls `weeklyPool[week]` into `weeklyPool[currentWeek]` (respecting `MAX_POOL`, excess to treasury).
     * Once locked, no function can modify that week's wins, pool, or total.
   * **Session Key Gas Stipend**: Optional gas stipend forwarded to the browser-generated session key at `startRanked` (capped at 0.05 OKB) so human players make moves with zero per-move wallet pop-ups.
   * **Security**: ReentrancyGuard, no admin functions that can withdraw player funds or the prize pool, all parameters bounded with strict caps.

3. **Autonomous Bot Operator (`bot/operator.ts`)**:
   * Minimax engine with alpha-beta pruning (3 difficulty levels: Easy, Medium, Hard).
   * Watches on-chain `MovePlayed` events and submits `playBotMove`.
   * Cannot play illegal moves: every move must pass the on-chain circuit evaluation.

4. **Web Application (`web/`)**:
   * Pure static HTML5, CSS3, and ES modules (zero framework overhead, zero build step).
   * Published directly from the `web/` folder: `index.html` is the self-contained interactive landing page, and `game.html` is the playable Connect Four game (`game.html#ranked` opens directly into on-chain ranked mode).
   * EIP-6963 multi-wallet picker (MetaMask, OKX, Rabby, Zerion, etc.) with explicit gas enforcement and safe disconnect.
   * Truthful verification badges: explicitly indicates whether each move was verified via "local circuit simulation" or "on-chain (TapeOut circuit)".

---

## 💰 Economic Model & Fee Split

* **Ranked Fee**: `0.005 OKB` (~$0.22 USD at \$45/OKB)
* **Weekly Prize Pool**: **60%** (`poolBps = 6000`)
* **Project Treasury**: **40%** (`4000 bps`)

### Operator Gas Cost vs. Treasury Share

Each game awards **0.002 OKB** (40% of 0.005 OKB) to the project treasury upon conclusion to cover bot gas costs and infrastructure.

| Metric | Current Gas Price (0.021 Gwei) | Elevated Gas Price (0.100 Gwei) | Extreme Gas Price (0.500 Gwei) |
| :--- | :--- | :--- | :--- |
| **Realistic Game (30 moves, 15 bot moves)** | | | |
| *Total Bot Gas (51.81M gas)* | `0.001088 OKB` ($0.049) | `0.005181 OKB` ($0.233) | `0.025905 OKB` ($1.166) |
| *Treasury Share (40%)* | `0.002000 OKB` ($0.090) | `0.002000 OKB` ($0.090) | `0.002000 OKB` ($0.090) |
| **Operator Net Margin** | **+0.000912 OKB (+83.8% Profit)** | `-0.003181 OKB` | `-0.023905 OKB` |
| | | | |
| **Worst-Case Game (42 moves, 21 bot moves)** | | | |
| *Total Bot Gas (72.53M gas)* | `0.001523 OKB` ($0.069) | `0.007253 OKB` ($0.326) | `0.036267 OKB` ($1.632) |
| *Treasury Share (40%)* | `0.002000 OKB` ($0.090) | `0.002000 OKB` ($0.090) | `0.002000 OKB` ($0.090) |
| **Operator Net Margin** | **+0.000477 OKB (+31.3% Profit)** | `-0.005253 OKB` | `-0.034267 OKB` |

*At normal X Layer operating gas prices (0.021 Gwei), the 40% treasury allocation provides a comfortable **31.3% to 83.8% profit margin**.*

---

## 🚀 Live Mainnet Deployment (X Layer Chain ID 196)

TapeFour is **live on X Layer mainnet**. Both the custom circuit processor and the TapeFour ranked game contract are fully deployed, verified, and configured:

| Component | Mainnet Address / ID | Transaction / Block Details |
| :--- | :--- | :--- |
| **TapeOut CPU Container** | `0xc849714d70A5c1bE8A456C47c644fe90D5B1625C` | Created in tx `0x74723760...` |
| **Taped-Out Circuit** | **Circuit ID: `1`** (1,479 NAND Gates) | Minted in `0x481f4dbe...`, Taped out in `0x5446643f...` |
| **TapeFour Contract** | `0x1c319c3bcb9ed1c35507f029c8e7152ab0590c04` | Deployed at block `76781513` (tx `0x3e9c900e...`) |
| **Project Treasury** | `0xb1c17d49869b79dc8f96e01078cf6799db1b3ccc` | 40% of ranked entry fees |
| **Bot Operator** | `0x3318600906c5f72b02be32aad973de8e206add41` | Authorized signer for bot moves |
| **Multicall3 Verification** | 5,000 / 5,000 positions verified | 100% bit-for-bit on-chain match (0 mismatches) |

---

## 📜 Deployment & Verification History

### 1. Circuit Tape-Out (`scripts/tapeout.ts`)
* **BEM Approvals & Container Creation**: Deployer approved exact BEM amounts to the CPU Factory (`0x1f09daefa827f02cbb40967cc91b259763760761`) and created processor `0xc849714d70A5c1bE8A456C47c644fe90D5B1625C`.
* **Transistor Minting**: Minted 1,479 transistors on-chain for the TAP-02 netlist.
* **Netlist Tape-Out**: Pinned Circuit ID 1 onto the processor container. Full records logged to `deployments.json`.

### 2. Contract Deployment (`scripts/deploy.ts`)
* Pre-flight checks read live X Layer state to ensure the processor bytecode existed, verified factory origin, and verified that on-chain `netlist(1)` was 100% byte-identical to `scripts/c4_netlist.bin`.
* Strict address separation verified that Treasury (`0xb1c1...`) and Operator (`0x3318...`) were distinct and non-zero.
* `TapeFour.sol` deployed with immutable parameters: 0.005 OKB fee, 60% prize pool, 40% treasury, 24h move timeout, 10m bot timeout.

### 3. Post-Deploy Multicall Verification (`scripts/verify_multicall.ts`)
Ran 5,000 randomized legal game positions (including wins, draws, and edge columns) through canonical Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`) directly against the live on-chain processor on X Layer:
```bash
npx tsx scripts/verify_multicall.ts --count 5000 --batch 10
# Result: 5,000 / 5,000 matches, 0 mismatches, 0 call errors (100% match)
```

### 4. Read-Only Contract Verification (`scripts/read_contract.ts`)
Inspects the deployed contract on X Layer to verify all immutable settings and current ISO week:
```bash
npx tsx scripts/read_contract.ts
```

---

## 🌐 What's Left to Host

With smart contracts and processor circuits permanently deployed on X Layer, the remaining hosting tasks are:

### 1. Static Web Application (`web/`)
The front-end is 100% static HTML/CSS/ES modules with zero build step. Publish the `web/` folder to any static host:
* `index.html`: The interactive 3D landing page introducing the game and the on-chain circuit.
* `game.html`: The full Connect Four game application. Navigating to `game.html#ranked` directly opens Ranked (On-Chain) mode; plain `game.html` opens casual mode.
* `web/config.js` is already wired to the live contract (`0x1c319c3bcb9ed1c35507f029c8e7152ab0590c04`) and public RPC (`https://rpc.xlayer.tech`).

* **Deploy**: Publish the `web/` directory on any static host (Cloudflare Pages, Vercel, Netlify, GitHub Pages, or VPS nginx/caddy).
* **Local Development Server**:
  ```bash
  npm start
  # or: node serve.js
  # Serves / as index.html (landing page) and /game.html as game.html
  ```

### 2. Autonomous Bot Operator Service (`bot/`)
The bot operator service listens for `MovePlayed` events on X Layer, computes moves with minimax, and submits `playBotMove`.
* **Configuration**: Set in `.env`:
  ```ini
  XLAYER_RPC_URL=https://rpc.xlayer.tech
  BOT_OPERATOR_KEY=your_operator_private_key   # Must derive to 0x3318600906c5f72b02be32aad973de8e206add41
  TAPEFOUR_ADDRESS=0x1c319c3bcb9ed1c35507f029c8e7152ab0590c04
  BOT_DIFFICULTY=medium
  ```
* **Dry-Run Mode (Observation only, zero gas, no transactions)**:
  ```bash
  npx tsx bot/operator.ts --dry-run
  ```
* **Production Daemon (PM2 / systemd)**:
  ```bash
  npm install -g pm2
  pm2 start "npx tsx bot/operator.ts" --name tapefour-operator
  pm2 logs tapefour-operator
  ```
  *Ensure the operator wallet (`0x3318600906c5f72b02be32aad973de8e206add41`) maintains a small OKB balance on X Layer (~0.05 OKB) to pay transaction gas.*

---

## 🧪 Testing & Verification Summary

* **Circuit Exhaustive Sub-block Tests**: `npm run test:subblocks` (100% passed).
* **Reference Engine Simulation**: `npm run test:random-games` (100,000 legal games / 2,079,668 moves, 100% bit-for-bit match).
* **Contract Unit Tests**: `npx hardhat test test/TapeFour.test.js` (**38 passing tests** covering deployment, fee escrow, fee settlement, draws, timeouts, forfeits, prize pool isolation, cross-week settlement, rollover of winless weeks, anti-drain attacker tests, invariant fuzz testing, and bot-timeout refunds).
* **Full Game on Real Circuit**: Complete 7-move ranked game played on an X Layer fork against the real taped-out 1,479-gate circuit (`TapeFour_real.test.js`). Winning move gas: **3,608,618 gas**.
* **Bot-Timeout Refund on Real Circuit**: Confirmed 100% fee refund (0.005 OKB) returned to player upon bot inactivity on the real circuit (`TapeFour_real.test.js`).
* **Targeted On-Chain Circuit Tests**: **40 / 40 positions verified (100% match)** against the real circuit on the fork covering horizontal, vertical, and diagonal wins for both players, full column rejections, column 7 rejections, empty board drops, and last-cell terminal draws.

---

## 🔒 Security Commitments & Remaining Risks

### Security Invariants
* **Isolated Per-Week Accounting**: Global prize pool eliminated. No user can claim funds from weeks they did not win.
* **Escrow Balance Invariant**: Verified via fuzzing that contract balance is strictly $\ge$ active escrowed fees $+$ unlocked weekly pools $+$ unclaimed locked snapshots.
* **No Administrative Backdoor**: Neither the owner, deployer, operator, nor treasury can withdraw escrowed player fees or weekly prize pool funds.
* **Immutable Rules**: The game rules are hard-coded into the taped-out silicon netlist and cannot be modified.

### Honest Report of Remaining Risks
1. **Operator Gas Margin at Elevated Gas Prices**: At standard gas prices on X Layer (0.021 Gwei), the 40% treasury share (0.002 OKB) yields a +31% to +83% profit margin over bot gas costs. However, if gas prices rise above 0.100 Gwei, the bot operator may run at a loss for long 42-move games unless the treasury subsidizes operator gas.
2. **Permissionless Lock Timing**: Anyone can call `lockWeeklyPool(week)` after week end. While deterministic and non-exploitable, if no one calls `lockWeeklyPool`, winners cannot claim until someone submits the transaction.
3. **Session Key Device Storage**: Ephemeral session keys are generated in browser `sessionStorage`. If a player clears browser storage or closes their private browsing tab mid-game, they must make their remaining moves directly from their main connected wallet.
