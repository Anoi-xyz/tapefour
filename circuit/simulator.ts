// High-Performance Local Simulator for TAP-02 Netlists
import type { NANDGate } from './builder.ts';

export class CircuitSimulator {
  readonly numInputs: number;
  readonly gates: NANDGate[];
  readonly outputWires: Int32Array;

  // Flattened gate inputs for peak V8 loop performance
  private readonly in1Arr: Int32Array;
  private readonly in2Arr: Int32Array;
  private readonly wireValues: Uint8Array;
  private readonly outBytes: Uint8Array;
  private readonly numGates: number;

  constructor(numInputs: number, gates: NANDGate[], outputWires: number[]) {
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

  evaluate(inputs: Uint8Array | number[]): Uint8Array {
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

    // Hot loop: fully inlined, JIT optimized
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
