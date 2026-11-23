const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const tokenAddr = "0x60e62efa9405d6873c5deabd4e6cc91c25363952";
  const token = new ethers.Contract(tokenAddr, ["function balanceOf(address) view returns (uint256)"], deployer);

  for (let slot = 0; slot <= 10; slot++) {
    const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [deployer.address, slot]));
    await network.provider.send("hardhat_setStorageAt", [tokenAddr, key, "0x0000000000000000000000000000000000000000000000000000000005f5e100"]);
    const bal = await token.balanceOf(deployer.address);
    if (bal > 0n) {
      console.log("FOUND BALANCE SLOT!", slot, "bal:", bal.toString());
      break;
    }
  }
}
main().catch(console.error);
