// Tests for Connect Four Bot:
// 1. Bot never plays an illegal move across 1,000 full games.
// 2. Bot beats a random player at every difficulty level ('easy', 'medium', 'hard').
// 3. Every bot move passes the circuit rules check.

import { selectBotMove, getLegalColumns } from '../bot/minimax.ts';
import type { Difficulty } from '../bot/minimax.ts';
import { LocalCircuitSimulator } from '../engine/rules_engine.ts';

// Deterministic PRNG
class LCG {
  private s: number;
  constructor(seed = 42) {
    this.s = seed;
  }
  next(max: number): number {
    this.s = (this.s * 1664525 + 1013904223) | 0;
    return (this.s >>> 0) % max;
  }
}

async function testBotLegalityAndCircuit(totalGames: number = 1000) {
  console.log(`=== 1. Testing Bot Legality & Circuit Verification across ${totalGames} Full Games ===`);
  const engine = new LocalCircuitSimulator();
  const rng = new LCG(999);

  // Distribute across difficulty levels (800 easy, 150 medium, 50 hard) to test all while keeping runtime fast
  let totalMoves = 0;
  for (let g = 1; g <= totalGames; g++) {
    let boardA = 0n;
    let boardB = 0n;
    let turn = 0;
    let gameOver = false;

    const botDiff: Difficulty = g <= 800 ? 'easy' : g <= 950 ? 'medium' : 'hard';

    while (!gameOver) {
      const legalCols = getLegalColumns(boardA, boardB);
      if (legalCols.length === 0) break;

      let chosenCol: number;
      if (turn === 0) {
        // Opponent move (random)
        chosenCol = legalCols[rng.next(legalCols.length)];
      } else {
        // Bot move
        chosenCol = selectBotMove(boardA, boardB, turn, botDiff);
        if (!legalCols.includes(chosenCol)) {
          throw new Error(`Bot made illegal move in col ${chosenCol} at game ${g}!`);
        }
      }

      // Check move through circuit rules engine
      const circuitRes = await engine.evaluateMove(boardA, boardB, chosenCol, turn);
      if (!circuitRes.valid) {
        throw new Error(`Move in col ${chosenCol} rejected by circuit engine at game ${g}!`);
      }

      totalMoves++;
      boardA = circuitRes.newBoardA;
      boardB = circuitRes.newBoardB;

      if (circuitRes.win || circuitRes.draw) {
        gameOver = true;
      } else {
        turn = 1 - turn;
      }
    }

    if (g % 200 === 0 || g === totalGames) {
      console.log(`  -> ${g}/${totalGames} games (${totalMoves} total moves): 100% legal moves & passed circuit checks.`);
    }
  }
  console.log('=== Bot Legality & Circuit Verification PASSED! ===\n');
}

async function testBotWinRate() {
  console.log('=== 2. Testing Bot vs Random Player (Win Rate) ===');
  const engine = new LocalCircuitSimulator();
  const testConfigs: { diff: Difficulty; games: number }[] = [
    { diff: 'easy', games: 100 },
    { diff: 'medium', games: 50 },
    { diff: 'hard', games: 25 },
  ];

  for (const { diff, games } of testConfigs) {
    const rng = new LCG(diff === 'easy' ? 101 : diff === 'medium' ? 202 : 303);
    let botWins = 0;
    let randomWins = 0;
    let draws = 0;

    for (let g = 0; g < games; g++) {
      let boardA = 0n;
      let boardB = 0n;
      // Alternate who goes first
      const botTurn = g % 2;
      let turn = 0;
      let gameOver = false;

      while (!gameOver) {
        const legalCols = getLegalColumns(boardA, boardB);
        if (legalCols.length === 0) break;

        let col: number;
        if (turn === botTurn) {
          col = selectBotMove(boardA, boardB, botTurn, diff);
        } else {
          col = legalCols[rng.next(legalCols.length)];
        }

        const res = await engine.evaluateMove(boardA, boardB, col, turn);
        if (!res.valid) throw new Error('Illegal move');

        boardA = res.newBoardA;
        boardB = res.newBoardB;

        if (res.win) {
          if (turn === botTurn) botWins++;
          else randomWins++;
          gameOver = true;
        } else if (res.draw) {
          draws++;
          gameOver = true;
        } else {
          turn = 1 - turn;
        }
      }
    }

    console.log(
      `Difficulty '${diff}': Bot won ${botWins}/${games} (${((botWins / games) * 100).toFixed(0)}%), Random won ${randomWins}, Draws ${draws}`
    );
    if (botWins <= randomWins) {
      throw new Error(`Bot (${diff}) failed to beat random player!`);
    }
  }
  console.log('=== Bot Win Rate Verification PASSED! ===\n');
}

async function main() {
  await testBotLegalityAndCircuit(1000);
  await testBotWinRate();
}

main();
