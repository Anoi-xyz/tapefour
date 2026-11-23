// UI Logic Tests for Win, Draw, and Full Column
import { LocalCircuitSimulator } from '../engine/rules_engine.ts';
import { cellIndex, COLS, ROWS } from '../engine/connect4.ts';

async function runUILogicTests() {
  console.log('=== Running UI Logic Tests ===');
  const engine = new LocalCircuitSimulator();

  // 1. Win Detection Test (Horizontal, Vertical, Diagonal)
  console.log('1. Testing Win Detection in UI Logic...');
  {
    // Horizontal Win: A places at col 0, 1, 2, 3 on row 0
    let bA = 0n;
    let bB = 0n;
    // moves: A(0,0), B(0,1), A(1,0), B(1,1), A(2,0), B(2,1), A(3,0) -> Win!
    const moves = [
      { col: 0, turn: 0 },
      { col: 0, turn: 1 },
      { col: 1, turn: 0 },
      { col: 1, turn: 1 },
      { col: 2, turn: 0 },
      { col: 2, turn: 1 },
      { col: 3, turn: 0 },
    ];
    let finalRes: any = null;
    for (const m of moves) {
      finalRes = await engine.evaluateMove(bA, bB, m.col, m.turn);
      if (!finalRes.valid) throw new Error('Move should be valid');
      bA = finalRes.newBoardA;
      bB = finalRes.newBoardB;
    }
    if (!finalRes.win) throw new Error('Horizontal 4-in-a-row must trigger win');
    console.log('  -> Horizontal win correctly detected.');
  }

  {
    // Vertical Win: B places 4 stones stacked in col 4
    let bA = 0n;
    let bB = 0n;
    // moves: A(0,0), B(4,0), A(1,0), B(4,1), A(2,0), B(4,2), A(0,1), B(4,3) -> Win!
    const moves = [
      { col: 0, turn: 0 },
      { col: 4, turn: 1 },
      { col: 1, turn: 0 },
      { col: 4, turn: 1 },
      { col: 2, turn: 0 },
      { col: 4, turn: 1 },
      { col: 0, turn: 0 },
      { col: 4, turn: 1 },
    ];
    let finalRes: any = null;
    for (const m of moves) {
      finalRes = await engine.evaluateMove(bA, bB, m.col, m.turn);
      bA = finalRes.newBoardA;
      bB = finalRes.newBoardB;
    }
    if (!finalRes.win) throw new Error('Vertical 4-in-a-row must trigger win');
    console.log('  -> Vertical win correctly detected.');
  }

  {
    // Diagonal Win: / from (0,0) to (3,3)
    let bA = 0n;
    let bB = 0n;
    // (0,0): A
    // (1,0): B, (1,1): A
    // (2,0): B, (2,1): B, (2,2): A
    // (3,0): B, (3,1): B, (3,2): B, (3,3): A
    const seq = [
      { c: 0, t: 0 }, // A at (0,0)
      { c: 1, t: 1 }, // B at (1,0)
      { c: 1, t: 0 }, // A at (1,1)
      { c: 2, t: 1 }, // B at (2,0)
      { c: 2, t: 1 }, // B at (2,1)
      { c: 2, t: 0 }, // A at (2,2)
      { c: 3, t: 1 }, // B at (3,0)
      { c: 3, t: 1 }, // B at (3,1)
      { c: 3, t: 1 }, // B at (3,2)
      { c: 3, t: 0 }, // A at (3,3) -> Win!
    ];
    let finalRes: any = null;
    for (const m of seq) {
      finalRes = await engine.evaluateMove(bA, bB, m.c, m.t);
      bA = finalRes.newBoardA;
      bB = finalRes.newBoardB;
    }
    if (!finalRes.win) throw new Error('Diagonal 4-in-a-row must trigger win');
    console.log('  -> Diagonal win correctly detected.');
  }

  // 2. Full Column Detection Test
  console.log('2. Testing Full Column Rejection in UI Logic...');
  {
    let bA = 0n;
    let bB = 0n;
    // Fill column 2 to the top (6 stones)
    for (let r = 0; r < 6; r++) {
      const res = await engine.evaluateMove(bA, bB, 2, r % 2);
      if (!res.valid) throw new Error(`Row ${r} should be valid`);
      bA = res.newBoardA;
      bB = res.newBoardB;
    }

    // 7th attempt in column 2 must be rejected
    const invalidRes = await engine.evaluateMove(bA, bB, 2, 0);
    if (invalidRes.valid) throw new Error('7th stone in full column must be invalid!');
    if (invalidRes.newBoardA !== bA || invalidRes.newBoardB !== bB) {
      throw new Error('Board state must not change on invalid move');
    }
    console.log('  -> Full column rejection correctly verified.');
  }

  // 3. Draw Detection Test
  console.log('3. Testing Draw Detection (Board Full, No Win)...');
  {
    // A known Connect Four draw sequence (standard 42-move draw):
    // Columns sequence:
    // Pattern: alternate columns to avoid 4 in a row
    // Column 0: A B A B A B
    // Column 1: A B A B A B
    // Column 2: B A B A B A
    // Column 3: B A B A B A
    // Column 4: A B A B A B
    // Column 5: A B A B A B
    // Column 6: B A B A B A
    // Let's verify by simulating a manufactured non-winning full board:
    // Board A has 21 stones, Board B has 21 stones, no 4-in-a-row.
    let bA = 0n;
    let bB = 0n;

    // Pattern: A A B B A A / B B A A B B alternating
    for (let c = 0; c < 7; c++) {
      for (let r = 0; r < 6; r++) {
        // Skip last cell to test final move
        if (c === 6 && r === 5) continue;
        const isA = ((c + Math.floor(r / 2)) % 2 === 0);
        const cell = cellIndex(c, r);
        if (isA) bA |= (1n << BigInt(cell));
        else bB |= (1n << BigInt(cell));
      }
    }

    // Last empty cell is (6, 5)
    // Make move in col 6 by player B (turn 1)
    const drawRes = await engine.evaluateMove(bA, bB, 6, 1);
    if (!drawRes.valid) throw new Error('Final move in draw game must be valid');
    if (drawRes.win) throw new Error('Constructed draw game should not be a win');
    if (!drawRes.draw) throw new Error('Full board without win must be a DRAW!');
    console.log('  -> Draw correctly detected on final stone.');
  }

  console.log('=== ALL UI LOGIC TESTS PASSED! ===\n');
}

runUILogicTests();
