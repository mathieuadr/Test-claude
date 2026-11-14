// Couche réseau sans serveur : les téléphones communiquent via un relais MQTT public.
// Un joueur (l'« autorité », au départ le créateur) exécute le moteur de règles et publie
// l'état de la salle en message retenu. Si l'autorité disparaît, un autre joueur reprend
// automatiquement la main à partir du dernier état publié.
import * as MQ from './vendor/mqtt.esm.js';
import { Game, GameError } from './engine/game.js';
import { TOKENS, COLORS } from './engine/board.js';

const mqtt = MQ.default?.connect ? MQ.default : MQ;
const params = new URLSearchParams(location.search);
export const BROKER = params.get('broker') || 'wss://broker.hivemq.com:8884/mqtt';
const NS = 'skyline-v1';
const MAX_PLAYERS = 6;
const HB_MS = 4000;          // battement de cœur
const OFFLINE_MS = 13000;    // joueur considéré hors ligne
const TAKEOVER_MS = 15000;   // reprise de l'autorité
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
const rid = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');

function deviceId() {
  let id = localStorage.getItem('deviceId');
  if (!id) { id = rid(5); localStorage.setItem('deviceId', id); }
  return id;
}

export class Net {
  constructor({ onMessage, onStatus }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.me = deviceId();
    this.code = null;
    this.room = null;       // dernier état public reçu
    this.auth = null;       // { room, game } si je suis l'autorité
    this.seen = new Map();  // id -> dernier battement (horloge locale)
    this.pending = null;    // { kind: 'join'|'resume', name, token, since, tries }
    this.subscribedAt = 0;
    this.connected = false;
    this.client = mqtt.connect(BROKER, {
      clientId: `sky_${rid(6)}`, keepalive: 30, reconnectPeriod: 2000, connectTimeout: 10000, clean: true,
    });
    this.client.on('connect', () => {
      this.connected = true; this.onStatus(true);
      if (this.code) this.subscribe(this.code);
    });
    this.client.on('close', () => { if (this.connected) { this.connected = false; this.onStatus(false); } });
    this.client.on('offline', () => { this.connected = false; this.onStatus(false); });
    this.client.on('message', (topic, payload) => this.route(topic, payload.toString()));
    setInterval(() => this.tick(), 2000);
  }

  topic(kind) { return `${NS}/${this.code}/${kind}`; }
  pub(kind, obj, opts = {}) {
    this.client.publish(this.topic(kind), obj === null ? '' : JSON.stringify(obj), { qos: 1, ...opts });
  }
  subscribe(code) {
    this.client.subscribe(`${NS}/${code}/#`, { qos: 1 });
    this.subscribedAt = Date.now();
    this.heartbeat();
  }
  heartbeat() { if (this.code && this.connected) this.pub('hb', { id: this.me }, { qos: 0 }); }
  setRoom(code) {
    if (this.code && this.code !== code) this.client.unsubscribe(`${NS}/${this.code}/#`);
    this.code = code; this.room = null; this.auth = null; this.seen.clear();
    if (code && this.connected) this.subscribe(code);
  }
  emit(msg) { this.onMessage(msg); }

  // ------------------------------------------------------------ API utilisée par l'app
  send(msg) {
    switch (msg.t) {
      case 'create': {
        const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const code = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => A[b % A.length]).join('');
        this.setRoom(code);
        const room = { code, hostId: this.me, authority: this.me, ver: 0, members: [], game: null };
        this.auth = { room, game: null };
        this.addMember(this.me, msg.name, msg.token);
        this.emit({ t: 'joined', code, playerId: this.me });
        return this.publishState();
      }
      case 'join':
        this.setRoom(clean(msg.code, 5).toUpperCase());
        this.pending = { kind: 'join', name: msg.name, token: msg.token, since: Date.now(), tries: 0 };
        return;
      case 'resume':
        this.setRoom(clean(msg.code, 5).toUpperCase());
        this.pending = { kind: 'resume', since: Date.now() };
        return;
      case 'react':
        return this.pub('evt', { t: 'react', playerId: this.me, emoji: clean(msg.emoji, 8) }, { qos: 0 });
      case 'leave': {
        if (!this.code) return;
        this.command({ ...msg, from: this.me });
        this.pending = null;
        this.setRoom(null);
        return;
      }
      default:
        return this.command({ ...msg, from: this.me });
    }
  }

  command(cmd) {
    if (!this.connected) return this.emit({ t: 'error', msg: 'Connexion en cours…' });
    if (this.auth) return this.handleCmd(cmd);
    this.pub('cmd', cmd);
  }

  // ------------------------------------------------------------ réception
  route(topic, raw) {
    const kind = topic.split('/')[2];
    if (topic.split('/')[1] !== this.code) return;
    let msg = null;
    try { msg = raw ? JSON.parse(raw) : null; } catch { return; }
    if (kind === 'hb') { if (msg?.id) this.seen.set(msg.id, Date.now()); return; }
    if (kind === 'state') return this.onState(msg);
    if (kind === 'cmd') { if (this.auth && msg) this.handleCmd(msg); return; }
    if (kind === 'evt' && msg) {
      if (msg.t === 'react') return this.emit(msg);
      if (msg.t === 'error' && msg.to === this.me) return this.emit({ t: 'error', msg: msg.msg });
    }
  }

  onState(room) {
    if (!room) { // salle supprimée
      if (this.pending?.kind === 'join') { this.pending = null; this.setRoom(null); this.emit({ t: 'error', msg: 'Salle introuvable — vérifie le code' }); }
      return;
    }
    if (this.room && room.ver < this.room.ver && room.authority === this.room.authority) return; // obsolète
    this.room = room;
    if (!this.seen.has(room.authority)) this.seen.set(room.authority, Date.now());

    // Passation / reprise d'autorité
    if (room.authority === this.me && !this.auth) this.becomeAuthority(room);
    else if (room.authority !== this.me && this.auth) this.auth = null;

    const member = room.members.some((m) => m.id === this.me);
    if (this.pending) {
      if (member) {
        const kind = this.pending.kind;
        this.pending = null;
        this.emit({ t: 'joined', code: room.code, playerId: this.me, resumed: kind === 'resume' });
      } else if (this.pending.kind === 'resume') {
        this.pending = null; this.setRoom(null);
        return this.emit({ t: 'resumeFailed' });
      } else if (this.pending.kind === 'join' && this.pending.tries === 0) {
        this.pending.tries = 1;
        this.pending.sentAt = Date.now();
        this.pub('cmd', { t: 'join', from: this.me, name: this.pending.name, token: this.pending.token });
        return;
      } else return;
    } else if (!member) {
      this.setRoom(null);
      return this.emit({ t: 'kicked' });
    }
    this.emit({ t: 'state', room });
  }

  becomeAuthority(room) {
    this.auth = {
      room: { code: room.code, hostId: room.hostId, authority: this.me, ver: room.ver, members: room.members.map(({ connected, ...m }) => m) },
      game: room.snap ? Game.restore(room.snap) : null,
    };
  }

  tick() {
    this.heartbeat();
    const now = Date.now();
    if (this.pending && this.connected) {
      const p = this.pending;
      if (p.kind === 'join' && p.tries && now - p.sentAt > 5000) {
        p.tries++; p.sentAt = now;
        if (p.tries > 3) { this.pending = null; this.setRoom(null); return this.emit({ t: 'error', msg: 'L’hôte ne répond pas — réessaie' }); }
        this.pub('cmd', { t: 'join', from: this.me, name: p.name, token: p.token });
      } else if (!p.tries && now - p.since > 7000) {
        this.pending = null; this.setRoom(null);
        return this.emit(p.kind === 'resume' ? { t: 'resumeFailed' } : { t: 'error', msg: 'Salle introuvable — vérifie le code' });
      }
    }
    if (!this.room || !this.connected) return;
    if (this.auth) {
      // republie si la présence des joueurs a changé
      const flags = this.presence().join();
      if (flags !== this.lastFlags) this.publishState();
      return;
    }
    // Reprise si l'autorité a disparu : le premier joueur en ligne (ordre d'arrivée) prend la main
    const lastAuth = this.seen.get(this.room.authority) || 0;
    if (now - lastAuth > TAKEOVER_MS && now - this.subscribedAt > TAKEOVER_MS) {
      const alive = this.room.members.filter((m) => m.id === this.me || now - (this.seen.get(m.id) || 0) < OFFLINE_MS);
      const g = this.room.game;
      const eligible = alive.filter((m) => !g || !g.players.find((p) => p.id === m.id)?.bankrupt);
      if ((eligible[0] || alive[0])?.id === this.me) {
        this.becomeAuthority(this.room);
        if (!alive.some((m) => m.id === this.room.hostId)) this.auth.room.hostId = this.me; // l'hôte est parti
        this.publishState();
      }
    }
  }

  presence() {
    const now = Date.now();
    return this.auth.room.members.map((m) => m.id === this.me || now - (this.seen.get(m.id) || 0) < OFFLINE_MS);
  }

  publishState() {
    const { room, game } = this.auth;
    const flags = this.presence();
    this.lastFlags = flags.join();
    room.ver++;
    const pub = {
      code: room.code, hostId: room.hostId, authority: room.authority, ver: room.ver,
      status: game ? (game.phase === 'over' ? 'over' : 'playing') : 'lobby',
      members: room.members.map((m, k) => ({ ...m, connected: flags[k] })),
      game: game ? game.toJSON() : null,
      snap: game ? game.snapshot() : null,
    };
    this.pub('state', pub, { retain: true });
    this.room = pub;
    this.emit({ t: 'state', room: pub });
  }

  // ------------------------------------------------------------ logique de l'autorité
  addMember(id, name, token) {
    const room = this.auth.room;
    if (room.members.some((m) => m.id === id)) return;
    if (room.members.length >= MAX_PLAYERS) throw new GameError('La salle est pleine (6 joueurs max)');
    if (this.auth.game) throw new GameError('La partie a déjà commencé');
    const used = new Set(room.members.map((m) => m.token));
    if (!TOKENS.includes(token) || used.has(token)) token = TOKENS.find((t) => !used.has(t));
    const usedC = new Set(room.members.map((m) => m.color));
    room.members.push({ id, name: clean(name, 16) || `Joueur ${room.members.length + 1}`, token, color: COLORS.find((c) => !usedC.has(c)) });
    this.seen.set(id, Date.now());
  }

  handleCmd(cmd) {
    try {
      this.apply(cmd);
    } catch (e) {
      if (!(e instanceof GameError)) console.error(e);
      const msg = e instanceof GameError ? e.message : 'Erreur';
      if (cmd.from === this.me) this.emit({ t: 'error', msg });
      else this.pub('evt', { t: 'error', to: cmd.from, msg }, { qos: 0 });
    }
  }

  apply(cmd) {
    const { room } = this.auth;
    const from = cmd.from;
    const member = room.members.find((m) => m.id === from);
    if (cmd.t === 'join') { this.addMember(from, cmd.name, cmd.token); return this.publishState(); }
    if (!member) throw new GameError('Rejoins d’abord la salle');
    const game = this.auth.game;
    switch (cmd.t) {
      case 'update':
        if (game) throw new GameError('Partie en cours');
        if (cmd.token && TOKENS.includes(cmd.token) && !room.members.some((x) => x !== member && x.token === cmd.token)) member.token = cmd.token;
        return this.publishState();
      case 'leave':
        if (!game) {
          room.members = room.members.filter((x) => x !== member);
          if (!room.members.length) { this.pub('state', null, { retain: true }); this.auth = null; return; }
          if (room.hostId === from) room.hostId = room.members[0].id;
        } else if (!game.players.find((x) => x.id === from).bankrupt && game.phase !== 'over') {
          game.actBankrupt(from);
        }
        if (from === this.me) this.handOver();
        return this.publishState();
      case 'start':
        if (room.hostId !== from) throw new GameError('Seul l’hôte peut lancer la partie');
        if (game && game.phase !== 'over') throw new GameError('Partie déjà lancée');
        if (room.members.length < 2) throw new GameError('Il faut au moins 2 joueurs');
        this.auth.game = new Game(room.members);
        return this.publishState();
      case 'kick': case 'skip': {
        const target = room.members.find((x) => x.id === cmd.playerId);
        if (!target || target === member) throw new GameError('Joueur invalide');
        if (!game) {
          if (room.hostId !== from) throw new GameError('Seul l’hôte peut faire ça');
          room.members = room.members.filter((x) => x !== target);
        } else {
          if (target.id === this.me || Date.now() - (this.seen.get(target.id) || 0) < OFFLINE_MS) throw new GameError('Ce joueur est connecté');
          if (cmd.t === 'skip') game.actSkipAbsent(target.id); else game.actBankrupt(target.id);
        }
        return this.publishState();
      }
      case 'act':
        if (!game) throw new GameError('La partie n’a pas commencé');
        game.dispatch(from, cmd);
        return this.publishState();
      default:
        throw new GameError('Message inconnu');
    }
  }

  /** Quand l'autorité quitte la salle : passe la main au prochain joueur en ligne */
  handOver() {
    const { room, game } = this.auth;
    const now = Date.now();
    const next = room.members.find((m) => m.id !== this.me && now - (this.seen.get(m.id) || 0) < OFFLINE_MS && !(game?.players.find((p) => p.id === m.id)?.bankrupt))
      || room.members.find((m) => m.id !== this.me);
    if (!next) return;
    room.authority = next.id;
    if (room.hostId === this.me) room.hostId = next.id;
  }
}
