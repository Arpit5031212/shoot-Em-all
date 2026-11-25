// Tiny static server for local testing (localhost only, no dependencies).
//   node tools/dev-server.mjs [port]
// Game:   http://localhost:5173/src/
// Covers: http://localhost:5173/store/covers.html  (its "Save" button writes PNGs into store/)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storeDir = path.join(root, 'store');
const port = Number(process.argv[2]) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webm': 'video/webm', '.mp4': 'video/mp4',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'POST' && url.pathname === '/__save') {
    const name = url.searchParams.get('name') || '';
    if (!/^[\w-]+\.(png|mp4|webm)$/.test(name)) { res.writeHead(400).end('bad name'); return; }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      // PNGs arrive as a data URL; videos arrive as raw bytes
      const data = name.endsWith('.png')
        ? Buffer.from(raw.toString().replace(/^data:image\/png;base64,/, ''), 'base64')
        : raw;
      fs.writeFileSync(path.join(storeDir, name), data);
      console.log('saved', name);
      res.writeHead(200).end('ok');
    });
    return;
  }

  if (url.pathname === '/') { res.writeHead(302, { Location: '/src/' }).end(); return; }
  let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => console.log(`Dev server: http://localhost:${port}/src/`));
