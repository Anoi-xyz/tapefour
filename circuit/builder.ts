// Circuit Netlist Builder for TAP-02 NAND Netlist
// Wire 0 = Constant FALSE (0)
// Wire 1 = Constant TRUE (1)
// Input wires = 2 .. 2 + numInputs - 1
// Gate wires = 2 + numInputs .. 2 + numInputs + numGates - 1

export interface NANDGate {
  in1: number;
  in2: number;
}

export class CircuitBuilder {
  readonly numInputs: number;
  readonly gates: NANDGate[] = [];
  readonly wireMap = new Map<string, number>();

  // Constants
  readonly CONST_0 = 0;
  readonly CONST_1 = 1;

  constructor(numInputs: number) {
    this.numInputs = numInputs;
  }

  get totalGates(): number {
    return this.gates.length;
  }

  // Returns wire index for input bit i (0 <= i < numInputs)
  inputWire(i: number): number {
    if (i < 0 || i >= this.numInputs) {
      throw new Error(`Input index ${i} out of bounds (0..${this.numInputs - 1})`);
    }
    return 2 + i;
  }

  // Add a raw NAND gate
  nand(in1: number, in2: number): number {
    // Canonical ordering for memoization
    const a = Math.min(in1, in2);
    const b = Math.max(in1, in2);

    // Constant propagation:
    // NAND(0, x) = 1
    if (a === this.CONST_0) return this.CONST_1;
    // NAND(1, 1) = 0
    if (a === this.CONST_1 && b === this.CONST_1) return this.CONST_0;
    // If a === CONST_1, NAND(1, b) = NOT(b)

    const key = `${a},${b}`;
    const existing = this.wireMap.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const wire = 2 + this.numInputs + this.gates.length;
    this.gates.push({ in1: a, in2: b });
    this.wireMap.set(key, wire);
    return wire;
  }

  // Add a raw NAND gate without memoization (used to pin exact output gate positions)
  rawNand(in1: number, in2: number): number {
    const a = Math.min(in1, in2);
    const b = Math.max(in1, in2);
    const wire = 2 + this.numInputs + this.gates.length;
    this.gates.push({ in1: a, in2: b });
    return wire;
  }

  // Primitive operations built from NAND
  not(x: number): number {
    if (x === this.CONST_0) return this.CONST_1;
    if (x === this.CONST_1) return this.CONST_0;
    return this.nand(x, x);
  }

  and(a: number, b: number): number {
    if (a === this.CONST_0 || b === this.CONST_0) return this.CONST_0;
    if (a === this.CONST_1) return b;
    if (b === this.CONST_1) return a;
    if (a === b) return a;
    const nandVal = this.nand(a, b);
    return this.not(nandVal);
  }

  or(a: number, b: number): number {
    if (a === this.CONST_1 || b === this.CONST_1) return this.CONST_1;
    if (a === this.CONST_0) return b;
    if (b === this.CONST_0) return a;
    if (a === b) return a;
    // OR(a, b) = NAND(NOT(a), NOT(b))
    const notA = this.not(a);
    const notB = this.not(b);
    return this.nand(notA, notB);
  }

  nor(a: number, b: number): number {
    return this.not(this.or(a, b));
  }

  xor(a: number, b: number): number {
    if (a === this.CONST_0) return b;
    if (b === this.CONST_0) return a;
    if (a === this.CONST_1) return this.not(b);
    if (b === this.CONST_1) return this.not(a);
    if (a === b) return this.CONST_0;
    // XOR using 4 NAND gates:
    // n = NAND(a, b)
    // XOR = NAND(NAND(a, n), NAND(b, n))
    const n = this.nand(a, b);
    return this.nand(this.nand(a, n), this.nand(b, n));
  }

  // 2:1 Multiplexer: sel ? b : a
  // sel=0 -> a, sel=1 -> b
  mux(sel: number, a: number, b: number): number {
    if (sel === this.CONST_0) return a;
    if (sel === this.CONST_1) return b;
    if (a === b) return a;
    // Mux using 4 NAND gates:
    // nSelA = NAND(NOT(sel), a) = NAND(NAND(sel, sel), a)
    // nSelB = NAND(sel, b)
    // res = NAND(nSelA, nSelB)
    const notSel = this.not(sel);
    const nA = this.nand(notSel, a);
    const nB = this.nand(sel, b);
    return this.nand(nA, nB);
  }

  // Multi-input AND
  andMany(inputs: number[]): number {
    if (inputs.length === 0) return this.CONST_1;
    let res = inputs[0];
    for (let i = 1; i < inputs.length; i++) {
      res = this.and(res, inputs[i]);
      if (res === this.CONST_0) return this.CONST_0;
    }
    return res;
  }

  // Multi-input OR
  orMany(inputs: number[]): number {
    if (inputs.length === 0) return this.CONST_0;
    let res = inputs[0];
    for (let i = 1; i < inputs.length; i++) {
      res = this.or(res, inputs[i]);
      if (res === this.CONST_1) return this.CONST_1;
    }
    return res;
  }

  // Serialize to TAP-02 binary netlist (opcode 0x00 + uint24 in1 + uint24 in2 = 7 bytes per gate)
  serialize(): Uint8Array {
    const bytes = new Uint8Array(this.gates.length * 7);
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      const offset = i * 7;
      bytes[offset] = 0x00; // opcode NAND
      // in1 big-endian 3 bytes
      bytes[offset + 1] = (g.in1 >> 16) & 0xff;
      bytes[offset + 2] = (g.in1 >> 8) & 0xff;
      bytes[offset + 3] = g.in1 & 0xff;
      // in2 big-endian 3 bytes
      bytes[offset + 4] = (g.in2 >> 16) & 0xff;
      bytes[offset + 5] = (g.in2 >> 8) & 0xff;
      bytes[offset + 6] = g.in2 & 0xff;
    }
    return bytes;
  }
}
