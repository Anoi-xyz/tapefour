const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const BOARD_MASK = (1n << 42n) - 1n;

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
  const [deployer] = await ethers.getSigners();
  const cpuAddr = "0x839bdd6fa7a66416a609a735e11de5411b98574e"; // processor address
  const codeHex = fs.readFileSync(path.join(__dirname, "cpu_impl_code.hex"), "utf8").trim();

  // Set the CPU bytecode at cpuAddr
  await network.provider.send("hardhat_setCode", [cpuAddr, codeHex]);

  // Read netlist
  const netlistBytes = fs.readFileSync(path.join(__dirname, "../../scripts/c4_netlist.bin"));

  // Check if we need initialize or if tapeout works
  const cpu = new ethers.Contract(cpuAddr, [
    "function initialize(string,string,string,address,uint256,uint256)",
    "function tapeout(bytes,uint32,uint32) payable returns (uint256)",
    "function eval(uint256,bytes) view returns (bytes)"
  ], deployer);

  try {
    await (await cpu.initialize("C4 CPU", "C4CPU", "uri", deployer.address, 10000, 0)).wait();
    console.log("Initialized CPU!");
  } catch (e) {
    console.log("Init skipped/failed:", e.message.slice(0, 50));
  }

  // Tape out circuit
  console.log("Taping out...");
  try {
    const tx = await cpu.tapeout(netlistBytes, 88, 87, { value: 0 });
    await tx.wait();
    console.log("Taped out with value 0!");
  } catch (e) {
    console.log("Tapeout with 0 failed, trying with fee:", e.message.slice(0, 50));
    const tx = await cpu.tapeout(netlistBytes, 88, 87, { value: ethers.parseEther("0.0013") });
    await tx.wait();
    console.log("Taped out with fee!");
  }

  console.log("Running 100 calls in a loop...");
  for (let i = 0; i < 100; i++) {
    const inBytes = packInputs(0n, 0n, i % 7, 0);
    const start = Date.now();
    const res = await cpu.eval(1n, inBytes);
    const elapsed = Date.now() - start;
    if (i % 10 === 0) {
      console.log(`Call ${i}: elapsed=${elapsed}ms, res=${res.slice(0, 10)}`);
    }
  }
  console.log("🎉 ALL 100 CALLS COMPLETED ON LOCAL HARDHAT NETWORK!");
}

main().catch(console.error);
