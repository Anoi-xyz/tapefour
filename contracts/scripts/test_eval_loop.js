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

async function main() {
  console.log("== Testing cpu.eval() Staticcall Loop ==");
  const [deployer] = await ethers.getSigners();

  // Setup BEM
  const slot = 5;
  const balanceKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [deployer.address, slot]));
  const balanceVal = ethers.zeroPadValue(ethers.toBeHex(100n * 10n**8n), 32);
  await network.provider.send("hardhat_setStorageAt", [BEM_ADDR, balanceKey, balanceVal]);

  const bem = new ethers.Contract(BEM_ADDR, ["function approve(address, uint256) returns (bool)"], deployer);
  await (await bem.approve(FACTORY_ADDR, ethers.MaxUint256)).wait();

  // Deploy CPU
  const factory = new ethers.Contract(FACTORY_ADDR, [
    "function createCPU(string,string,string,uint256,uint256) returns (address)",
    "function cpuCount() view returns (uint256)",
    "function cpuAt(uint256) view returns (address)"
  ], deployer);

  const countBefore = await factory.cpuCount();
  await (await factory.createCPU("TapeFour CPU", "C4CPU", "https://tapefour.xyz/cpu/", 10000, 0)).wait();
  const cpuAddr = await factory.cpuAt(countBefore);
  console.log("CPU deployed at:", cpuAddr);

  // Mint transistors
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

  // Tape out
  const netlistBytes = fs.readFileSync(path.join(__dirname, "../../scripts/c4_netlist.bin"));
  const fee = await cpu.TAPEOUT_FEE();
  await (await cpu.tapeout(netlistBytes, 88, 87, { value: fee })).wait();
  console.log("Circuit taped out! ID: 1");

  // Loop staticcalls
  let seed = 42;
  function randInt(max) {
    seed = (seed * 1664525 + 1013904223) | 0;
    return (seed >>> 0) % max;
  }

  const TARGET = 100;
  console.log(`Starting loop of ${TARGET} eval() calls...`);
  const t0 = Date.now();
  for (let i = 0; i < TARGET; i++) {
    const col = randInt(7);
    const turn = randInt(2);
    const bA = BigInt(randInt(1000000));
    const bB = BigInt(randInt(1000000)) << 20n;
    const inBytes = packInputs(bA, bB, col, turn);

    const outBytes = await cpu.eval(1n, inBytes);
    const out = unpackOutputs(ethers.getBytes(outBytes));

    if ((i + 1) % 10 === 0) {
      console.log(`Completed ${i + 1}/${TARGET} calls (${Date.now() - t0}ms)`);
    }
  }
  console.log(`SUCCESS: Completed all ${TARGET} staticcalls cleanly!`);
}

main().catch(console.error);
