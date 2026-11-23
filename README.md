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

## 🚀 Deployment & Tape-Out Guide

### Prerequisites
* Throwaway private key configured in `.env` (never commit real funds).
* Minimum funds required on deployer wallet:
  * **0.12 BEM** on X Layer (Token: `0x60e62efa9405d6873c5deabd4e6cc91c25363952`)
  * **0.01 OKB** on X Layer (for tape-out fee and deployment gas)

### Step 1: Tape Out the Circuit
The tape-out script verifies the BEM token address, checks deployer balances/allowances, creates the CPU container, mints 1,479 transistors, and tapes out the netlist:
```bash
# Dry run simulation
npx tsx scripts/tapeout.ts --dry-run

# Live tape-out (requires manual confirmation)
npx tsx scripts/tapeout.ts
```
*Outputs `PROCESSOR_ADDRESS` and `CIRCUIT_ID` and saves them to `deployments.json`.*

### Step 2: Deploy the TapeFour Contract
```bash
# Dry run deployment check
npx tsx scripts/deploy.ts --dry-run

# Live contract deployment
npx tsx scripts/deploy.ts
```
*Saves contract address and deployment transaction to `deployments.json`.*

### Step 3: Post-Deploy Verification Script
Run 5,000 random on-chain evaluations via canonical Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`) to verify the deployed circuit against the local simulator:
```bash
npx tsx scripts/verify_multicall.ts --count 5000 --batch 100
```

---

## 🌐 Hosting Guide

### 1. Hosting the Web Application (`web/`)
The web application is 100% static with no compilation or bundler requirements.

1. **Configuration**:
   Update `web/config.js` with the deployed contract address from `deployments.json`:
   ```javascript
   window.TAPEFOUR_CONFIG = {
     rankedEnabled: true,
     contractAddress: '0xYourDeployedContractAddress',
     processorAddress: '0xYourProcessorAddress',
     circuitId: 1,
     rpcUrl: 'https://rpc.xlayer.tech',
     chainId: 196,
     rankedFee: '0.005',
     poolSharePct: 60,
     treasurySharePct: 40,
     botTimeoutSec: 600,
   };
   ```

2. **Static Deployment Options**:
   * **Cloudflare Pages**: Connect repo and set build output directory to `web/` (build command: none).
   * **Netlify / Vercel**: Publish directory: `web/`.
   * **Static HTTP Server** (Local / VPS):
     ```bash
     npx serve web -p 3000
     ```

### 2. Hosting the Autonomous Bot Operator Service (`bot/`)

The operator service monitors the chain for human moves and responds automatically.

1. **Environment Variables (`.env`)**:
   ```ini
   XLAYER_RPC_URL=https://rpc.xlayer.tech
   BOT_OPERATOR_KEY=your_throwaway_operator_private_key
   TAPEFOUR_ADDRESS=0xYourDeployedContractAddress
   BOT_DIFFICULTY=medium
   ```

2. **Standalone Runner with Automatic Restart**:
   * **Linux / macOS**:
     ```bash
     chmod +x bot/start_operator.sh
     ./bot/start_operator.sh
     ```
   * **Windows**:
     ```cmd
     bot\start_operator.bat
     ```

3. **Production PM2 Process Manager**:
   ```bash
   npm install -g pm2
   pm2 start bot/ecosystem.config.cjs
   pm2 logs tapefour-operator
   pm2 startup
   ```

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
