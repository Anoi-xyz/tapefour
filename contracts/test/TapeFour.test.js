// test/TapeFour.test.js
// Hardhat test for TapeFour ranked contract
// Tests run against a local in-process Hardhat chain with a mock TapeOut processor.

const { expect } = require("chai");
const { ethers } = require("hardhat");

const BOARD_MASK = (1n << 42n) - 1n;

async function expectRevert(promise, expectedReason) {
  try {
    const tx = await promise;
    if (tx && tx.wait) await tx.wait();
    expect.fail("Expected transaction to revert, but it succeeded");
  } catch (err) {
    if (err.message && err.message.includes("Expected transaction to revert")) {
      throw err;
    }
    if (expectedReason) {
      expect(err.message).to.include(expectedReason);
    }
  }
}

function packInputsForMock(boardA, boardB, col, turn) {
  let val = 0n;
  val |= (boardA & BOARD_MASK);
  val |= (boardB & BOARD_MASK) << 42n;
  val |= (BigInt(col) & 7n) << 84n;
  val |= (BigInt(turn) & 1n) << 87n;
  const bytes = new Uint8Array(11);
  for (let i = 0; i < 11; i++) bytes[i] = Number((val >> BigInt(i * 8)) & 0xffn);
  return bytes;
}

function packOutputs(valid, boardA, boardB, win, draw) {
  let val = 0n;
  if (valid) val |= 1n;
  val |= (boardA & BOARD_MASK) << 1n;
  val |= (boardB & BOARD_MASK) << 43n;
  if (win)  val |= 1n << 85n;
  if (draw) val |= 1n << 86n;
  const bytes = new Uint8Array(11);
  for (let i = 0; i < 11; i++) bytes[i] = Number((val >> BigInt(i * 8)) & 0xffn);
  return bytes;
}

function getLowestEmptyRow(bA, bB, col) {
  for (let r = 0; r < 6; r++) {
    if (((bA | bB) & (1n << BigInt(col + 7 * r))) === 0n) return r;
  }
  return -1;
}

const WINNING_LINES = [];
const ci = (c, r) => c + 7 * r;
for (let r = 0; r < 6; r++) for (let c = 0; c <= 3; c++)
  WINNING_LINES.push([ci(c,r), ci(c+1,r), ci(c+2,r), ci(c+3,r)]);
for (let c = 0; c < 7; c++) for (let r = 0; r <= 2; r++)
  WINNING_LINES.push([ci(c,r), ci(c,r+1), ci(c,r+2), ci(c,r+3)]);
for (let c = 0; c <= 3; c++) for (let r = 0; r <= 2; r++)
  WINNING_LINES.push([ci(c,r), ci(c+1,r+1), ci(c+2,r+2), ci(c+3,r+3)]);
for (let c = 0; c <= 3; c++) for (let r = 3; r < 6; r++)
  WINNING_LINES.push([ci(c,r), ci(c+1,r-1), ci(c+2,r-2), ci(c+3,r-3)]);

function checkWinRef(board) {
  return WINNING_LINES.some(l => l.every(cell => ((board >> BigInt(cell)) & 1n) === 1n));
}

function applyMoveRef(bA, bB, col, turn) {
  const row = getLowestEmptyRow(bA, bB, col);
  if (row === -1 || col < 0 || col > 6) return { valid: false, boardA: bA, boardB: bB, win: false, draw: false };
  const cell = col + 7 * row;
  let nA = bA, nB = bB;
  if (turn === 0) nA |= 1n << BigInt(cell);
  else            nB |= 1n << BigInt(cell);
  const mover = turn === 0 ? nA : nB;
  const win   = checkWinRef(mover);
  const full  = ((nA | nB) & BOARD_MASK) === BOARD_MASK;
  return { valid: true, boardA: nA, boardB: nB, win, draw: full && !win };
}

describe("TapeFour", function () {
  let owner, human, sessionKey, operator, treasury, other;
  let mockProc, tapeFour;

  const RANKED_FEE   = ethers.parseEther("0.005");
  const POOL_BPS     = 6000n;
  const MOVE_TIMEOUT = 24n * 3600n;
  const BOT_TIMEOUT  = 600n; // 10 minutes
  const CIRCUIT_ID   = 42n;

  before(async () => {
    [owner, human, sessionKey, operator, treasury, other] = await ethers.getSigners();
  });

  async function deployFresh(overrides = {}) {
    const MP = await ethers.getContractFactory("MockProcessor");
    mockProc = await MP.deploy();

    const TF = await ethers.getContractFactory("TapeFour");
    tapeFour = await TF.deploy(
      await mockProc.getAddress(),
      overrides.circuitId     ?? CIRCUIT_ID,
      overrides.rankedFee     ?? RANKED_FEE,
      overrides.poolBps       ?? POOL_BPS,
      overrides.treasury      ?? await treasury.getAddress(),
      overrides.moveTimeout   ?? MOVE_TIMEOUT,
      overrides.botTimeout    ?? BOT_TIMEOUT,
      overrides.botOperator   ?? await operator.getAddress()
    );
    return { mockProc, tapeFour };
  }

  async function programMove(boardA, boardB, col, turn) {
    const { valid, boardA: nA, boardB: nB, win, draw } = applyMoveRef(boardA, boardB, col, turn);
    const outBytes = packOutputs(valid, nA, nB, win, draw);
    await mockProc.setResponse(outBytes);
    return { valid, nA, nB, win, draw };
  }

  describe("Deployment", () => {
    it("pins processor and circuit at deploy", async () => {
      await deployFresh();
      expect(await tapeFour.processor()).to.equal(await mockProc.getAddress());
      expect(await tapeFour.circuitId()).to.equal(CIRCUIT_ID);
      expect(await tapeFour.botOperator()).to.equal(await operator.getAddress());
      expect(await tapeFour.rankedFee()).to.equal(RANKED_FEE);
      expect(await tapeFour.poolBps()).to.equal(POOL_BPS);
      expect(await tapeFour.botTimeout()).to.equal(BOT_TIMEOUT);
      expect(await tapeFour.moveTimeout()).to.equal(MOVE_TIMEOUT);
    });

    it("reverts with fee > MAX_FEE", async () => {
      const TF = await ethers.getContractFactory("TapeFour");
      const MP = await ethers.getContractFactory("MockProcessor");
      const mp = await MP.deploy();
      await expectRevert(
        TF.deploy(await mp.getAddress(), 1n, ethers.parseEther("0.2"), 6000n,
          await treasury.getAddress(), 86400n, 600n, await operator.getAddress()),
        "invalid fee"
      );
    });

    it("reverts with poolBps out of bounds", async () => {
      const TF = await ethers.getContractFactory("TapeFour");
      const MP = await ethers.getContractFactory("MockProcessor");
      const mp = await MP.deploy();
      await expectRevert(
        TF.deploy(await mp.getAddress(), 1n, RANKED_FEE, 500n,
          await treasury.getAddress(), 86400n, 600n, await operator.getAddress()),
        "invalid pool bps"
      );
      await expectRevert(
        TF.deploy(await mp.getAddress(), 1n, RANKED_FEE, 9500n,
          await treasury.getAddress(), 86400n, 600n, await operator.getAddress()),
        "invalid pool bps"
      );
    });

    it("reverts with botTimeout out of bounds", async () => {
      const TF = await ethers.getContractFactory("TapeFour");
      const MP = await ethers.getContractFactory("MockProcessor");
      const mp = await MP.deploy();
      await expectRevert(
        TF.deploy(await mp.getAddress(), 1n, RANKED_FEE, 6000n,
          await treasury.getAddress(), 86400n, 60n, await operator.getAddress()),
        "invalid bot timeout"
      );
    });
  });

  describe("startRanked", () => {
    beforeEach(async () => { await deployFresh(); });

    it("accepts fee and escrows it in contract until settlement", async () => {
      const treasuryBefore = await ethers.provider.getBalance(await treasury.getAddress());
      const contractBefore = await ethers.provider.getBalance(await tapeFour.getAddress());

      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });

      const treasuryAfter = await ethers.provider.getBalance(await treasury.getAddress());
      const contractAfter = await ethers.provider.getBalance(await tapeFour.getAddress());

      // Fee is escrowed: treasury not paid yet, prize pool not incremented yet
      expect(treasuryAfter - treasuryBefore).to.equal(0n);
      expect(await tapeFour.prizePool()).to.equal(0n);
      expect(contractAfter - contractBefore).to.equal(RANKED_FEE);
    });

    it("creates game with status Active", async () => {
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
      const g = await tapeFour.games(0);
      expect(g.status).to.equal(0n);
      expect(g.turn).to.equal(0n);
      expect(g.fee).to.equal(RANKED_FEE);
    });

    it("reverts on fee too low", async () => {
      await expectRevert(
        tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: 1n }),
        "fee too low"
      );
    });

    it("forwards gas stipend to session key when msg.value > rankedFee", async () => {
      const stipend = ethers.parseEther("0.005");
      const keyBalBefore = await ethers.provider.getBalance(await sessionKey.getAddress());
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE + stipend });
      const keyBalAfter = await ethers.provider.getBalance(await sessionKey.getAddress());
      expect(keyBalAfter - keyBalBefore).to.equal(stipend);
    });

    it("reverts on stipend > MAX_STIPEND", async () => {
      const hugeStipend = ethers.parseEther("0.06"); // MAX_STIPEND is 0.05 ether
      await expectRevert(
        tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE + hugeStipend }),
        "stipend exceeds cap"
      );
    });

    it("reverts on zero session key", async () => {
      await expectRevert(
        tapeFour.connect(human).startRanked(ethers.ZeroAddress, { value: RANKED_FEE }),
        "zero session key"
      );
    });
  });

  describe("playMove — human", () => {
    beforeEach(async () => {
      await deployFresh();
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
    });

    it("accepts a valid human move via session key", async () => {
      await programMove(0n, 0n, 3, 0);
      const tx = await tapeFour.connect(sessionKey).playMove(0n, 3);
      const rc = await tx.wait();
      expect(rc.status).to.equal(1);
      const g = await tapeFour.games(0n);
      expect(g.turn).to.equal(1n);
    });

    it("accepts a valid move from human wallet directly", async () => {
      await programMove(0n, 0n, 3, 0);
      const tx = await tapeFour.connect(human).playMove(0n, 3);
      const rc = await tx.wait();
      expect(rc.status).to.equal(1);
    });

    it("rejects move from wrong caller", async () => {
      await programMove(0n, 0n, 3, 0);
      await expectRevert(
        tapeFour.connect(other).playMove(0n, 3),
        "not authorised"
      );
    });

    it("rejects an invalid move (circuit says invalid)", async () => {
      const outBytes = packOutputs(false, 0n, 0n, false, false);
      await mockProc.setResponse(outBytes);
      await expectRevert(
        tapeFour.connect(sessionKey).playMove(0n, 3),
        "move invalid per circuit"
      );
    });

    it("rejects col >= 7", async () => {
      await expectRevert(
        tapeFour.connect(sessionKey).playMove(0n, 7),
        "col out of range"
      );
    });
  });

  describe("playBotMove", () => {
    beforeEach(async () => {
      await deployFresh();
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
      await programMove(0n, 0n, 3, 0);
      await tapeFour.connect(sessionKey).playMove(0n, 3);
    });

    it("only bot operator can call playBotMove", async () => {
      const [bA] = await tapeFour.getBoard(0n);
      const [,bB] = await tapeFour.getBoard(0n);
      await programMove(bA, bB, 3, 1);
      await expectRevert(
        tapeFour.connect(other).playBotMove(0n, 3),
        "not bot operator"
      );
    });

    it("operator can submit bot move", async () => {
      const [bA] = await tapeFour.getBoard(0n);
      const [,bB] = await tapeFour.getBoard(0n);
      await programMove(bA, bB, 3, 1);
      const tx = await tapeFour.connect(operator).playBotMove(0n, 3);
      const rc = await tx.wait();
      expect(rc.status).to.equal(1);
      const g = await tapeFour.games(0n);
      expect(g.turn).to.equal(0n);
    });

    it("rejects bot move on human turn", async () => {
      const { mockProc: mp, tapeFour: tf } = await deployFresh();
      await tf.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
      await mp.setResponse(packOutputs(true, 0n, 0n, false, false));
      await expectRevert(
        tf.connect(operator).playBotMove(0n, 3),
        "not bot turn"
      );
    });
  });

  describe("Full game — Human wins", () => {
    it("plays a full game to human win, records the win, and settles fee", async () => {
      await deployFresh();
      const treasuryBefore = await ethers.provider.getBalance(await treasury.getAddress());
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });

      let bA = 0n, bB = 0n;
      const moves = [[0,0],[1,1],[0,0],[2,1],[0,0],[3,1],[0,0]];

      for (const [col, turn] of moves) {
        const ref = applyMoveRef(bA, bB, col, turn);
        await mockProc.setResponse(packOutputs(ref.valid, ref.boardA, ref.boardB, ref.win, ref.draw));
        if (turn === 0) await tapeFour.connect(sessionKey).playMove(0n, col);
        else            await tapeFour.connect(operator).playBotMove(0n, col);
        bA = ref.boardA; bB = ref.boardB;
      }

      const g = await tapeFour.games(0n);
      expect(g.status).to.equal(1n);

      const week = await tapeFour.currentWeek();
      expect(await tapeFour.weeklyWins(week, await human.getAddress())).to.equal(1n);

      // Fee settled upon win: 60% pool, 40% treasury
      const toPool     = (RANKED_FEE * POOL_BPS) / 10000n;
      const toTreasury = RANKED_FEE - toPool;
      expect(await tapeFour.prizePool()).to.equal(toPool);
      const treasuryAfter = await ethers.provider.getBalance(await treasury.getAddress());
      expect(treasuryAfter - treasuryBefore).to.equal(toTreasury);
    });
  });

  describe("Full game — Draw", () => {
    it("detects draw when circuit says draw and refunds fee to human", async () => {
      await deployFresh();
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
      const drawOutput = packOutputs(true, BOARD_MASK, 0n, false, true);
      await mockProc.setResponse(drawOutput);

      const humanBalBefore = await ethers.provider.getBalance(await human.getAddress());
      await tapeFour.connect(sessionKey).playMove(0n, 0);
      const humanBalAfter = await ethers.provider.getBalance(await human.getAddress());

      const g = await tapeFour.games(0n);
      expect(g.status).to.equal(3n); // Draw
      // Human receives full refund on draw
      expect(humanBalAfter - humanBalBefore).to.equal(RANKED_FEE);
      expect(await tapeFour.prizePool()).to.equal(0n);
    });
  });

  describe("Timeout / forfeit", () => {
    it("allows forfeit claim after timeout", async () => {
      await deployFresh();
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
      await ethers.provider.send("evm_increaseTime", [Number(MOVE_TIMEOUT) + 1]);
      await ethers.provider.send("evm_mine", []);
      const tx = await tapeFour.connect(other).claimForfeit(0n);
      const rc = await tx.wait();
      expect(rc.status).to.equal(1);
      const g = await tapeFour.games(0n);
      expect(g.status).to.equal(4n); // HumanForfeit
    });

    it("rejects forfeit before timeout", async () => {
      await deployFresh();
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
      await expectRevert(
        tapeFour.connect(other).claimForfeit(0n),
        "timeout not reached"
      );
    });
  });

  describe("Bot-timeout refund (claimBotTimeout)", () => {
    beforeEach(async () => {
      await deployFresh();
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
      // Human makes opening move -> turn becomes 1 (bot's turn)
      await programMove(0n, 0n, 3, 0);
      await tapeFour.connect(sessionKey).playMove(0n, 3);
    });

    it("rejects refund claim before bot timeout expires", async () => {
      await expectRevert(
        tapeFour.connect(human).claimBotTimeout(0n),
        "bot timeout not reached"
      );
    });

    it("allows human to claim full refund after bot timeout expires", async () => {
      await ethers.provider.send("evm_increaseTime", [Number(BOT_TIMEOUT) + 1]);
      await ethers.provider.send("evm_mine", []);

      const humanBalBefore = await ethers.provider.getBalance(await human.getAddress());
      const tx = await tapeFour.connect(human).claimBotTimeout(0n);
      const rc = await tx.wait();
      const gasCost = BigInt(rc.gasUsed) * BigInt(rc.gasPrice ?? 0n);
      const humanBalAfter = await ethers.provider.getBalance(await human.getAddress());

      // Human received full refund minus gas of claim call
      expect(humanBalAfter + gasCost - humanBalBefore).to.equal(RANKED_FEE);

      const g = await tapeFour.games(0n);
      expect(g.status).to.equal(5n); // GameStatus.Voided
      expect(await tapeFour.prizePool()).to.equal(0n);
    });

    it("allows session key to trigger refund on behalf of human", async () => {
      await ethers.provider.send("evm_increaseTime", [Number(BOT_TIMEOUT) + 1]);
      await ethers.provider.send("evm_mine", []);

      const humanBalBefore = await ethers.provider.getBalance(await human.getAddress());
      await tapeFour.connect(sessionKey).claimBotTimeout(0n);
      const humanBalAfter = await ethers.provider.getBalance(await human.getAddress());

      expect(humanBalAfter - humanBalBefore).to.equal(RANKED_FEE);
      const g = await tapeFour.games(0n);
      expect(g.status).to.equal(5n);
    });

    it("rejects refund claim from unauthorized third party", async () => {
      await ethers.provider.send("evm_increaseTime", [Number(BOT_TIMEOUT) + 1]);
      await ethers.provider.send("evm_mine", []);

      await expectRevert(
        tapeFour.connect(other).claimBotTimeout(0n),
        "not authorised"
      );
    });

    it("rejects refund claim on human turn", async () => {
      // Complete bot move so it's human turn again
      const [bA] = await tapeFour.getBoard(0n);
      const [,bB] = await tapeFour.getBoard(0n);
      await programMove(bA, bB, 3, 1);
      await tapeFour.connect(operator).playBotMove(0n, 3);

      await ethers.provider.send("evm_increaseTime", [Number(BOT_TIMEOUT) + 1]);
      await ethers.provider.send("evm_mine", []);

      await expectRevert(
        tapeFour.connect(human).claimBotTimeout(0n),
        "not bot turn"
      );
    });

    it("rejects refund claim on already completed game", async () => {
      await ethers.provider.send("evm_increaseTime", [Number(BOT_TIMEOUT) + 1]);
      await ethers.provider.send("evm_mine", []);
      await tapeFour.connect(human).claimBotTimeout(0n);

      await expectRevert(
        tapeFour.connect(human).claimBotTimeout(0n),
        "not active"
      );
    });
  });

  describe("Prize pool", () => {
    it("locks week pool and allows winner to claim proportional share", async () => {
      await deployFresh();
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
      const week = await tapeFour.currentWeek();

      await mockProc.setResponse(packOutputs(true, 1n, 0n, true, false));
      await tapeFour.connect(sessionKey).playMove(0n, 0);

      const poolAmount = await tapeFour.prizePool();
      expect(poolAmount > 0n).to.be.true;

      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine", []);

      await tapeFour.lockWeeklyPool(week);
      expect(await tapeFour.weeklyPoolSnapshot(week)).to.equal(poolAmount);

      const before = await ethers.provider.getBalance(await human.getAddress());
      const tx     = await tapeFour.connect(human).claimPrize(week);
      const rc     = await tx.wait();
      const gas    = BigInt(rc.gasUsed) * BigInt(rc.gasPrice ?? 0n);
      const after  = await ethers.provider.getBalance(await human.getAddress());

      expect(after + gas - before).to.equal(poolAmount);
    });

    it("rejects double claim", async () => {
      await deployFresh();
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
      const week = await tapeFour.currentWeek();
      await mockProc.setResponse(packOutputs(true, 1n, 0n, true, false));
      await tapeFour.connect(sessionKey).playMove(0n, 0);
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine", []);
      await tapeFour.lockWeeklyPool(week);
      await tapeFour.connect(human).claimPrize(week);
      await expectRevert(
        tapeFour.connect(human).claimPrize(week),
        "already claimed"
      );
    });

    it("rejects locking current week", async () => {
      await deployFresh();
      const currentW = await tapeFour.currentWeek();
      await expectRevert(
        tapeFour.lockWeeklyPool(currentW),
        "cannot lock current week"
      );
    });

    it("rejects locking already locked week", async () => {
      await deployFresh();
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
      const week = await tapeFour.currentWeek();
      await mockProc.setResponse(packOutputs(true, 1n, 0n, true, false));
      await tapeFour.connect(sessionKey).playMove(0n, 0);

      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine", []);

      await tapeFour.lockWeeklyPool(week);
      await expectRevert(
        tapeFour.lockWeeklyPool(week),
        "already locked"
      );
    });

    it("Attacker scenario: winner in an old quiet week gets only that week's pool, cannot drain later weeks", async () => {
      await deployFresh();
      // Week W: attacker plays and wins 1 game
      const weekW = await tapeFour.currentWeek();
      await tapeFour.connect(other).startRanked(await other.getAddress(), { value: RANKED_FEE });
      await mockProc.setResponse(packOutputs(true, 1n, 0n, true, false));
      await tapeFour.connect(other).playMove(0n, 0);

      const poolW = await tapeFour.weeklyPool(weekW);
      expect(poolW).to.equal((RANKED_FEE * POOL_BPS) / 10000n);

      // Advance to Week W+1
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine", []);
      const weekW1 = await tapeFour.currentWeek();
      expect(weekW1 > weekW).to.be.true;

      // In Week W+1, 5 new games are played and won by other players, filling the pool
      for (let i = 1; i <= 5; i++) {
        await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
        const gId = BigInt(i);
        await mockProc.setResponse(packOutputs(true, 1n, 0n, true, false));
        await tapeFour.connect(sessionKey).playMove(gId, 0);
      }

      const poolW1 = await tapeFour.weeklyPool(weekW1);
      expect(poolW1).to.equal(((RANKED_FEE * POOL_BPS) / 10000n) * 5n);

      // Total balance in contract includes both pools
      const contractBal = await ethers.provider.getBalance(await tapeFour.getAddress());
      expect(contractBal >= poolW + poolW1).to.be.true;

      // Attacker locks old week W
      await tapeFour.connect(other).lockWeeklyPool(weekW);
      expect(await tapeFour.weeklySnapshot(weekW)).to.equal(poolW);
      expect(await tapeFour.weeklyPool(weekW)).to.equal(0n);

      // Attacker claims prize for week W
      const balBefore = await ethers.provider.getBalance(await other.getAddress());
      const tx = await tapeFour.connect(other).claimPrize(weekW);
      const rc = await tx.wait();
      const gas = BigInt(rc.gasUsed) * BigInt(rc.gasPrice ?? 0n);
      const balAfter = await ethers.provider.getBalance(await other.getAddress());

      // Attacker received ONLY poolW, NOT poolW1!
      expect(balAfter + gas - balBefore).to.equal(poolW);

      // Week W+1 pool is COMPLETELY untouched!
      expect(await tapeFour.weeklyPool(weekW1)).to.equal(poolW1);

      // Advance to Week W+2 and lock Week W+1
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine", []);
      await tapeFour.lockWeeklyPool(weekW1);
      expect(await tapeFour.weeklySnapshot(weekW1)).to.equal(poolW1);

      // Human claims week W+1 prize and gets full poolW1
      const humanBefore = await ethers.provider.getBalance(await human.getAddress());
      const txH = await tapeFour.connect(human).claimPrize(weekW1);
      const rcH = await txH.wait();
      const gasH = BigInt(rcH.gasUsed) * BigInt(rcH.gasPrice ?? 0n);
      const humanAfter = await ethers.provider.getBalance(await human.getAddress());
      expect(humanAfter + gasH - humanBefore).to.equal(poolW1);
    });

    it("Cross-week game: game starting in week W and ending in week W+1 after W locked does not change W totals", async () => {
      await deployFresh();
      const weekW = await tapeFour.currentWeek();

      // Week W has an existing game that finished with a win
      await tapeFour.connect(other).startRanked(await other.getAddress(), { value: RANKED_FEE });
      await mockProc.setResponse(packOutputs(true, 1n, 0n, true, false));
      await tapeFour.connect(other).playMove(0n, 0); // Game 0 won in week W

      // Game 1 starts in week W, but only plays an opening non-winning move
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
      await mockProc.setResponse(packOutputs(true, 1n, 0n, false, false));
      await tapeFour.connect(sessionKey).playMove(1n, 0); // Game 1 still active

      // Advance to Week W+1
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine", []);
      const weekW1 = await tapeFour.currentWeek();
      expect(weekW1 > weekW).to.be.true;

      // Week W is locked
      await tapeFour.lockWeeklyPool(weekW);
      const snapW = await tapeFour.weeklySnapshot(weekW);
      const winsW = await tapeFour.weeklyTotalWins(weekW);
      expect(winsW).to.equal(1n);

      // Now bot plays a move in Game 1, and then human wins in Week W+1
      await mockProc.setResponse(packOutputs(true, 1n | (1n << 42n), 0n, false, false));
      await tapeFour.connect(operator).playBotMove(1n, 1);

      await mockProc.setResponse(packOutputs(true, 3n | (1n << 42n), 0n, true, false));
      await tapeFour.connect(sessionKey).playMove(1n, 0); // Game 1 finishes with win in Week W+1!

      // Assert that Week W totals are completely unchanged
      expect(await tapeFour.weeklyTotalWins(weekW)).to.equal(winsW);
      expect(await tapeFour.weeklySnapshot(weekW)).to.equal(snapW);
      expect(await tapeFour.weeklyPool(weekW)).to.equal(0n);

      // Assert that Week W+1 received the win and fee
      expect(await tapeFour.weeklyTotalWins(weekW1)).to.equal(1n);
      expect(await tapeFour.weeklyPool(weekW1)).to.equal((RANKED_FEE * POOL_BPS) / 10000n);
      expect(await tapeFour.weeklyWins(weekW1, await human.getAddress())).to.equal(1n);
      expect(await tapeFour.weeklyWins(weekW, await human.getAddress())).to.equal(0n);
    });

    it("Rollover scenario: week with fees and no winners rolls over into current week and is claimable later", async () => {
      await deployFresh();
      const weekW = await tapeFour.currentWeek();

      // Week W: human starts game and bot wins (or human forfeits), so fees are collected but NO human wins
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
      await mockProc.setResponse(packOutputs(true, 1n, 0n, false, false));
      await tapeFour.connect(sessionKey).playMove(0n, 0);

      // Bot wins!
      await mockProc.setResponse(packOutputs(true, 1n | (1n << 42n), 0n, true, false));
      await tapeFour.connect(operator).playBotMove(0n, 1);

      const feePoolW = await tapeFour.weeklyPool(weekW);
      expect(feePoolW).to.equal((RANKED_FEE * POOL_BPS) / 10000n);
      expect(await tapeFour.weeklyTotalWins(weekW)).to.equal(0n);

      // Advance to Week W+1
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine", []);
      const weekW1 = await tapeFour.currentWeek();
      expect(weekW1 > weekW).to.be.true;

      // Lock week W with NO winners: should roll over into week W+1
      await tapeFour.lockWeeklyPool(weekW);
      expect(await tapeFour.weekLocked(weekW)).to.be.true;
      expect(await tapeFour.weeklyPool(weekW)).to.equal(0n);
      expect(await tapeFour.weeklySnapshot(weekW)).to.equal(0n);
      expect(await tapeFour.weeklyPool(weekW1)).to.equal(feePoolW); // Rolled over!

      // In Week W+1: human plays and wins
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
      await mockProc.setResponse(packOutputs(true, 1n, 0n, true, false));
      await tapeFour.connect(sessionKey).playMove(1n, 0);

      const newFeePool = (RANKED_FEE * POOL_BPS) / 10000n;
      const totalPoolW1 = feePoolW + newFeePool;
      expect(await tapeFour.weeklyPool(weekW1)).to.equal(totalPoolW1);

      // Advance to Week W+2 and lock Week W+1
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine", []);
      await tapeFour.lockWeeklyPool(weekW1);
      expect(await tapeFour.weeklySnapshot(weekW1)).to.equal(totalPoolW1);

      // Human claims Week W+1 prize: receives BOTH week W and week W+1 pool amounts!
      const balBefore = await ethers.provider.getBalance(await human.getAddress());
      const tx = await tapeFour.connect(human).claimPrize(weekW1);
      const rc = await tx.wait();
      const gas = BigInt(rc.gasUsed) * BigInt(rc.gasPrice ?? 0n);
      const balAfter = await ethers.provider.getBalance(await human.getAddress());
      expect(balAfter + gas - balBefore).to.equal(totalPoolW1);
    });

    it("Invariant fuzz test: contract balance >= active escrow + unlocked pools + unclaimed snapshots, claims never exceed snapshot", async () => {
      await deployFresh();
      const signers = [human, other, owner];
      const observedWeeks = new Set();
      const activeGames = new Map(); // gameId -> { fee, human }
      const lockedWeeks = new Set();
      const totalClaimed = new Map(); // week -> claimed

      let nextGameId = 0n;

      // Helper to check invariant
      const checkInvariant = async (actionDesc) => {
        const bal = await ethers.provider.getBalance(await tapeFour.getAddress());

        let activeEscrow = 0n;
        for (const [gid, ginfo] of activeGames.entries()) {
          activeEscrow += ginfo.fee;
        }

        let unlockedPools = 0n;
        for (const w of observedWeeks) {
          if (!lockedWeeks.has(w)) {
            unlockedPools += await tapeFour.weeklyPool(w);
          }
        }

        let unclaimedSnapshots = 0n;
        for (const w of lockedWeeks) {
          const snap = await tapeFour.weeklySnapshot(w);
          const claimed = totalClaimed.get(w) || 0n;
          expect(claimed <= snap).to.be.true; // Sum of claims never exceeds snapshot
          unclaimedSnapshots += (snap - claimed);
        }

        expect(
          bal >= activeEscrow + unlockedPools + unclaimedSnapshots,
          `Invariant breached after ${actionDesc}: bal=${bal}, required=${activeEscrow + unlockedPools + unclaimedSnapshots}`
        ).to.be.true;
      };

      // Run 30 mixed randomized actions
      for (let step = 0; step < 30; step++) {
        const actionType = step % 6;
        const currentW = await tapeFour.currentWeek();
        observedWeeks.add(currentW);

        if (actionType === 0) {
          // Start game
          const s = signers[step % signers.length];
          const gid = nextGameId++;
          await tapeFour.connect(s).startRanked(await s.getAddress(), { value: RANKED_FEE });
          activeGames.set(gid, { fee: RANKED_FEE, human: s });
          await checkInvariant(`StartGame #${gid}`);
        } else if (actionType === 1 && activeGames.size > 0) {
          // Play human move (win)
          const [gid, ginfo] = Array.from(activeGames.entries())[0];
          const g = await tapeFour.games(gid);
          if (g.turn === 0n) {
            await mockProc.setResponse(packOutputs(true, 1n, 0n, true, false));
            await tapeFour.connect(ginfo.human).playMove(gid, 0);
            activeGames.delete(gid);
            await checkInvariant(`HumanWin #${gid}`);
          }
        } else if (actionType === 2 && activeGames.size > 0) {
          // Play human move (no win) -> bot move (win)
          const [gid, ginfo] = Array.from(activeGames.entries())[0];
          let g = await tapeFour.games(gid);
          if (g.turn === 0n) {
            await mockProc.setResponse(packOutputs(true, 1n, 0n, false, false));
            await tapeFour.connect(ginfo.human).playMove(gid, 0);
            g = await tapeFour.games(gid);
          }
          if (g.turn === 1n && g.status === 0n) {
            await mockProc.setResponse(packOutputs(true, 1n | (1n << 42n), 0n, true, false));
            await tapeFour.connect(operator).playBotMove(gid, 1);
            activeGames.delete(gid);
            await checkInvariant(`BotWin #${gid}`);
          }
        } else if (actionType === 3 && activeGames.size > 0) {
          // Draw (100% refund)
          const [gid, ginfo] = Array.from(activeGames.entries())[0];
          const g = await tapeFour.games(gid);
          if (g.turn === 0n) {
            await mockProc.setResponse(packOutputs(true, 1n, 0n, false, true)); // draw!
            await tapeFour.connect(ginfo.human).playMove(gid, 0);
            activeGames.delete(gid);
            await checkInvariant(`Draw #${gid}`);
          }
        } else if (actionType === 4) {
          // Advance time across week boundary
          await ethers.provider.send("evm_increaseTime", [8 * 24 * 3600]);
          await ethers.provider.send("evm_mine", []);
          const newW = await tapeFour.currentWeek();
          observedWeeks.add(newW);

          // Lock any unlockable past weeks
          for (const w of Array.from(observedWeeks)) {
            if (w < newW && !lockedWeeks.has(w)) {
              await tapeFour.lockWeeklyPool(w);
              lockedWeeks.add(w);
              await checkInvariant(`LockWeek #${w}`);
            }
          }
        } else if (actionType === 5) {
          // Claim prizes for locked weeks if any
          for (const w of Array.from(lockedWeeks)) {
            const snap = await tapeFour.weeklySnapshot(w);
            const totalWins = await tapeFour.weeklyTotalWins(w);
            if (snap > 0n && totalWins > 0n) {
              for (const s of signers) {
                const sAddr = await s.getAddress();
                const sWins = await tapeFour.weeklyWins(w, sAddr);
                const claimed = await tapeFour.hasClaimed(w, sAddr);
                if (sWins > 0n && !claimed) {
                  const share = (snap * sWins) / totalWins;
                  await tapeFour.connect(s).claimPrize(w);
                  totalClaimed.set(w, (totalClaimed.get(w) || 0n) + share);
                  await checkInvariant(`ClaimPrize week ${w} by ${sAddr.slice(0,6)}`);
                }
              }
            }
          }
        }
      }
    });
  });

  describe("Fuzz-style: random move sequences", () => {
    it("plays 20 scripted games without reverting on valid moves", async () => {
      await deployFresh();
      let passed = 0;

      for (let g = 0; g < 20; g++) {
        await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
        const gameId = BigInt(g);
        let bA = 0n, bB = 0n, turn = 0;
        let done = false;

        for (let m = 0; m < 42 && !done; m++) {
          let col = -1;
          for (let c = 0; c < 7; c++) {
            if (((bA | bB) & (1n << BigInt(c + 7 * 5))) === 0n) { col = c; break; }
          }
          if (col === -1) break;

          const ref = applyMoveRef(bA, bB, col, turn);
          if (!ref.valid) break;

          await mockProc.setResponse(packOutputs(ref.valid, ref.boardA, ref.boardB, ref.win, ref.draw));
          if (turn === 0) await tapeFour.connect(sessionKey).playMove(gameId, col);
          else            await tapeFour.connect(operator).playBotMove(gameId, col);

          bA = ref.boardA; bB = ref.boardB;
          done = ref.win || ref.draw;
          turn = 1 - turn;
        }
        passed++;
      }
      expect(passed).to.equal(20);
    });
  });

  describe("Gas measurement", () => {
    it("measures gas for opening, mid-game, and winning moves", async () => {
      await deployFresh();

      // Opening move
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
      await mockProc.setResponse(packOutputs(true, 1n << 3n, 0n, false, false));
      let tx = await tapeFour.connect(sessionKey).playMove(0n, 3);
      let rc = await tx.wait();
      const gasOpening = rc.gasUsed;

      // Mid-game: 10 moves spread across columns to ensure no win
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
      let gId = 1n;
      let bA = 0n, bB = 0n;
      // Cols: H=0, B=1, H=2, B=3, H=4, B=5, H=6, B=0, H=1, B=2
      const setup = [[0,0],[1,1],[2,0],[3,1],[4,0],[5,1],[6,0],[0,1],[1,0],[2,1]];
      for (const [col, t] of setup) {
        const ref = applyMoveRef(bA, bB, col, t);
        await mockProc.setResponse(packOutputs(ref.valid, ref.boardA, ref.boardB, ref.win, ref.draw));
        if (t === 0) await tapeFour.connect(sessionKey).playMove(gId, col);
        else         await tapeFour.connect(operator).playBotMove(gId, col);
        bA = ref.boardA; bB = ref.boardB;
      }
      {
        const ref = applyMoveRef(bA, bB, 4, 0);
        await mockProc.setResponse(packOutputs(ref.valid, ref.boardA, ref.boardB, ref.win, ref.draw));
        tx = await tapeFour.connect(sessionKey).playMove(gId, 4);
        rc = await tx.wait();
      }
      const gasMid = rc.gasUsed;

      // Winning move
      await tapeFour.connect(human).startRanked(await sessionKey.getAddress(), { value: RANKED_FEE });
      gId = 2n;
      await mockProc.setResponse(packOutputs(true, 0xFn, 0n, true, false));
      tx = await tapeFour.connect(sessionKey).playMove(gId, 0);
      rc = await tx.wait();
      const gasWin = rc.gasUsed;

      console.log("\n  ┌─ Gas measurements (TapeFour contract overhead on local chain) ─");
      console.log(`  │ Opening move  : ${gasOpening.toString().padStart(9)} gas`);
      console.log(`  │ Mid-game move : ${gasMid.toString().padStart(9)} gas`);
      console.log(`  │ Winning move  : ${gasWin.toString().padStart(9)} gas`);
      console.log("  │");
      console.log("  │ Note: on X Layer with real TapeOut circuit, the eval()");
      console.log("  │ call adds ~2,750,000 gas (1,356 gates × ~2,000 gas/gate).");
      console.log("  └───────────────────────────────────────────────────────────────");

      expect(gasOpening > 50000n).to.be.true;
      expect(gasMid > 50000n).to.be.true;
    });
  });
});
