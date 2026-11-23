// contracts/scripts/test_tapeout_fork.js
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

const CPU_ABI = [
  'function tapeout(bytes netlist, uint32 inBits, uint32 outBits) payable returns (uint256)',
  'function eval(uint256 id, bytes inputs) view returns (bytes)',
  'function TAPEOUT_FEE() view returns (uint256)',
  'function nextId() view returns (uint256)',
  'function transistors() view returns (address)',
];

const TRANSISTOR_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function mint(uint256 id, uint256 amount) payable',
  'function mintPrice() view returns (uint256)',
  'function protocolFee() view returns (uint256)',
  'function paymentToken() view returns (address)',
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const cpu437Addr = '0xdd6bb6fbda8ee867ef838bbe56eba7d1ecc2c2f4';
  const cpu = new hre.ethers.Contract(cpu437Addr, CPU_ABI, deployer);

  const transAddr = await cpu.transistors();
  console.log('CPU 437 Transistors:', transAddr);
  const transistors = new hre.ethers.Contract(transAddr, TRANSISTOR_ABI, deployer);

  const netlistBytes = fs.readFileSync(path.join(__dirname, '../../scripts/c4_netlist.bin'));
  console.log('Netlist bytes:', netlistBytes.length, '(gates:', netlistBytes.length / 7, ')');

  const tapeoutFee = await cpu.TAPEOUT_FEE();
  console.log('TAPEOUT_FEE:', tapeoutFee);

  // Give deployer 100 OKB
  await hre.network.provider.send('hardhat_setBalance', [
    await deployer.getAddress(),
    '0x56bc75e2d63100000', // 100 ETH
  ]);

  // Give deployer 1,356 NAND transistors (id 0) using hardhat_setStorageAt or impersonation
  // First check if mint works directly
  const nextId = await cpu.nextId();
  console.log('Next Circuit ID:', nextId);

  // Let's test tapeout directly
  console.log('Calling tapeout...');
  const tx = await cpu.tapeout(netlistBytes, 88, 87, { value: tapeoutFee });
  const rc = await tx.wait();
  console.log('Tapeout confirmed! Gas used:', rc.gasUsed);

  // Test eval on circuit
  console.log('Testing eval on circuit', nextId, '...');
  const testInput = new Uint8Array(11); // empty board, col 3, turn 0
  testInput[10] = 0x00; // col 3
  testInput[10] = (3 << 4); // col 3
  // packInputs(0n, 0n, 3, 0)
  // bits 84-86: col 3 -> bit 84 + 85 = 1 + 2 = 3. byte 10 bits 4..6 = 3 << 4 = 0x30
  testInput[10] = 0x30;
  const outHex = await cpu.eval(nextId, testInput);
  console.log('eval output hex:', outHex);
}

main().catch(console.error);
