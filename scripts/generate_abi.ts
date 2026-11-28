// scripts/generate_abi.ts
// Generates web/abi.js directly from the compiled Hardhat artifact (TapeFour.json).
// Guarantees front-end function selectors and ABI can never drift from the contract.

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { toFunctionSelector, type AbiFunction } from 'viem';

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactPath = join(__dirname, '../contracts/artifacts/contracts/TapeFour.sol/TapeFour.json');
const outputPath = join(__dirname, '../web/abi.js');

const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
const abi = artifact.abi;

const functions: AbiFunction[] = abi.filter((x: any) => x.type === 'function');
const selectors: Record<string, string> = {};

for (const fn of functions) {
  const sel = toFunctionSelector(fn);
  selectors[fn.name] = sel;
}

const fileContent = `// web/abi.js
// AUTO-GENERATED from contracts/artifacts/contracts/TapeFour.sol/TapeFour.json.
// DO NOT EDIT MANUALLY. Run 'npm run build:abi' or 'npx tsx scripts/generate_abi.ts' to regenerate.

export const SELECTORS = Object.freeze({
  startRanked:     '${selectors.startRanked}',     // startRanked(address) -> 0x173bda98
  playMove:        '${selectors.playMove}',        // playMove(uint256,uint8) -> 0xcdc6317f
  playBotMove:     '${selectors.playBotMove}',     // playBotMove(uint256,uint8) -> 0x112c15b0
  claimBotTimeout: '${selectors.claimBotTimeout}', // claimBotTimeout(uint256) -> 0x6fde5f36
  claimForfeit:    '${selectors.claimForfeit}',    // claimForfeit(uint256) -> 0xd4c147e2
  lockWeeklyPool:  '${selectors.lockWeeklyPool}',  // lockWeeklyPool(uint64) -> 0x68484eea
  claimPrize:      '${selectors.claimPrize}',      // claimPrize(uint64) -> 0xe67194d2
  botOperator:     '${selectors.botOperator}',     // botOperator() -> 0xbd15b9c1
  rankedFee:       '${selectors.rankedFee}',       // rankedFee() -> 0x2bc2d0e8
  games:           '${selectors.games}',           // games(uint256) -> 0x117a5b90
  processor:       '${selectors.processor}',       // processor() -> 0xce1b1d43
  circuitId:       '${selectors.circuitId}',       // circuitId() -> 0x030c9d5c
  currentWeek:     '${selectors.currentWeek}',     // currentWeek() -> 0x06575c89
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
      const match = dataOrError.match(/execution reverted:\\s*([^"']+)/);
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

export const TAPEFOUR_ABI = Object.freeze(${JSON.stringify(abi, null, 2)});
`;

writeFileSync(outputPath, fileContent, 'utf8');
console.log(`[generate_abi] Successfully generated ${outputPath} from Hardhat artifact.`);
