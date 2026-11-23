// RulesEngine Interface and Implementations
import { buildConnectFourCircuit } from '../circuit/circuit.ts';
import { CircuitSimulator } from '../circuit/simulator.ts';
import { packInputs, unpackOutputs } from './connect4.ts';
import type { MoveResult } from './connect4.ts';

export type VerificationSource = 'local-circuit-simulation' | 'on-chain';

export interface RulesEngineResult extends MoveResult {
  source: VerificationSource;
  rawInputHex: string;
  rawOutputHex: string;
  gateCount?: number;
}

export interface RulesEngine {
  evaluateMove(
    boardA: bigint,
    boardB: bigint,
    col: number,
    turn: number
  ): Promise<RulesEngineResult>;

  getVerificationSource(): VerificationSource;
}

// 1. Local Circuit Simulator Implementation
export class LocalCircuitSimulator implements RulesEngine {
  private sim: CircuitSimulator;
  private gatesCount: number;

  constructor() {
    const circuit = buildConnectFourCircuit();
    this.gatesCount = circuit.gateCount;
    this.sim = new CircuitSimulator(88, circuit.builder.gates, circuit.outputWires);
  }

  getVerificationSource(): VerificationSource {
    return 'local-circuit-simulation';
  }

  get gateCount(): number {
    return this.gatesCount;
  }

  async evaluateMove(
    boardA: bigint,
    boardB: bigint,
    col: number,
    turn: number
  ): Promise<RulesEngineResult> {
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

// 2. OnChainEval Implementation (stubbed until Phase 3 tape-out)
export class OnChainEval implements RulesEngine {
  private rpcUrl: string;
  private processorAddress: string | null;
  private circuitId: number | null;

  constructor(
    rpcUrl: string = 'https://rpc.xlayer.tech',
    processorAddress: string | null = null,
    circuitId: number | null = null
  ) {
    this.rpcUrl = rpcUrl;
    this.processorAddress = processorAddress;
    this.circuitId = circuitId;
  }

  getVerificationSource(): VerificationSource {
    return 'on-chain';
  }

  async evaluateMove(
    boardA: bigint,
    boardB: bigint,
    col: number,
    turn: number
  ): Promise<RulesEngineResult> {
    if (!this.processorAddress || this.circuitId === null) {
      throw new Error(
        'OnChainEval: Connect Four circuit has not been taped out on-chain yet (Phase 3).'
      );
    }

    const inBytes = packInputs(boardA, boardB, col, turn);
    const inHex = Array.from(inBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    // ABI encode eval(uint256,bytes) -> 0x934d06ea
    const evalData =
      '0x934d06ea' +
      this.circuitId.toString(16).padStart(64, '0') +
      (64).toString(16).padStart(64, '0') +
      inBytes.length.toString(16).padStart(64, '0') +
      inHex.padEnd(64, '0');

    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: this.processorAddress, data: evalData }, 'latest'],
      }),
    });

    const json = await response.json();
    if (!json.result) {
      throw new Error(`OnChain eval failed: ${JSON.stringify(json)}`);
    }

    // Decode ABI bytes return
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
