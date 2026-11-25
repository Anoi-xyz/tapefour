// bot/operator.ts
// TapeFour Bot Operator Service
// Watches for MovePlayed events (human turn) on the TapeFour ranked contract,
// computes the bot move with minimax, and submits playBotMove.
//
// Key read from BOT_OPERATOR_KEY in .env — NEVER committed.
// This key is a throwaway key; it cannot withdraw player funds (the contract
// has no such function).
//
// Trust assumption (documented in PHASE3-RESULTS.md):
//   The operator chooses which column to play.  The on-chain circuit still
//   verifies legality, so the operator cannot cheat on rules, only on bot
//   strength.
//
// Usage:
//   npx tsx bot/operator.ts [--dry-run]
//   BOT_DIFFICULTY=hard npx tsx bot/operator.ts [--dry-run]

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { selectBotMove, type Difficulty } from './minimax.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DRY_RUN = process.argv.includes('--dry-run');

// ---- Config ----------------------------------------------------------------
function loadDotEnv(filepath: string): Record<string, string> {
  if (!existsSync(filepath)) return {};
  return Object.fromEntries(
    readFileSync(filepath, 'utf8').split('\n')
      .flatMap(line => {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
        return m ? [[m[1], m[2].trim().replace(/^["']|["']$/g, '')]] : [];
      })
  );
}
const env = loadDotEnv(join(__dirname, '../.env'));

const RPC_URL         = process.env.XLAYER_RPC_URL   ?? env.XLAYER_RPC_URL   ?? 'https://rpc.xlayer.tech';
const OPERATOR_KEY    = process.env.BOT_OPERATOR_KEY ?? env.BOT_OPERATOR_KEY;
let CONTRACT_ADDR     = process.env.TAPEFOUR_ADDRESS ?? env.TAPEFOUR_ADDRESS;

if (!CONTRACT_ADDR && existsSync(join(__dirname, '../deployments.json'))) {
  try {
    const d = JSON.parse(readFileSync(join(__dirname, '../deployments.json'), 'utf8'));
    if (d.tapeFour) CONTRACT_ADDR = d.tapeFour;
  } catch {}
}

const DIFFICULTY      = (process.env.BOT_DIFFICULTY  ?? env.BOT_DIFFICULTY  ?? 'medium') as Difficulty;

// Rate limiting: max 1 bot move per N ms to avoid spamming the RPC
const MIN_MOVE_INTERVAL_MS = 500;

if (!OPERATOR_KEY) {
  console.error('[operator] ERROR: BOT_OPERATOR_KEY not set in .env');
  process.exit(1);
}
if (!CONTRACT_ADDR) {
  console.error('[operator] ERROR: TAPEFOUR_ADDRESS not set in .env');
  process.exit(1);
}

// ---- Chain setup -----------------------------------------------------------
const formattedKey = (OPERATOR_KEY.startsWith('0x') ? OPERATOR_KEY : `0x${OPERATOR_KEY}`) as `0x${string}`;
const account = privateKeyToAccount(formattedKey);
const chain = {
  id: 196,
  name: 'X Layer',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};
const pub = createPublicClient({ chain: chain as any, transport: http(RPC_URL) });
const wal = createWalletClient({ account, chain: chain as any, transport: http(RPC_URL) });

// ---- ABI -------------------------------------------------------------------
const ABI = parseAbi([
  'event MovePlayed(uint256 indexed gameId, uint8 col, uint8 turn, uint256 newBoard)',
  'event GameEnded(uint256 indexed gameId, uint8 status, address winner)',
  'function games(uint256) view returns (address human, address sessionKey, uint256 board, uint8 turn, uint8 status, uint64 lastMoveAt, uint64 fee)',
  'function playBotMove(uint256 gameId, uint8 col) nonpayable',
  'function botOperator() view returns (address)',
]);

const BOARD_MASK = (1n << 42n) - 1n;

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [operator] ${msg}`);
}

// ---- Active game tracking --------------------------------------------------
// Map gameId → processing flag (prevent double-submission)
const inFlight = new Set<bigint>();
let lastMoveAt = 0;

// ---- Process a bot move for a game -----------------------------------------
async function processBotMove(gameId: bigint): Promise<void> {
  if (inFlight.has(gameId)) {
    log(`Game ${gameId}: already in flight, skipping`);
    return;
  }
  inFlight.add(gameId);

  // Rate limiting
  const now = Date.now();
  const wait = MIN_MOVE_INTERVAL_MS - (now - lastMoveAt);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastMoveAt = Date.now();

  try {
    // Read game state from chain
    const g = await pub.readContract({
      address: CONTRACT_ADDR as `0x${string}`,
      abi: ABI,
      functionName: 'games',
      args: [gameId],
    }) as readonly [string, string, bigint, number, number, bigint, bigint, bigint];

    const [, , board, turn, status] = g;

    if (status !== 0) {
      log(`Game ${gameId}: status=${status} (not active), skipping`);
      return;
    }
    if (turn !== 1) {
      log(`Game ${gameId}: turn=${turn} (not bot turn), skipping`);
      return;
    }

    const boardA = board & BOARD_MASK;
    const boardB = (board >> 42n) & BOARD_MASK;

    log(`Game ${gameId}: computing bot move (difficulty=${DIFFICULTY})`);
    const col = selectBotMove(boardA, boardB, 1 /* bot is player B */, DIFFICULTY);
    log(`Game ${gameId}: bot chose col=${col}`);

    if (DRY_RUN) {
      log(`[DRY RUN] Game ${gameId}: would call playBotMove(gameId=${gameId}, col=${col}). Skipping transaction.`);
      return;
    }

    // Submit the move
    const hash = await wal.writeContract({
      address: CONTRACT_ADDR as `0x${string}`,
      abi: ABI,
      functionName: 'playBotMove',
      args: [gameId, col],
    });

    log(`Game ${gameId}: playBotMove tx=${hash}`);
    const rc = await pub.waitForTransactionReceipt({ hash });

    if (rc.status === 'success') {
      log(`Game ${gameId}: bot move confirmed (gas=${rc.gasUsed})`);
    } else {
      log(`Game ${gameId}: bot move tx FAILED`);
    }
  } catch (err) {
    log(`Game ${gameId}: ERROR: ${err}`);
  } finally {
    inFlight.delete(gameId);
  }
}

// ---- Event watcher ---------------------------------------------------------
async function watchEvents(): Promise<void> {
  log(`Starting operator service [mode: ${DRY_RUN ? 'DRY-RUN (read-only, no txs)' : 'LIVE'}]`);
  log(`Operator address from key: ${account.address}`);
  log(`Contract address: ${CONTRACT_ADDR}`);
  log(`RPC URL: ${RPC_URL.replace(/:\/\/.*@/, '://')}`); // sanitize if any basic auth
  log(`Difficulty: ${DIFFICULTY}`);

  // Startup verification: check code and botOperator() on-chain
  const code = await pub.getCode({ address: CONTRACT_ADDR as `0x${string}` });
  if (!code || code === '0x') {
    log(`FATAL: No contract deployed at ${CONTRACT_ADDR}`);
    process.exit(1);
  }

  const onChainOperator = await pub.readContract({
    address: CONTRACT_ADDR as `0x${string}`,
    abi: ABI,
    functionName: 'botOperator',
  }) as string;

  log(`Contract botOperator: ${onChainOperator}`);

  if (account.address.toLowerCase() !== onChainOperator.toLowerCase()) {
    log(`FATAL: Operator key address (${account.address}) does NOT match contract botOperator (${onChainOperator}). Refusing to run.`);
    process.exit(1);
  }

  log(`Authorization verified: local key address matches contract botOperator.`);
  log('Watching for MovePlayed events...');

  // Poll for new events every 3 seconds (X Layer block time ~1-2s)
  let lastBlock = await pub.getBlockNumber();

  while (true) {
    try {
      const currentBlock = await pub.getBlockNumber();
      if (currentBlock <= lastBlock) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      const logs = await pub.getLogs({
        address: CONTRACT_ADDR as `0x${string}`,
        event: ABI[0] as any, // MovePlayed
        fromBlock: lastBlock + 1n,
        toBlock: currentBlock,
      });

      for (const event of logs) {
        const args = event.args as { gameId?: bigint; col?: number; turn?: number };
        const { gameId, turn } = args;
        if (gameId === undefined || turn === undefined) continue;

        log(`MovePlayed: gameId=${gameId}, col=${args.col}, turn=${turn}`);

        // A human just played (turn=0 → now it's bot's turn)
        if (turn === 0) {
          // Fire async, don't await — allow other events to process
          processBotMove(gameId).catch(err => {
            log(`processBotMove error: ${err}`);
          });
        }
      }

      lastBlock = currentBlock;
    } catch (err) {
      log(`Poll error: ${err}`);
    }

    await new Promise(r => setTimeout(r, 3000));
  }
}

watchEvents().catch(err => {
  log(`Fatal: ${err}`);
  process.exit(1);
});
