// Connect Four Deterministic Minimax Bot with Alpha-Beta Pruning
// 3 Difficulty Levels: 'easy', 'medium', 'hard'
// Strictly deterministic: no Math.random(), fixed column search order [3, 2, 4, 1, 5, 0, 6]

import {
  COLS,
  ROWS,
  cellIndex,
  applyMove,
  checkWin,
  isBoardFull,
  WINNING_LINES,
} from '../engine/connect4.ts';

export type Difficulty = 'easy' | 'medium' | 'hard';

// Search order preferring central columns for better alpha-beta cutoffs
export const COLUMN_ORDER = [3, 2, 4, 1, 5, 0, 6];

// Positional weight table: central cells have more winning line intersections
export const CELL_WEIGHTS: number[] = [
  3, 4, 5, 7, 5, 4, 3, // row 0
  4, 6, 8, 10, 8, 6, 4, // row 1
  5, 8, 11, 13, 11, 8, 5, // row 2
  5, 8, 11, 13, 11, 8, 5, // row 3
  4, 6, 8, 10, 8, 6, 4, // row 4
  3, 4, 5, 7, 5, 4, 3, // row 5
];

export function getLegalColumns(boardA: bigint, boardB: bigint): number[] {
  const occ = boardA | boardB;
  const legal: number[] = [];
  for (const c of COLUMN_ORDER) {
    const topCell = cellIndex(c, 5);
    if (((occ >> BigInt(topCell)) & 1n) === 0n) {
      legal.push(c);
    }
  }
  return legal;
}

// Heuristic evaluation of the board from perspective of `maximizingTurn`
export function evaluateBoard(boardA: bigint, boardB: bigint, maximizingTurn: number): number {
  const moverBoard = maximizingTurn === 0 ? boardA : boardB;
  const oppBoard = maximizingTurn === 0 ? boardB : boardA;

  let score = 0;

  // 1. Positional stone weights
  for (let c = 0; c < 42; c++) {
    const mask = 1n << BigInt(c);
    if ((moverBoard & mask) !== 0n) {
      score += CELL_WEIGHTS[c];
    } else if ((oppBoard & mask) !== 0n) {
      score -= CELL_WEIGHTS[c];
    }
  }

  // 2. Line potential evaluation
  for (const line of WINNING_LINES) {
    let moverCount = 0;
    let oppCount = 0;

    for (const cell of line) {
      const mask = 1n << BigInt(cell);
      if ((moverBoard & mask) !== 0n) moverCount++;
      else if ((oppBoard & mask) !== 0n) oppCount++;
    }

    if (moverCount > 0 && oppCount > 0) {
      // Line is blocked by both players
      continue;
    }

    if (moverCount === 3) score += 50;
    else if (moverCount === 2) score += 10;

    if (oppCount === 3) score -= 60; // Opponent 3-in-a-row is a major threat
    else if (oppCount === 2) score -= 10;
  }

  return score;
}

export function minimax(
  boardA: bigint,
  boardB: bigint,
  depth: number,
  alpha: number,
  beta: number,
  currentTurn: number,
  maximizingTurn: number
): { score: number; bestCol: number } {
  const isMaximizing = currentTurn === maximizingTurn;
  const legalCols = getLegalColumns(boardA, boardB);

  if (legalCols.length === 0) {
    return { score: 0, bestCol: -1 }; // Draw
  }

  if (depth === 0) {
    return {
      score: evaluateBoard(boardA, boardB, maximizingTurn),
      bestCol: legalCols[0],
    };
  }

  let bestCol = legalCols[0];

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const col of legalCols) {
      const res = applyMove(boardA, boardB, col, currentTurn);
      if (res.win) {
        return { score: 100000 + depth, bestCol: col };
      }
      if (res.draw) {
        if (0 > maxEval) {
          maxEval = 0;
          bestCol = col;
        }
        continue;
      }

      const nextTurn = 1 - currentTurn;
      const evaluation = minimax(
        res.newBoardA,
        res.newBoardB,
        depth - 1,
        alpha,
        beta,
        nextTurn,
        maximizingTurn
      ).score;

      if (evaluation > maxEval) {
        maxEval = evaluation;
        bestCol = col;
      }
      alpha = Math.max(alpha, evaluation);
      if (beta <= alpha) break; // Beta cutoff
    }
    return { score: maxEval, bestCol };
  } else {
    let minEval = Infinity;
    for (const col of legalCols) {
      const res = applyMove(boardA, boardB, col, currentTurn);
      if (res.win) {
        return { score: -100000 - depth, bestCol: col };
      }
      if (res.draw) {
        if (0 < minEval) {
          minEval = 0;
          bestCol = col;
        }
        continue;
      }

      const nextTurn = 1 - currentTurn;
      const evaluation = minimax(
        res.newBoardA,
        res.newBoardB,
        depth - 1,
        alpha,
        beta,
        nextTurn,
        maximizingTurn
      ).score;

      if (evaluation < minEval) {
        minEval = evaluation;
        bestCol = col;
      }
      beta = Math.min(beta, evaluation);
      if (beta <= alpha) break; // Alpha cutoff
    }
    return { score: minEval, bestCol };
  }
}

export function selectBotMove(
  boardA: bigint,
  boardB: bigint,
  botTurn: number,
  difficulty: Difficulty
): number {
  const legalCols = getLegalColumns(boardA, boardB);
  if (legalCols.length === 0) {
    throw new Error('No legal moves available');
  }

  // 1. Immediate Win Check (all difficulties take an immediate win)
  for (const col of legalCols) {
    const res = applyMove(boardA, boardB, col, botTurn);
    if (res.win) return col;
  }

  // 2. Immediate Block Check (all difficulties block an opponent immediate win)
  const oppTurn = 1 - botTurn;
  for (const col of legalCols) {
    const oppRes = applyMove(boardA, boardB, col, oppTurn);
    if (oppRes.win) return col;
  }

  // 3. Search depths per difficulty level
  let searchDepth: number;
  if (difficulty === 'easy') {
    searchDepth = 1; // Evaluates board after 1 move
  } else if (difficulty === 'medium') {
    searchDepth = 3; // Looks ahead 3 plies
  } else {
    // 'hard'
    searchDepth = 5; // Deep lookahead with rapid response time (~20-50ms)
  }

  const { bestCol } = minimax(
    boardA,
    boardB,
    searchDepth,
    -Infinity,
    Infinity,
    botTurn,
    botTurn
  );

  return bestCol;
}
