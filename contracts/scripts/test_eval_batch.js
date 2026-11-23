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

let seed = 0xabcdefn;
function prng() {
  seed = (seed * 6364136223846793005n + 1442695040888963407n) & 0xFFFFFFFFFFFFFFFFn;
  return Number(seed & 0xFFFFFFFFn);
}

process.on('uncaughtException', err => console.error('UNCAUGHT EXCEPTION:', err));
process.on('unhandledRejection', err => console.error('UNHANDLED REJECTION:', err));

async function main() {
  const [deployer] = await ethers.getSigners();
  const factoryAddr = "0x1f09daefa827f02cbb40967cc91b259763760761";
  const bemAddr = "0x60e62efa9405d6873c5deabd4e6cc91c25363952";

  const slot = 5;
  const balanceKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [deployer.address, slot]));
  const balanceVal = ethers.zeroPadValue(ethers.toBeHex(100n * 10n**8n), 32);
  await network.provider.send("hardhat_setStorageAt", [bemAddr, balanceKey, balanceVal]);

  const bem = new ethers.Contract(bemAddr, ["function approve(address, uint256) returns (bool)"], deployer);
  await (await bem.approve(factoryAddr, ethers.MaxUint256)).wait();

  const factory = new ethers.Contract(factoryAddr, [
    "function createCPU(string,string,string,uint256,uint256) returns (address)",
    "function cpuCount() view returns (uint256)",
    "function cpuAt(uint256) view returns (address)"
  ], deployer);

  const countBefore = await factory.cpuCount();
  await (await factory.createCPU("C4", "C4", "uri", 10000, 0)).wait();
  const cpuAddr = await factory.cpuAt(countBefore);

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
  console.log("Tapeout complete!");

  // Evaluate 10 positions
  let bA = 0n, bB = 0n, turn = 0;
  for (let i = 0; i < 20; i++) {
    const col = prng() % 7;
    const inBytes = packInputs(bA, bB, col, turn);
    try {
      const outHex = await cpu.eval(1n, inBytes);
      const out = unpackOutputs(ethers.getBytes(outHex));
      console.log(`Pos ${i}: col=${col}, turn=${turn} -> valid=${out.valid}, win=${out.win}, draw=${out.draw}`);
      if (out.valid) {
        bA = out.newBoardA;
        bB = out.newBoardB;
        turn = 1 - turn;
      }
    } catch (e) {
      console.error(`Error at pos ${i}:`, e);
      break;
    }
  }
  console.log("=== ALL BATCH MOVES COMPLETE ===");
}

main().catch(console.error);
