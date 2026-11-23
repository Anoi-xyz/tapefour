const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const factoryAddr = "0x1f09daefa827f02cbb40967cc91b259763760761";
  const bemAddr = "0x60e62efa9405d6873c5deabd4e6cc91c25363952";

  // 1. Give deployer 100 BEM (100 * 10^8 units)
  const slot = 5;
  const balanceKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [deployer.address, slot]));
  const balanceVal = ethers.zeroPadValue(ethers.toBeHex(100n * 10n**8n), 32);
  await network.provider.send("hardhat_setStorageAt", [bemAddr, balanceKey, balanceVal]);

  const bem = new ethers.Contract(bemAddr, [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)",
    "function allowance(address, address) view returns (uint256)"
  ], deployer);

  console.log("Deployer BEM balance:", await bem.balanceOf(deployer.address));

  // 2. Approve factory
  const approveTx = await bem.approve(factoryAddr, ethers.MaxUint256);
  await approveTx.wait();
  console.log("Approved factory. Allowance:", await bem.allowance(deployer.address, factoryAddr));

  // 3. Call createCPU
  const factory = new ethers.Contract(factoryAddr, [
    "function createCPU(string name, string symbol, string uri, uint256 supplyCap, uint256 mintPrice) returns (address)",
    "function cpuCount() view returns (uint256)",
    "function cpuAt(uint256) view returns (address)"
  ], deployer);

  const countBefore = await factory.cpuCount();
  console.log("CPU count before:", countBefore);

  console.log("Calling factory.createCPU...");
  const tx = await factory.createCPU(
    "TapeFour CPU",
    "TFCPU",
    "https://tapefour.xyz/cpu/",
    10000,
    0
  );
  const rc = await tx.wait();
  console.log("SUCCESS! createCPU status:", rc.status, "gasUsed:", rc.gasUsed.toString());

  const countAfter = await factory.cpuCount();
  console.log("CPU count after:", countAfter);
  const newCpuAddr = await factory.cpuAt(countBefore);
  console.log("New CPU address:", newCpuAddr);
}

main().catch(console.error);
