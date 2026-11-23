// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title TapeFour — Connect Four on TapeOut on-chain circuits (X Layer)
 *
 * Architecture:
 * - Pure combinational circuit taped out on TapeOut (circuit ID pinned at deploy).
 * - Every move (human and bot) is evaluated by calling `eval(circuitId, packedInputs)`
 *   on the TapeOut processor contract.
 * - Board is represented as two packed 42-bit integers in a single uint256 slot:
 *     bits  0-41: player A (human)
 *     bits 42-83: player B (bot)
 * - Session keys: human registers an ephemeral browser address at game start so
 *   the browser can sign moves with zero wallet pop-ups.
 * - Fee Escrow Model: each game's entry fee is held in escrow until the game ends.
 *   Fees are only split to the prize pool and treasury upon settlement (win or forfeit).
 * - Bot Timeout: if the bot fails to move within `botTimeout` on its turn, the human
 *   can claim a 100% fee refund and void the game.
 * - Per-Week Prize Pool: each ISO week has an isolated `weeklyPool[week]`.
 *   Fees and wins are credited to the week the game ENDS (_isoWeek() at settlement).
 *   At week boundary, anyone can lock the pool:
 *     - If there were wins, the pool is snapshotted and winners claim proportional shares.
 *     - If no wins, the pool rolls over into the current week (capped at MAX_POOL, excess to treasury).
 * - No admin withdrawal backdoors: prize pools and escrowed funds cannot be drained.
 */

interface IProcessor {
    function eval(uint256 circuitId, bytes calldata inputs) external view returns (bytes memory);
}

contract TapeFour {
    // -------------------------------------------------------------------------
    // Reentrancy guard (custom, minimal)
    // -------------------------------------------------------------------------
    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "reentrant");
        _locked = 2;
        _;
        _locked = 1;
    }

    // -------------------------------------------------------------------------
    // Immutable protocol parameters & Caps
    // -------------------------------------------------------------------------
    IProcessor public immutable processor;
    uint256    public immutable circuitId;

    /// @notice Ranked entry fee (wei). Default: 0.005 OKB.
    uint256    public immutable rankedFee;
    uint256    public constant  MIN_FEE        = 0.0001 ether;
    uint256    public constant  MAX_FEE        = 0.1 ether;

    /// @notice Maximum gas stipend forwarded to a session key at startRanked (0.05 OKB cap).
    uint256    public constant  MAX_STIPEND    = 0.05 ether;

    /// @notice Fee split: poolBps basis points go to the weekly prize pool,
    ///         the rest to the project treasury.  Default: 6000 (60% pool / 40% treasury).
    uint256    public immutable poolBps;
    uint256    public constant  MIN_POOL_BPS   = 1_000;  // min 10%
    uint256    public constant  MAX_POOL_BPS   = 9_000;  // max 90%
    address payable public immutable treasury;

    /// @notice Hard cap on accumulated prize pool per week to bound exposure.
    uint256    public constant  MAX_POOL       = 100 ether;

    /// @notice Seconds the human player has to make a move before forfeit.
    uint256    public immutable moveTimeout;
    uint256    public constant  MIN_MOVE_TIMEOUT = 5 minutes;
    uint256    public constant  MAX_MOVE_TIMEOUT = 7 days;

    /// @notice Seconds the bot has to respond before human can claim a refund.
    uint256    public immutable botTimeout;
    uint256    public constant  MIN_BOT_TIMEOUT  = 3 minutes;
    uint256    public constant  MAX_BOT_TIMEOUT  = 1 days;

    /// @notice Address allowed to submit bot moves.
    address    public immutable botOperator;

    // -------------------------------------------------------------------------
    // Board packing — two packed 42-bit values stored in a single uint256 slot.
    //   bits  0-41  : player A stones
    //   bits 42-83  : player B stones
    // -------------------------------------------------------------------------
    uint256 internal constant BOARD_MASK = (1 << 42) - 1;

    // -------------------------------------------------------------------------
    // Game state
    // -------------------------------------------------------------------------

    enum GameStatus { Active, HumanWon, BotWon, Draw, HumanForfeit, Voided }

    struct Game {
        address   human;         // the paying player (player A)
        address   sessionKey;    // browser-generated signer for human moves
        uint256   board;         // packed as described above
        uint8     turn;          // 0 = human (A), 1 = bot (B)
        GameStatus status;
        uint64    lastMoveAt;    // unix timestamp of last move
        uint64    fee;           // wei escrowed (refunded on void/draw, split on win/forfeit)
    }

    uint256 public gameCount;
    mapping(uint256 => Game) public games;

    // -------------------------------------------------------------------------
    // Leaderboard — wins per player per ISO week
    // -------------------------------------------------------------------------
    mapping(uint64 => mapping(address => uint256)) public weeklyWins;
    mapping(uint64 => address[]) public weeklyPlayers;
    mapping(uint64 => mapping(address => bool)) private _weeklyPlayerAdded;

    // -------------------------------------------------------------------------
    // Per-Week Prize pool & Lock state
    // -------------------------------------------------------------------------
    mapping(uint64 => uint256) public weeklyPool;
    mapping(uint64 => uint256) public weeklySnapshot;
    mapping(uint64 => bool)    public weekLocked;
    mapping(uint64 => uint256) public weeklyTotalWins;
    mapping(uint64 => mapping(address => bool)) public hasClaimed;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event GameStarted(uint256 indexed gameId, address indexed human, address sessionKey, uint64 week);
    event SessionKeyStipendForwarded(uint256 indexed gameId, address indexed sessionKey, uint256 stipend);
    event MovePlayed(uint256 indexed gameId, uint8 col, uint8 turn, uint256 newBoard);
    event GameEnded(uint256 indexed gameId, GameStatus status, address winner);
    event GameVoided(uint256 indexed gameId, address indexed human, uint256 refundAmount);
    event WeeklyPoolLocked(uint64 indexed week, uint256 amount, uint256 totalWins);
    event WeeklyPoolRolledOver(uint64 indexed fromWeek, uint64 indexed toWeek, uint256 amount);
    event PrizeClaimed(uint64 indexed week, address indexed player, uint256 amount);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(
        address _processor,
        uint256 _circuitId,
        uint256 _rankedFee,    // default 0.005 ether
        uint256 _poolBps,      // default 6000 (60% to pool)
        address _treasury,
        uint256 _moveTimeout,  // e.g. 86400 (24h)
        uint256 _botTimeout,   // default 600 (10m)
        address _botOperator
    ) {
        require(_processor   != address(0), "zero processor");
        require(_treasury    != address(0), "zero treasury");
        require(_botOperator != address(0), "zero operator");

        require(_rankedFee >= MIN_FEE && _rankedFee <= MAX_FEE, "invalid fee");
        require(_poolBps >= MIN_POOL_BPS && _poolBps <= MAX_POOL_BPS, "invalid pool bps");
        require(_moveTimeout >= MIN_MOVE_TIMEOUT && _moveTimeout <= MAX_MOVE_TIMEOUT, "invalid move timeout");
        require(_botTimeout >= MIN_BOT_TIMEOUT && _botTimeout <= MAX_BOT_TIMEOUT, "invalid bot timeout");

        processor    = IProcessor(_processor);
        circuitId    = _circuitId;
        rankedFee    = _rankedFee;
        poolBps      = _poolBps;
        treasury     = payable(_treasury);
        moveTimeout  = _moveTimeout;
        botTimeout   = _botTimeout;
        botOperator  = _botOperator;
    }

    // -------------------------------------------------------------------------
    // Public entry points
    // -------------------------------------------------------------------------

    /**
     * @notice Start a ranked game. Caller pays the ranked fee and registers a
     *         session key address so the browser can sign moves without a
     *         wallet pop-up on every move.
     *         The ranked fee is held in escrow until game settlement.
     *         Any excess over `rankedFee` (up to MAX_STIPEND) is forwarded directly
     *         to the session key address as an initial gas stipend.
     * @param sessionKey Ephemeral address generated in the browser.
     */
    function startRanked(address sessionKey) external payable nonReentrant returns (uint256 gameId) {
        require(msg.value >= rankedFee, "fee too low");
        uint256 stipend = msg.value - rankedFee;
        require(stipend <= MAX_STIPEND, "stipend exceeds cap");
        require(sessionKey != address(0), "zero session key");

        gameId = gameCount++;

        // Ranked fee is escrowed in the contract (not split yet)
        games[gameId] = Game({
            human:      msg.sender,
            sessionKey: sessionKey,
            board:      0,
            turn:       0,
            status:     GameStatus.Active,
            lastMoveAt: uint64(block.timestamp),
            fee:        uint64(rankedFee)
        });

        // Forward gas stipend to session key address if supplied
        if (stipend > 0) {
            (bool sOk,) = sessionKey.call{value: stipend}("");
            require(sOk, "stipend forwarding failed");
            emit SessionKeyStipendForwarded(gameId, sessionKey, stipend);
        }

        emit GameStarted(gameId, msg.sender, sessionKey, _isoWeek());
    }

    /**
     * @notice Human plays a move. Must be called by the session key address
     *         (or by the human's wallet directly).
     */
    function playMove(uint256 gameId, uint8 col) external nonReentrant {
        Game storage g = games[gameId];
        require(g.status == GameStatus.Active, "not active");
        require(g.turn == 0, "not human turn");
        require(
            msg.sender == g.sessionKey || msg.sender == g.human,
            "not authorised"
        );

        _executeMove(gameId, g, col);
    }

    /**
     * @notice Bot operator submits the bot move.
     */
    function playBotMove(uint256 gameId, uint8 col) external nonReentrant {
        require(msg.sender == botOperator, "not bot operator");
        Game storage g = games[gameId];
        require(g.status == GameStatus.Active, "not active");
        require(g.turn == 1, "not bot turn");

        _executeMove(gameId, g, col);
    }

    /**
     * @notice Human claims a full refund if the bot operator fails to move within botTimeout
     *         on its turn. Voids the game and returns 100% of the escrowed ranked fee.
     */
    function claimBotTimeout(uint256 gameId) external nonReentrant {
        Game storage g = games[gameId];
        require(g.status == GameStatus.Active, "not active");
        require(g.turn == 1, "not bot turn");
        require(block.timestamp >= g.lastMoveAt + botTimeout, "bot timeout not reached");
        require(
            msg.sender == g.human || msg.sender == g.sessionKey,
            "not authorised"
        );

        g.status = GameStatus.Voided;
        uint256 refundAmount = g.fee;
        g.fee = 0;

        emit GameEnded(gameId, GameStatus.Voided, address(0));
        emit GameVoided(gameId, g.human, refundAmount);

        if (refundAmount > 0) {
            (bool ok,) = g.human.call{value: refundAmount}("");
            require(ok, "refund transfer failed");
        }
    }

    /**
     * @notice Claim forfeit if human has not moved within moveTimeout.
     *         Anyone can call this (e.g. the operator).
     *         Settles the fee to pool and treasury.
     */
    function claimForfeit(uint256 gameId) external nonReentrant {
        Game storage g = games[gameId];
        require(g.status == GameStatus.Active, "not active");
        require(g.turn == 0, "not human turn");
        require(block.timestamp >= g.lastMoveAt + moveTimeout, "timeout not reached");

        g.status = GameStatus.HumanForfeit;
        _settleFee(g);
        emit GameEnded(gameId, GameStatus.HumanForfeit, address(0));
    }

    // -------------------------------------------------------------------------
    // Weekly prize pool
    // -------------------------------------------------------------------------

    /**
     * @notice Lock the weekly prize pool for a past week.
     *         If there are winners, snapshots weeklyPool[week] so winners can claim.
     *         If there are no winners, rolls weeklyPool[week] into the current week's pool.
     * @param week ISO week number to lock (must be < _isoWeek()).
     */
    function lockWeeklyPool(uint64 week) external nonReentrant {
        require(week < _isoWeek(), "cannot lock current week");
        require(!weekLocked[week], "already locked");

        weekLocked[week] = true;

        uint256 total = weeklyTotalWins[week];
        if (total > 0) {
            uint256 snapshot = weeklyPool[week];
            weeklySnapshot[week] = snapshot;
            weeklyPool[week] = 0;
            emit WeeklyPoolLocked(week, snapshot, total);
        } else {
            uint256 rollAmount = weeklyPool[week];
            weeklyPool[week] = 0;
            uint64 currentW = _isoWeek();
            if (rollAmount > 0) {
                uint256 currentPool = weeklyPool[currentW];
                uint256 toRoll = rollAmount;
                uint256 toTreasury = 0;
                if (currentPool + toRoll > MAX_POOL) {
                    toRoll = MAX_POOL > currentPool ? MAX_POOL - currentPool : 0;
                    toTreasury = rollAmount - toRoll;
                }
                weeklyPool[currentW] = currentPool + toRoll;
                if (toTreasury > 0) {
                    (bool ok,) = treasury.call{value: toTreasury}("");
                    require(ok, "treasury transfer failed");
                }
                emit WeeklyPoolRolledOver(week, currentW, toRoll);
            }
            emit WeeklyPoolLocked(week, 0, 0);
        }
    }

    /**
     * @notice Winner claims their proportional share of the locked week's pool snapshot.
     * @param week ISO week number to claim for.
     */
    function claimPrize(uint64 week) external nonReentrant {
        require(weekLocked[week], "week not locked");
        uint256 snapshot = weeklySnapshot[week];
        require(snapshot > 0, "no prize pool for week");
        require(!hasClaimed[week][msg.sender], "already claimed");

        uint256 myWins = weeklyWins[week][msg.sender];
        require(myWins > 0, "no wins that week");

        uint256 total = weeklyTotalWins[week];
        require(total > 0, "no total wins");

        hasClaimed[week][msg.sender] = true;

        uint256 share = (snapshot * myWins) / total;
        require(share > 0, "share rounds to zero");

        (bool ok,) = msg.sender.call{value: share}("");
        require(ok, "transfer failed");

        emit PrizeClaimed(week, msg.sender, share);
    }

    // -------------------------------------------------------------------------
    // View helpers
    // -------------------------------------------------------------------------

    function getBoard(uint256 gameId) external view returns (uint256 boardA, uint256 boardB) {
        uint256 packed = games[gameId].board;
        boardA = packed & BOARD_MASK;
        boardB = (packed >> 42) & BOARD_MASK;
    }

    function currentWeek() external view returns (uint64) {
        return _isoWeek();
    }

    function weeklyPoolSnapshot(uint64 week) external view returns (uint256) {
        return weeklySnapshot[week];
    }

    function prizePool() external view returns (uint256) {
        return weeklyPool[_isoWeek()];
    }

    function getLeaderboard(uint64 week) external view returns (address[] memory players, uint256[] memory wins) {
        players = weeklyPlayers[week];
        wins    = new uint256[](players.length);
        for (uint i = 0; i < players.length; i++) {
            wins[i] = weeklyWins[week][players[i]];
        }
    }

    // -------------------------------------------------------------------------
    // Internal logic
    // -------------------------------------------------------------------------

    function _executeMove(uint256 gameId, Game storage g, uint8 col) internal {
        require(col < 7, "col out of range");

        (bool valid, uint256 newBoard, bool win, bool draw) = _evalMove(g.board, col, g.turn);
        require(valid, "move invalid per circuit");

        g.board = newBoard;
        g.lastMoveAt = uint64(block.timestamp);

        emit MovePlayed(gameId, col, g.turn, newBoard);

        if (win) {
            uint64 endWeek = _isoWeek();
            if (g.turn == 0) {
                g.status = GameStatus.HumanWon;
                _recordWin(endWeek, g.human);
                _settleFee(g);
                emit GameEnded(gameId, GameStatus.HumanWon, g.human);
            } else {
                g.status = GameStatus.BotWon;
                _settleFee(g);
                emit GameEnded(gameId, GameStatus.BotWon, address(0));
            }
        } else if (draw) {
            g.status = GameStatus.Draw;
            uint256 refundAmount = g.fee;
            g.fee = 0;
            emit GameEnded(gameId, GameStatus.Draw, address(0));
            if (refundAmount > 0) {
                (bool ok,) = g.human.call{value: refundAmount}("");
                require(ok, "draw refund failed");
            }
        } else {
            g.turn = g.turn == 0 ? 1 : 0;
        }
    }

    /**
     * @notice Settle escrowed fee upon game conclusion: splits into weekly prize pool and treasury.
     *         Credits weeklyPool[_isoWeek()] (the week the game concludes).
     */
    function _settleFee(Game storage g) internal {
        uint256 fee = g.fee;
        if (fee == 0) return;
        g.fee = 0; // State updated before external transfers

        uint64 endWeek = _isoWeek();
        require(!weekLocked[endWeek], "week locked");

        uint256 toPool = (fee * poolBps) / 10_000;
        uint256 toTreasury = fee - toPool;

        uint256 currentPool = weeklyPool[endWeek];
        if (currentPool + toPool > MAX_POOL) {
            toPool     = MAX_POOL > currentPool ? MAX_POOL - currentPool : 0;
            toTreasury = fee - toPool;
        }
        weeklyPool[endWeek] = currentPool + toPool;

        if (toTreasury > 0) {
            (bool ok,) = treasury.call{value: toTreasury}("");
            require(ok, "treasury transfer failed");
        }
    }

    function _evalMove(uint256 currentBoard, uint8 col, uint8 turn)
        internal view returns (bool valid, uint256 newBoard, bool win, bool draw)
    {
        bytes memory inp = _packInputs(currentBoard & BOARD_MASK, (currentBoard >> 42) & BOARD_MASK, col, turn);

        (bool ok, bytes memory ret) = address(processor).staticcall{gas: 10_000_000}(
            abi.encodeWithSignature("eval(uint256,bytes)", circuitId, inp)
        );
        require(ok && ret.length > 0, "eval call failed");

        bytes memory outBytes = abi.decode(ret, (bytes));
        require(outBytes.length >= 11, "short output");

        uint256 outVal = _bytesToUint(outBytes);
        valid = (outVal & 1) == 1;
        uint256 newA = (outVal >> 1) & BOARD_MASK;
        uint256 newB = (outVal >> 43) & BOARD_MASK;
        newBoard = newA | (newB << 42);
        win = ((outVal >> 85) & 1) == 1;
        draw = ((outVal >> 86) & 1) == 1;
    }

    function _recordWin(uint64 week, address player) internal {
        require(!weekLocked[week], "week locked");
        weeklyWins[week][player]++;
        weeklyTotalWins[week]++;
        _trackPlayer(week, player);
    }

    function _trackPlayer(uint64 week, address player) internal {
        if (!_weeklyPlayerAdded[week][player]) {
            _weeklyPlayerAdded[week][player] = true;
            weeklyPlayers[week].push(player);
        }
    }

    // Build 11-byte input per SPEC §5 (LSB first)
    function _packInputs(
        uint256 boardA,
        uint256 boardB,
        uint8   col,
        uint8   turn
    ) internal pure returns (bytes memory) {
        // 88 bits → 11 bytes
        uint256 val = (boardA & BOARD_MASK)
                    | ((boardB & BOARD_MASK) << 42)
                    | (uint256(col  & 0x7) << 84)
                    | (uint256(turn & 0x1) << 87);

        bytes memory b = new bytes(11);
        for (uint i = 0; i < 11; i++) {
            b[i] = bytes1(uint8(val >> (i * 8)));
        }
        return b;
    }

    function _bytesToUint(bytes memory b) internal pure returns (uint256 val) {
        uint256 len = b.length < 11 ? b.length : 11;
        for (uint i = 0; i < len; i++) {
            val |= uint256(uint8(b[i])) << (i * 8);
        }
    }

    // ISO week number (approximate: epoch week counting from 1970-01-05 Mon)
    function _isoWeek() internal view returns (uint64) {
        return uint64((block.timestamp + 4 days) / 7 days);
    }
}
