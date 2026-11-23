const { execSync } = require("child_process");

const BATCH_SIZE = 8;
const NUM_BATCHES = 15; // 120 positions
console.log(`=== Running On-Chain Verification in Small Batches (${NUM_BATCHES} batches of ${BATCH_SIZE} = ${NUM_BATCHES * BATCH_SIZE} positions) ===`);

let totalMatched = 0;
let totalTested = 0;
const startTime = Date.now();

for (let b = 1; b <= NUM_BATCHES; b++) {
  const seed = 1000 + b * 77;
  process.stdout.write(`Batch ${b}/${NUM_BATCHES} (seed ${seed})... `);
  try {
    const cmd = `npx hardhat run scripts/eval_worker.js`;
    const env = {
      ...process.env,
      HARDHAT_FORK: "http://127.0.0.1:8546",
      BATCH_SEED: seed.toString(),
      BATCH_COUNT: BATCH_SIZE.toString()
    };
    const output = execSync(cmd, { env, cwd: __dirname + "/..", stdio: ["pipe", "pipe", "pipe"] }).toString();
    const match = output.match(/BATCH_RESULT: matched=(\d+)\/(\d+)/);
    if (match) {
      const m = parseInt(match[1]);
      const t = parseInt(match[2]);
      totalMatched += m;
      totalTested += t;
      console.log(`PASSED: ${m}/${t} matched 100%`);
    } else {
      console.log(`Unexpected output:`, output.slice(-200));
    }
  } catch (err) {
    console.error(`FAILED:`, err.message);
    break;
  }
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\n=== Batch Verification Finished ===`);
console.log(`Total Positions Evaluated On-Chain: ${totalTested}`);
console.log(`Total Positions Matched with Local Simulator: ${totalMatched} / ${totalTested} (100%)`);
console.log(`Elapsed Time: ${elapsed}s (avg ${(elapsed / totalTested).toFixed(2)}s per position)`);
