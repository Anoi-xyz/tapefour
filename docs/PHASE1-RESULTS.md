# Phase 1 Results: Connect Four Rules Circuit & Evaluation

## 1. Executive Summary

Phase 1 implemented the combinational Connect Four rules circuit, local execution simulators, verification against the reference engine across millions of moves, exact chain discovery of TapeOut on X Layer, and on-chain evaluation benchmarking.

* **Target Gate Count**: $\le 1,500$ NAND gates (Hard limit: 3,000)
* **Final Gate Count Achieved**: **1,356 NAND gates** (144 gates below the target)
* **Sub-Block Tests**: 100% Passed (Column decode, full column detection, lowest empty cell finder, and all 69 winning lines)
* **Random Games Simulation**: **100,000 legal games** evaluated (2,079,668 moves); 100% match between circuit output and reference engine.
* **On-Chain Verification**: 1,000 random input positions evaluated against live processor on X Layer via Multicall3; 100% match with local simulator.

---

## 2. Measured vs. Projected

To ensure complete clarity and transparency regarding test environments and metrics:

1. **On-Chain Evaluation Benchmark Target**:
   * The 1,000-position on-chain verification was executed against **Circuit ID 1** on the default processor **CPU 0** (`0x839bdd6fa7a66416a609a735e11de5411b98574e`). Circuit 1 is a verified 4-NAND combinational logic block deployed on X Layer.
   * **Our Connect Four rules circuit itself has NOT been taped out or evaluated on-chain yet** (per SPEC milestones, the tape-out transaction on X Layer occurs in Phase 3 after fork verification and testing).

2. **Gas per Move (Projection vs. Direct Measurement)**:
   * The gas figure of **$\approx 2,750,000$ gas per move** is a **projection** derived from measuring actual execution gas across existing on-chain circuits on X Layer (which scale linearly at $\approx 47,500$ base overhead $+ \approx 1,980 - 2,000$ gas per NAND gate).
   * Because our 1,356-gate circuit is not yet deployed on-chain, this gas figure is a calculated projection rather than a direct transaction measurement of the Connect Four circuit.

3. **Transistor Minting Costs & Revert Analysis**:
   * On TapeOut, circuits require 1 burned transistor per gate (1,356 transistors for our design).
   * **CPU 0** (`0x839bdd...`): Transistor contract `0xbe0eee424c49d44592e4d498740f5b031ef8e26d`.
     * `protocolFee`: 660,000,000,000,000 wei ($6.6 \times 10^{14}$ wei $\approx 0.00066$ OKB) per transistor.
     * `supplyCap`: 100,000 transistors.
     * **Why the earlier mint call reverted**: The contract reverted with `"execution reverted: supply cap"` because the 100,000 supply cap for CPU 0's transistor token had already been fully minted out by earlier participants.
   * **CPU 434** (`0x9c5bdc...`): Modern CPU container (`0x278b48ae9a2c4a9415e0a372694457b9e93ca967`).
     * `mintPrice`: 0 wei.
     * `protocolFee`: 1,000,000 wei ($10^6$ wei) per unit.
     * `paymentToken`: Custom ERC20 token at `0xeddb9881d316eca48e4886800067f4c4d18b4ba9`.
     * **Why the earlier mint call reverted**: Reverted with `ERC20InsufficientAllowance(0x278b..., 0, 1000000)` because transistor mints on CPU 434 require an ERC20 token allowance.
   * **Total Cost for 1,356 Gates on Target CPU**:
     * When deploying a fresh custom processor via CPU Factory (`createCPU`), the creator sets the supply cap, payment token (or native OKB), and mint price.
     * At factory default rates: 1,356 transistors $\times 10^6$ wei protocol fee $= 1,356,000,000$ wei ($\approx 0.000000001356$ OKB, negligible) plus the $0.0013$ OKB tapeout fee.

---

## 3. Circuit Architecture & Optimization Log

The circuit adheres strictly to **SPEC.md Section 5**:
* **Inputs (88 bits)**:
  * Bits 0–41: Player A stones ($cell = col + 7 \times row$, row 0 bottom)
  * Bits 42–83: Player B stones
  * Bits 84–86: Chosen column ($0..6$)
  * Bit 87: Whose turn ($0 = \text{A}, 1 = \text{B}$)
* **Outputs (87 bits)**:
  * Bit 0: Move valid (column in range and not full)
  * Bits 1–42: New Player A stones
  * Bits 43–84: New Player B stones
  * Bit 85: Mover has four in a row after the move (win)
  * Bit 86: Board full without win (draw)

### Gate Count Progression:
1. **Initial Baseline**: **1,580 NAND gates**
   * *Architecture*: Standard multiplexers for mover stone selection, naive 4-input AND trees per winning line.
   * *Status*: Over target of 1,500.
2. **Pairwise Win Check Sharing**: **1,531 NAND gates** (-49 gates)
   * *Optimization*: Reused shared pairs of adjacent cell AND gates across overlapping lines.
3. **De Morgan Cell Update & Direct Inversion**: **1,356 NAND gates** (-175 gates)
   * *Optimization*:
     * $\text{placedA} = \text{placed} \land \neg\text{turn}$, $\text{newA} = \text{A} \lor \text{placedA} = \text{NAND}(\neg\text{A}, \text{NAND}(\text{placed}, \neg\text{turn}))$.
     * $\text{placedB} = \text{placed} \land \text{turn}$, $\text{newB} = \text{B} \lor \text{placedB} = \text{NAND}(\neg\text{B}, \text{NAND}(\text{placed}, \text{turn}))$.
     * Mover board multiplexing directly derived using De Morgan equivalents.
   * *Final Result*: **1,356 NAND gates** (Target $\le 1,500$ met, savings of 144 gates).

---

## 4. TapeOut Protocol on X Layer (Chain ID 196)

By querying the public RPC `https://rpc.xlayer.tech`, the on-chain infrastructure was identified:

* **CPU Factory**: `0x1f09daefa827f02cbb40967cc91b259763760761`
* **Factory Implementation**: `0x336e9F0F4c3fEe7C8c803377e4DEA00293f4ae2a`
* **Circuit Beacon**: `0xf70d1ed4f62cf3780157b0b421b7e2f45bd0991c`
* **Circuit Implementation**: `0x977f217887E085D298Cb3819cDAD5A0ee35F29B2`
* **Transistor Beacon**: `0x1059ad62cabb6a6925bb65aa617300556c60a51b`
* **Transistor Implementation**: `0x265bf10faB9ddEC0eE0A649C6B9DB845f1b9a06b`
* **Default Processor (CPU 0)**: `0x839bdd6fa7a66416a609a735e11de5411b98574e`

### Exact ABI Signatures:
* **Circuit Info**: `circuitInfo(uint256 id) returns (uint32 inBits, uint32 outBits, uint32 latches, uint32 nands)` (`0x084d60f1`)
* **Netlist**: `netlist(uint256 id) returns (bytes)` (`0x3fc4be56`)
* **Combinational Evaluation**: `eval(uint256 id, bytes inputs) returns (bytes outputs)` (`0x934d06ea`)
* **Tape-out**: `tapeout(bytes netlist, uint32 inBits, uint32 outBits)` (`0x7bd3ac1d`)

### Protocol Fees:
* **Factory Deploy Fee**: 10,000,000 wei ($10^7$ wei)
* **Factory Protocol Fee**: 1,000,000 wei ($10^6$ wei)
* **Tape-Out Fee**: 1,300,000,000,000,000 wei (**0.0013 OKB**, $\approx \$0.06$ USD)
* **X Layer Current Gas Price**: **0.020 Gwei** ($2 \times 10^7$ wei).

---

## 5. Upgradeability Analysis

* **Processor Contracts**: Each processor (e.g., `0x839bdd...`) is deployed behind an **ERC1967 BeaconProxy** pointing to `Circuit Beacon` (`0xf70d1ed4f62cf3780157b0b421b7e2f45bd0991c`).
* **Beacon Owner**: Address `0x0000000000000000000000000000000000000000`. The creator burned the beacon owner key (`seal()`), making the circuit implementation permanently immutable.
* **Risk Assessment**: The processor code cannot be altered, ensuring full trust minimization for on-chain game evaluation.

---

## 6. Decision Gate Recommendation (Section 6 of SPEC.md)

### Recommendation: Keep Per-Move On-Chain Transactions (with Move-List Settlement as Optional Mode)

**Reasoning**:
1. **Extremely Low Gas Fees on X Layer**: At 0.02 Gwei, a full $2.75\text{M}$ gas `eval` costs less than **\$0.003 USD**. A full 30-move Connect Four game costs under **\$0.10 USD** total on-chain.
2. **Superior Real-Time UX**: Recording moves on-chain in real-time provides immediate verification badges, tamper-proof spectator observation, and instant forfeit enforcement upon timeout.
3. **Move-List Settlement Compatibility**: The ranked contract can easily support both: per-move state updates for live ranked matches, and batch move list replay for asynchronous or low-bandwidth games.
