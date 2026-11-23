const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const BOARD_MASK = (1n << 42n) - 1n;
const FACTORY_ADDR = "0x1f09daefa827f02cbb40967cc91b259763760761";
const BEM_ADDR = "0x60e62efa9405d6873c5deabd4e6cc91c25363952";

async function main() {
  const [deployer, human, sessionKey, operator, treasury] = await ethers.getSigners();
  const slot = 5;
  const balanceKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [deployer.address, slot]));
  const balanceVal = ethers.zeroPadValue(ethers.toBeHex(100n * 10n**8n), 32);
  await network.provider.send("hardhat_setStorageAt", [BEM_ADDR, balanceKey, balanceVal]);

  const bem = new ethers.Contract(BEM_ADDR, ["function approve(address, uint256) returns (bool)"], deployer);
  await (await bem.approve(FACTORY_ADDR, ethers.MaxUint256)).wait();

  const factory = new ethers.Contract(FACTORY_ADDR, [
    "function createCPU(string,string,string,uint256,uint256) returns (address)",
    "function cpuCount() view returns (uint256)",
    "function cpuAt(uint256) view returns (address)"
  ], deployer);

  const countBefore = await factory.cpuCount();
  await (await factory.createCPU("C4 CPU", "C4CPU", "https://tapefour.xyz/cpu/", 10000, 0)).wait();
  const cpuAddr = await factory.cpuAt(countBefore);
  console.log("CPU at:", cpuAddr);

  const cpu = new ethers.Contract(cpuAddr, [
    "function transistors() view returns (address)",
    "function TAPEOUT_FEE() view returns (uint256)",
    "function tapeout(bytes,uint32,uint32) payable returns (uint256)",
    "function eval(uint256,bytes) view returns (bytes)"
  ], deployer);

  const transAddr = await cpu.transistors();
  await (await bem.approve(transAddr, ethers.MaxUint256)).wait();
  const trans = new ethers.Contract(transAddr, ["function mint(uint256,uint256)"], deployer);
  await (await trans.mint(0, 1479)).wait();

  const netlistBytes = fs.readFileSync(path.join(__dirname, "../../scripts/c4_netlist.bin"));
  const fee = await cpu.TAPEOUT_FEE();
  await (await cpu.tapeout(netlistBytes, 88, 87, { value: fee })).wait();
  const circuitId = 1n;
  console.log("Circuit taped out! Circuit ID:", circuitId.toString());

  // Deploy TapeFour contract pointing to real CPU
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
  const tfAddr = await tapeFour.getAddress();
  console.log("TapeFour deployed at:", tfAddr);

  // 1. Opening Move (empty board, col 3)
  console.log("Executing opening move...");
  await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: ethers.parseEther("0.001") });
  let tx = await tapeFour.connect(sessionKey).playMove(0n, 3);
  let rc = await tx.wait();
  const gasOpening = rc.gasUsed;
  console.log("✓ Opening move gasUsed:", gasOpening.toString());

  // 2. Mid-game Move (~10 moves in)
  console.log("Executing mid-game move...");
  await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: ethers.parseEther("0.001") });
  const gId = 1n;
  const setup = [[0,0],[1,1],[2,0],[3,1],[4,0],[5,1],[6,0],[0,1],[1,0],[2,1]];
  for (let sIdx = 0; sIdx < setup.length; sIdx++) {
    const [col, t] = setup[sIdx];
    console.log(`Mid move ${sIdx}: col=${col}, turn=${t}...`);
    if (t === 0) await (await tapeFour.connect(sessionKey).playMove(gId, col)).wait();
    else         await (await tapeFour.connect(operator).playBotMove(gId, col)).wait();
    console.log(`Mid move ${sIdx} done. Block:`, await ethers.provider.getBlockNumber());
  }
  tx = await tapeFour.connect(sessionKey).playMove(gId, 4);
  rc = await tx.wait();
  const gasMid = rc.gasUsed;
  console.log("✓ Mid-game move gasUsed:", gasMid.toString());

  // 3. Winning Move
  console.log("Executing winning move...");
  await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: ethers.parseEther("0.001") });
  const gWinId = 2n;
  for (let i = 0; i < 3; i++) {
    await (await tapeFour.connect(sessionKey).playMove(gWinId, 0)).wait();
    await (await tapeFour.connect(operator).playBotMove(gWinId, 1)).wait();
  }
  tx = await tapeFour.connect(sessionKey).playMove(gWinId, 0); // 4th in col 0 -> WIN!
  rc = await tx.wait();
  const gasWin = rc.gasUsed;
  console.log("✓ Winning move gasUsed:", gasWin.toString());

  console.log("\n========================================================");
  console.log("REAL MEASURED GAS ON X LAYER FORK (TapeOut 1,479 Gates):");
  console.log(`Opening move gas : ${gasOpening}`);
  console.log(`Mid-game move gas: ${gasMid}`);
  console.log(`Winning move gas : ${gasWin}`);
  console.log(`Difference vs 2.75M projection: ${Number(gasOpening) - 2750000} gas`);
  console.log("========================================================\n");
}

main().catch(console.error);
