const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const FACTORY_ADDR = "0x1f09daefa827f02cbb40967cc91b259763760761";
const BEM_ADDR = "0x60e62efa9405d6873c5deabd4e6cc91c25363952";

async function main() {
  console.log("== Deploying TapeOut Connect Four Circuit on Fork Node ==");
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // 1. Give deployer BEM balance
  const slot = 5;
  const balanceKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [deployer.address, slot]));
  const balanceVal = ethers.zeroPadValue(ethers.toBeHex(100n * 10n**8n), 32);
  await network.provider.send("hardhat_setStorageAt", [BEM_ADDR, balanceKey, balanceVal]);

  const bem = new ethers.Contract(BEM_ADDR, ["function approve(address, uint256) returns (bool)"], deployer);
  await (await bem.approve(FACTORY_ADDR, ethers.MaxUint256)).wait();

  // 2. Deploy fresh CPU
  const factory = new ethers.Contract(FACTORY_ADDR, [
    "function createCPU(string,string,string,uint256,uint256) returns (address)",
    "function cpuCount() view returns (uint256)",
    "function cpuAt(uint256) view returns (address)"
  ], deployer);

  const countBefore = await factory.cpuCount();
  console.log("Current CPU count:", countBefore.toString());
  const txCpu = await factory.createCPU("TapeFour Fork CPU", "T4CPU", "https://tapefour.xyz/cpu/", 10000, 0);
  await txCpu.wait();
  const cpuAddr = await factory.cpuAt(countBefore);
  console.log("Deployed CPU at:", cpuAddr);

  // 3. Mint 1,479 transistors
  const cpu = new ethers.Contract(cpuAddr, [
    "function transistors() view returns (address)",
    "function TAPEOUT_FEE() view returns (uint256)",
    "function tapeout(bytes,uint32,uint32) payable returns (uint256)",
    "function eval(uint256,bytes) view returns (bytes)",
  ], deployer);

  const transAddr = await cpu.transistors();
  console.log("Transistor contract:", transAddr);
  await (await bem.approve(transAddr, ethers.MaxUint256)).wait();
  const trans = new ethers.Contract(transAddr, ["function mint(uint256,uint256)"], deployer);
  await (await trans.mint(0, 1479)).wait();
  console.log("Minted 1,479 transistors!");

  // 4. Tape out circuit
  const netlistBytes = fs.readFileSync(path.join(__dirname, "../../scripts/c4_netlist.bin"));
  const fee = await cpu.TAPEOUT_FEE();
  console.log("Netlist size:", netlistBytes.length, "bytes, tapeout fee:", ethers.formatEther(fee), "OKB");
  const txTape = await cpu.tapeout(netlistBytes, 88, 87, { value: fee });
  await txTape.wait();
  const circuitId = 1n;
  console.log("Circuit taped out! Circuit ID:", circuitId.toString());

  // Save info to a json file
  const info = { cpuAddr, circuitId: circuitId.toString() };
  fs.writeFileSync(path.join(__dirname, "../fork_circuit.json"), JSON.stringify(info, null, 2));
  console.log("Saved fork circuit info to contracts/fork_circuit.json");
}

main().catch(console.error);
