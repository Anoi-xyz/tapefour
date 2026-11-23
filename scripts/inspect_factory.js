// scripts/inspect_factory.js
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
  if (json.error) console.error("RPC Error:", json.error);
  return json.result;
}

async function main() {
  console.log("Checking factory with exact selectors...");
  // deployFee() -> 0xeb2a5d2c
  const deployFee = await call(FACTORY, "0xeb2a5d2c");
  console.log("deployFee result:", deployFee, deployFee ? BigInt(deployFee) : null);
  // protocolFee() -> 0xb0e21e8a
  const protoFee = await call(FACTORY, "0xb0e21e8a");
  console.log("protocolFee result:", protoFee, protoFee ? BigInt(protoFee) : null);
  // cpuCount() -> 0xa94da8a7
  const cpuCount = await call(FACTORY, "0xa94da8a7");
  console.log("cpuCount result:", cpuCount, cpuCount ? BigInt(cpuCount) : null);
  // cpus(0) -> 0xd2c26963 + 000...
  const cpu0 = await call(FACTORY, "0xd2c26963" + "0".padStart(64, "0"));
  console.log("cpu 0 result:", cpu0);
}

main().catch(console.error);
