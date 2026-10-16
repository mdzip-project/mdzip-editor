// Static server for the test bench (testbench/). Listens on all interfaces so
// the page also opens through this machine's LAN address: that page is NOT a
// secure context (crypto.subtle is undefined), which the editor must handle.
// PORT overrides the default 8790. Ctrl+C to stop.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT ?? 8790);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mdz': 'application/zip',
  '.css': 'text/css',
  '.map': 'application/json'
};

createServer(async (request, response) => {
  const urlPath = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  const file = normalize(join(root, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(normalize(root))) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`Test bench:  http://localhost:${port}/   (secure context)`);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        console.log(`  LAN:       http://${address.address}:${port}/   (NOT a secure context)`);
      }
    }
  }
});
