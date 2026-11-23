// scripts/find_create_cpu_tx.js
const rpcUrl = 'https://rpc.xlayer.tech';
const FACTORY = '0x1f09daefa827f02cbb40967cc91b259763760761';

async function main() {
  const blkRes = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] })
  });
  const blockNumber = parseInt((await blkRes.json()).result, 16);
  console.log("Current block:", blockNumber);

  // query logs from blockNumber - 100000
  const logsRes = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_getLogs',
      params: [{
        address: FACTORY,
        fromBlock: "0x" + (blockNumber - 50000).toString(16),
        toBlock: "latest"
      }]
    })
  });
  const logs = (await logsRes.json()).result;
  console.log("Logs count:", logs ? logs.length : 0);
  if (logs && logs.length > 0) {
    const lastLog = logs[logs.length - 1];
    console.log("Last CPU creation log txHash:", lastLog.transactionHash);

    // fetch tx
    const txRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionByHash', params: [lastLog.transactionHash] })
    });
    const tx = (await txRes.json()).result;
    console.log("Tx to:", tx.to);
    console.log("Tx value:", BigInt(tx.value));
    console.log("Tx input selector:", tx.input.slice(0, 10));
    console.log("Tx input full:", tx.input);
  }
}

main().catch(console.error);
