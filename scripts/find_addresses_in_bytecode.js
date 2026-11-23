// scripts/find_addresses_in_bytecode.js
const rpcUrl = 'https://rpc.xlayer.tech';
const IMPL = '0x336e9F0F4c3fEe7C8c803377e4DEA00293f4ae2a';

async function main() {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [IMPL, 'latest'] })
  });
  const code = (await res.json()).result.slice(2);
  
  // Search for 20-byte sequences (40 hex chars) that look like addresses (PUSH20: 73 <20 bytes>)
  for (let i = 0; i < code.length - 42; i += 2) {
    if (code.slice(i, i + 2) === '73') {
      const addr = '0x' + code.slice(i + 2, i + 42);
      console.log('PUSH20 address found at', i / 2, ':', addr);
    }
  }
}

main().catch(console.error);
