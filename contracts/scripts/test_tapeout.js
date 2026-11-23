const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const factoryAddr = "0x1f09daefa827f02cbb40967cc91b259763760761";
  const bemAddr = "0x60e62efa9405d6873c5deabd4e6cc91c25363952";

  // 1. Give deployer BEM balance and approve factory
  const slot = 5;
  const balanceKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [deployer.address, slot]));
  const balanceVal = ethers.zeroPadValue(ethers.toBeHex(100n * 10n**8n), 32);
  await network.provider.send("hardhat_setStorageAt", [bemAddr, balanceKey, balanceVal]);

  const bem = new ethers.Contract(bemAddr, ["function approve(address, uint256) returns (bool)"], deployer);
  await (await bem.approve(factoryAddr, ethers.MaxUint256)).wait();

  // 2. Deploy fresh CPU
  const factory = new ethers.Contract(factoryAddr, [
    "function createCPU(string,string,string,uint256,uint256) returns (address)",
    "function cpuCount() view returns (uint256)",
    "function cpuAt(uint256) view returns (address)"
  ], deployer);

  const countBefore = await factory.cpuCount();
  await (await factory.createCPU("Connect Four CPU", "C4CPU", "https://tapefour.xyz/cpu/", 10000, 0)).wait();
  const cpuAddr = await factory.cpuAt(countBefore);
  console.log("Deployed C4 CPU at:", cpuAddr);

  const cpu = new ethers.Contract(cpuAddr, [
    "function transistors() view returns (address)",
    "function TAPEOUT_FEE() view returns (uint256)",
    "function nextId() view returns (uint256)",
    "function tapeout(bytes,uint32,uint32) payable returns (uint256)",
    "function eval(uint256,bytes) view returns (bytes)"
  ], deployer);

  // 3. Mint 1,479 NAND transistors
  const transAddr = await cpu.transistors();
  await (await bem.approve(transAddr, ethers.MaxUint256)).wait();
  const trans = new ethers.Contract(transAddr, ["function mint(uint256,uint256)"], deployer);
  await (await trans.mint(0, 1479)).wait();
  console.log("Minted 1,479 NAND transistors!");

  // 4. Tape out Connect Four circuit
  const netlistBytes = fs.readFileSync(path.join(__dirname, "../../scripts/c4_netlist.bin"));
  console.log("Netlist size:", netlistBytes.length, "bytes (", netlistBytes.length / 7, "NAND gates )");
  const fee = await cpu.TAPEOUT_FEE();
  const txTapeout = await cpu.tapeout(netlistBytes, 88, 87, { value: fee });
  await txTapeout.wait();
  const circuitId = 1n;
  console.log("Connect Four Circuit Taped Out! Circuit ID:", circuitId.toString());

  // 5. Test eval on empty board, col 3, turn 0
  let val = 0n;
  val |= (3n << 84n); // col 3
  const inBytes = new Uint8Array(11);
  for (let i = 0; i < 11; i++) inBytes[i] = Number((val >> BigInt(i * 8)) & 0xffn);

  console.log("Calling cpu.eval(cid, col 3)...");
  const resHex = await cpu.eval(circuitId, inBytes);
  console.log("eval() hex result:", resHex);

  const resBytes = ethers.getBytes(resHex);
  let outVal = 0n;
  for (let i = 0; i < resBytes.length; i++) outVal |= BigInt(resBytes[i]) << BigInt(i * 8);

  const BOARD_MASK = (1n << 42n) - 1n;
  const valid = (outVal & 1n) === 1n;
  const newBoardA = (outVal >> 1n) & BOARD_MASK;
  const newBoardB = (outVal >> 43n) & BOARD_MASK;
  const win = ((outVal >> 85n) & 1n) === 1n;
  const draw = ((outVal >> 86n) & 1n) === 1n;

  console.log("On-Chain Eval Unpacked Result:");
  console.log({
    valid,
    newBoardA: newBoardA.toString(),
    newBoardB: newBoardB.toString(),
    win,
    draw
  });

  // Expected:
  // col 3, row 0 -> cell 3. newBoardA = 1n << 3n = 8n, newBoardB = 0n, win = false, draw = false, valid = true
  console.log("Expected: cell 3 placed -> newBoardA = 8, newBoardB = 0, valid = true, win = false, draw = false");
  if (valid === true && newBoardA === 8n && newBoardB === 0n && win === false && draw === false) {
    console.log("🎉 PERFECT MATCH WITH ON-CHAIN EVALUATION!");
  } else {
    console.log("❌ Mismatch!");
  }
}

main().catch(console.error);
