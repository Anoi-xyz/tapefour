// Connect Four Circuit and Engine for Web Front End
// Evaluates identical TAP-02 1,356 NAND gate netlist in the browser

export const COLS = 7;
export const ROWS = 6;
export const NUM_CELLS = 42;

export function cellIndex(col, row) {
  return col + 7 * row;
}

export function getAllWinningLines() {
  const lines = [];
  // 1. Horizontal
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      lines.push([cellIndex(c, r), cellIndex(c + 1, r), cellIndex(c + 2, r), cellIndex(c + 3, r)]);
    }
  }
  // 2. Vertical
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r <= ROWS - 4; r++) {
      lines.push([cellIndex(c, r), cellIndex(c, r + 1), cellIndex(c, r + 2), cellIndex(c, r + 3)]);
    }
  }
  // 3. Diagonal /
  for (let c = 0; c <= COLS - 4; c++) {
    for (let r = 0; r <= ROWS - 4; r++) {
      lines.push([cellIndex(c, r), cellIndex(c + 1, r + 1), cellIndex(c + 2, r + 2), cellIndex(c + 3, r + 3)]);
    }
  }
  // 4. Diagonal \
  for (let c = 0; c <= COLS - 4; c++) {
    for (let r = 3; r < ROWS; r++) {
      lines.push([cellIndex(c, r), cellIndex(c + 1, r - 1), cellIndex(c + 2, r - 2), cellIndex(c + 3, r - 3)]);
    }
  }
  return lines;
}

export const WINNING_LINES = getAllWinningLines();

export function isOccupied(boardA, boardB, col, row) {
  const idx = BigInt(cellIndex(col, row));
  const mask = 1n << idx;
  return ((boardA | boardB) & mask) !== 0n;
}

export function getLowestEmptyRow(boardA, boardB, col) {
  if (col < 0 || col >= COLS) return -1;
  for (let r = 0; r < ROWS; r++) {
    if (!isOccupied(boardA, boardB, col, r)) return r;
  }
  return -1;
}

export function checkWin(board) {
  for (const line of WINNING_LINES) {
    const hasAll = line.every(cell => ((board >> BigInt(cell)) & 1n) === 1n);
    if (hasAll) return true;
  }
  return false;
}

export function isBoardFull(boardA, boardB) {
  const fullMask = (1n << BigInt(NUM_CELLS)) - 1n;
  return ((boardA | boardB) & fullMask) === fullMask;
}

export function applyMove(boardA, boardB, col, turn) {
  if (col < 0 || col > 6) {
    return { valid: false, newBoardA: boardA, newBoardB: boardB, win: false, draw: false };
  }
  const row = getLowestEmptyRow(boardA, boardB, col);
  if (row === -1) {
    return { valid: false, newBoardA: boardA, newBoardB: boardB, win: false, draw: false };
  }
  const cell = cellIndex(col, row);
  const cellMask = 1n << BigInt(cell);

  let newBoardA = boardA;
  let newBoardB = boardB;
  if (turn === 0) newBoardA |= cellMask;
  else newBoardB |= cellMask;

  const moverBoard = turn === 0 ? newBoardA : newBoardB;
  const win = checkWin(moverBoard);
  const full = isBoardFull(newBoardA, newBoardB);
  const draw = full && !win;

  return { valid: true, newBoardA, newBoardB, win, draw };
}

export class CircuitBuilder {
  constructor(numInputs) {
    this.numInputs = numInputs;
    this.gates = [];
    this.wireMap = new Map();
    this.CONST_0 = 0;
    this.CONST_1 = 1;
  }

  get totalGates() {
    return this.gates.length;
  }

  inputWire(i) {
    return 2 + i;
  }

  nand(in1, in2) {
    const a = Math.min(in1, in2);
    const b = Math.max(in1, in2);
    if (a === this.CONST_0) return this.CONST_1;
    if (a === this.CONST_1 && b === this.CONST_1) return this.CONST_0;

    const key = `${a},${b}`;
    const existing = this.wireMap.get(key);
    if (existing !== undefined) return existing;

    const wire = 2 + this.numInputs + this.gates.length;
    this.gates.push({ in1: a, in2: b });
    this.wireMap.set(key, wire);
    return wire;
  }

  not(x) {
    if (x === this.CONST_0) return this.CONST_1;
    if (x === this.CONST_1) return this.CONST_0;
    return this.nand(x, x);
  }

  and(a, b) {
    if (a === this.CONST_0 || b === this.CONST_0) return this.CONST_0;
    if (a === this.CONST_1) return b;
    if (b === this.CONST_1) return a;
    if (a === b) return a;
    return this.not(this.nand(a, b));
  }

  or(a, b) {
    if (a === this.CONST_1 || b === this.CONST_1) return this.CONST_1;
    if (a === this.CONST_0) return b;
    if (b === this.CONST_0) return a;
    if (a === b) return a;
    return this.nand(this.not(a), this.not(b));
  }

  andMany(inputs) {
    if (inputs.length === 0) return this.CONST_1;
    let res = inputs[0];
    for (let i = 1; i < inputs.length; i++) {
      res = this.and(res, inputs[i]);
      if (res === this.CONST_0) return this.CONST_0;
    }
    return res;
  }

  orMany(inputs) {
    if (inputs.length === 0) return this.CONST_0;
    let res = inputs[0];
    for (let i = 1; i < inputs.length; i++) {
      res = this.or(res, inputs[i]);
      if (res === this.CONST_1) return this.CONST_1;
    }
    return res;
  }
}

export function buildConnectFourCircuit() {
  const b = new CircuitBuilder(88);

  const wireA = [];
  const notWireA = [];
  for (let i = 0; i < 42; i++) {
    const w = b.inputWire(i);
    wireA.push(w);
    notWireA.push(b.not(w));
  }

  const wireB = [];
  const notWireB = [];
  for (let i = 0; i < 42; i++) {
    const w = b.inputWire(42 + i);
    wireB.push(w);
    notWireB.push(b.not(w));
  }

  const wireCol = [b.inputWire(84), b.inputWire(85), b.inputWire(86)];
  const wireTurn = b.inputWire(87);

  const wireOcc = [];
  for (let c = 0; c < 42; c++) {
    wireOcc.push(b.nand(notWireA[c], notWireB[c]));
  }

  const notC0 = b.not(wireCol[0]);
  const notC1 = b.not(wireCol[1]);
  const notC2 = b.not(wireCol[2]);

  const colDecoded = [
    b.and(b.and(notC2, notC1), notC0),
    b.and(b.and(notC2, notC1), wireCol[0]),
    b.and(b.and(notC2, wireCol[1]), notC0),
    b.and(b.and(notC2, wireCol[1]), wireCol[0]),
    b.and(b.and(wireCol[2], notC1), notC0),
    b.and(b.and(wireCol[2], notC1), wireCol[0]),
    b.and(b.and(wireCol[2], wireCol[1]), notC0),
  ];

  const wirePlaced = new Array(42);
  const colCanAcceptMove = new Array(7);

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

  const colValidTerms = [];
  for (let c = 0; c < 7; c++) {
    colValidTerms.push(b.and(colDecoded[c], colCanAcceptMove[c]));
  }
  const wireValid = b.orMany(colValidTerms);

  const notTurn = b.not(wireTurn);
  const wireNewA = new Array(42);
  const wireNewB = new Array(42);
  const wireMoverBoard = new Array(42);

  for (let cell = 0; cell < 42; cell++) {
    const nPA = b.nand(wirePlaced[cell], notTurn);
    const newA = b.nand(notWireA[cell], nPA);
    wireNewA[cell] = newA;

    const nPB = b.nand(wirePlaced[cell], wireTurn);
    const newB = b.nand(notWireB[cell], nPB);
    wireNewB[cell] = newB;

    const sA = b.nand(notTurn, newA);
    const sB = b.nand(wireTurn, newB);
    wireMoverBoard[cell] = b.nand(sA, sB);
  }

  const lines = getAllWinningLines();
  const lineWins = [];
  for (const line of lines) {
    const p1 = b.and(wireMoverBoard[line[0]], wireMoverBoard[line[1]]);
    const p2 = b.and(wireMoverBoard[line[2]], wireMoverBoard[line[3]]);
    lineWins.push(b.and(p1, p2));
  }
  const rawWin = b.orMany(lineWins);
  const wireWin = b.and(rawWin, wireValid);

  const topOccs = [];
  for (let c = 0; c < 7; c++) {
    const topCell = c + 7 * 5;
    topOccs.push(b.or(wireOcc[topCell], wirePlaced[topCell]));
  }
  const boardFull = b.andMany(topOccs);
  const notWin = b.not(wireWin);
  const wireDraw = b.andMany([wireValid, boardFull, notWin]);

  const outputWires = [
    wireValid,
    ...wireNewA,
    ...wireNewB,
    wireWin,
    wireDraw,
  ];

  return {
    builder: b,
    outputWires,
    gateCount: b.totalGates,
  };
}

export class CircuitSimulator {
  constructor(numInputs, gates, outputWires) {
    this.numInputs = numInputs;
    this.gates = gates;
    this.numGates = gates.length;
    this.outputWires = new Int32Array(outputWires);

    this.in1Arr = new Int32Array(this.numGates);
    this.in2Arr = new Int32Array(this.numGates);
    for (let i = 0; i < this.numGates; i++) {
      this.in1Arr[i] = gates[i].in1;
      this.in2Arr[i] = gates[i].in2;
    }

    const totalWires = 2 + numInputs + this.numGates;
    this.wireValues = new Uint8Array(totalWires);
    this.wireValues[0] = 0;
    this.wireValues[1] = 1;

    this.outBytes = new Uint8Array(Math.ceil(outputWires.length / 8));
  }

  evaluate(inputs) {
    const wireValues = this.wireValues;
    const numInputs = this.numInputs;

    if (inputs instanceof Uint8Array) {
      for (let i = 0; i < numInputs; i++) {
        const byteIdx = i >> 3;
        const bitIdx = i & 7;
        wireValues[2 + i] = (inputs[byteIdx] >> bitIdx) & 1;
      }
    } else {
      for (let i = 0; i < numInputs; i++) {
        wireValues[2 + i] = inputs[i] & 1;
      }
    }

    const in1 = this.in1Arr;
    const in2 = this.in2Arr;
    const numGates = this.numGates;
    const gateOffset = 2 + numInputs;

    for (let i = 0; i < numGates; i++) {
      wireValues[gateOffset + i] = (wireValues[in1[i]] & wireValues[in2[i]]) ^ 1;
    }

    const outWires = this.outputWires;
    const outWiresLen = outWires.length;
    const outBytes = new Uint8Array(this.outBytes.length);

    for (let i = 0; i < outWiresLen; i++) {
      const bitVal = wireValues[outWires[i]];
      if (bitVal) {
        outBytes[i >> 3] |= (1 << (i & 7));
      }
    }

    return outBytes;
  }
}

export function packInputs(boardA, boardB, col, turn) {
  const bytes = new Uint8Array(11);
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

export function unpackOutputs(bytes) {
  let val = 0n;
  for (let i = 0; i < bytes.length; i++) {
    val |= BigInt(bytes[i]) << BigInt(i * 8);
  }
  const valid = (val & 1n) === 1n;
  const newBoardA = (val >> 1n) & ((1n << 42n) - 1n);
  const newBoardB = (val >> 43n) & ((1n << 42n) - 1n);
  const win = ((val >> 85n) & 1n) === 1n;
  const draw = ((val >> 86n) & 1n) === 1n;

  return { valid, newBoardA, newBoardB, win, draw };
}

export class LocalCircuitSimulatorRulesEngine {
  constructor() {
    const circuit = buildConnectFourCircuit();
    this.gatesCount = circuit.gateCount;
    this.sim = new CircuitSimulator(88, circuit.builder.gates, circuit.outputWires);
  }

  getVerificationSource() {
    return 'local-circuit-simulation';
  }

  get gateCount() {
    return this.gatesCount;
  }

  async evaluateMove(boardA, boardB, col, turn) {
    const inBytes = packInputs(boardA, boardB, col, turn);
    const outBytes = this.sim.evaluate(inBytes);
    const moveRes = unpackOutputs(outBytes);

    const rawInputHex = '0x' + Array.from(inBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const rawOutputHex = '0x' + Array.from(outBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    return {
      ...moveRes,
      source: 'local-circuit-simulation',
      rawInputHex,
      rawOutputHex,
      gateCount: this.gatesCount,
    };
  }
}

export class OnChainEvalRulesEngine {
  constructor(rpcUrl = 'https://rpc.xlayer.tech', processorAddress = null, circuitId = null) {
    this.rpcUrl = rpcUrl;
    this.processorAddress = processorAddress;
    this.circuitId = circuitId;
  }

  getVerificationSource() {
    return 'on-chain';
  }

  async evaluateMove(boardA, boardB, col, turn) {
    if (!this.processorAddress || this.circuitId === null) {
      throw new Error('OnChainEval: Connect Four circuit not yet taped out on-chain (Phase 3).');
    }
    const inBytes = packInputs(boardA, boardB, col, turn);
    const inHex = Array.from(inBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    const evalData =
      '0x934d06ea' +
      this.circuitId.toString(16).padStart(64, '0') +
      (64).toString(16).padStart(64, '0') +
      inBytes.length.toString(16).padStart(64, '0') +
      inHex.padEnd(64, '0');

    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: this.processorAddress, data: evalData }, 'latest'],
      }),
    });
    const json = await res.json();
    if (!json.result) throw new Error('On-chain eval failed: ' + JSON.stringify(json));

    const raw = json.result.slice(2);
    const len = parseInt(raw.slice(64, 128), 16);
    const outHex = raw.slice(128, 128 + len * 2);
    const outBytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      outBytes[i] = parseInt(outHex.slice(i * 2, i * 2 + 2), 16);
    }
    const moveRes = unpackOutputs(outBytes);
    return {
      ...moveRes,
      source: 'on-chain',
      rawInputHex: '0x' + inHex,
      rawOutputHex: '0x' + outHex,
    };
  }
}
