// scripts/test_targeted_40.cjs
// Evaluates 40 targeted hand-picked positions on the real taped-out circuit on an X Layer fork.
// Wins in all 4 directions for both players, full column checks, col 7 checks,
// empty board checks, and last-cell draw.

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const BOARD_MASK = (1n << 42n) - 1n;
const FACTORY_ADDR = "0x1f09daefa827f02cbb40967cc91b259763760761";
const BEM_ADDR = "0x60e62efa9405d6873c5deabd4e6cc91c25363952";

function packInput(bA, bB, col, turn) {
  let val = 0n;
  val |= (bA & BOARD_MASK);
  val |= (bB & BOARD_MASK) << 42n;
  val |= (BigInt(col) & 7n) << 84n;
  val |= (BigInt(turn) & 1n) << 87n;
  const bytes = new Uint8Array(11);
  for (let i = 0; i < 11; i++) bytes[i] = Number((val >> BigInt(i * 8)) & 0xffn);
  return bytes;
}

function unpackOutput(bytes) {
  let val = 0n;
  for (let i = 0; i < 11; i++) val |= BigInt(bytes[i]) << BigInt(i * 8);
  const valid = (val & 1n) === 1n;
  const boardA = (val >> 1n) & BOARD_MASK;
  const boardB = (val >> 43n) & BOARD_MASK;
  const win = ((val >> 85n) & 1n) === 1n;
  const draw = ((val >> 86n) & 1n) === 1n;
  return { valid, boardA, boardB, win, draw };
}

function simulateNetlist(buf, inputBytes) {
  const numGates = Math.floor(buf.length / 7);
  const numInputs = 88;
  const gateOffset = 2 + numInputs;
  const totalWires = gateOffset + numGates;

  const wires = new Uint8Array(totalWires);
  wires[0] = 0; // CONST_0
  wires[1] = 1; // CONST_1

  for (let i = 0; i < numInputs; i++) {
    const byteIdx = i >> 3;
    const bitIdx = i & 7;
    wires[2 + i] = (inputBytes[byteIdx] >> bitIdx) & 1;
  }

  for (let i = 0; i < numGates; i++) {
    const offset = i * 7;
    const in1 = (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
    const in2 = (buf[offset + 4] << 16) | (buf[offset + 5] << 8) | buf[offset + 6];
    wires[gateOffset + i] = (wires[in1] & wires[in2]) ^ 1;
  }

  const outStartWire = gateOffset + numGates - 87;
  const outBytes = new Uint8Array(11);
  for (let i = 0; i < 87; i++) {
    if (wires[outStartWire + i]) {
      outBytes[i >> 3] |= (1 << (i & 7));
    }
  }
  return outBytes;
}

async function main() {
  console.log("=== Testing 40 Targeted Positions on Real Taped-Out Circuit ===");

  const [deployer] = await ethers.getSigners();

  // 1. Give deployer BEM balance
  const slot = 5;
  const balanceKey = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [deployer.address, slot])
  );
  const balanceVal = ethers.zeroPadValue(ethers.toBeHex(100n * 10n**8n), 32);
  await network.provider.send("hardhat_setStorageAt", [BEM_ADDR, balanceKey, balanceVal]);

  const bem = new ethers.Contract(BEM_ADDR, ["function approve(address, uint256) returns (bool)"], deployer);
  await (await bem.approve(FACTORY_ADDR, ethers.MaxUint256)).wait();

  // 2. Deploy fresh CPU via Factory
  const factory = new ethers.Contract(FACTORY_ADDR, [
    "function createCPU(string,string,string,uint256,uint256) returns (address)",
    "function cpuCount() view returns (uint256)",
    "function cpuAt(uint256) view returns (address)"
  ], deployer);

  const countBefore = await factory.cpuCount();
  await (await factory.createCPU("TapeFour CPU", "C4CPU", "https://tapefour.xyz/cpu/", 10000, 0)).wait();
  const cpuAddr = await factory.cpuAt(countBefore);

  // 3. Mint 1,479 transistors
  const cpu = new ethers.Contract(cpuAddr, [
    "function transistors() view returns (address)",
    "function TAPEOUT_FEE() view returns (uint256)",
    "function tapeout(bytes,uint32,uint32) payable returns (uint256)",
    "function eval(uint256,bytes) view returns (bytes)",
  ], deployer);

  const transAddr = await cpu.transistors();
  await (await bem.approve(transAddr, ethers.MaxUint256)).wait();
  const trans = new ethers.Contract(transAddr, ["function mint(uint256,uint256)"], deployer);
  await (await trans.mint(0, 1479)).wait();

  // 4. Tape out circuit
  const netlistPath = path.join(__dirname, "c4_netlist.bin");
  const netlistBytes = fs.readFileSync(netlistPath);
  const fee = await cpu.TAPEOUT_FEE();
  await (await cpu.tapeout(netlistBytes, 88, 87, { value: fee })).wait();
  const circuitId = 1n;

  console.log(`CPU deployed at ${cpuAddr}, circuitId=1 taped out (${netlistBytes.length} bytes, 1,479 gates)\n`);

  const ci = (c, r) => BigInt(c + 7 * r);
  const cellBit = (c, r) => 1n << ci(c, r);

  // Build the 40 targeted positions
  const targeted = [];

  // 1-4: Horizontal wins - Player A
  targeted.push({ name: "Horiz win P_A row 0 (cols 0,1,2,3)", bA: cellBit(0,0)|cellBit(1,0)|cellBit(2,0), bB: cellBit(0,1)|cellBit(1,1)|cellBit(2,1), col: 3, turn: 0, expWin: true });
  targeted.push({ name: "Horiz win P_A row 0 (cols 4,5,6,3)", bA: cellBit(4,0)|cellBit(5,0)|cellBit(6,0), bB: cellBit(4,1)|cellBit(5,1)|cellBit(6,1), col: 3, turn: 0, expWin: true });
  targeted.push({ name: "Horiz win P_A row 2 (cols 1,2,3,4)", bA: cellBit(1,2)|cellBit(2,2)|cellBit(3,2)|cellBit(1,0)|cellBit(2,0)|cellBit(3,0)|cellBit(4,0), bB: cellBit(1,1)|cellBit(2,1)|cellBit(3,1)|cellBit(4,1), col: 4, turn: 0, expWin: true });
  {
    let fullSupportA = 0n, fullSupportB = 0n;
    for (let c = 2; c <= 5; c++) for (let r = 0; r < 5; r++) {
      if (r % 2 === 0) fullSupportA |= cellBit(c, r); else fullSupportB |= cellBit(c, r);
    }
    fullSupportA |= cellBit(2,5) | cellBit(3,5) | cellBit(4,5);
    targeted.push({ name: "Horiz win P_A row 5 top row", bA: fullSupportA, bB: fullSupportB, col: 5, turn: 0, expWin: true });
  }

  // 5-7: Horizontal wins - Player B
  targeted.push({ name: "Horiz win P_B row 0 (cols 0,1,2,3)", bA: cellBit(0,1)|cellBit(1,1)|cellBit(2,1), bB: cellBit(0,0)|cellBit(1,0)|cellBit(2,0), col: 3, turn: 1, expWin: true });
  targeted.push({ name: "Horiz win P_B row 1 (cols 2,3,4,5)", bA: cellBit(2,0)|cellBit(3,0)|cellBit(4,0)|cellBit(5,0), bB: cellBit(2,1)|cellBit(3,1)|cellBit(4,1), col: 5, turn: 1, expWin: true });
  targeted.push({ name: "Horiz win P_B row 3 (cols 3,4,5,6)", bA: cellBit(3,0)|cellBit(4,0)|cellBit(5,0)|cellBit(6,0)|cellBit(3,2)|cellBit(4,2)|cellBit(5,2)|cellBit(6,2), bB: cellBit(3,1)|cellBit(4,1)|cellBit(5,1)|cellBit(6,1)|cellBit(3,3)|cellBit(4,3)|cellBit(5,3), col: 6, turn: 1, expWin: true });

  // 8-10: Vertical wins - Player A
  targeted.push({ name: "Vert win P_A col 0 (rows 0,1,2,3)", bA: cellBit(0,0)|cellBit(0,1)|cellBit(0,2), bB: cellBit(1,0)|cellBit(1,1)|cellBit(1,2), col: 0, turn: 0, expWin: true });
  targeted.push({ name: "Vert win P_A col 3 (rows 0,1,2,3)", bA: cellBit(3,0)|cellBit(3,1)|cellBit(3,2), bB: cellBit(2,0)|cellBit(2,1)|cellBit(2,2), col: 3, turn: 0, expWin: true });
  targeted.push({ name: "Vert win P_A col 6 (rows 2,3,4,5)", bA: cellBit(6,2)|cellBit(6,3)|cellBit(6,4), bB: cellBit(6,0)|cellBit(6,1), col: 6, turn: 0, expWin: true });

  // 11-13: Vertical wins - Player B
  targeted.push({ name: "Vert win P_B col 0 (rows 0,1,2,3)", bA: cellBit(1,0)|cellBit(1,1)|cellBit(1,2), bB: cellBit(0,0)|cellBit(0,1)|cellBit(0,2), col: 0, turn: 1, expWin: true });
  targeted.push({ name: "Vert win P_B col 4 (rows 1,2,3,4)", bA: cellBit(4,0)|cellBit(5,0)|cellBit(5,1), bB: cellBit(4,1)|cellBit(4,2)|cellBit(4,3), col: 4, turn: 1, expWin: true });
  targeted.push({ name: "Vert win P_B col 6 (rows 2,3,4,5)", bA: cellBit(6,0)|cellBit(6,1), bB: cellBit(6,2)|cellBit(6,3)|cellBit(6,4), col: 6, turn: 1, expWin: true });

  // 14-17: Diagonal / wins (Player A and B)
  targeted.push({ name: "Diag / win P_A (c0r0, c1r1, c2r2, c3r3)", bA: cellBit(0,0)|cellBit(1,1)|cellBit(2,2), bB: cellBit(1,0)|cellBit(2,0)|cellBit(2,1)|cellBit(3,0)|cellBit(3,1)|cellBit(3,2), col: 3, turn: 0, expWin: true });
  targeted.push({ name: "Diag / win P_A (c1r0, c2r1, c3r2, c4r3)", bA: cellBit(1,0)|cellBit(2,1)|cellBit(3,2), bB: cellBit(2,0)|cellBit(3,0)|cellBit(3,1)|cellBit(4,0)|cellBit(4,1)|cellBit(4,2), col: 4, turn: 0, expWin: true });
  targeted.push({ name: "Diag / win P_B (c0r0, c1r1, c2r2, c3r3)", bA: cellBit(1,0)|cellBit(2,0)|cellBit(2,1)|cellBit(3,0)|cellBit(3,1)|cellBit(3,2), bB: cellBit(0,0)|cellBit(1,1)|cellBit(2,2), col: 3, turn: 1, expWin: true });
  targeted.push({ name: "Diag / win P_B (c2r1, c3r2, c4r3, c5r4)", bA: cellBit(2,0)|cellBit(3,0)|cellBit(3,1)|cellBit(4,0)|cellBit(4,1)|cellBit(4,2)|cellBit(5,0)|cellBit(5,1)|cellBit(5,2)|cellBit(5,3), bB: cellBit(2,1)|cellBit(3,2)|cellBit(4,3), col: 5, turn: 1, expWin: true });

  // 18-21: Diagonal \ wins (Player A and B)
  targeted.push({ name: "Diag \\ win P_A (c0r3, c1r2, c2r1, c3r0)", bA: cellBit(0,3)|cellBit(1,2)|cellBit(2,1), bB: cellBit(0,0)|cellBit(0,1)|cellBit(0,2)|cellBit(1,0)|cellBit(1,1)|cellBit(2,0), col: 3, turn: 0, expWin: true });
  targeted.push({ name: "Diag \\ win P_A (c3r3, c4r2, c5r1, c6r0)", bA: cellBit(3,3)|cellBit(4,2)|cellBit(5,1), bB: cellBit(3,0)|cellBit(3,1)|cellBit(3,2)|cellBit(4,0)|cellBit(4,1)|cellBit(5,0), col: 6, turn: 0, expWin: true });
  targeted.push({ name: "Diag \\ win P_B (c0r3, c1r2, c2r1, c3r0)", bA: cellBit(0,0)|cellBit(0,1)|cellBit(0,2)|cellBit(1,0)|cellBit(1,1)|cellBit(2,0), bB: cellBit(0,3)|cellBit(1,2)|cellBit(2,1), col: 3, turn: 1, expWin: true });
  targeted.push({ name: "Diag \\ win P_B (c1r4, c2r3, c3r2, c4r1)", bA: cellBit(1,0)|cellBit(1,1)|cellBit(1,2)|cellBit(1,3)|cellBit(2,0)|cellBit(2,1)|cellBit(2,2)|cellBit(3,0)|cellBit(3,1)|cellBit(4,0), bB: cellBit(1,4)|cellBit(2,3)|cellBit(3,2), col: 4, turn: 1, expWin: true });

  // 22-24: Full column checks
  targeted.push({ name: "Full column 0 check", bA: cellBit(0,0)|cellBit(0,2)|cellBit(0,4), bB: cellBit(0,1)|cellBit(0,3)|cellBit(0,5), col: 0, turn: 0, expValid: false });
  targeted.push({ name: "Full column 3 check", bA: cellBit(3,0)|cellBit(3,2)|cellBit(3,4), bB: cellBit(3,1)|cellBit(3,3)|cellBit(3,5), col: 3, turn: 1, expValid: false });
  targeted.push({ name: "Full column 6 check", bA: cellBit(6,0)|cellBit(6,2)|cellBit(6,4), bB: cellBit(6,1)|cellBit(6,3)|cellBit(6,5), col: 6, turn: 0, expValid: false });

  // 25-26: Column 7 (out of bounds)
  targeted.push({ name: "Col 7 on empty board", bA: 0n, bB: 0n, col: 7, turn: 0, expValid: false });
  targeted.push({ name: "Col 7 on midgame board", bA: cellBit(3,0), bB: cellBit(3,1), col: 7, turn: 1, expValid: false });

  // 27-30: Empty board checks
  targeted.push({ name: "Empty board col 0 (P_A)", bA: 0n, bB: 0n, col: 0, turn: 0, expValid: true, expWin: false, expDraw: false });
  targeted.push({ name: "Empty board col 3 (P_A)", bA: 0n, bB: 0n, col: 3, turn: 0, expValid: true, expWin: false, expDraw: false });
  targeted.push({ name: "Empty board col 6 (P_A)", bA: 0n, bB: 0n, col: 6, turn: 0, expValid: true, expWin: false, expDraw: false });
  targeted.push({ name: "Empty board col 3 (P_B)", bA: 0n, bB: 0n, col: 3, turn: 1, expValid: true, expWin: false, expDraw: false });

  // 31: Last-cell draw
  {
    let drawA = 0n, drawB = 0n;
    for (let c = 0; c < 7; c++) {
      for (let r = 0; r < 6; r++) {
        if (c === 6 && r === 5) continue;
        const isA = ((Math.floor(r / 2) + Math.floor(c / 2)) % 2 === 0);
        if (isA) drawA |= cellBit(c, r); else drawB |= cellBit(c, r);
      }
    }
    targeted.push({ name: "Last-cell draw (42nd stone)", bA: drawA, bB: drawB, col: 6, turn: 1, expValid: true, expWin: false, expDraw: true });
  }

  // 32-35: 3-in-a-row non-winning checks
  targeted.push({ name: "Horiz 3-in-a-row (non-win)", bA: cellBit(0,0)|cellBit(1,0), bB: cellBit(4,0), col: 2, turn: 0, expValid: true, expWin: false });
  targeted.push({ name: "Vert 3-in-a-row (non-win)", bA: cellBit(2,0)|cellBit(2,1), bB: cellBit(4,0), col: 2, turn: 0, expValid: true, expWin: false });
  targeted.push({ name: "Diag / 3-in-a-row (non-win)", bA: cellBit(0,0)|cellBit(1,1), bB: cellBit(1,0)|cellBit(2,0)|cellBit(2,1), col: 2, turn: 0, expValid: true, expWin: false });
  targeted.push({ name: "Diag \\ 3-in-a-row (non-win)", bA: cellBit(0,2)|cellBit(1,1), bB: cellBit(0,0)|cellBit(0,1)|cellBit(1,0), col: 2, turn: 0, expValid: true, expWin: false });

  // 36-40: Additional strategic / boundary tests
  targeted.push({ name: "Col 1 full check", bA: cellBit(1,0)|cellBit(1,2)|cellBit(1,4), bB: cellBit(1,1)|cellBit(1,3)|cellBit(1,5), col: 1, turn: 0, expValid: false });
  targeted.push({ name: "Col 5 full check", bA: cellBit(5,0)|cellBit(5,2)|cellBit(5,4), bB: cellBit(5,1)|cellBit(5,3)|cellBit(5,5), col: 5, turn: 1, expValid: false });
  targeted.push({ name: "Non-winning defensive block", bA: cellBit(0,0)|cellBit(1,0)|cellBit(2,0), bB: cellBit(0,1)|cellBit(1,1), col: 3, turn: 1, expValid: true, expWin: false });
  targeted.push({ name: "Bottom row center play", bA: cellBit(2,0), bB: cellBit(4,0), col: 3, turn: 0, expValid: true, expWin: false });
  targeted.push({ name: "Top-row cell drop into col 4", bA: cellBit(4,0)|cellBit(4,2)|cellBit(4,4), bB: cellBit(4,1)|cellBit(4,3), col: 4, turn: 1, expValid: true, expWin: false });

  // Multicall3 canonical address
  const MULTICALL3_ADDR = "0xcA11bde05977b3631167028862bE2a173976CA11";
  const multicall = new ethers.Contract(MULTICALL3_ADDR, [
    "function aggregate3((address target, bool allowFailure, bytes callData)[]) view returns ((bool success, bytes returnData)[])"
  ], deployer);

  // Encode all 40 calls
  const calls = targeted.map(tc => {
    const inBytes = packInput(tc.bA, tc.bB, tc.col, tc.turn);
    const callData = cpu.interface.encodeFunctionData("eval", [circuitId, inBytes]);
    return {
      target: cpuAddr,
      allowFailure: false,
      callData: callData,
    };
  });

  console.log(`Executing all 40 targeted positions on-chain via Multicall3 (${MULTICALL3_ADDR})...`);
  const results = await multicall.aggregate3(calls);
  console.log(`Received 40 results from on-chain circuit!\n`);

  let matched = 0;
  for (let i = 0; i < targeted.length; i++) {
    const tc = targeted[i];
    const inBytes = packInput(tc.bA, tc.bB, tc.col, tc.turn);
    const simOut = simulateNetlist(netlistBytes, inBytes);
    const simRes = unpackOutput(simOut);

    const retData = results[i].returnData;
    const [evalBytesHex] = cpu.interface.decodeFunctionResult("eval", retData);
    const onchainBytes = ethers.getBytes(evalBytesHex);
    const onchainRes = unpackOutput(onchainBytes);

    if (ethers.hexlify(onchainBytes) !== ethers.hexlify(simOut)) {
      console.error(`MISMATCH on position ${i + 1}: ${tc.name}`);
      process.exit(1);
    }

    if (tc.expValid !== undefined && onchainRes.valid !== tc.expValid) {
      console.error(`VALID MISMATCH on ${tc.name}: expected ${tc.expValid}, got ${onchainRes.valid}`);
      process.exit(1);
    }
    if (tc.expWin !== undefined && onchainRes.win !== tc.expWin) {
      console.error(`WIN MISMATCH on ${tc.name}: expected ${tc.expWin}, got ${onchainRes.win}`);
      process.exit(1);
    }
    if (tc.expDraw !== undefined && onchainRes.draw !== tc.expDraw) {
      console.error(`DRAW MISMATCH on ${tc.name}: expected ${tc.expDraw}, got ${onchainRes.draw}`);
      process.exit(1);
    }

    matched++;
    console.log(`[${(i + 1).toString().padStart(2)}/40] Verified: ${tc.name.padEnd(38)} -> 100% MATCH`);
  }

  console.log(`\n======================================================`);
  console.log(`Targeted On-Chain Circuit Tests: ${matched} / ${targeted.length} PERFECT MATCHES (100%)`);
  console.log(`======================================================`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
