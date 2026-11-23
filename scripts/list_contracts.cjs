const fs = require('fs');
const cache = JSON.parse(fs.readFileSync('scripts/rpc_cache.json', 'utf8'));

// Find all code entries
for (const [k, v] of Object.entries(cache)) {
  if (k.startsWith('eth_getCode') && v.result && v.result.length > 2) {
    const addr = JSON.parse(k.split('eth_getCode:')[1])[0];
    console.log(addr, 'code size:', v.result.length / 2, 'bytes');
  }
}
