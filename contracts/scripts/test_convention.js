const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const factoryAddr = "0x1f09daefa827f02cbb40967cc91b259763760761";
  const bemAddr = "0x60e62efa9405d6873c5deabd4e6cc91c25363952";

  // 1. Give deployer BEM balance and approve
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
  await (await factory.createCPU("Test CPU", "TCPU", "uri", 10000, 0)).wait();
  const cpuAddr = await factory.cpuAt(countBefore);
  const cpu = new ethers.Contract(cpuAddr, [
    "function transistors() view returns (address)",
    "function TAPEOUT_FEE() view returns (uint256)",
    "function nextId() view returns (uint256)",
    "function tapeout(bytes,uint32,uint32) payable returns (uint256)",
    "function eval(uint256,bytes) view returns (bytes)"
  ], deployer);

  const transAddr = await cpu.transistors();
  await (await bem.approve(transAddr, ethers.MaxUint256)).wait();
  const trans = new ethers.Contract(transAddr, ["function mint(uint256,uint256)"], deployer);
  await (await trans.mint(0, 5)).wait();

  // Let's create a circuit with:
  // inBits = 2 (wire 2 = in0, wire 3 = in1)
  // 3 gates:
  // Gate 0: wire 4 = NAND(2, 3)
  // Gate 1: wire 5 = NAND(2, 2) [NOT in0]
  // Gate 2: wire 6 = NAND(3, 3) [NOT in1]
  const netlist = new Uint8Array(21);
  netlist[0] = 0; netlist[3] = 2; netlist[6] = 3;
  netlist[7] = 0; netlist[10] = 2; netlist[13] = 2;
  netlist[14] = 0; netlist[17] = 3; netlist[20] = 3;

  const fee = await cpu.TAPEOUT_FEE();
  await (await cpu.tapeout(netlist, 2, 2, { value: fee })).wait();
  const cid = 1n;

  // Let's test inputs:
  // in0 = 1, in1 = 0 -> inputs = 0x01
  // If outputs are:
  // A) LAST 2 gates (wire 5 = NOT in0 = 0, wire 6 = NOT in1 = 1):
  //    bit 0 = wire 5 = 0, bit 1 = wire 6 = 1 -> byte = 0x02
  // B) FIRST 2 gates (wire 4 = NAND(1,0) = 1, wire 5 = NOT in0 = 0):
  //    bit 0 = 1, bit 1 = 0 -> byte = 0x01
  // C) Something else?
  const res = await cpu.eval(cid, "0x01");
  console.log("Input 0x01 (in0=1, in1=0) -> output:", res);

  const res2 = await cpu.eval(cid, "0x00");
  console.log("Input 0x00 (in0=0, in1=0) -> output:", res2);
}

main().catch(console.error);
