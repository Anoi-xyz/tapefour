const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const BOARD_MASK = (1n << 42n) - 1n;

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

// Reference Connect Four rule logic to compare
function getLowestEmptyRow(bA, bB, col) {
  for (let r = 0; r < 6; r++) {
    if (((bA | bB) & (1n << BigInt(col + 7 * r))) === 0n) return r;
  }
  return -1;
}

function checkWin(board) {
  // Horizontal
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 4; c++) {
      const m = (1n << BigInt(c + 7 * r)) | (1n << BigInt(c + 1 + 7 * r)) | (1n << BigInt(c + 2 + 7 * r)) | (1n << BigInt(c + 3 + 7 * r));
      if ((board & m) === m) return true;
    }
  }
  // Vertical
  for (let c = 0; c < 7; c++) {
    for (let r = 0; r < 3; r++) {
      const m = (1n << BigInt(c + 7 * r)) | (1n << BigInt(c + 7 * (r + 1))) | (1n << BigInt(c + 7 * (r + 2))) | (1n << BigInt(c + 7 * (r + 3)));
      if ((board & m) === m) return true;
    }
  }
  // Diagonal /
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const m = (1n << BigInt(c + 7 * r)) | (1n << BigInt(c + 1 + 7 * (r + 1))) | (1n << BigInt(c + 2 + 7 * (r + 2))) | (1n << BigInt(c + 3 + 7 * (r + 3)));
      if ((board & m) === m) return true;
    }
  }
  // Diagonal \
  for (let r = 3; r < 6; r++) {
    for (let c = 0; c < 4; c++) {
      const m = (1n << BigInt(c + 7 * r)) | (1n << BigInt(c + 1 + 7 * (r - 1))) | (1n << BigInt(c + 2 + 7 * (r - 2))) | (1n << BigInt(c + 3 + 7 * (r - 3)));
      if ((board & m) === m) return true;
    }
  }
  return false;
}

function refEval(boardA, boardB, col, turn) {
  if (col < 0 || col > 6) return { valid: false, newBoardA: boardA, newBoardB: boardB, win: false, draw: false };
  const row = getLowestEmptyRow(boardA, boardB, col);
  if (row === -1) return { valid: false, newBoardA: boardA, newBoardB: boardB, win: false, draw: false };
  const cell = col + 7 * row;
  let nA = boardA;
  let nB = boardB;
  if (turn === 0) nA |= 1n << BigInt(cell);
  else nB |= 1n << BigInt(cell);
  const mover = turn === 0 ? nA : nB;
  const win = checkWin(mover);
  const full = ((nA | nB) & BOARD_MASK) === BOARD_MASK;
  return { valid: true, newBoardA: nA, newBoardB: nB, win, draw: full && !win };
}

async function main() {
  const seedArg = parseInt(process.env.BATCH_SEED || "1");
  const countArg = parseInt(process.env.BATCH_COUNT || "5");

  const [deployer] = await ethers.getSigners();
  const FACTORY_ADDR = "0x1f09daefa827f02cbb40967cc91b259763760761";
  const BEM_ADDR = "0x60e62efa9405d6873c5deabd4e6cc91c25363952";

  // Give BEM balance
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
  await (await factory.createCPU("TapeFour CPU", "C4CPU", "https://tapefour.xyz/cpu/", 10000, 0)).wait();
  const cpuAddr = await factory.cpuAt(countBefore);

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

  const netlistBytes = fs.readFileSync(path.join(__dirname, "../../scripts/c4_netlist.bin"));
  const fee = await cpu.TAPEOUT_FEE();
  await (await cpu.tapeout(netlistBytes, 88, 87, { value: fee })).wait();

  let seed = seedArg;
  function randInt(max) {
    seed = (seed * 1664525 + 1013904223) | 0;
    return (seed >>> 0) % max;
  }

  let matched = 0;
  for (let i = 0; i < countArg; i++) {
    // Generate legal-ish or random board
    let bA = 0n;
    let bB = 0n;
    const pieces = randInt(25);
    for (let p = 0; p < pieces; p++) {
      const c = randInt(7);
      const r = getLowestEmptyRow(bA, bB, c);
      if (r !== -1) {
        if (p % 2 === 0) bA |= 1n << BigInt(c + 7 * r);
        else bB |= 1n << BigInt(c + 7 * r);
      }
    }
    const col = randInt(8); // 0-7, test out-of-bounds col 7 too
    const turn = randInt(2);

    const ref = refEval(bA, bB, col, turn);
    const inBytes = packInputs(bA, bB, col, turn);
    const outBytes = await cpu.eval(1n, inBytes);
    const onchain = unpackOutputs(ethers.getBytes(outBytes));

    if (
      onchain.valid !== ref.valid ||
      onchain.newBoardA !== ref.newBoardA ||
      onchain.newBoardB !== ref.newBoardB ||
      onchain.win !== ref.win ||
      onchain.draw !== ref.draw
    ) {
      console.error(`MISMATCH at seed=${seedArg}, iter=${i}:`, { ref, onchain });
      process.exit(1);
    }
    matched++;
  }
  console.log(`BATCH_RESULT: matched=${matched}/${countArg}`);
}

main().catch(err => {
  console.error("Worker error:", err);
  process.exit(1);
});
