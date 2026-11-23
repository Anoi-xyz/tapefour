// test/TapeFour_real.test.js
// Tests TapeFour ranked contract against the REAL taped-out Connect Four circuit on an X Layer fork.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const BOARD_MASK = (1n << 42n) - 1n;
const FACTORY_ADDR = "0x1f09daefa827f02cbb40967cc91b259763760761";
const BEM_ADDR = "0x60e62efa9405d6873c5deabd4e6cc91c25363952";

describe("TapeFour with REAL On-Chain Circuit", function () {
  this.timeout(300000);

  let deployer, human, sessionKey, operator, treasury;
  let cpuAddr, circuitId, tapeFour;

  before(async function () {
    [deployer, human, sessionKey, operator, treasury] = await ethers.getSigners();

    // 1. Give deployer BEM balance
    const slot = 5;
    const balanceKey = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [deployer.address, slot])
    );
    const balanceVal = ethers.zeroPadValue(ethers.toBeHex(100n * 10n**8n), 32);
    await network.provider.send("hardhat_setStorageAt", [BEM_ADDR, balanceKey, balanceVal]);

    const bem = new ethers.Contract(BEM_ADDR, ["function approve(address, uint256) returns (bool)"], deployer);
    await (await bem.approve(FACTORY_ADDR, ethers.MaxUint256)).wait();

    // 2. Deploy fresh CPU via Factory
    const factory = new ethers.Contract(FACTORY_ADDR, [
      "function createCPU(string,string,string,uint256,uint256) returns (address)",
      "function cpuCount() view returns (uint256)",
      "function cpuAt(uint256) view returns (address)"
    ], deployer);

    const countBefore = await factory.cpuCount();
    await (await factory.createCPU("TapeFour CPU", "C4CPU", "https://tapefour.xyz/cpu/", 10000, 0)).wait();
    cpuAddr = await factory.cpuAt(countBefore);

    // 3. Mint 1,479 transistors
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

    // 4. Tape out circuit
    const netlistBytes = fs.readFileSync(path.join(__dirname, "../../scripts/c4_netlist.bin"));
    const fee = await cpu.TAPEOUT_FEE();
    await (await cpu.tapeout(netlistBytes, 88, 87, { value: fee })).wait();
    circuitId = 1n;

    // 5. Deploy TapeFour contract with real CPU
    const TapeFourFactory = await ethers.getContractFactory("TapeFour");
    tapeFour = await TapeFourFactory.deploy(
      cpuAddr,
      circuitId,
      ethers.parseEther("0.005"),
      6000n,
      await treasury.getAddress(),
      86400n,
      600n,
      await operator.getAddress()
    );
    await tapeFour.waitForDeployment();
  });

  it("plays a full game (start to win) verified by the REAL on-chain circuit", async function () {
    const entryFee = ethers.parseEther("0.005");
    const sessionKeyAddr = await sessionKey.getAddress();

    // Start ranked game
    await tapeFour.connect(human).startRanked(sessionKeyAddr, { value: entryFee });
    const gameId = 0n;

    let game = await tapeFour.games(gameId);
    expect(game.status).to.equal(0n); // GameStatus.Active is 0n
    expect(game.turn).to.equal(0n);   // Human turn

    // 3 rounds of moves: Human in col 0, Bot in col 1
    for (let r = 0; r < 3; r++) {
      // Human move (col 0)
      const txH = await tapeFour.connect(sessionKey).playMove(gameId, 0);
      const rcH = await txH.wait();
      expect(rcH.status).to.equal(1);

      // Bot move (col 1)
      const txB = await tapeFour.connect(operator).playBotMove(gameId, 1);
      const rcB = await txB.wait();
      expect(rcB.status).to.equal(1);
    }

    game = await tapeFour.games(gameId);
    expect(game.status).to.equal(0n); // Still Active
    expect(game.turn).to.equal(0n);   // Human turn

    // 4th move by Human in col 0 -> 4 in a vertical column! (Circuit evaluates WIN=true)
    const txWin = await tapeFour.connect(sessionKey).playMove(gameId, 0);
    const rcWin = await txWin.wait();
    expect(rcWin.status).to.equal(1);

    // Verify game finished with Human Win!
    game = await tapeFour.games(gameId);
    expect(game.status).to.equal(1n); // GameStatus.HumanWon is 1n

    const currentWeek = await tapeFour.currentWeek();
    const wins = await tapeFour.weeklyWins(currentWeek, await human.getAddress());
    expect(wins).to.equal(1n);

    console.log("  Full game completed with REAL circuit: Human won in 7 moves!");
    console.log(`  Final Winning Move gas: ${rcWin.gasUsed.toString()} gas`);
  });

  it("refunds 100% of ranked fee upon bot timeout on the REAL circuit", async function () {
    const entryFee = ethers.parseEther("0.005");
    const sessionKeyAddr = await sessionKey.getAddress();

    // Start game 1
    await tapeFour.connect(human).startRanked(sessionKeyAddr, { value: entryFee });
    const gameId = 1n;

    // Human plays col 2
    const txH = await tapeFour.connect(sessionKey).playMove(gameId, 2);
    await txH.wait();

    let game = await tapeFour.games(gameId);
    expect(game.turn).to.equal(1n); // Bot's turn
    expect(game.status).to.equal(0n); // Active

    // Advance time past bot timeout (600s = 10m)
    await network.provider.send("evm_increaseTime", [605]);
    await network.provider.send("evm_mine");

    const humanBalBefore = await ethers.provider.getBalance(await human.getAddress());
    const txRefund = await tapeFour.connect(human).claimBotTimeout(gameId);
    const rcRefund = await txRefund.wait();
    const gasSpent = BigInt(rcRefund.gasUsed) * BigInt(rcRefund.gasPrice ?? 0n);
    const humanBalAfter = await ethers.provider.getBalance(await human.getAddress());

    // 100% fee refunded (minus caller gas)
    expect(humanBalAfter + gasSpent - humanBalBefore).to.equal(entryFee);

    game = await tapeFour.games(gameId);
    expect(game.status).to.equal(5n); // GameStatus.Voided
    console.log("  Bot timeout refund verified on REAL circuit: 0.005 OKB returned to human!");
  });
});
