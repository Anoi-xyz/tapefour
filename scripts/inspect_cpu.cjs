const fs = require('fs');
const c = JSON.parse(fs.readFileSync('scripts/rpc_cache.json', 'utf8'));
const code = c['eth_getCode:["0x977f217887e085d298cb3819cdad5a0ee35f29b2","0x48f3479"]'];
console.log('CPU code size:', code.length / 2, 'bytes');

const selectors = [];
for (let i = 2; i < 3000; i += 2) {
  if (code.slice(i, i+2) === '63') {
    selectors.push('0x' + code.slice(i+2, i+10));
  }
}
console.log('Selectors found:', selectors);
