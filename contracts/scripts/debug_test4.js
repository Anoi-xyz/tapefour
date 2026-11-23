const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const BOARD_MASK = (1n << 42n) - 1n;
const FACTORY_ADDR = "0x1f09daefa827f02cbb40967cc91b259763760761";
const BEM_ADDR = "0x60e62efa9405d6873c5deabd4e6cc91c25363952";

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

let seed = 0xabcdefn;
function prng() {
  seed = (seed * 6364136223846793005n + 1442695040888963407n) & 0xFFFFFFFFFFFFFFFFn;
  return Number(seed & 0xFFFFFFFFn);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const slot = 5;
  const balanceKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [deployer.address, slot]));
  const balanceVal = ethers.zeroPadValue(ethers.toBeHex(100n * 10n**8n), 32);
  await network.provider.send("hardhat_setStorageAt", [BEM_ADDR, balanceKey, balanceVal]);

  const bem = new ethers.Contract(BEM_ADDR, ["function approve(address, uint256) returns (bool)"], deployer);
  await (await bem.approve(FACTORY_ADDR, ethers.MaxUint256)).wait();

  const factory = new ethers.Contract(FACTORY_ADDR, [
    "function createCPU(string,string,string,uint256,uint256) returns (address)",
    "function cpuCount() view returns (uint256)",
    "function cpuAt(uint256) view returns (address)"
  ], deployer);

  const countBefore = await factory.cpuCount();
  await (await factory.createCPU("C4 CPU", "C4CPU", "https://tapefour.xyz/cpu/", 10000, 0)).wait();
  const cpuAddr = await factory.cpuAt(countBefore);
  console.log("CPU at:", cpuAddr);

  const cpu = new ethers.Contract(cpuAddr, [
    "function transistors() view returns (address)",
    "function TAPEOUT_FEE() view returns (uint256)",
    "function tapeout(bytes,uint32,uint32) payable returns (uint256)",
    "function eval(uint256,bytes) view returns (bytes)"
  ], deployer);

  const transAddr = await cpu.transistors();
  await (await bem.approve(transAddr, ethers.MaxUint256)).wait();
  const trans = new ethers.Contract(transAddr, ["function mint(uint256,uint256)"], deployer);
  await (await trans.mint(0, 1479)).wait();

  const netlistBytes = fs.readFileSync(path.join(__dirname, "../../scripts/c4_netlist.bin"));
  const fee = await cpu.TAPEOUT_FEE();
  await (await cpu.tapeout(netlistBytes, 88, 87, { value: fee })).wait();
  console.log("Circuit taped out!");

  const circuitId = 1n;
  console.log("Starting 10 random evals to debug...");
  let bA = 0n, bB = 0n, turn = 0;
  for (let i = 0; i < 10; i++) {
    const col = prng() % 7;
    const ref = applyMoveRef(bA, bB, col, turn);
    const inBytes = packInputs(bA, bB, col, turn);
    console.log(`Pos ${i}: col=${col}, turn=${turn}, calling cpu.eval...`);
    const outHex = await cpu.eval(circuitId, inBytes);
    console.log(`Pos ${i} returned:`, outHex);
    const outBytes = ethers.getBytes(outHex);
    const onchain = unpackOutputs(outBytes);
    console.log(`Pos ${i} onchain:`, onchain);
    console.log(`Pos ${i} ref:`, ref);
    if (ref.valid) {
      bA = ref.newBoardA;
      bB = ref.newBoardB;
      if (ref.win || ref.draw) {
        bA = 0n; bB = 0n; turn = 0;
      } else {
        turn = 1 - turn;
      }
    }
  }
  console.log("Debug completed successfully!");
}

main().catch(err => {
  console.error("FATAL ERROR IN DEBUG:", err);
  process.exit(1);
});
