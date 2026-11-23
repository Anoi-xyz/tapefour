// 100,000+ Random Legal Games Verification
import { buildConnectFourCircuit } from '../circuit/circuit.ts';
import { CircuitSimulator } from '../circuit/simulator.ts';
import { packInputs, unpackOutputs, applyMove, cellIndex } from '../engine/connect4.ts';

async function runGamesSimulation(numGames: number = 100000) {
  console.log(`=== Starting ${numGames.toLocaleString()} Random Legal Games Verification ===`);
  const startTime = Date.now();

  const circuit = buildConnectFourCircuit();
  console.log(`Circuit Gate Count: ${circuit.gateCount} NAND gates (Target: <= 1,500)`);
  const sim = new CircuitSimulator(88, circuit.builder.gates, circuit.outputWires);

  // Deterministic LCG
  let seed = 123456789;
  function randInt(max: number): number {
    seed = (seed * 1664525 + 1013904223) | 0;
    return (seed >>> 0) % max;
  }

  let totalMoves = 0;
  let aWins = 0;
  let bWins = 0;
  let draws = 0;

  for (let g = 1; g <= numGames; g++) {
    let boardA = 0n;
    let boardB = 0n;
    let turn = 0;
    let gameOver = false;

    while (!gameOver) {
      const legalCols: number[] = [];
      for (let c = 0; c < 7; c++) {
        const topCell = cellIndex(c, 5);
        const occ = ((boardA | boardB) & (1n << BigInt(topCell))) !== 0n;
        if (!occ) legalCols.push(c);
      }

      if (legalCols.length === 0) break;

      const col = legalCols[randInt(legalCols.length)];
      const refRes = applyMove(boardA, boardB, col, turn);

      const inBytes = packInputs(boardA, boardB, col, turn);
      const simRes = unpackOutputs(sim.evaluate(inBytes));

      if (
        simRes.valid !== refRes.valid ||
        simRes.newBoardA !== refRes.newBoardA ||
        simRes.newBoardB !== refRes.newBoardB ||
        simRes.win !== refRes.win ||
        simRes.draw !== refRes.draw
      ) {
        console.error(`\nMISMATCH at game ${g}, move ${totalMoves}!`);
        console.error('Inputs:', { boardA: boardA.toString(16), boardB: boardB.toString(16), col, turn });
        console.error('Ref Result:', refRes);
        console.error('Sim Result:', simRes);
        throw new Error('Circuit output did not equal reference engine!');
      }

      totalMoves++;
      boardA = simRes.newBoardA;
      boardB = simRes.newBoardB;

      if (simRes.win) {
        if (turn === 0) aWins++;
        else bWins++;
        gameOver = true;
      } else if (simRes.draw) {
        draws++;
        gameOver = true;
      } else {
        turn = 1 - turn;
      }
    }

    if (g % 20000 === 0 || g === numGames) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(
        `Completed ${g.toLocaleString()} games (${totalMoves.toLocaleString()} moves) in ${elapsed}s | A wins: ${aWins}, B wins: ${bWins}, Draws: ${draws}`
      );
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n=== SUCCESS: All ${numGames.toLocaleString()} games (${totalMoves.toLocaleString()} total moves) matched 100% ===`);
  console.log(`Total time: ${duration}s, Avg speed: ${Math.round(totalMoves / parseFloat(duration)).toLocaleString()} moves/sec\n`);
}

runGamesSimulation(100000);
