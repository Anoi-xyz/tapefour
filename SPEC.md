# SPEC: Connect Four on TapeOut (working title: TapeFour)

Read this whole file before writing code. Follow "Hard rules" at all times.

## 1. Goal
Build a Connect Four game whose rules are enforced by a TapeOut circuit on X Layer, for the
X Layer TapeOut Accelerate hackathon.
- Deadline: 7 Dec 2026, 23:59 UTC (provisional; re-check the official page).
- Must use TapeOut circuits, contracts or on-chain data on X Layer (chain ID 196) and provide
  the processor address + circuit ID.
- Judged on: user value and commercial potential, innovation, ecosystem integration,
  product readiness and UX, demo video (3 min max).

## 2. Hard rules (never break)
1. NEVER spend real funds, sign mainnet transactions, or use a real private key without the
   owner's explicit approval in that moment. Develop and test on a local fork of X Layer.
2. NEVER commit keys, seed phrases or .env files. Provide .env.example only.
3. No randomness anywhere in the game or circuit. Everything must be deterministic.
4. Test the circuit against a reference engine BEFORE building UI on top of it.
5. Keep the circuit small: target <= 1,500 NAND gates, hard limit 3,000. Report the gate count
   after every circuit change.
6. Keep contract code minimal. No admin function that can withdraw player funds or the prize pool.
7. Pin the TapeOut processor address in the contract at deploy. Do not make it changeable.
8. TapeOut contracts are unaudited test-phase: keep fees and prize amounts small.
9. If something is unknown (ABI, fees, gas cost), measure or read it from chain. Do not guess.

## 3. Game scope
- Connect Four, 7 columns x 6 rows, standard rules (4 in a row horizontal, vertical or diagonal).
- v1: human vs bot. Design the game mode as a setting so a two-human mode can be added later.
- Free casual mode: play the bot, every move checked by free eval(), nothing on-chain.
- Ranked mode: small fee, every move is an on-chain transaction, result recorded on-chain.

## 4. Architecture
1. `engine/` reference engine in JS/TS: board, legal moves, win/draw, used as test oracle.
2. `circuit/` Connect Four rules circuit (NAND netlist) + generator + tests.
3. `bot/` off-chain bot (minimax with alpha-beta, depth configurable, deterministic).
4. `web/` static front end (relative paths, no external requests except the X Layer RPC,
   so it could also be published on DeWEB later).
5. `contracts/` Hardhat project: ranked game contract, leaderboard, prize pool.
   Note: Foundry requires admin-level installation on Windows (curl pipe to bash); Hardhat
   is used instead — it is functionally equivalent for fork tests and fuzz-style tests,
   and is installable via npx without elevated privileges.
6. `docs/` architecture notes, measured gas, submission text.

## 5. Circuit spec
Pure combinational circuit, called with `eval(circuitId, inputs)`. Inputs and outputs are
bit-packed, least significant bit first.

Inputs (about 88 bits):
- bits 0-41: player A stones (cell index = col + 7 * row, row 0 = bottom)
- bits 42-83: player B stones
- bits 84-86: chosen column (0-6)
- bit 87: whose turn (0 = A, 1 = B)

Outputs (about 87 bits):
- bit 0: move valid (column in range and not full)
- bits 1-42: new A stones
- bits 43-84: new B stones
- bit 85: mover has four in a row after the move
- bit 86: board full (draw)

Logic blocks: column decode, full-column check, lowest-empty-cell finder, board update for
the mover, 69-line win check (24 horizontal, 21 vertical, 24 diagonal), draw check.

How to build: write the rules in Verilog or a truth-table/PLA form and synthesize to a NAND
netlist with TapeSynth (Verilog/PLA -> verified TAP-02 netlist, with tapeout and verify
commands), or write a netlist generator. Tape-out burns one transistor per gate.

Verification (required):
- Exhaustive tests for small sub-blocks (decode, lowest-empty, line checks).
- Random full-game simulation: 100k+ random legal games, circuit output must equal the
  reference engine on every move.
- After tape-out: check eval/step results on-chain against the local simulator.

## 6. Contract spec (ranked mode)
Solidity + Foundry. Tests must include fuzz tests and an X Layer mainnet-fork test.
- Calls the TapeOut processor `eval` with a low-level call and a gas cap. Any failure means
  the move is rejected (never treat a failure as valid).
- `startRanked()` payable: takes the ranked fee, creates a game, empty board, human = A.
- `playMove(gameId, col)`: human move. Contract builds inputs from stored board, calls eval,
  rejects invalid moves, stores the new board, checks win/draw.
- Bot moves: submitted by a designated bot-operator address via `playBotMove(gameId, col)`.
  The circuit still checks legality, so the operator cannot cheat on rules, only choose bot
  strength. State this trust assumption openly in the docs and submission.
- Timeouts: if the human does not move within a set time, the game is a forfeit.
- Result recorded on finish: win, loss or draw, per player.
- Fee split: X% to the weekly prize pool, rest to the project. Parameters set in the
  constructor.
- Leaderboard: wins per player per week.
- Weekly pool payout: claim-based (pull payment) for the top players at week end. No admin
  withdraw of the pool.
- Security basics: reentrancy guard, checks-effects-interactions, caps on fee and pool.

Settlement mode switch: build with a config flag so the contract can later settle by
replaying a submitted move list in one transaction instead of per-move transactions.
DECISION GATE at the end of Phase 1: measure real gas per move. If per-move cost or UX is
too poor, propose switching modes before building further.

## 7. Revenue model (for the submission)
Casual play vs bot is free. Ranked play costs a small fee that records a verified result
on-chain and counts toward a weekly leaderboard. Part of the fees funds a weekly prize pool,
the rest is the project's revenue. Why users pay: a permanent verifiable record and a chance
at prizes. Optional later: sell transistors on a custom processor so others can tape out
their own rule variants.

## 8. UX requirements
- Mobile-first, clean, fast. Board animation, clear turn indicator, win highlight.
- Show a "verified by circuit" badge on every move, with a link to the circuit ID.
- A "Verify this move" button that re-runs eval live and shows the match.
- Ranked flow shows fee, gas estimate and transaction status clearly.
- Casual mode works with no wallet connected.

## 9. Milestones (from 19 Nov 2026)
- Phase 0 (19-20 Nov): repo setup, reference engine, tests.
- Phase 1 (20-23 Nov): circuit, simulator tests, gate count, measure gas. Decision gate.
- Phase 2 (23-26 Nov): front end and bot using free eval, casual mode complete.
- Phase 3 (26-30 Nov): contract, fork tests, tape-out on X Layer, ranked mode end to end.
- Feature freeze: 1 Dec.
- Phase 4 (1-4 Dec): polish, demo video (3 min max), submission text.
- 5-6 Dec: buffer. Submit before 7 Dec 23:59 UTC; aim to submit on 6 Dec.

## 10. Definition of done
- Casual mode: full game vs bot, every move checked by the circuit, no wallet needed.
- Ranked mode: fee paid, each move accepted by the contract through the circuit, result and
  leaderboard recorded.
- Circuit matches the reference engine on 100k+ random games and on-chain eval.
- Processor address, circuit ID and access link are ready for the submission form.
- Demo video recorded.

## 11. Submission checklist
- Processor contract address and circuit ID
- Access link (website) and which TapeOut features are used (circuits, eval, processor;
  DeWEB only if actually used)
- Project description: the product, target users and how to reach them, revenue model,
  why users would pay and keep playing
- Demo video (3 min max): problem solved, core features demo, target users and business
  model, how TapeOut is used
- Submit via the official Google Form before the deadline

## 12. Known unknowns (verify, do not assume)
- Exact `eval` call signature and input packing: read from chain / circuit docs
- Real gas cost of one move on X Layer and the gas price
- Current tape-out and mint fees
- Whether the processor implementation is upgradeable
- Whether the deadline has changed on the official page

## 13. Working style for the agent
- Work phase by phase. At the end of each phase, summarize what works, the gate count, and
  the next step. Stop and ask before anything that costs money or touches mainnet.
- Prefer small commits with passing tests.
