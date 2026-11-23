// Connect Four Reference Engine
// 7 columns x 6 rows (42 cells)
// cell index = col + 7 * row, row 0 = bottom row, row 5 = top row

export const COLS = 7;
export const ROWS = 6;
export const NUM_CELLS = 42;

export interface BoardState {
  boardA: bigint; // bits 0-41
  boardB: bigint; // bits 0-41
}

export interface MoveResult {
  valid: boolean;
  newBoardA: bigint;
  newBoardB: bigint;
  win: boolean;
  draw: boolean;
}

export function cellIndex(col: number, row: number): number {
  return col + 7 * row;
}

export function isOccupied(boardA: bigint, boardB: bigint, col: number, row: number): boolean {
  const idx = BigInt(cellIndex(col, row));
  const mask = 1n << idx;
  return ((boardA | boardB) & mask) !== 0n;
}

export function getLowestEmptyRow(boardA: bigint, boardB: bigint, col: number): number {
  if (col < 0 || col >= COLS) return -1;
  for (let r = 0; r < ROWS; r++) {
    if (!isOccupied(boardA, boardB, col, r)) {
      return r;
    }
  }
  return -1; // Column full
}

export function getAllWinningLines(): number[][] {
  const lines: number[][] = [];

  // 1. Horizontal lines (24 lines): row 0..5, col 0..3
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      lines.push([
        cellIndex(c, r),
        cellIndex(c + 1, r),
        cellIndex(c + 2, r),
        cellIndex(c + 3, r),
      ]);
    }
  }

  // 2. Vertical lines (21 lines): col 0..6, row 0..2
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r <= ROWS - 4; r++) {
      lines.push([
        cellIndex(c, r),
        cellIndex(c, r + 1),
        cellIndex(c, r + 2),
        cellIndex(c, r + 3),
      ]);
    }
  }

  // 3. Diagonal Up-Right / (12 lines): col 0..3, row 0..2
  for (let c = 0; c <= COLS - 4; c++) {
    for (let r = 0; r <= ROWS - 4; r++) {
      lines.push([
        cellIndex(c, r),
        cellIndex(c + 1, r + 1),
        cellIndex(c + 2, r + 2),
        cellIndex(c + 3, r + 3),
      ]);
    }
  }

  // 4. Diagonal Down-Right \ (12 lines): col 0..3, row 3..5
  for (let c = 0; c <= COLS - 4; c++) {
    for (let r = 3; r < ROWS; r++) {
      lines.push([
        cellIndex(c, r),
        cellIndex(c + 1, r - 1),
        cellIndex(c + 2, r - 2),
        cellIndex(c + 3, r - 3),
      ]);
    }
  }

  return lines;
}

export const WINNING_LINES = getAllWinningLines(); // exactly 69 lines (24 + 21 + 12 + 12 = 69)

export function checkWin(board: bigint): boolean {
  for (const line of WINNING_LINES) {
    const hasAll = line.every(cell => ((board >> BigInt(cell)) & 1n) === 1n);
    if (hasAll) return true;
  }
  return false;
}

export function isBoardFull(boardA: bigint, boardB: bigint): boolean {
  const fullMask = (1n << BigInt(NUM_CELLS)) - 1n; // 42 ones
  return ((boardA | boardB) & fullMask) === fullMask;
}

export function applyMove(
  boardA: bigint,
  boardB: bigint,
  col: number,
  turn: number // 0 = A, 1 = B
): MoveResult {
  if (col < 0 || col > 6) {
    return {
      valid: false,
      newBoardA: boardA,
      newBoardB: boardB,
      win: false,
      draw: false,
    };
  }

  const row = getLowestEmptyRow(boardA, boardB, col);
  if (row === -1) {
    return {
      valid: false,
      newBoardA: boardA,
      newBoardB: boardB,
      win: false,
      draw: false,
    };
  }

  const cell = cellIndex(col, row);
  const cellMask = 1n << BigInt(cell);

  let newBoardA = boardA;
  let newBoardB = boardB;

  if (turn === 0) {
    newBoardA = boardA | cellMask;
  } else {
    newBoardB = boardB | cellMask;
  }

  const moverBoard = (turn === 0) ? newBoardA : newBoardB;
  const win = checkWin(moverBoard);
  const full = isBoardFull(newBoardA, newBoardB);
  // In Connect Four, draw occurs when board is full and no one won on the final move
  const draw = full && !win;

  return {
    valid: true,
    newBoardA,
    newBoardB,
    win,
    draw,
  };
}

// Bit packing as per Section 5:
// Inputs (88 bits):
// bits 0-41: player A stones
// bits 42-83: player B stones
// bits 84-86: col (0-6)
// bit 87: turn (0=A, 1=B)
export function packInputs(boardA: bigint, boardB: bigint, col: number, turn: number): Uint8Array {
  const bytes = new Uint8Array(11); // 88 bits = 11 bytes
  let val = 0n;
  val |= (boardA & ((1n << 42n) - 1n));
  val |= (boardB & ((1n << 42n) - 1n)) << 42n;
  val |= (BigInt(col) & 7n) << 84n;
  val |= (BigInt(turn) & 1n) << 87n;

  for (let i = 0; i < 11; i++) {
    bytes[i] = Number((val >> BigInt(i * 8)) & 0xffn);
  }
  return bytes;
}

// Outputs (87 bits):
// bit 0: valid
// bits 1-42: new A stones
// bits 43-84: new B stones
// bit 85: win
// bit 86: draw
export function packOutputs(res: MoveResult): Uint8Array {
  const bytes = new Uint8Array(11); // ceil(87/8) = 11 bytes
  let val = 0n;
  if (res.valid) val |= 1n;
  val |= (res.newBoardA & ((1n << 42n) - 1n)) << 1n;
  val |= (res.newBoardB & ((1n << 42n) - 1n)) << 43n;
  if (res.win) val |= (1n << 85n);
  if (res.draw) val |= (1n << 86n);

  for (let i = 0; i < 11; i++) {
    bytes[i] = Number((val >> BigInt(i * 8)) & 0xffn);
  }
  return bytes;
}

export function unpackOutputs(bytes: Uint8Array): MoveResult {
  let val = 0n;
  for (let i = 0; i < bytes.length; i++) {
    val |= BigInt(bytes[i]) << BigInt(i * 8);
  }
  const valid = (val & 1n) === 1n;
  const newBoardA = (val >> 1n) & ((1n << 42n) - 1n);
  const newBoardB = (val >> 43n) & ((1n << 42n) - 1n);
  const win = ((val >> 85n) & 1n) === 1n;
  const draw = ((val >> 86n) & 1n) === 1n;

  return {
    valid,
    newBoardA,
    newBoardB,
    win,
    draw,
  };
}
