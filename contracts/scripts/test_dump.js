const { ethers, network } = require("hardhat");

async function main() {
  const state = await network.provider.send("hardhat_dumpState");
  console.log("Dump state supported! Length:", state ? state.length : 0);
}

main().catch(console.error);
