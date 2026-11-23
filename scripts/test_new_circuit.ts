import { CircuitBuilder } from '../circuit/builder.ts';
import { getAllWinningLines } from '../engine/connect4.ts';
import { CircuitSimulator } from '../circuit/simulator.ts';

export function buildDirectConnectFourCircuit() {
  const b = new CircuitBuilder(88);

  // 1. Map input wires
  const wireA: number[] = [];
  const notWireA: number[] = [];
  for (let i = 0; i < 42; i++) {
    const w = b.inputWire(i);
    wireA.push(w);
    notWireA.push(b.not(w));
  }

  const wireB: number[] = [];
  const notWireB: number[] = [];
  for (let i = 0; i < 42; i++) {
    const w = b.inputWire(42 + i);
    wireB.push(w);
    notWireB.push(b.not(w));
  }

  const wireCol = [b.inputWire(84), b.inputWire(85), b.inputWire(86)];
  const wireTurn = b.inputWire(87);
  const notTurn = b.not(wireTurn);

  // 2. Cell occupancy: occ[cell] = A[cell] OR B[cell] = NAND(NOT(A), NOT(B))
  const wireOcc: number[] = [];
  for (let c = 0; c < 42; c++) {
    wireOcc.push(b.nand(notWireA[c], notWireB[c]));
  }

  // 3. Column decode: decode 3-bit col into 7 one-hot signals (col 0..6)
  const notC0 = b.not(wireCol[0]);
  const notC1 = b.not(wireCol[1]);
  const notC2 = b.not(wireCol[2]);

  const colDecoded: number[] = [
    b.and(b.and(notC2, notC1), notC0),
    b.and(b.and(notC2, notC1), wireCol[0]),
    b.and(b.and(notC2, wireCol[1]), notC0),
    b.and(b.and(notC2, wireCol[1]), wireCol[0]),
    b.and(b.and(wireCol[2], notC1), notC0),
    b.and(b.and(wireCol[2], notC1), wireCol[0]),
    b.and(b.and(wireCol[2], wireCol[1]), notC0),
  ];

  // 4. Lowest empty cell finder per column
  const wirePlaced: number[] = new Array(42);
  const colCanAcceptMove: number[] = new Array(7);

  for (let c = 0; c < 7; c++) {
    const notOcc0 = b.not(wireOcc[c + 7 * 0]);
    const notOcc1 = b.not(wireOcc[c + 7 * 1]);
    const notOcc2 = b.not(wireOcc[c + 7 * 2]);
    const notOcc3 = b.not(wireOcc[c + 7 * 3]);
    const notOcc4 = b.not(wireOcc[c + 7 * 4]);
    const notOcc5 = b.not(wireOcc[c + 7 * 5]);

    const occ0 = wireOcc[c + 7 * 0];
    const occ01 = b.and(occ0, wireOcc[c + 7 * 1]);
    const occ02 = b.and(occ01, wireOcc[c + 7 * 2]);
    const occ03 = b.and(occ02, wireOcc[c + 7 * 3]);
    const occ04 = b.and(occ03, wireOcc[c + 7 * 4]);

    const empty0 = notOcc0;
    const empty1 = b.and(occ0, notOcc1);
    const empty2 = b.and(occ01, notOcc2);
    const empty3 = b.and(occ02, notOcc3);
    const empty4 = b.and(occ03, notOcc4);
    const empty5 = b.and(occ04, notOcc5);

    const colAllFull = b.and(occ04, wireOcc[c + 7 * 5]);
    colCanAcceptMove[c] = b.not(colAllFull);

    const emptyRows = [empty0, empty1, empty2, empty3, empty4, empty5];
    for (let r = 0; r < 6; r++) {
      const cell = c + 7 * r;
      wirePlaced[cell] = b.and(colDecoded[c], emptyRows[r]);
    }
  }

  // 5. Precompute mover board for win check:
  // mover = (turn ? B : A) | placed
  const wireMoverBoard: number[] = new Array(42);
  for (let cell = 0; cell < 42; cell++) {
    const origMover = b.mux(wireTurn, wireA[cell], wireB[cell]);
    wireMoverBoard[cell] = b.or(origMover, wirePlaced[cell]);
  }

  // 6. Win check (69 lines):
  const lines = getAllWinningLines();
  const lineWins: number[] = [];
  for (const line of lines) {
    const p1 = b.and(wireMoverBoard[line[0]], wireMoverBoard[line[1]]);
    const p2 = b.and(wireMoverBoard[line[2]], wireMoverBoard[line[3]]);
    lineWins.push(b.and(p1, p2));
  }
  const rawWin = b.orMany(lineWins);

  // 7. Board full check:
  const topOccs: number[] = [];
  for (let c = 0; c < 7; c++) {
    const topCell = c + 7 * 5;
    topOccs.push(b.or(wireOcc[topCell], wirePlaced[topCell]));
  }
  const boardFull = b.andMany(topOccs);

  // 8. Precompute terms for newA and newB:
  // newA = A | (placed & !turn) = NAND(notA, NAND(placed, notTurn))
  const nPA: number[] = new Array(42);
  const nPB: number[] = new Array(42);
  for (let cell = 0; cell < 42; cell++) {
    nPA[cell] = b.nand(wirePlaced[cell], notTurn);
    nPB[cell] = b.nand(wirePlaced[cell], wireTurn);
  }

  // Precompute notColValidTerms for valid OR:
  const colValidTerms: number[] = [];
  for (let c = 0; c < 7; c++) {
    colValidTerms.push(b.and(colDecoded[c], colCanAcceptMove[c]));
  }
  // OR of 7 terms = NAND(NOT(t0), NOT(t1), ...)
  const notColValid = colValidTerms.map(t => b.not(t));
  const notAllValid = b.andMany(notColValid); // = NOT(wireValid)

  // Precompute notDraw and nWin BEFORE emitting output gates:
  // wireValid = NOT(notAllValid)
  // nWin = NAND(rawWin, wireValid)
  const notRawWin = b.not(rawWin);
  const nWin = b.or(notRawWin, notAllValid); // by De Morgan: NAND(rawWin, NOT(notAllValid)) = NOT(rawWin) OR notAllValid

  // wireValid & boardFull = NOT(notAllValid) & boardFull
  const validAndFull = b.and(b.not(notAllValid), boardFull);
  const nDraw = b.nand(validAndFull, nWin);

  // --- NOW EMIT EXACTLY THE 87 OUTPUT GATES IN TOPOLOGICAL ORDER ---
  const finalOutputWires: number[] = [];

  // Gate 0: wireValid = NOT(notAllValid) = NAND(notAllValid, 1)
  const wireValid = b.rawNand(notAllValid, b.CONST_1);
  finalOutputWires.push(wireValid);

  // Gates 1..42: newBoardA[0..41]
  for (let cell = 0; cell < 42; cell++) {
    const w = b.rawNand(notWireA[cell], nPA[cell]);
    finalOutputWires.push(w);
  }

  // Gates 43..84: newBoardB[0..41]
  for (let cell = 0; cell < 42; cell++) {
    const w = b.rawNand(notWireB[cell], nPB[cell]);
    finalOutputWires.push(w);
  }

  // Gate 85: wireWin = NOT(nWin) = NAND(nWin, 1)
  const wireWin = b.rawNand(nWin, b.CONST_1);
  finalOutputWires.push(wireWin);

  // Gate 86: wireDraw = NOT(nDraw) = NAND(nDraw, 1)
  const wireDraw = b.rawNand(nDraw, b.CONST_1);
  finalOutputWires.push(wireDraw);

  return {
    builder: b,
    outputWires: finalOutputWires,
    gateCount: b.totalGates,
  };
}

const { builder, gateCount, outputWires } = buildDirectConnectFourCircuit();
console.log('Optimized Direct Gate Count:', gateCount);
console.log('Total gates:', builder.gates.length);
console.log('Output wires count:', outputWires.length);
console.log('Last 87 gate wires start at:', 2 + 88 + builder.gates.length - 87);
console.log('First output wire:', outputWires[0]);
console.log('Last output wire:', outputWires[86]);
console.log('Are output wires EXACTLY the last 87 gates?:', 
  outputWires.every((w, idx) => w === (2 + 88 + builder.gates.length - 87 + idx))
);
