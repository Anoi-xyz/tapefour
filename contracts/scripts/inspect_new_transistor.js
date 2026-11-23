const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const factoryAddr = "0x1f09daefa827f02cbb40967cc91b259763760761";
  const factory = new ethers.Contract(factoryAddr, ["function cpuCount() view returns (uint256)", "function cpuAt(uint256) view returns (address)"], deployer);
  const count = await factory.cpuCount();
  const lastCpu = await factory.cpuAt(count - 1n);
  console.log("Last CPU:", lastCpu);

  const cpu = new ethers.Contract(lastCpu, ["function transistors() view returns (address)"], deployer);
  const transAddr = await cpu.transistors();
  console.log("Transistor contract:", transAddr);

  for (let i = 0; i <= 10; i++) {
    const val = await ethers.provider.getStorage(transAddr, i);
    console.log("Slot", i, ":", val);
  }
}

main().catch(console.error);
