// Connect Four Bot Web Worker
// Performs deterministic minimax search in a background thread

import {
  cellIndex,
  applyMove,
  WINNING_LINES,
} from './engine.js';

const COLUMN_ORDER = [3, 2, 4, 1, 5, 0, 6];

const CELL_WEIGHTS = [
  3, 4, 5, 7, 5, 4, 3,
  4, 6, 8, 10, 8, 6, 4,
  5, 8, 11, 13, 11, 8, 5,
  5, 8, 11, 13, 11, 8, 5,
  4, 6, 8, 10, 8, 6, 4,
  3, 4, 5, 7, 5, 4, 3,
];

function getLegalColumns(boardA, boardB) {
  const occ = boardA | boardB;
  const legal = [];
  for (const c of COLUMN_ORDER) {
    const topCell = cellIndex(c, 5);
    if (((occ >> BigInt(topCell)) & 1n) === 0n) {
      legal.push(c);
    }
  }
  return legal;
}

function evaluateBoard(boardA, boardB, maximizingTurn) {
  const moverBoard = maximizingTurn === 0 ? boardA : boardB;
  const oppBoard = maximizingTurn === 0 ? boardB : boardA;
  let score = 0;

  for (let c = 0; c < 42; c++) {
    const mask = 1n << BigInt(c);
    if ((moverBoard & mask) !== 0n) score += CELL_WEIGHTS[c];
    else if ((oppBoard & mask) !== 0n) score -= CELL_WEIGHTS[c];
  }

  for (const line of WINNING_LINES) {
    let moverCount = 0;
    let oppCount = 0;
    for (const cell of line) {
      const mask = 1n << BigInt(cell);
      if ((moverBoard & mask) !== 0n) moverCount++;
      else if ((oppBoard & mask) !== 0n) oppCount++;
    }
    if (moverCount > 0 && oppCount > 0) continue;
    if (moverCount === 3) score += 50;
    else if (moverCount === 2) score += 10;
    if (oppCount === 3) score -= 60;
    else if (oppCount === 2) score -= 10;
  }
  return score;
}

function minimax(boardA, boardB, depth, alpha, beta, currentTurn, maximizingTurn) {
  const isMaximizing = currentTurn === maximizingTurn;
  const legalCols = getLegalColumns(boardA, boardB);

  if (legalCols.length === 0) return { score: 0, bestCol: -1 };
  if (depth === 0) {
    return { score: evaluateBoard(boardA, boardB, maximizingTurn), bestCol: legalCols[0] };
  }

  let bestCol = legalCols[0];

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const col of legalCols) {
      const res = applyMove(boardA, boardB, col, currentTurn);
      if (res.win) return { score: 100000 + depth, bestCol: col };
      if (res.draw) {
        if (0 > maxEval) { maxEval = 0; bestCol = col; }
        continue;
      }
      const evaluation = minimax(res.newBoardA, res.newBoardB, depth - 1, alpha, beta, 1 - currentTurn, maximizingTurn).score;
      if (evaluation > maxEval) {
        maxEval = evaluation;
        bestCol = col;
      }
      alpha = Math.max(alpha, evaluation);
      if (beta <= alpha) break;
    }
    return { score: maxEval, bestCol };
  } else {
    let minEval = Infinity;
    for (const col of legalCols) {
      const res = applyMove(boardA, boardB, col, currentTurn);
      if (res.win) return { score: -100000 - depth, bestCol: col };
      if (res.draw) {
        if (0 < minEval) { minEval = 0; bestCol = col; }
        continue;
      }
      const evaluation = minimax(res.newBoardA, res.newBoardB, depth - 1, alpha, beta, 1 - currentTurn, maximizingTurn).score;
      if (evaluation < minEval) {
        minEval = evaluation;
        bestCol = col;
      }
      beta = Math.min(beta, evaluation);
      if (beta <= alpha) break;
    }
    return { score: minEval, bestCol };
  }
}

self.onmessage = function (e) {
  const { boardAHex, boardBHex, botTurn, difficulty } = e.data;
  const boardA = BigInt(boardAHex);
  const boardB = BigInt(boardBHex);

  const legalCols = getLegalColumns(boardA, boardB);
  if (legalCols.length === 0) {
    self.postMessage({ error: 'No legal moves' });
    return;
  }

  // 1. Immediate Win
  for (const col of legalCols) {
    const res = applyMove(boardA, boardB, col, botTurn);
    if (res.win) {
      self.postMessage({ bestCol: col, immediate: 'win' });
      return;
    }
  }

  // 2. Immediate Block
  const oppTurn = 1 - botTurn;
  for (const col of legalCols) {
    const oppRes = applyMove(boardA, boardB, col, oppTurn);
    if (oppRes.win) {
      self.postMessage({ bestCol: col, immediate: 'block' });
      return;
    }
  }

  // 3. Search Depths
  let depth = 1;
  if (difficulty === 'medium') depth = 3;
  else if (difficulty === 'hard') depth = 5;

  const result = minimax(boardA, boardB, depth, -Infinity, Infinity, botTurn, botTurn);
  self.postMessage({ bestCol: result.bestCol, score: result.score });
};
