// Zero-dependency local development server for TapeFour
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_DIR = path.join(__dirname, 'web');

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

let currentPort = Number(process.env.PORT) || 3000;

const server = http.createServer((req, res) => {
  // Normalize URL (strip query parameters and client fragments)
  let reqPath = req.url.split('?')[0].split('#')[0];
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  if (reqPath === '/game') reqPath = '/game.html';

  const filePath = path.join(WEB_DIR, reqPath);

  // Security check: ensure path is within WEB_DIR
  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + reqPath);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

function startServer(port) {
  server.removeAllListeners('listening');
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const actualPort = (address && typeof address === 'object') ? address.port : port;
    console.log(`TapeFour web server running at http://localhost:${actualPort}/`);
    console.log(`Serving static files from: ${WEB_DIR}`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && !process.env.PORT && currentPort < 3010) {
    currentPort += 1;
    console.warn(`Port in use, trying port ${currentPort}...`);
    startServer(currentPort);
  } else {
    throw err;
  }
});

startServer(currentPort);
