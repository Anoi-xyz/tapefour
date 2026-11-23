const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const BOARD_MASK = (1n << 42n) - 1n;
const FACTORY_ADDR = "0x1f09daefa827f02cbb40967cc91b259763760761";
const BEM_ADDR = "0x60e62efa9405d6873c5deabd4e6cc91c25363952";

function packInputs(boardA, boardB, col, turn) {
  let val = 0n;
  val |= (boardA & BOARD_MASK);
  val |= (boardB & BOARD_MASK) << 42n;
  val |= (BigInt(col) & 7n) << 84n;
  val |= (BigInt(turn) & 1n) << 87n;
  const bytes = new Uint8Array(11);
  for (let i = 0; i < 11; i++) bytes[i] = Number((val >> BigInt(i * 8)) & 0xffn);
  return bytes;
}

function unpackOutputs(bytes) {
  let val = 0n;
  for (let i = 0; i < bytes.length; i++) val |= BigInt(bytes[i]) << BigInt(i * 8);
  return {
    valid: (val & 1n) === 1n,
    newBoardA: (val >> 1n) & BOARD_MASK,
    newBoardB: (val >> 43n) & BOARD_MASK,
    win: ((val >> 85n) & 1n) === 1n,
    draw: ((val >> 86n) & 1n) === 1n,
  };
}

async function main() {
  console.log("== Starting Comprehensive Gas Measurement ==");
  const [deployer, human, sessionKey, operator, treasury] = await ethers.getSigners();

  // 1. Give deployer BEM balance
  console.log("Setting BEM balance...");
  const slot = 5;
  const balanceKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [deployer.address, slot]));
  const balanceVal = ethers.zeroPadValue(ethers.toBeHex(100n * 10n**8n), 32);
  await network.provider.send("hardhat_setStorageAt", [BEM_ADDR, balanceKey, balanceVal]);

  const bem = new ethers.Contract(BEM_ADDR, ["function approve(address, uint256) returns (bool)"], deployer);
  await (await bem.approve(FACTORY_ADDR, ethers.MaxUint256)).wait();

  // 2. Deploy fresh CPU
  console.log("Creating CPU...");
  const factory = new ethers.Contract(FACTORY_ADDR, [
    "function createCPU(string,string,string,uint256,uint256) returns (address)",
    "function cpuCount() view returns (uint256)",
    "function cpuAt(uint256) view returns (address)"
  ], deployer);

  const countBefore = await factory.cpuCount();
  await (await factory.createCPU("TapeFour CPU", "C4CPU", "https://tapefour.xyz/cpu/", 10000, 0)).wait();
  const cpuAddr = await factory.cpuAt(countBefore);
  console.log("CPU deployed at:", cpuAddr);

  // 3. Mint 1,479 transistors
  console.log("Minting 1,479 transistors...");
  const cpu = new ethers.Contract(cpuAddr, [
    "function transistors() view returns (address)",
    "function TAPEOUT_FEE() view returns (uint256)",
    "function tapeout(bytes,uint32,uint32) payable returns (uint256)",
    "function eval(uint256,bytes) view returns (bytes)",
  ], deployer);

  const transAddr = await cpu.transistors();
  await (await bem.approve(transAddr, ethers.MaxUint256)).wait();
  const trans = new ethers.Contract(transAddr, ["function mint(uint256,uint256)"], deployer);
  await (await trans.mint(0, 1479)).wait();
  console.log("Transistors minted!");

  // 4. Tape out circuit
  console.log("Taping out circuit...");
  const netlistBytes = fs.readFileSync(path.join(__dirname, "../../scripts/c4_netlist.bin"));
  const fee = await cpu.TAPEOUT_FEE();
  await (await cpu.tapeout(netlistBytes, 88, 87, { value: fee })).wait();
  const circuitId = 1n;
  console.log("Circuit taped out! ID:", circuitId);

  // 5. Deploy Measurer and TapeFour
  console.log("Deploying EvalMeasurer & TapeFour...");
  const MeasurerF = await ethers.getContractFactory("EvalMeasurer");
  const measurer = await MeasurerF.deploy();
  await measurer.waitForDeployment();

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
  console.log("Contracts deployed!");

  // --- POSITIONS TO TEST ---
  // A. Opening Move: empty board, human plays col 3
  const openInputs = packInputs(0n, 0n, 3, 0);

  // B. Mid-game Move: after human plays 0, bot plays 1, human plays 2; now bot plays 3
  const midBoardA = (1n << 0n) | (1n << 2n);
  const midBoardB = (1n << 1n);
  const midInputs = packInputs(midBoardA, midBoardB, 3, 1);

  // C. Winning Move: human has 3 in column 0 (rows 0, 1, 2)
  const winBoardA = (1n << 0n) | (1n << 7n) | (1n << 14n);
  const winBoardB = (1n << 1n) | (1n << 8n) | (1n << 15n);
  const winInputs = packInputs(winBoardA, winBoardB, 0, 0);

  // --- MEASURE DIRECT EVAL GAS (contract staticcall) ---
  console.log("\n=== 1. Direct cpu.eval() Low-Level Staticcall Gas ===");
  const [openOk, openRes, openGas] = await measurer.measureEval(cpuAddr, circuitId, openInputs);
  const [openBytes] = ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], openRes);
  const openOut = unpackOutputs(ethers.getBytes(openBytes));
  console.log(`Opening Move eval: success=${openOk}, gas=${openGas.toString()}, valid=${openOut.valid}, newBoardA=${openOut.newBoardA}, win=${openOut.win}`);

  const [midOk, midRes, midGas] = await measurer.measureEval(cpuAddr, circuitId, midInputs);
  const [midBytes] = ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], midRes);
  const midOut = unpackOutputs(ethers.getBytes(midBytes));
  console.log(`Mid-game Move eval: success=${midOk}, gas=${midGas.toString()}, valid=${midOut.valid}, win=${midOut.win}`);

  const [winOk, winRes, winGas] = await measurer.measureEval(cpuAddr, circuitId, winInputs);
  const [winBytes] = ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], winRes);
  const winOut = unpackOutputs(ethers.getBytes(winBytes));
  console.log(`Winning Move eval:  success=${winOk}, gas=${winGas.toString()}, valid=${winOut.valid}, win=${winOut.win}`);

  // --- MEASURE TapeFour.playMove / playBotMove TX GAS ---
  console.log("\n=== 2. TapeFour Ranked Contract Transaction Gas ===");

  // Game 1: Opening move
  await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: ethers.parseEther("0.001") });
  const txOpen = await tapeFour.connect(sessionKey).playMove(0n, 3);
  const rcOpen = await txOpen.wait();
  console.log(`TapeFour Opening Move tx gas: ${rcOpen.gasUsed.toString()}`);

  // Game 2: Mid-game move
  await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: ethers.parseEther("0.001") });
  const gMid = 1n;
  await (await tapeFour.connect(sessionKey).playMove(gMid, 0)).wait();
  await (await tapeFour.connect(operator).playBotMove(gMid, 1)).wait();
  await (await tapeFour.connect(sessionKey).playMove(gMid, 2)).wait();
  const txMid = await tapeFour.connect(operator).playBotMove(gMid, 3);
  const rcMid = await txMid.wait();
  console.log(`TapeFour Mid-game Move tx gas: ${rcMid.gasUsed.toString()}`);

  // Game 3: Winning move
  console.log("Testing Winning Move in Game 3...");
  await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: ethers.parseEther("0.001") });
  const gWin = 2n;
  try {
    for (let i = 0; i < 3; i++) {
      console.log(`Move round ${i+1}: human col 0`);
      await (await tapeFour.connect(sessionKey).playMove(gWin, 0)).wait();
      console.log(`Move round ${i+1}: bot col 1`);
      await (await tapeFour.connect(operator).playBotMove(gWin, 1)).wait();
    }
    console.log("Playing 4th move in col 0 for the win...");
    const txWin = await tapeFour.connect(sessionKey).playMove(gWin, 0); // 4th in col 0 -> WIN!
    const rcWin = await txWin.wait();
    console.log(`TapeFour Winning Move tx gas:  ${rcWin.gasUsed.toString()}`);
  } catch (err) {
    console.error("Caught error during Game 3:", err.message || err);
  }

  console.log("\n=== SUMMARY OF MEASUREMENTS ===");
  console.log(`Direct eval (Opening):  ${openGas.toString()} gas`);
  console.log(`Direct eval (Mid-game): ${midGas.toString()} gas`);
  console.log(`Direct eval (Winning):  ${winGas.toString()} gas`);
  console.log(`TapeFour tx (Opening):  ${rcOpen.gasUsed.toString()} gas`);
  console.log(`TapeFour tx (Mid-game): ${rcMid.gasUsed.toString()} gas`);
  console.log(`TapeFour tx (Winning):  ${rcWin.gasUsed.toString()} gas`);
}

main().catch(console.error);
