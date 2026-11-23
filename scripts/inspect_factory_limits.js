// scripts/inspect_factory_limits.js
const rpcUrl = 'https://rpc.xlayer.tech';
const FACTORY = '0x1f09daefa827f02cbb40967cc91b259763760761';

async function call(to, data) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to, data }, 'latest']
    })
  });
  const json = await res.json();
  return json.result;
}

async function main() {
  console.log("owner:", await call(FACTORY, "0x8da5cb5b"));
  console.log("MAX_MINT_PRICE:", BigInt(await call(FACTORY, "0x8efc9196")));
  console.log("MAX_PROTOCOL_FEE:", BigInt(await call(FACTORY, "0xb8ca3b83")));
  console.log("MAX_DEPLOY_FEE:", BigInt(await call(FACTORY, "0xc5c4a614")));
}

main().catch(console.error);
