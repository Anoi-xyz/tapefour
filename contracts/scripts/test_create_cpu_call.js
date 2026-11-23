// contracts/scripts/test_create_cpu_call.js
const rpcUrl = 'https://rpc.xlayer.tech';
const FACTORY = '0x1f09daefa827f02cbb40967cc91b259763760761';
const { Interface } = require('ethers');

const iface = new Interface([
  'function createCPU(string name, string symbol, string uri, uint256 supplyCap, uint256 mintPrice) payable returns (address)',
  'function deployFee() view returns (uint256)',
  'function protocolFee() view returns (uint256)'
]);

async function main() {
  const data = iface.encodeFunctionData('createCPU', [
    'TapeFour CPU', 'TFCPU', 'https://tapefour.xyz', 10000n, 0n
  ]);

  for (const val of [0n, 10000000n, 11000000n, 10000000000000000n]) {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{
          from: '0xb3d85b42a045c1a88d800cad0f55d2566a4d3138',
          to: FACTORY,
          data,
          value: '0x' + val.toString(16)
        }, 'latest']
      })
    });
    const json = await res.json();
    console.log(`From owner, val ${val}:`, json.result ? "SUCCESS: " + json.result : "REVERT: " + JSON.stringify(json.error));
  }

  for (const val of [11000000n, 10000000n]) {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{
          from: '0x000000000000000000000000000000000000dEaD',
          to: FACTORY,
          data,
          value: '0x' + val.toString(16)
        }, 'latest']
      })
    });
    const json = await res.json();
    console.log(`From random, val ${val}:`, json.result ? "SUCCESS: " + json.result : "REVERT: " + JSON.stringify(json.error));
  }
}

main().catch(console.error);
