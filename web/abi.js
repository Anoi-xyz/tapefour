// web/abi.js
// AUTO-GENERATED from contracts/artifacts/contracts/TapeFour.sol/TapeFour.json.
// DO NOT EDIT MANUALLY. Run 'npm run build:abi' or 'npx tsx scripts/generate_abi.ts' to regenerate.

export const SELECTORS = Object.freeze({
  startRanked:     '0x173bda98',     // startRanked(address) -> 0x173bda98
  playMove:        '0xcdc6317f',        // playMove(uint256,uint8) -> 0xcdc6317f
  playBotMove:     '0x112c15b0',     // playBotMove(uint256,uint8) -> 0x112c15b0
  claimBotTimeout: '0x6fde5f36', // claimBotTimeout(uint256) -> 0x6fde5f36
  claimForfeit:    '0xd4c147e2',    // claimForfeit(uint256) -> 0xd4c147e2
  lockWeeklyPool:  '0x68484eea',  // lockWeeklyPool(uint64) -> 0x68484eea
  claimPrize:      '0xe67194d2',      // claimPrize(uint64) -> 0xe67194d2
  botOperator:     '0xbd15b9c1',     // botOperator() -> 0xbd15b9c1
  rankedFee:       '0x2bc2d0e8',       // rankedFee() -> 0x2bc2d0e8
  games:           '0x117a5b90',           // games(uint256) -> 0x117a5b90
  processor:       '0xce1b1d43',       // processor() -> 0xce1b1d43
  circuitId:       '0x030c9d5c',       // circuitId() -> 0x030c9d5c
  currentWeek:     '0x06575c89',     // currentWeek() -> 0x06575c89
});

export function encodeUint256(n) {
  return BigInt(n).toString(16).padStart(64, '0');
}

export function encodeAddress(addr) {
  const clean = (addr || '').toLowerCase().replace(/^0x/, '');
  return clean.padStart(64, '0');
}

export function encodeStartRanked(sessionKey) {
  return SELECTORS.startRanked + encodeAddress(sessionKey);
}

export function encodePlayMove(gameId, col) {
  return SELECTORS.playMove + encodeUint256(gameId) + encodeUint256(col);
}

export function encodePlayBotMove(gameId, col) {
  return SELECTORS.playBotMove + encodeUint256(gameId) + encodeUint256(col);
}

export function encodeClaimBotTimeout(gameId) {
  return SELECTORS.claimBotTimeout + encodeUint256(gameId);
}

export function encodeClaimForfeit(gameId) {
  return SELECTORS.claimForfeit + encodeUint256(gameId);
}

export function encodeLockWeeklyPool(week) {
  return SELECTORS.lockWeeklyPool + encodeUint256(week);
}

export function encodeClaimPrize(week) {
  return SELECTORS.claimPrize + encodeUint256(week);
}

export function encodeGames(gameId) {
  return SELECTORS.games + encodeUint256(gameId);
}

export function decodeRevertReason(dataOrError) {
  if (!dataOrError) return 'Transaction reverted without reason';
  if (typeof dataOrError === 'string') {
    // If it is already a human-readable error message
    if (dataOrError.includes('execution reverted:')) {
      const match = dataOrError.match(/execution reverted:\s*([^"']+)/);
      if (match) return match[1].trim();
    }
    // If it's a hex error string starting with 0x08c379a0 (Error(string))
    if (dataOrError.startsWith('0x08c379a0') && dataOrError.length >= 138) {
      try {
        const lenHex = dataOrError.slice(74, 138);
        const len = parseInt(lenHex, 16);
        const strHex = dataOrError.slice(138, 138 + len * 2);
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = parseInt(strHex.slice(i * 2, i * 2 + 2), 16);
        }
        return new TextDecoder().decode(bytes);
      } catch {}
    }
    // Panic(uint256) 0x4e487b71
    if (dataOrError.startsWith('0x4e487b71')) {
      return 'Assertion failed or arithmetic overflow (Panic)';
    }
    return dataOrError;
  }
  if (dataOrError.data) {
    return decodeRevertReason(dataOrError.data);
  }
  if (dataOrError.message) {
    return decodeRevertReason(dataOrError.message);
  }
  return String(dataOrError);
}

export const TAPEFOUR_ABI = Object.freeze([
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_processor",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "_circuitId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_rankedFee",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_poolBps",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "_treasury",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "_moveTimeout",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_botTimeout",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "_botOperator",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "gameId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "enum TapeFour.GameStatus",
        "name": "status",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "winner",
        "type": "address"
      }
    ],
    "name": "GameEnded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "gameId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "human",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "sessionKey",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "week",
        "type": "uint64"
      }
    ],
    "name": "GameStarted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "gameId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "human",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "refundAmount",
        "type": "uint256"
      }
    ],
    "name": "GameVoided",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "gameId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "col",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "turn",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "newBoard",
        "type": "uint256"
      }
    ],
    "name": "MovePlayed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint64",
        "name": "week",
        "type": "uint64"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "player",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "PrizeClaimed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "gameId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sessionKey",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "stipend",
        "type": "uint256"
      }
    ],
    "name": "SessionKeyStipendForwarded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint64",
        "name": "week",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "totalWins",
        "type": "uint256"
      }
    ],
    "name": "WeeklyPoolLocked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint64",
        "name": "fromWeek",
        "type": "uint64"
      },
      {
        "indexed": true,
        "internalType": "uint64",
        "name": "toWeek",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "WeeklyPoolRolledOver",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "MAX_BOT_TIMEOUT",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_FEE",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_MOVE_TIMEOUT",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_POOL",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_POOL_BPS",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_STIPEND",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MIN_BOT_TIMEOUT",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MIN_FEE",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MIN_MOVE_TIMEOUT",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MIN_POOL_BPS",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "botOperator",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "botTimeout",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "circuitId",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "gameId",
        "type": "uint256"
      }
    ],
    "name": "claimBotTimeout",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "gameId",
        "type": "uint256"
      }
    ],
    "name": "claimForfeit",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "week",
        "type": "uint64"
      }
    ],
    "name": "claimPrize",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "currentWeek",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "gameCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "games",
    "outputs": [
      {
        "internalType": "address",
        "name": "human",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "sessionKey",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "board",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "turn",
        "type": "uint8"
      },
      {
        "internalType": "enum TapeFour.GameStatus",
        "name": "status",
        "type": "uint8"
      },
      {
        "internalType": "uint64",
        "name": "lastMoveAt",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "fee",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "gameId",
        "type": "uint256"
      }
    ],
    "name": "getBoard",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "boardA",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "boardB",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "week",
        "type": "uint64"
      }
    ],
    "name": "getLeaderboard",
    "outputs": [
      {
        "internalType": "address[]",
        "name": "players",
        "type": "address[]"
      },
      {
        "internalType": "uint256[]",
        "name": "wins",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      },
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "hasClaimed",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "week",
        "type": "uint64"
      }
    ],
    "name": "lockWeeklyPool",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "moveTimeout",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "gameId",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "col",
        "type": "uint8"
      }
    ],
    "name": "playBotMove",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "gameId",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "col",
        "type": "uint8"
      }
    ],
    "name": "playMove",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "poolBps",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "prizePool",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "processor",
    "outputs": [
      {
        "internalType": "contract IProcessor",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "rankedFee",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sessionKey",
        "type": "address"
      }
    ],
    "name": "startRanked",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "gameId",
        "type": "uint256"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "treasury",
    "outputs": [
      {
        "internalType": "address payable",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "name": "weekLocked",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      },
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "weeklyPlayers",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "name": "weeklyPool",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "week",
        "type": "uint64"
      }
    ],
    "name": "weeklyPoolSnapshot",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "name": "weeklySnapshot",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "name": "weeklyTotalWins",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      },
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "weeklyWins",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
]);
