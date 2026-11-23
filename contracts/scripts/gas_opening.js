const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const BOARD_MASK = (1n << 42n) - 1n;
const FACTORY_ADDR = "0x1f09daefa827f02cbb40967cc91b259763760761";
const BEM_ADDR = "0x60e62efa9405d6873c5deabd4e6cc91c25363952";

async function main() {
  console.log("1. Starting gas_opening...");
  const [deployer, human, sessionKey, operator, treasury] = await ethers.getSigners();
  const slot = 5;
  const balanceKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [deployer.address, slot]));
  const balanceVal = ethers.zeroPadValue(ethers.toBeHex(100n * 10n**8n), 32);
  await network.provider.send("hardhat_setStorageAt", [BEM_ADDR, balanceKey, balanceVal]);

  console.log("2. Approving BEM...");
  const bem = new ethers.Contract(BEM_ADDR, ["function approve(address, uint256) returns (bool)"], deployer);
  await (await bem.approve(FACTORY_ADDR, ethers.MaxUint256)).wait();

  console.log("3. Creating CPU...");
  const factory = new ethers.Contract(FACTORY_ADDR, [
    "function createCPU(string,string,string,uint256,uint256) returns (address)",
    "function cpuCount() view returns (uint256)",
    "function cpuAt(uint256) view returns (address)"
  ], deployer);

  const countBefore = await factory.cpuCount();
  await (await factory.createCPU("C4 CPU", "C4CPU", "https://tapefour.xyz/cpu/", 10000, 0)).wait();
  const cpuAddr = await factory.cpuAt(countBefore);
  console.log("CPU at:", cpuAddr);

  console.log("4. Minting transistors...");
  const cpu = new ethers.Contract(cpuAddr, [
    "function transistors() view returns (address)",
    "function TAPEOUT_FEE() view returns (uint256)",
    "function tapeout(bytes,uint32,uint32) payable returns (uint256)",
  ], deployer);

  const transAddr = await cpu.transistors();
  await (await bem.approve(transAddr, ethers.MaxUint256)).wait();
  const trans = new ethers.Contract(transAddr, ["function mint(uint256,uint256)"], deployer);
  await (await trans.mint(0, 1479)).wait();

  console.log("5. Taping out circuit...");
  const netlistBytes = fs.readFileSync(path.join(__dirname, "../../scripts/c4_netlist.bin"));
  const fee = await cpu.TAPEOUT_FEE();
  await (await cpu.tapeout(netlistBytes, 88, 87, { value: fee })).wait();
  const circuitId = 1n;

  console.log("6. Deploying TapeFour contract...");
  const TF = await ethers.getContractFactory("TapeFour");
  const tapeFour = await TF.deploy(
    cpuAddr,
    circuitId,
    ethers.parseEther("0.001"),
    7000n,
    await treasury.getAddress(),
    86400n,
    await operator.getAddress()
  );
  await tapeFour.waitForDeployment();
  console.log("TapeFour deployed!");

  console.log("7. Starting ranked game...");
  await (await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: ethers.parseEther("0.001") })).wait();

  console.log("8. Playing opening move...");
  const tx = await tapeFour.connect(sessionKey).playMove(0n, 3);
  const rc = await tx.wait();
  console.log("OPENING_MOVE_GAS:" + rc.gasUsed.toString());
}

main().catch(console.error);
