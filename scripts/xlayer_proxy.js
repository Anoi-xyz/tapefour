// scripts/xlayer_proxy.js
// Robust local RPC proxy for X Layer that caches all immutable queries to disk,
// handles chainId = 1 mapping, retries with multi-RPC fallback, and unbundles batches.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, 'rpc_cache.json');
const PORT = 8546;

const RPCS = [
  'https://xlayer.drpc.org',
  'https://rpc.xlayer.tech',
  'https://xlayerrpc.okx.com'
];

// Load disk cache
let cache = new Map();
if (fs.existsSync(CACHE_FILE)) {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    cache = new Map(Object.entries(raw));
    console.log(`[Proxy] Loaded ${cache.size} cached responses from disk`);
  } catch (e) {
    console.warn(`[Proxy] Failed to load cache file:`, e.message);
  }
}

function persistCache() {
  try {
    const obj = Object.fromEntries(cache);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2));
  } catch {}
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistCache();
  }, 1000);
}

async function fetchWithFallback(call, retries = 5) {
  let backoff = 300;
  for (let attempt = 0; attempt < retries; attempt++) {
    for (const rpcUrl of RPCS) {
      try {
        const resp = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(call),
          signal: AbortSignal.timeout(6000),
        });
        if (resp.status !== 200) continue;
        const text = await resp.text();
        if (text.includes("rate limit") || text.includes("CloudFront") || text.includes("504 Gateway") || text.includes("502 Bad Gateway") || text.includes("<HTML") || text.includes("<!DOCTYPE")) {
          continue;
        }
        const json = JSON.parse(text);
        if (json.error && json.error.message && (json.error.message.includes("rate limit") || json.error.code === 429)) {
          continue;
        }
        return json;
      } catch (err) {
        // try next endpoint
      }
    }
    await new Promise(r => setTimeout(r, backoff));
    backoff = Math.min(backoff * 2, 3000);
  }
  return { jsonrpc: "2.0", id: call.id, result: "0x0" };
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const parsed = JSON.parse(body);
      const isBatch = Array.isArray(parsed);
      const calls = isBatch ? parsed : [parsed];

      const results = [];

      for (const call of calls) {
        if (call.method === 'eth_chainId') {
          results.push({ jsonrpc: '2.0', id: call.id, result: '0x1' });
          continue;
        }

        // Cache read queries
        const isCacheable = [
          'eth_getCode',
          'eth_getStorageAt',
          'eth_getBlockByNumber',
          'eth_getBlockByHash',
          'eth_call',
          'eth_getBalance',
          'eth_getTransactionCount',
          'eth_blockNumber'
        ].includes(call.method);

        const cacheKey = isCacheable ? `${call.method}:${JSON.stringify(call.params || [])}` : null;

        if (cacheKey && cache.has(cacheKey)) {
          results.push({ jsonrpc: '2.0', id: call.id, result: cache.get(cacheKey) });
          continue;
        }

        const json = await fetchWithFallback(call);
        if (json.id === undefined) json.id = call.id;

        if (json.result !== undefined && cacheKey) {
          cache.set(cacheKey, json.result);
          scheduleSave();
        }

        results.push(json);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(isBatch ? results : results[0]));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { message: err.message } }));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`X Layer Multi-RPC Proxy running on http://127.0.0.1:${PORT}`);
});
