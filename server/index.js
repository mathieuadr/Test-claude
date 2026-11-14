'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game, GameError } = require('./game');
const { TILES, GROUPS } = require('./board');

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC = path.join(__dirname, '..', 'public');
const MAX_PLAYERS = 6;
const ROOM_TTL_MS = 1000 * 60 * 60 * 6; // salle abandonnée supprimée après 6 h
const TOKENS = ['🚀', '🦄', '🐙', '🦊', '🎸', '🍩', '🛸', '🐼', '🌵', '👑'];
const COLORS = ['#ff5d8f', '#4fd1ff', '#ffd23f', '#7cf29c', '#b18cff', '#ff9b42'];

// ---------------------------------------------------------------- HTTP statique
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
  }
  if (url.pathname === '/api/board') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' });
    return res.end(JSON.stringify({ tiles: TILES, groups: GROUPS, tokens: TOKENS }));
  }
  let file = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (!file || file.endsWith('/')) file += 'index.html';
  let full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) full = path.join(PUBLIC, 'index.html'); // fallback SPA (liens /?room=XXXX)
    const ext = path.extname(full);
    const noCache = ext === '.html' || full.endsWith('sw.js') || ext === '.webmanifest';
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': noCache ? 'no-cache' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
    fs.createReadStream(full).pipe(res);
  });
});

// ---------------------------------------------------------------- Salles
/** @type {Map<string, any>} */
const rooms = new Map();

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join(''); } while (rooms.has(c));
  return c;
}

const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.game ? (room.game.phase === 'over' ? 'over' : 'playing') : 'lobby',
    members: room.members.map((m) => ({ id: m.id, name: m.name, token: m.token, color: m.color, connected: m.sockets.size > 0 })),
    game: room.game ? room.game.toJSON() : null,
  };
}

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const m of room.members) for (const ws of m.sockets) if (ws.readyState === 1) ws.send(data);
}

function pushState(room) {
  room.touched = Date.now();
  broadcast(room, { t: 'state', room: publicRoom(room) });
}

function addMember(room, name, token) {
  if (room.members.length >= MAX_PLAYERS) throw new GameError('La salle est pleine (6 joueurs max)');
  if (room.game) throw new GameError('La partie a déjà commencé');
  const used = new Set(room.members.map((m) => m.token));
  if (!TOKENS.includes(token) || used.has(token)) token = TOKENS.find((t) => !used.has(t));
  const usedC = new Set(room.members.map((m) => m.color));
  const member = {
    id: crypto.randomUUID().slice(0, 8),
    secret: crypto.randomBytes(16).toString('hex'),
    name: clean(name, 16) || `Joueur ${room.members.length + 1}`,
    token,
    color: COLORS.find((c) => !usedC.has(c)),
    sockets: new Set(),
  };
  room.members.push(member);
  return member;
}

function attach(ws, room, member) {
  ws.ctx = { room, member };
  member.sockets.add(ws);
  send(ws, { t: 'joined', code: room.code, playerId: member.id, secret: member.secret });
  pushState(room);
}

function handle(ws, msg) {
  const ctx = ws.ctx;
  switch (msg.t) {
    case 'create': {
      const room = { code: newCode(), members: [], game: null, hostId: null, touched: Date.now() };
      rooms.set(room.code, room);
      const m = addMember(room, msg.name, msg.token);
      room.hostId = m.id;
      return attach(ws, room, m);
    }
    case 'join': {
      const room = rooms.get(clean(msg.code, 4).toUpperCase());
      if (!room) throw new GameError('Salle introuvable — vérifie le code');
      return attach(ws, room, addMember(room, msg.name, msg.token));
    }
    case 'resume': {
      const room = rooms.get(clean(msg.code, 4).toUpperCase());
      const m = room?.members.find((x) => x.id === msg.playerId && x.secret === msg.secret);
      if (!m) return send(ws, { t: 'resumeFailed' });
      return attach(ws, room, m);
    }
    case 'ping': return send(ws, { t: 'pong' });
  }

  if (!ctx) throw new GameError('Rejoins d’abord une salle');
  const { room, member } = ctx;

  switch (msg.t) {
    case 'update': { // changer pseudo / pion dans le lobby
      if (room.game) throw new GameError('Partie en cours');
      if (msg.name) member.name = clean(msg.name, 16) || member.name;
      if (msg.token && TOKENS.includes(msg.token) && !room.members.some((x) => x !== member && x.token === msg.token)) member.token = msg.token;
      return pushState(room);
    }
    case 'leave': {
      member.sockets.delete(ws);
      ws.ctx = null;
      if (!room.game) {
        room.members = room.members.filter((x) => x !== member);
        if (!room.members.length) { rooms.delete(room.code); return; }
        if (room.hostId === member.id) room.hostId = room.members[0].id;
      } else if (!room.game.players.find((x) => x.id === member.id).bankrupt && room.game.phase !== 'over') {
        room.game.actBankrupt(member.id);
      }
      return pushState(room);
    }
    case 'start': {
      if (room.hostId !== member.id) throw new GameError('Seul l’hôte peut lancer la partie');
      if (room.game && room.game.phase !== 'over') throw new GameError('Partie déjà lancée');
      if (room.members.length < 2) throw new GameError('Il faut au moins 2 joueurs');
      room.game = new Game(room.members);
      return pushState(room);
    }
    case 'kick': { // l'hôte peut éliminer un joueur absent pour débloquer la partie
      if (room.hostId !== member.id) throw new GameError('Seul l’hôte peut faire ça');
      const target = room.members.find((x) => x.id === msg.playerId);
      if (!target || target === member) throw new GameError('Joueur invalide');
      if (!room.game) {
        for (const s of target.sockets) { send(s, { t: 'kicked' }); s.ctx = null; }
        room.members = room.members.filter((x) => x !== target);
      } else {
        if (target.sockets.size > 0) throw new GameError('Ce joueur est connecté');
        room.game.actBankrupt(target.id);
      }
      return pushState(room);
    }
    case 'react': {
      const emoji = clean(msg.emoji, 8);
      if (!emoji) return;
      return broadcast(room, { t: 'react', playerId: member.id, emoji });
    }
    case 'act': {
      if (!room.game) throw new GameError('La partie n’a pas commencé');
      room.game.dispatch(member.id, msg);
      return pushState(room);
    }
    default: throw new GameError('Message inconnu');
  }
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try {
      handle(ws, msg);
    } catch (e) {
      if (!(e instanceof GameError)) console.error(e);
      send(ws, { t: 'error', msg: e instanceof GameError ? e.message : 'Erreur serveur' });
    }
  });
  ws.on('close', () => {
    const ctx = ws.ctx;
    if (!ctx) return;
    ctx.member.sockets.delete(ws);
    if (rooms.has(ctx.room.code)) pushState(ctx.room);
  });
});

// Heartbeat (garde les connexions ouvertes derrière les proxies cloud) + ménage
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, room] of rooms) {
    const online = room.members.some((m) => m.sockets.size > 0);
    if (!online && now - room.touched > ROOM_TTL_MS) rooms.delete(code);
  }
}, 25000).unref();

server.listen(PORT, () => console.log(`Skyline prêt sur http://localhost:${PORT}`));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    for (const ws of wss.clients) ws.close(1012, 'redémarrage');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
