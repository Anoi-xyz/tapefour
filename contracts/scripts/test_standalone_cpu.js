const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const code = fs.readFileSync(path.join(__dirname, "cpu_impl_code.hex"), "utf8").trim();
  const cpuAddr = "0x1111111111111111111111111111111111111111";
  await ethers.provider.send("hardhat_setCode", [cpuAddr, code]);

  const cpu = new ethers.Contract(cpuAddr, [
    "function TAPEOUT_FEE() view returns (uint256)",
    "function transistors() view returns (address)",
    "function tapeout(bytes,uint32,uint32) payable returns (uint256)",
    "function eval(uint256,bytes) view returns (bytes)"
  ], deployer);

  console.log("Fee:", await cpu.TAPEOUT_FEE());
  console.log("Transistors:", await cpu.transistors());

  const netlistBytes = fs.readFileSync(path.join(__dirname, "../../scripts/c4_netlist.bin"));
  console.log("Taping out circuit...");
  const fee = await cpu.TAPEOUT_FEE();
  const tx = await cpu.tapeout(netlistBytes, 88, 87, { value: fee });
  await tx.wait();
  console.log("Taped out! Circuit ID: 1");

  // Call eval on opening move
  const inBytes = new Uint8Array(11);
  inBytes[10] = 3 << 4; // col 3
  const res = await cpu.eval(1n, inBytes);
  console.log("Eval result hex:", res);
}

main().catch(console.error);
