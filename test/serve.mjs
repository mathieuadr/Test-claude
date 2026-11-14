// Serveur de développement : sert public/ sous /Test-claude/ (comme GitHub Pages)
// et lance un relais MQTT local en WebSocket sur :8883.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Aedes from 'aedes';
import { createServer } from 'aedes-server-factory';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT) || 8099;
const BASE = '/Test-claude/';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (!u.pathname.startsWith(BASE)) { res.writeHead(302, { location: BASE }); return res.end(); }
  let f = path.join(ROOT, path.normalize(decodeURIComponent(u.pathname.slice(BASE.length))));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`App : http://localhost:${PORT}${BASE}?broker=ws://localhost:8883`));

const aedes = await Aedes.createBroker?.() ?? new Aedes();
createServer(aedes, { ws: true }).listen(8883, () => console.log('Relais MQTT local : ws://localhost:8883'));
