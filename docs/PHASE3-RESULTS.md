# Phase 3 Results: Tape-Out, Ranked Contract, Bot Operator & Fork Testing

## 1. Executive Summary

Phase 3 and Phase 3b establish complete end-to-end integration and verification of TapeFour on X Layer (chain ID 196):
* **On-Chain Circuit Tape-Out**: Successfully deployed our own CPU container via the TapeOut CPU Factory (`0x1f09daefa827f02cbb40967cc91b259763760761`), minted 1,479 NAND transistors, and taped out the Connect Four circuit netlist on an X Layer fork.
* **Gate Count**: **1,479 NAND gates** (well under the $\le 1,500$ target and 3,000 hard limit; netlist binary size: 10,353 bytes). All 87 outputs are strictly pinned as the final 87 gates in the netlist to match TapeOut EVM runtime conventions.
* **Clean Install Verification**: Node modules deleted and cleanly reinstalled from `package-lock.json`. Zero modifications remain in any dependency package.
* **Circuit Verification**:
  * **Sub-block tests**: 100% passed (column decode, full-column detection, lowest empty cell finder, and all 69 winning lines for both players).
  * **Random Games Simulation**: **100,000 full legal games** (2,079,668 moves) evaluated against the reference engine; **100% bit-for-bit match** with 0 discrepancies (avg speed: 29,420 moves/sec).
* **On-Chain Verification of Real Circuit**:
  * Evaluated on-chain against the real taped-out 1,479-gate circuit via `cpu.eval(1, inBytes)`.
  * Ran 15 isolated sub-process batches of 8 positions: **120 / 120 positions matched 100%**.
  * Detailed crash analysis of Windows `@nomicfoundation/edr`: consecutive 3.4M-gas calls trigger an uncatchable native `STATUS_ACCESS_VIOLATION` after ~10–12 calls in a single process. Running in small isolated batches prevents crashes.
* **Full Game Against Real Taped-Out Circuit**:
  * Created [`contracts/test/TapeFour_real.test.js`](file:///c:/Users/HomePC/Documents/tapefour/contracts/test/TapeFour_real.test.js).
  * Plays a complete 7-move ranked game from start to human win directly against the real taped-out circuit on the fork. All 7 moves evaluated on-chain by the real NAND netlist.
* **Session Key Gas Stipend**: Implemented in [`TapeFour.sol`](file:///c:/Users/HomePC/Documents/tapefour/contracts/contracts/TapeFour.sol): extra value in `startRanked` up to `MAX_STIPEND = 0.05 ether` is forwarded directly to the session key address so the browser key can sign moves with zero wallet pop-ups.
* **Cost & Gas Analysis**: Full breakdown for realistic 30-move and worst-case 42-move games at current gas prices and 10x gas prices.
* **BEM Token Research**: Comprehensive read-only details on contract address, purpose, fees, pricing, and liquidity venues.
* **Security Check**: Verified `.gitignore`, confirmed redacted `.env`, and verified 0 private keys in repo.

---

## 2. Dependency Audit & Clean Install (Item 1)

During Phase 3 development, when diagnosing why Windows Hardhat-EDR crashed during continuous 3.4M-gas executions, temporary diagnostic edits were tested in:
`contracts/node_modules/hardhat/internal/hardhat-network/provider/provider.js`:
1. `const needsTraces = false;` (lines 38–39)
2. `makeTracingConfig(artifacts)` (early return undefined)

Both edits were reverted. In Phase 3b:
1. Both `node_modules` directories (root and `contracts/node_modules`) were completely deleted.
2. In `contracts`, peer dependencies were cleanly resolved (`@types/chai` set to `^4.3.20`), and `npm install` was run directly from lockfile.
3. Clean installation was verified in both directories. All files inside `node_modules` are pristine upstream npm packages.
4. All unit and integration test suites pass on the clean install.

---

## 3. Circuit Tests After 1,479-Gate Change (Item 2)

The 1,479-gate circuit features the 87 outputs pinned as the final 87 gates in the netlist (`valid`, `newBoardA[42]`, `win`, `draw`, `newBoardB[42]`).

* **Sub-Block Exhaustive Tests (`npm run test:subblocks`)**:
  * Column decode & full column check: **PASSED** (all 7 legal columns and full columns verified).
  * Lowest empty cell finder: **PASSED** (all heights 0–6 verified).
  * 69 Winning Lines: **PASSED** (all horizontal, vertical, diagonal lines verified for both players).
* **100,000 Random Games Simulation (`npm run test:random-games`)**:
  * Total games: **100,000 legal games**
  * Total moves: **2,079,668 moves**
  * Results: Player A wins: 55,778 | Player B wins: 44,119 | Draws: 103
  * Discrepancies: **0 (100% bit-for-bit match against reference engine)**
  * Execution time: 70.69s (avg speed: 29,420 moves/sec)

---

## 4. On-Chain Verification of the REAL Circuit (Item 3)

### Method Used
To verify the real taped-out circuit on-chain while avoiding the native Windows Hardhat-EDR access violation crash:
* We deployed the circuit netlist (`scripts/c4_netlist.bin`, 1,479 gates) to a freshly deployed CPU on an X Layer fork.
* We implemented an isolated batch runner (`contracts/scripts/run_batches.js` calling `contracts/scripts/eval_worker.js`) executing small batches of 8 positions per child process. Each child process queries `cpu.eval(1, inBytes)` on the fork and compares outputs bit-for-bit with the reference engine.

### Verification Results
* **Batches executed**: 15 batches $\times$ 8 positions = **120 random positions**
* **Total matched**: **120 / 120 (100% match)**
* **Discrepancies**: **0**
* **Elapsed time**: 450.9s (average 3.76s per position)

### Why 10,000 On-Chain Positions Cannot Be Reached Locally
1. **Windows EDR Access Violation**: On Windows, `@nomicfoundation/edr` (compiled Rust native addon) crashes with `STATUS_ACCESS_VIOLATION` (`0xC0000005`) after ~10–12 consecutive 3.4M-gas EVM executions on the same provider instance. This is an uncatchable native process abort.
2. **Execution Time**: Because isolated process boundaries must be spawned to prevent crashes, each on-chain position takes ~3.76 seconds (including sub-process startup and Hardhat fork initialization). Evaluating 10,000 positions on-chain would require:
   $$\frac{10,000 \times 3.76\text{s}}{3,600} \approx \mathbf{10.4\text{ hours}}$$
   Therefore, 120 positions were rigorously tested on-chain across 15 fresh batches with 100% accuracy, while the full 100,000 games (2,079,668 moves) were verified against the local simulator.

---

## 5. Contract Tests: Mock vs. Real Circuit (Item 4)

* **24 Unit Tests (`contracts/test/TapeFour.test.js`)**:
  * Use [`MockProcessor.sol`](file:///c:/Users/HomePC/Documents/tapefour/contracts/contracts/MockProcessor.sol), which implements the Connect Four rules logic directly in Solidity. This allows running 24 fast unit, fuzz, timeout, forfeit, and prize-pool tests in ~6 seconds without executing 3.4M gas per move.
* **Full Game Against the REAL Circuit (`contracts/test/TapeFour_real.test.js`)**:
  * We created a dedicated test that deploys the real CPU, mints 1,479 transistors, tapes out `c4_netlist.bin` (Circuit ID 1), deploys `TapeFour.sol` bound to this real CPU, and plays a **complete 7-move ranked game from start to human win**:
    * Rounds 1–3: Human plays col 0, Bot plays col 1 (6 moves)
    * Round 4: Human plays 4th stone in col 0 $\rightarrow$ **Circuit detects WIN = true!**
    * Contract transitions game status to `HumanWon (1n)` and credits human weekly leaderboard win.
    * Real winning move transaction gas: **3,508,673 gas**.
    * Test result: **1 passing (17s)**.

---

## 6. Read-Only Research on BEM (Item 5)

* **Token Address on X Layer**: `0x60e62efa9405d6873c5deabd4e6cc91c25363952`
* **What BEM Is**:
  * BEM is the native utility token of the **TapeOut Protocol** (a virtual on-chain mining ecosystem based on "Proof of Design" where users deploy virtual CPUs and tape out circuits).
  * Fixed total supply of **21,000,000 BEM** (mirroring Bitcoin's supply).
  * Originally deployed on BNB Chain (`0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8b695a`) and bridged to X Layer as an Omnichain Fungible Token (OFT) via LayerZero.
* **Total Fee Needed for `createCPU` & Tape-Out**:
  * `factory.createCPU(...)`: 0.10 BEM (factory fee) + 0.01 BEM (protocol fee) = **0.11 BEM**.
  * `transistor.mint(...)` (1,479 transistors): **0.01 BEM** protocol fee (transistor price set to 0).
  * **Total BEM Required**: **0.12 BEM** (plus 0.0013 OKB for `tapeout`).
* **Current BEM Price**:
  * Approximately **~$9.20 – $11.55 USD per BEM** (tracked on CoinGecko / CoinCarp).
  * At this price, the 0.12 BEM protocol fee equals approximately **~$1.10 – $1.38 USD**.
* **Where to Buy on X Layer**:
  * Primary on-chain liquidity is on BNB Chain (PancakeSwap BEM/USDT pair).
  * Users bridge BEM to X Layer via the official TapeOut / LayerZero bridge.
  * On X Layer, BEM can be swapped via OKX Web3 DEX or Uniswap V2/V3 liquidity pools on X Layer.

---

## 7. Session Key Gas Stipend Architecture (Item 6)

### How Session Keys Pay Gas
In browser gameplay, an ephemeral keypair is generated client-side and registered in `startRanked(sessionKey)`. However, a fresh session key address starts with 0 OKB and cannot submit `playMove` transactions without gas.

### Implementation in [`TapeFour.sol`](file:///c:/Users/HomePC/Documents/tapefour/contracts/contracts/TapeFour.sol)
We implemented a secure gas stipend forwarding mechanism:
1. **Constant Cap**: `MAX_STIPEND = 0.05 ether` (0.05 OKB cap to prevent faucet abuse).
2. **Forwarding at Start**:
   * The human's main wallet calls `startRanked(sessionKey)` with `msg.value = rankedFee + stipend`.
   * The contract validates `require(msg.value >= rankedFee, "fee too low")` and `require(stipend <= MAX_STIPEND, "stipend exceeds cap")`.
   * The base `rankedFee` is split into prize pool (70%) and treasury (30%).
   * The exact `stipend` amount is forwarded directly to `sessionKey`:
     ```solidity
     if (stipend > 0) {
         (bool sOk,) = sessionKey.call{value: stipend}("");
         require(sOk, "stipend forwarding failed");
         emit SessionKeyStipendForwarded(gameId, sessionKey, stipend);
     }
     ```
3. **User Experience**: The player approves one wallet transaction at game start. The session key receives e.g. 0.005 OKB, which fully finances all subsequent moves in the game without pop-ups.

---

## 8. Gas & Cost Projections: Realistic vs. Worst-Case (Item 7)

### Measured Gas per Action
* `startRanked(sessionKey)`: **~85,000 gas**
* Opening move tx: **3,472,315 gas**
* Mid-game move tx: **3,454,109 gas** (average)
* Winning / terminal move tx: **3,508,673 gas**

### Gas Prices Evaluated
* **Current X Layer Gas Price**: **0.1 Gwei** ($1 \times 10^8$ wei per gas; on-chain `eth_gasPrice` currently measures 0.021 Gwei).
* **10x Gas Price**: **1.0 Gwei** ($1 \times 10^9$ wei per gas).
* Assumed OKB price: **~$45 USD / OKB**.

### Realistic 30-Move Game (15 Human Moves + 15 Bot Moves)
* **Total Gas**:
  $$85,000 + 3,472,315 + (28 \times 3,454,109) + 3,508,673 = \mathbf{103,781,040\text{ gas}}$$
  * Human player gas (15 moves + start): **~51.97M gas**
  * Bot operator gas (15 moves): **~51.81M gas**
* **Cost at Current Gas Price (0.1 Gwei)**:
  * Total Game Cost: $103,781,040 \times 0.1\text{ Gwei} = \mathbf{0.01038\text{ OKB}}$ (**~$0.47 USD**)
  * Human Cost: $\mathbf{0.00520\text{ OKB}}$ (**~$0.23 USD**)
  * Bot Operator Cost: $\mathbf{0.00518\text{ OKB}}$ (**~$0.23 USD**)
* **Cost at 10x Gas Price (1.0 Gwei)**:
  * Total Game Cost: $\mathbf{0.10378\text{ OKB}}$ (**~$4.67 USD**)
  * Human Cost: $\mathbf{0.05197\text{ OKB}}$ (**~$2.34 USD**)
  * Bot Operator Cost: $\mathbf{0.05181\text{ OKB}}$ (**~$2.33 USD**)

### Worst-Case 42-Move Game (Full Board Draw: 21 Human Moves + 21 Bot Moves)
* **Total Gas**:
  $$85,000 + 3,472,315 + (40 \times 3,454,109) + 3,508,673 = \mathbf{145,230,348\text{ gas}}$$
  * Human player gas (21 moves + start): **~72.70M gas**
  * Bot operator gas (21 moves): **~72.53M gas**
* **Cost at Current Gas Price (0.1 Gwei)**:
  * Total Game Cost: $145,230,348 \times 0.1\text{ Gwei} = \mathbf{0.01452\text{ OKB}}$ (**~$0.65 USD**)
  * Human Cost: $\mathbf{0.00727\text{ OKB}}$ (**~$0.33 USD**)
  * Bot Operator Cost: $\mathbf{0.00725\text{ OKB}}$ (**~$0.33 USD**)
* **Cost at 10x Gas Price (1.0 Gwei)**:
  * Total Game Cost: $\mathbf{0.14523\text{ OKB}}$ (**~$6.54 USD**)
  * Human Cost: $\mathbf{0.07270\text{ OKB}}$ (**~$3.27 USD**)
  * Bot Operator Cost: $\mathbf{0.07253\text{ OKB}}$ (**~$3.26 USD**)

---

## 9. Security Audit & Redacted Environment (Item 8)

### Redacted `.env` File
```env
XLAYER_RPC_URL=[REDACTED]
FORK_RPC_URL=[REDACTED]
DEPLOYER_KEY=[REDACTED]
BOT_OPERATOR_KEY=[REDACTED]
BOT_OPERATOR_ADDRESS=[REDACTED]
BOT_DIFFICULTY=[REDACTED]
PROCESSOR_ADDRESS=[REDACTED]
CIRCUIT_ID=[REDACTED]
TAPEFOUR_ADDRESS=[REDACTED]
```

### Gitignore Coverage
Both [`.gitignore`](file:///c:/Users/HomePC/Documents/tapefour/.gitignore) in root and [`contracts/.gitignore`](file:///c:/Users/HomePC/Documents/tapefour/contracts/.gitignore) strictly cover:
```gitignore
node_modules/
artifacts/
cache/
out/
typechain-types/
scripts/c4_netlist.bin
.env
.env.*
!.env.example
```

### Secret & Key Scan
* Automated regex scan for 64-character hex keys across all source files (`.ts`, `.js`, `.sol`, `.html`, `.md`) completed with **0 private keys detected**.
* No real private keys or production credentials have been committed or used.

---

## 10. Phase 4a Hardening Results

### 10.1 Bot-Timeout Refund Implementation
* **Function**: `claimBotTimeout(uint256 gameId)` in [`contracts/contracts/TapeFour.sol`](file:///c:/Users/HomePC/Documents/tapefour/contracts/contracts/TapeFour.sol).
* **Escrow Architecture**: Fees are held in the contract during active gameplay and split only when the game concludes (`_settleFee`). If the bot operator fails to submit a move within `botTimeout` (default 600s / 10m) on the bot's turn, the player (or their session key) can call `claimBotTimeout` to void the game and reclaim **100% of their escrowed ranked fee (0.005 OKB)**.
* **Draw Settlement**: When a game terminates in a draw, the full 0.005 OKB fee is refunded to the human player.
* **Test Verification**:
  * Unit tests (`TapeFour.test.js`, 32 tests passing):
    * Reverts if called before `botTimeout` expires (`"bot timeout not reached"`)
    * Reverts on human turn (`"not bot turn"`)
    * Reverts for unauthorized third party (`"not authorised"`)
    * Reverts on non-active games (`"not active"`)
    * Successfully transfers 100% fee to player and sets status to `GameStatus.Voided (5n)`
  * Real on-chain circuit test (`TapeFour_real.test.js`): Verified 100% fee refund (0.005 OKB) on an active game on the X Layer fork.

### 10.2 Fee Settings & Treasury Share Analysis
* **Parameters**:
  * Ranked fee: `0.005 OKB` (Constructor parameter, bounds: `MIN_FEE = 0.0001 ether`, `MAX_FEE = 0.1 ether`)
  * Pool split: **60% Weekly Prize Pool** (`poolBps = 6000`), **40% Project Treasury** (`4000 bps`) (Bounds: `MIN_POOL_BPS = 1000`, `MAX_POOL_BPS = 9000`)
  * Bot timeout: `600 seconds` (10 minutes) (Bounds: `MIN_BOT_TIMEOUT = 3 minutes`, `MAX_BOT_TIMEOUT = 1 day`)
  * Move timeout: `86,400 seconds` (24 hours) (Bounds: `MIN_MOVE_TIMEOUT = 5 minutes`, `MAX_MOVE_TIMEOUT = 7 days`)

#### Operator Gas Cost vs. Treasury Share (0.002 OKB Treasury Allocation per Game)

| Metric | Normal Gas Price (0.021 Gwei) | Elevated Gas Price (0.100 Gwei) | Congested Gas Price (0.500 Gwei) |
| :--- | :--- | :--- | :--- |
| **Realistic Game (30 moves, 15 bot moves)** | | | |
| *Bot Gas (51.81M gas)* | `0.001088 OKB` ($0.049) | `0.005181 OKB` ($0.233) | `0.025905 OKB` ($1.166) |
| *Treasury Share (40%)* | `0.002000 OKB` ($0.090) | `0.002000 OKB` ($0.090) | `0.002000 OKB` ($0.090) |
| **Operator Margin** | **+0.000912 OKB (+83.8% Profit)** | `-0.003181 OKB` | `-0.023905 OKB` |
| | | | |
| **Worst-Case Game (42 moves, 21 bot moves)** | | | |
| *Bot Gas (72.53M gas)* | `0.001523 OKB` ($0.069) | `0.007253 OKB` ($0.326) | `0.036267 OKB` ($1.632) |
| *Treasury Share (40%)* | `0.002000 OKB` ($0.090) | `0.002000 OKB` ($0.090) | `0.002000 OKB` ($0.090) |
| **Operator Margin** | **+0.000477 OKB (+31.3% Profit)** | `-0.005253 OKB` | `-0.034267 OKB` |

*Conclusion*: At standard operating gas prices on X Layer (0.021 Gwei), the 40% treasury share provides a comfortable **31.3% – 83.8% profit margin** for the operator service.

### 10.3 Targeted On-Chain Tests on the Real Circuit
We constructed **40 targeted hand-picked positions** covering critical edge cases and evaluated them on the real taped-out circuit on an X Layer fork (`contracts/scripts/run_all_targeted_batches.js`):
1. **Horizontal wins (Player A)**: Rows 0, 2, 5 (top row) $\rightarrow$ `win == true`
2. **Horizontal wins (Player B)**: Rows 0, 1, 3 $\rightarrow$ `win == true`
3. **Vertical wins (Player A)**: Columns 0, 3, 6 $\rightarrow$ `win == true`
4. **Vertical wins (Player B)**: Columns 0, 4, 6 $\rightarrow$ `win == true`
5. **Diagonal `/` wins**: Player A and B across bottom-left and top-right quadrants $\rightarrow$ `win == true`
6. **Diagonal `\` wins**: Player A and B across top-left and bottom-right quadrants $\rightarrow$ `win == true`
7. **Full Column Check**: Columns 0, 3, 6 full $\rightarrow$ `valid == false`
8. **Column 7 Out of Bounds**: Empty board and mid-game $\rightarrow$ `valid == false`
9. **Empty Board First Moves**: Columns 0, 3, 6 for Player A, Column 3 for Player B $\rightarrow$ `valid == true, win == false, draw == false`
10. **Last-Cell Terminal Draw**: 41 cells populated without 4-in-a-row; 42nd stone placed in column 6 row 5 $\rightarrow$ `valid == true, win == false, draw == true`
11. **3-in-a-Row Non-Wins**: Horizontal, vertical, and both diagonal 3-stone lines $\rightarrow$ `valid == true, win == false`
12. **Tactical & Boundary Drops**: Defensive blocks and top-row drops $\rightarrow$ `valid == true, win == false`

*Result*: **40 / 40 positions (100% matched)** bit-for-bit with the local netlist simulator.

### 10.4 Hardened Scripts & Hosting
* **`scripts/tapeout.ts`**: Verifies BEM token address matches `0x60e62efa9405d6873c5deabd4e6cc91c25363952`, enforces minimum balances (>= 0.12 BEM and >= 0.005 OKB), checks factory and transistor allowances, includes `--dry-run` and interactive confirmations, and persists state to `deployments.json`.
* **`scripts/deploy.ts`**: Deploys `TapeFour.sol` with validated constructor arguments (0.005 OKB fee, 60/40 split, 24h move timeout, 10m bot timeout), verifies gas balance, supports `--dry-run`, and records deployment addresses and transaction hashes to `deployments.json`.
* **`scripts/verify_multicall.ts`**: Post-deployment verification script using canonical Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`) on X Layer to verify 5,000 random positions against the deployed processor.
* **Hosting**:
  * Unified web config: [`web/config.js`](file:///c:/Users/HomePC/Documents/tapefour/web/config.js).
  * Web app: 100% static, zero-build deployment ready for Cloudflare Pages, Netlify, or IPFS.
  * Bot operator daemon: Provided [`bot/start_operator.sh`](file:///c:/Users/HomePC/Documents/tapefour/bot/start_operator.sh), [`bot/start_operator.bat`](file:///c:/Users/HomePC/Documents/tapefour/bot/start_operator.bat), and PM2 configuration [`bot/ecosystem.config.cjs`](file:///c:/Users/HomePC/Documents/tapefour/bot/ecosystem.config.cjs) with automatic restart-on-crash.
  * Ranked UI: Displays 0.005 OKB fee, 60/40 split, estimated move gas (~3.45M), game status, slow-bot warning message, and an active 100% refund claim button.

### 10.5 Honest Limitations & Constraints
* **Windows Hardhat-EDR Native Bug**: Running consecutive 3.4M-gas EVM transactions on the Windows build of `@nomicfoundation/edr` causes an uncatchable native memory access violation (`STATUS_ACCESS_VIOLATION 0xC0000005`) after ~10–12 calls in a single process. Running in small isolated batches prevents crashes.
* **Post-Deploy 5,000 Position Check**: `scripts/verify_multicall.ts` is fully implemented and tested against Multicall3. It is ready to run against the real deployed contract once mainnet deployment is authorized.


---

## 11. Prize-Pool Security Fixes & Audit Verification (Phase 4b)

### 11.1 Security Bugs Addressed
1. **Global Prize Pool Draining Bug**:
   * *Previous*: Single global `prizePool` variable. When `lockWeeklyPool(week)` was called on any past week, it snapshotted the entire global `prizePool`. An attacker who won a single game in a low-volume past week could lock that week after later weeks deposited funds, claiming the entire accumulated balance of subsequent weeks.
   * *Fix*: Replaced global `prizePool` with isolated `mapping(uint64 => uint256) public weeklyPool`. Fees and prize shares are strictly partitioned by week.
2. **Start-Week vs. End-Week Attribution Bug**:
   * *Previous*: Wins and fees were attributed to `g.week` (the week the game started). If a game concluded after its start week was locked, `weeklyTotalWins` incremented after the snapshot, destabilizing proportional claims and risking contract balance insolvency.
   * *Fix*: Fees and wins are now strictly attributed to the week the game **ends** (`_isoWeek()` at settlement). `g.week` was completely removed from `struct Game`.
3. **Stuck Funds in Winless Weeks**:
   * *Previous*: If a week accumulated fees but human players had 0 wins (e.g. all games lost to the bot or forfeited), `lockWeeklyPool` reverted with `"no winners"`, locking those funds forever.
   * *Fix*: `lockWeeklyPool(week)` now checks `weeklyTotalWins[week]`. If zero, the funds in `weeklyPool[week]` automatically roll over into `weeklyPool[_isoWeek()]` (current active week), respecting `MAX_POOL` with any excess forwarded to the treasury.

### 11.2 Attack Scenarios & Exploit Tests
Added 4 comprehensive attack scenarios to [`contracts/test/TapeFour.test.js`](file:///c:/Users/HomePC/Documents/tapefour/contracts/test/TapeFour.test.js):
1. **Old Week Attacker Isolation**:
   * Verified that an attacker winning in an old quiet week (Week W) can only claim Week W's pool (`0.003 OKB`), even after 5 subsequent games in Week W+1 deposit `0.015 OKB` into the contract. Week W+1's pool remains 100% intact.
2. **Cross-Week Game Settlement**:
   * A game started in Week W that finishes in Week W+1 after Week W was locked has zero effect on Week W's total wins, snapshot, or pool. The win and fee are credited cleanly to Week W+1.
3. **Winless Week Rollover**:
   * Verified that a week where the bot won all games (0 human wins) rolls its entire accumulated fee pool into the next active week upon calling `lockWeeklyPool`. The rolled-over funds were subsequently claimed by the winner of Week W+1.
4. **Contract Invariant Fuzz Test**:
   * Executed 30 diverse sequential operations across multiple weeks (game starts, human wins, bot wins, draws, timeouts, forfeits, week locks, and prize claims).
   * Verified at every state transition that:
     $$\text{address(this).balance} \ge \sum \text{active escrow} + \sum \text{unlocked weekly pools} + \sum \text{unclaimed snapshots}$$
     and that the sum of claims for any locked week never exceeds its snapshot.

### 11.3 Test Suite Results
* **Hardhat Unit Tests**: **38 / 38 passing** (`TapeFour.test.js`, 16s).
* **Real Circuit Integration**: Full 7-move game and bot timeout refund on local X Layer fork verified on real 1,479-gate circuit (`TapeFour_real.test.js`, 2/2 passing).
* **Circuit Sub-Blocks**: All 69 winning lines, column decode, lowest empty cell verified (`test/test_subblocks.ts`).
* **UI Logic**: Win, draw, full column tests verified (`test/test_ui_logic.ts`).

### 11.4 Honest Report of Remaining Risks
1. **Operator Gas Margin at Elevated Gas Prices**: At standard gas prices on X Layer (0.021 Gwei), the 40% treasury share (0.002 OKB) yields a +31% to +83% profit margin over bot gas costs. However, if gas prices rise above 0.100 Gwei, the bot operator may run at a loss for long 42-move games unless the treasury subsidizes operator gas.
2. **Permissionless Lock Timing**: Anyone can call `lockWeeklyPool(week)` after week end. While deterministic and non-exploitable, if no one calls `lockWeeklyPool`, winners cannot claim until someone submits the transaction.
3. **Session Key Device Storage**: Ephemeral session keys are generated in browser `sessionStorage`. If a player clears browser storage or closes their private browsing tab mid-game, they must make their remaining moves directly from their main connected wallet.
