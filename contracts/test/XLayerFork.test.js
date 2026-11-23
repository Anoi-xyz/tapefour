// test/XLayerFork.test.js
// Fork test for TapeFour on a local fork of X Layer (chain ID 196):
//   1. Deploys custom CPU via CPU Factory (createCPU)
//   2. Mints 1,479 NAND transistors
//   3. Tapes out the 1,479-gate Connect Four rules circuit
//   4. Runs on-chain eval on 10,000 random positions and verifies against local reference engine
//   5. Deploys TapeFour ranked contract pinned to this CPU and circuit ID
//   6. Measures REAL gas for eval() calls: opening, mid-game, and winning moves

const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const BOARD_MASK = (1n << 42n) - 1n;
const FACTORY_ADDR = "0x1f09daefa827f02cbb40967cc91b259763760761";
const BEM_ADDR = "0x60e62efa9405d6873c5deabd4e6cc91c25363952";

// ABI definitions
const FACTORY_ABI = [
  "function deployFee() view returns (uint256)",
  "function protocolFee() view returns (uint256)",
  "function cpuCount() view returns (uint256)",
  "function cpuAt(uint256) view returns (address)",
  "function createCPU(string name, string symbol, string uri, uint256 supplyCap, uint256 mintPrice) returns (address)",
];

const CPU_ABI = [
  "function transistors() view returns (address)",
  "function TAPEOUT_FEE() view returns (uint256)",
  "function nextId() view returns (uint256)",
  "function tapeout(bytes netlist, uint32 inBits, uint32 outBits) payable returns (uint256)",
  "function eval(uint256 id, bytes inputs) view returns (bytes)",
];

const TRANSISTOR_ABI = [
  "function mintPrice() view returns (uint256)",
  "function protocolFee() view returns (uint256)",
  "function mint(uint256 id, uint256 amount)",
  "function balanceOf(address account, uint256 id) view returns (uint256)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

// ---- Reference Engine logic (engine/connect4.ts) ---------------------------
function packInputs(boardA, boardB, col, turn) {
  let val = 0n;
  val |= (boardA & BOARD_MASK);
  val |= (boardB & BOARD_MASK) << 42n;
  val |= (BigInt(col) & 7n) << 84n;
  val |= (BigInt(turn) & 1n) << 87n;
  const bytes = new Uint8Array(11);
  for (let i = 0; i < 11; i++) bytes[i] = Number((val >> BigInt(i * 8)) & 0xffn);
  return bytes;
}

function unpackOutputs(bytes) {
  let val = 0n;
  for (let i = 0; i < bytes.length; i++) val |= BigInt(bytes[i]) << BigInt(i * 8);
  return {
    valid: (val & 1n) === 1n,
    newBoardA: (val >> 1n) & BOARD_MASK,
    newBoardB: (val >> 43n) & BOARD_MASK,
    win: ((val >> 85n) & 1n) === 1n,
    draw: ((val >> 86n) & 1n) === 1n,
  };
}

function getLowestEmptyRow(bA, bB, col) {
  for (let r = 0; r < 6; r++) {
    if (((bA | bB) & (1n << BigInt(col + 7 * r))) === 0n) return r;
  }
  return -1;
}

const WINNING_LINES = [];
const ci = (c, r) => c + 7 * r;
for (let r = 0; r < 6; r++) for (let c = 0; c <= 3; c++)
  WINNING_LINES.push([ci(c,r), ci(c+1,r), ci(c+2,r), ci(c+3,r)]);
for (let c = 0; c < 7; c++) for (let r = 0; r <= 2; r++)
  WINNING_LINES.push([ci(c,r), ci(c,r+1), ci(c,r+2), ci(c,r+3)]);
for (let c = 0; c <= 3; c++) for (let r = 0; r <= 2; r++)
  WINNING_LINES.push([ci(c,r), ci(c+1,r+1), ci(c+2,r+2), ci(c+3,r+3)]);
for (let c = 0; c <= 3; c++) for (let r = 3; r < 6; r++)
  WINNING_LINES.push([ci(c,r), ci(c+1,r-1), ci(c+2,r-2), ci(c+3,r-3)]);

function checkWinRef(board) {
  return WINNING_LINES.some(l => l.every(cell => ((board >> BigInt(cell)) & 1n) === 1n));
}

function applyMoveRef(bA, bB, col, turn) {
  const row = getLowestEmptyRow(bA, bB, col);
  if (row === -1 || col < 0 || col > 6) return { valid: false, newBoardA: bA, newBoardB: bB, win: false, draw: false };
  const cell = col + 7 * row;
  let nA = bA, nB = bB;
  if (turn === 0) nA |= 1n << BigInt(cell);
  else            nB |= 1n << BigInt(cell);
  const mover = turn === 0 ? nA : nB;
  const win   = checkWinRef(mover);
  const full  = ((nA | nB) & BOARD_MASK) === BOARD_MASK;
  return { valid: true, newBoardA: nA, newBoardB: nB, win, draw: full && !win };
}

// PRNG
let seed = 0xabcdefn;
function prng() {
  seed = (seed * 6364136223846793005n + 1442695040888963407n) & 0xFFFFFFFFFFFFFFFFn;
  return Number(seed & 0xFFFFFFFFn);
}

describe("X Layer Fork — Connect Four Tape-Out & On-Chain Verification", function () {
  this.timeout(1800000); // 30 min for 10k evals

  let deployer, human, sessionKey, operator, treasury;
  let factory, cpu, transistors, bem;
  let cpuAddress, circuitId;
  let netlistBytes;

  before(async function () {
    const code = await ethers.provider.getCode(FACTORY_ADDR);
    if (!code || code === "0x") {
      console.log("  ⚠ No code at factory address. Running only in fork mode.");
      this.skip();
    }

    [deployer, human, sessionKey, operator, treasury] = await ethers.getSigners();
    factory = new ethers.Contract(FACTORY_ADDR, FACTORY_ABI, deployer);
    bem = new ethers.Contract(BEM_ADDR, ERC20_ABI, deployer);

    // Provide BEM balance to deployer via storage cheatcode
    const slot = 5;
    const balanceKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [deployer.address, slot]));
    const balanceVal = ethers.zeroPadValue(ethers.toBeHex(100n * 10n**8n), 32);
    await network.provider.send("hardhat_setStorageAt", [BEM_ADDR, balanceKey, balanceVal]);

    // Approve Factory to spend BEM
    await (await bem.approve(FACTORY_ADDR, ethers.MaxUint256)).wait();

    const netlistPath = path.join(__dirname, "../../scripts/c4_netlist.bin");
    netlistBytes = fs.readFileSync(netlistPath);
    expect(netlistBytes.length).to.equal(1479 * 7); // 10353 bytes
  });

  it("1. Deploys custom CPU container via CPU Factory", async () => {
    const deployFee = await factory.deployFee();
    const protoFee = await factory.protocolFee();

    const countBefore = await factory.cpuCount();
    console.log(`  Current CPU count: ${countBefore}`);
    console.log(`  Factory deploy fee: ${deployFee} units (${Number(deployFee) / 1e8} BEM)`);
    console.log(`  Factory proto fee: ${protoFee} units (${Number(protoFee) / 1e8} BEM)`);

    const tx = await factory.createCPU(
      "TapeFour CPU",
      "TFCPU",
      "https://tapefour.xyz/cpu/",
      10000, // supplyCap = 10,000 transistors
      0      // mintPrice = 0
    );
    const rc = await tx.wait();
    expect(rc.status).to.equal(1);

    const countAfter = await factory.cpuCount();
    expect(countAfter).to.equal(countBefore + 1n);

    cpuAddress = await factory.cpuAt(countBefore);
    console.log(`  ✓ New CPU deployed at: ${cpuAddress}`);
    cpu = new ethers.Contract(cpuAddress, CPU_ABI, deployer);
  });

  it("2. Mints 1,479 NAND transistors on the CPU transistor contract", async () => {
    const transAddr = await cpu.transistors();
    transistors = new ethers.Contract(transAddr, TRANSISTOR_ABI, deployer);

    // Approve transistor contract to transfer BEM protocol fees
    await (await bem.approve(transAddr, ethers.MaxUint256)).wait();

    const mintPrice = await transistors.mintPrice();
    const protoFee = await transistors.protocolFee();
    console.log(`  Transistor contract: ${transAddr}`);
    console.log(`  Transistor mintPrice: ${mintPrice}, protocolFee: ${protoFee} (${Number(protoFee)/1e8} BEM)`);

    const tx = await transistors.mint(0 /* NAND token id = 0 */, 1479);
    const rc = await tx.wait();
    expect(rc.status).to.equal(1);

    const bal = await transistors.balanceOf(await deployer.getAddress(), 0);
    expect(bal).to.equal(1479n);
    console.log(`  ✓ Minted ${bal} NAND transistors (ID 0) to deployer (gas: ${rc.gasUsed})`);
  });

  it("3. Tapes out the 1,479-gate Connect Four rules circuit", async () => {
    const tapeoutFee = await cpu.TAPEOUT_FEE();
    console.log(`  Tape-out fee: ${ethers.formatEther(tapeoutFee)} OKB (${tapeoutFee} wei)`);

    const tx = await cpu.tapeout(netlistBytes, 88, 87, { value: tapeoutFee });
    const rc = await tx.wait();
    expect(rc.status).to.equal(1);

    circuitId = 1n; // First circuit on CPU is always token ID 1
    console.log(`  ✓ Connect Four circuit taped out with Circuit ID: ${circuitId} (gas: ${rc.gasUsed})`);
  });

  it("4. Evaluates circuit on-chain on 10,000 random positions vs local simulator", async function () {
    this.timeout(1800000);
    console.log(`  Evaluating 10,000 random positions on-chain via CPU.eval()...`);
    let verifiedCount = 0;
    const NUM_POSITIONS = 10000;

    let bA = 0n;
    let bB = 0n;
    let turn = 0;

    for (let i = 0; i < NUM_POSITIONS; i++) {
      try {
        // Pick random column 0..6
        const col = prng() % 7;

        // Reference engine evaluation
        const ref = applyMoveRef(bA, bB, col, turn);

        // On-chain eval call
        const inBytes = packInputs(bA, bB, col, turn);
        const outHex = await cpu.eval(circuitId, inBytes);
        const outBytes = ethers.getBytes(outHex);
        const onchain = unpackOutputs(outBytes);

        // Compare every bit
        if (onchain.valid !== ref.valid || onchain.newBoardA !== ref.newBoardA || onchain.newBoardB !== ref.newBoardB || onchain.win !== ref.win || onchain.draw !== ref.draw) {
          console.error(`MISMATCH at position ${i}:`, { ref, onchain, col, turn, bA: bA.toString(2), bB: bB.toString(2) });
        }
        expect(onchain.valid).to.equal(ref.valid);
        expect(onchain.newBoardA).to.equal(ref.newBoardA);
        expect(onchain.newBoardB).to.equal(ref.newBoardB);
        expect(onchain.win).to.equal(ref.win);
        expect(onchain.draw).to.equal(ref.draw);

        verifiedCount++;
        if (verifiedCount % 2000 === 0) {
          console.log(`    ... verified ${verifiedCount} / ${NUM_POSITIONS} positions perfectly.`);
        }

        // Advance game state
        if (ref.valid) {
          bA = ref.newBoardA;
          bB = ref.newBoardB;
          if (ref.win || ref.draw) {
            // Reset game
            bA = 0n;
            bB = 0n;
            turn = 0;
          } else {
            turn = 1 - turn;
          }
        }
      } catch (err) {
        console.error(`FATAL ERROR at pos ${i}:`, err.message);
        throw err;
      }
    }

    console.log(`  ✓ All ${verifiedCount} / ${NUM_POSITIONS} positions matched reference engine perfectly!`);
  });

  it("5. Measures REAL gas for eval() via TapeFour contract on fork", async function () {
    this.timeout(1800000);
    // Deploy TapeFour contract pointing to the taped-out circuit
    const TF = await ethers.getContractFactory("TapeFour");
    const tapeFour = await TF.deploy(
      cpuAddress,
      circuitId,
      ethers.parseEther("0.001"),
      7000n,
      await treasury.getAddress(),
      86400n,
      await operator.getAddress()
    );
    await tapeFour.waitForDeployment();
    console.log(`  TapeFour deployed at: ${await tapeFour.getAddress()}`);

    // --- Opening Move (empty board, col 3) ---
    await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: ethers.parseEther("0.001") });
    let tx = await tapeFour.connect(sessionKey).playMove(0n, 3);
    let rc = await tx.wait();
    const gasOpening = rc.gasUsed;

    // --- Mid-game Move (~10 moves in) ---
    await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: ethers.parseEther("0.001") });
    const gId = 1n;
    const setup = [[0,0],[1,1],[2,0],[3,1],[4,0],[5,1],[6,0],[0,1],[1,0],[2,1]];
    for (const [col, t] of setup) {
      if (t === 0) await tapeFour.connect(sessionKey).playMove(gId, col);
      else         await tapeFour.connect(operator).playBotMove(gId, col);
    }
    tx = await tapeFour.connect(sessionKey).playMove(gId, 4);
    rc = await tx.wait();
    const gasMid = rc.gasUsed;

    // --- Winning Move ---
    await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: ethers.parseEther("0.001") });
    const gWinId = 2n;
    // Human plays col 0 four times, Bot plays col 1 three times
    for (let i = 0; i < 3; i++) {
      await tapeFour.connect(sessionKey).playMove(gWinId, 0);
      await tapeFour.connect(operator).playBotMove(gWinId, 1);
    }
    tx = await tapeFour.connect(sessionKey).playMove(gWinId, 0); // 4th in col 0 -> WIN
    rc = await tx.wait();
    const gasWin = rc.gasUsed;

    console.log("\n  ╔══════════════════════════════════════════════════════════════════════╗");
    console.log("  ║ REAL GAS MEASUREMENT ON X LAYER FORK (TapeOut 1,479 NAND Gates)     ║");
    console.log("  ╠══════════════════════════════════════════════════════════════════════╣");
    console.log(`  ║ Opening move gas : ${gasOpening.toString().padStart(10)} gas                            ║`);
    console.log(`  ║ Mid-game move gas: ${gasMid.toString().padStart(10)} gas                            ║`);
    console.log(`  ║ Winning move gas : ${gasWin.toString().padStart(10)} gas                            ║`);
    console.log("  ╠══════════════════════════════════════════════════════════════════════╣");
    console.log("  ║ Comparison with 2.75M Projection:                                  ║");
    const diff = Number(gasOpening) - 2750000;
    console.log(`  ║ Actual opening vs 2.75M projection: ${diff >= 0 ? "+" : ""}${diff} gas                  ║`);
    console.log("  ╚══════════════════════════════════════════════════════════════════════╝\n");
  });
});
