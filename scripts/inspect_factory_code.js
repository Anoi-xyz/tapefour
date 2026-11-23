// scripts/inspect_factory_code.js
const rpcUrl = 'https://rpc.xlayer.tech';
const IMPL = '0x336e9F0F4c3fEe7C8c803377e4DEA00293f4ae2a';

async function main() {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [IMPL, 'latest'] })
  });
  const code = (await res.json()).result;
  console.log("Impl code length in bytes:", (code.length - 2) / 2);

  // Search for 0x47f9b5fd in bytecode
  const idx = code.indexOf("47f9b5fd");
  console.log("createCPU selector offset in bytecode:", idx);
}

main().catch(console.error);
