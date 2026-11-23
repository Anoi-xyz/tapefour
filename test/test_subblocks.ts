// Sub-block exhaustive tests
import { buildConnectFourCircuit } from '../circuit/circuit.ts';
import { CircuitSimulator } from '../circuit/simulator.ts';
import { packInputs, unpackOutputs, applyMove, getAllWinningLines, ROWS, COLS, cellIndex } from '../engine/connect4.ts';

function runSubBlockTests() {
  console.log('=== Running Sub-Block Tests ===');
  const circuit = buildConnectFourCircuit();
  const sim = new CircuitSimulator(88, circuit.builder.gates, circuit.outputWires);

  // 1. Column decode & full-column check test
  console.log('1. Testing Column Decode and Full-Column Check...');
  for (let col = 0; col < 8; col++) {
    // Test empty board
    const inEmpty = packInputs(0n, 0n, col, 0);
    const outEmpty = unpackOutputs(sim.evaluate(inEmpty));
    if (col < 7) {
      if (!outEmpty.valid) throw new Error(`Empty board col ${col} should be valid`);
      if (outEmpty.newBoardA !== (1n << BigInt(cellIndex(col, 0)))) {
        throw new Error(`Col ${col} placed wrong cell on empty board`);
      }
    } else {
      if (outEmpty.valid) throw new Error(`Col 7 must be invalid`);
    }

    // Test each column full
    if (col < 7) {
      // fill col with 6 stones
      let colFullBoard = 0n;
      for (let r = 0; r < 6; r++) {
        colFullBoard |= (1n << BigInt(cellIndex(col, r)));
      }
      const inFull = packInputs(colFullBoard, 0n, col, 0);
      const outFull = unpackOutputs(sim.evaluate(inFull));
      if (outFull.valid) throw new Error(`Full column ${col} must be invalid`);
    }
  }
  console.log('  -> Column decode and full-column check PASSED.');

  // 2. Lowest empty cell finder test
  console.log('2. Testing Lowest Empty Cell Finder...');
  for (let c = 0; c < 7; c++) {
    for (let height = 0; height <= 6; height++) {
      let bA = 0n;
      let bB = 0n;
      for (let r = 0; r < height; r++) {
        // alternate A and B
        if (r % 2 === 0) bA |= (1n << BigInt(cellIndex(c, r)));
        else bB |= (1n << BigInt(cellIndex(c, r)));
      }
      const inBytes = packInputs(bA, bB, c, 0);
      const out = unpackOutputs(sim.evaluate(inBytes));
      if (height < 6) {
        if (!out.valid) throw new Error(`Col ${c} height ${height} should be valid`);
        const expectedCell = cellIndex(c, height);
        const placed = out.newBoardA ^ bA;
        if (placed !== (1n << BigInt(expectedCell))) {
          throw new Error(`Col ${c} height ${height}: expected cell ${expectedCell}, got ${placed}`);
        }
      } else {
        if (out.valid) throw new Error(`Col ${c} height 6 should be invalid`);
      }
    }
  }
  console.log('  -> Lowest empty cell finder PASSED.');

  // 3. Each of the 69 winning lines test
  console.log('3. Testing Each of the 69 Winning Lines...');
  const lines = getAllWinningLines();
  if (lines.length !== 69) throw new Error(`Expected 69 lines, got ${lines.length}`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Place 3 stones in line on board, make move with the 4th stone
    // We choose the 4th stone as the move to test win detection
    // First, let's sort cells by row so gravity is respected
    const sorted = [...line].sort((a, b) => (a % 7) - (b % 7));
    // Let the winning move be sorted[3]
    const moveCell = sorted[3];
    const moveCol = moveCell % 7;
    const moveRow = Math.floor(moveCell / 7);

    // To make moveRow the lowest empty cell in moveCol, fill rows 0..moveRow-1 in moveCol
    let bA = 0n;
    let bB = 0n;

    // Fill supporting stones for moveCol
    for (let r = 0; r < moveRow; r++) {
      bB |= (1n << BigInt(cellIndex(moveCol, r)));
    }

    // Place the first 3 stones of the line
    for (let j = 0; j < 3; j++) {
      const c = sorted[j] % 7;
      const r = Math.floor(sorted[j] / 7);
      bA |= (1n << BigInt(sorted[j]));
      // Also fill supporting stones for that cell
      for (let sr = 0; sr < r; sr++) {
        bB |= (1n << BigInt(cellIndex(c, sr)));
      }
    }

    // Test player A making the winning move
    const inA = packInputs(bA, bB, moveCol, 0);
    const outA = unpackOutputs(sim.evaluate(inA));
    const refA = applyMove(bA, bB, moveCol, 0);

    if (outA.win !== true) {
      throw new Error(`Line ${i} failed win check for player A! Line: ${JSON.stringify(line)}`);
    }
    if (outA.win !== refA.win || outA.valid !== refA.valid) {
      throw new Error(`Line ${i} mismatch with reference engine for player A`);
    }

    // Test player B making the winning move
    const inB = packInputs(bB, bA, moveCol, 1);
    const outB = unpackOutputs(sim.evaluate(inB));
    const refB = applyMove(bB, bA, moveCol, 1);

    if (outB.win !== true) {
      throw new Error(`Line ${i} failed win check for player B! Line: ${JSON.stringify(line)}`);
    }
    if (outB.win !== refB.win || outB.valid !== refB.valid) {
      throw new Error(`Line ${i} mismatch with reference engine for player B`);
    }
  }
  console.log('  -> All 69 winning lines verified successfully for both players!');

  console.log('=== ALL SUB-BLOCK TESTS PASSED ===\n');
}

runSubBlockTests();
