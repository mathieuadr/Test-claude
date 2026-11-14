// Skyline — client PWA (sans serveur : voir net.js)
import { Net } from './net.js';
import { TILES, GROUPS, TOKENS } from './engine/board.js';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => `${Number(n).toLocaleString('fr-FR')} ₭`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get: (k, d = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: (k) => localStorage.removeItem(k),
};

const S = {
  net: null, board: { tiles: TILES, groups: GROUPS, tokens: TOKENS }, room: null, session: store.get('session'), token: store.get('token'),
  displayPos: {}, seenMove: 0, seenRoll: 0, seenCard: 0, seenLog: 0, seenTrade: null,
  money: {}, sheet: null, draft: null, animating: Promise.resolve(), retry: 0, wasMyTurn: false,
  wakeLock: null, installEvt: null, seededState: false,
};

// --------------------------------------------------------------- utilitaires UI
function toast(text, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 2800);
}
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
}
const vibrate = (p) => navigator.vibrate?.(p);
const BROKER_QS = new URLSearchParams(location.search).get('broker') ? `&broker=${encodeURIComponent(new URLSearchParams(location.search).get('broker'))}` : '';

// --------------------------------------------------------------- réseau
function connect() {
  S.net = new Net({
    onMessage,
    onStatus: (ok) => {
      $('#conn').classList.toggle('hidden', ok || !S.session);
      if (ok && S.session && !S.net.code) send({ t: 'resume', ...S.session });
    },
  });
}
function send(msg) { S.net.send(msg); }
const act = (a, extra = {}) => send({ t: 'act', a, ...extra });

function onMessage(msg) {
  switch (msg.t) {
    case 'joined':
      S.session = { code: msg.code, playerId: msg.playerId };
      store.set('session', S.session);
      history.replaceState(null, '', `${location.pathname}?room=${msg.code}${BROKER_QS}`);
      break;
    case 'state': onState(msg.room); break;
    case 'resumeFailed':
      S.session = null; store.del('session'); S.room = null;
      show('home');
      break;
    case 'kicked':
      S.session = null; store.del('session'); S.room = null;
      toast('Tu as été retiré·e du salon', true); show('home');
      break;
    case 'error': toast(msg.msg, true); vibrate(60); break;
    case 'react': floatReaction(msg.playerId, msg.emoji); break;
  }
}

// --------------------------------------------------------------- accueil
function tokenPicker(el, selected, taken, onPick) {
  el.innerHTML = '';
  for (const t of S.board.tokens) {
    const b = document.createElement('button');
    b.textContent = t;
    b.className = t === selected ? 'sel' : '';
    b.disabled = taken.has(t) && t !== selected;
    b.onclick = () => onPick(t);
    el.append(b);
  }
}

function initHome() {
  const name = $('#name');
  name.value = store.get('name', '');
  if (!S.token) S.token = S.board.tokens[Math.floor(Math.random() * 6)];
  const pick = (t) => { S.token = t; store.set('token', t); tokenPicker($('#tokenPick'), t, new Set(), pick); };
  pick(S.token);
  const code = new URLSearchParams(location.search).get('room');
  if (code) $('#code').value = code.toUpperCase();

  const go = (payload) => {
    const n = name.value.trim();
    if (!n) { toast('Choisis un pseudo 😉', true); name.focus(); return; }
    store.set('name', n);
    send({ ...payload, name: n, token: S.token });
  };
  $('#btnCreate').onclick = () => go({ t: 'create' });
  $('#btnJoin').onclick = () => {
    const c = $('#code').value.trim().toUpperCase();
    if (c.length !== 5) { toast('Le code fait 5 caractères', true); return; }
    go({ t: 'join', code: c });
  };
  $('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnJoin').click(); });

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (isIOS && !standalone) $('#installHint').textContent = 'Astuce : Partager ⬆️ puis « Sur l’écran d’accueil » pour installer l’app.';
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  S.installEvt = e;
  const h = $('#installHint');
  h.innerHTML = '<button class="btn sm">📲 Installer l’application</button>';
  h.firstChild.onclick = async () => { S.installEvt.prompt(); await S.installEvt.userChoice; h.innerHTML = ''; };
});

// --------------------------------------------------------------- salon
function renderLobby(room) {
  show('lobby');
  const me = room.members.find((m) => m.id === S.session.playerId);
  $('#roomCode').textContent = room.code;
  $('#playerCount').textContent = `(${room.members.length}/6)`;
  const isHost = room.hostId === S.session.playerId;
  $('#lobbyPlayers').innerHTML = room.members.map((m) => `
    <li>
      <span class="tok" style="background:${m.color}33;box-shadow:inset 0 0 0 2px ${m.color}">${m.token}</span>
      <span class="nm">${esc(m.name)}${m.id === S.session.playerId ? ' <span class="muted">(toi)</span>' : ''}</span>
      ${m.id === room.hostId ? '<span class="badge">HÔTE</span>' : ''}
      ${!m.connected ? '<span class="badge off">hors ligne</span>' : ''}
      ${isHost && m.id !== S.session.playerId ? `<button class="btn sm danger" data-kick="${m.id}">✕</button>` : ''}
    </li>`).join('');
  for (const b of document.querySelectorAll('[data-kick]')) b.onclick = () => send({ t: 'kick', playerId: b.dataset.kick });
  const taken = new Set(room.members.filter((m) => m !== me).map((m) => m.token));
  tokenPicker($('#tokenPickLobby'), me?.token, taken, (t) => { S.token = t; store.set('token', t); send({ t: 'update', token: t }); });
  const btn = $('#btnStart');
  btn.classList.toggle('hidden', !isHost);
  btn.disabled = room.members.length < 2;
  $('#lobbyHint').textContent = isHost
    ? (room.members.length < 2 ? 'Invite au moins un·e ami·e pour commencer.' : 'Tout le monde est là ? C’est parti !')
    : 'En attente du lancement par l’hôte…';
}

$('#btnShare').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${S.room.code}${BROKER_QS}`;
  const data = { title: 'Skyline', text: `Rejoins ma partie de Skyline ! Code : ${S.room.code}`, url };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(url); toast('Lien copié !'); }
  } catch { /* annulé */ }
};
$('#btnStart').onclick = () => send({ t: 'start' });
$('#btnLeaveLobby').onclick = () => leave();

function leave() {
  send({ t: 'leave' });
  S.session = null; store.del('session'); S.room = null;
  history.replaceState(null, '', `${location.pathname}${BROKER_QS ? '?' + BROKER_QS.slice(1) : ''}`);
  closeSheet();
  show('home');
}

// --------------------------------------------------------------- plateau
function gridPos(i) {
  if (i <= 10) return { row: 11, col: 11 - i, side: 'bottom' };
  if (i < 20) return { row: 21 - i, col: 1, side: 'left' };
  if (i <= 30) return { row: 1, col: i - 19, side: 'top' };
  return { row: i - 29, col: 11, side: 'right' };
}
const ICONS = { go: '🏁', jail: '🚔', parking: '☕', gotojail: '👮', chance: '❓', chest: '💎', tax: '💸', metro: '🚇' };

function buildBoard() {
  const board = $('#board');
  for (const t of S.board.tiles) {
    const { row, col, side } = gridPos(t.index);
    const el = document.createElement('div');
    const corner = t.index % 10 === 0;
    el.className = `tile s-${side}${corner ? ' corner' : ''}`;
    el.style.gridArea = `${row} / ${col}`;
    el.id = `t${t.index}`;
    const g = S.board.groups[t.group];
    if (t.type === 'property') {
      el.style.setProperty('--gc', g.color);
      el.innerHTML = `<div class="bar"></div><div class="nm">${esc(t.name)}</div><div class="pr">${t.price}</div>`;
    } else {
      const ic = t.icon || ICONS[t.type] || '';
      el.innerHTML = `<div class="ic">${ic}</div><div class="nm">${esc(t.name)}</div>${t.price ? `<div class="pr">${t.price}</div>` : ''}`;
    }
    el.insertAdjacentHTML('beforeend', '<div class="toks"></div>');
    el.onclick = () => openSheet('tile', t.index);
    board.append(el);
  }
}

function updateBoard(g) {
  for (const t of S.board.tiles) {
    const el = $(`#t${t.index}`);
    const pr = g.props[t.index];
    el.classList.toggle('mortgaged', !!pr?.mortgaged);
    let own = el.querySelector('.own');
    if (pr) {
      const owner = g.players.find((p) => p.id === pr.owner);
      if (!own) { own = document.createElement('div'); own.className = 'own'; el.prepend(own); }
      own.style.setProperty('--oc', owner?.color || '#fff');
    } else own?.remove();
    const bar = el.querySelector('.bar');
    if (bar) {
      const h = pr?.houses || 0;
      bar.innerHTML = h === 5 ? '<i class="hotel"></i>' : '<i></i>'.repeat(h);
    }
    el.classList.toggle('hl', g.phase === 'buy' && g.pendingBuy === t.index);
  }
}

function placeTokens(g) {
  for (const el of document.querySelectorAll('.toks')) el.innerHTML = '';
  for (const p of g.players) {
    if (p.bankrupt) continue;
    const pos = S.displayPos[p.id] ?? p.pos;
    const span = document.createElement('span');
    span.className = 'token';
    span.style.setProperty('--pc', p.color);
    span.textContent = p.token;
    $(`#t${pos} .toks`).append(span);
  }
}

// Anime les déplacements des pions case par case
function animateMoves(g) {
  const fresh = g.moves.filter((m) => m.seq > S.seenMove);
  if (!fresh.length) return;
  S.seenMove = Math.max(...fresh.map((m) => m.seq));
  S.animating = S.animating.then(async () => {
    await sleep(450); // laisse les dés rouler
    for (const m of fresh) {
      if (m.kind === 'walk') {
        let pos = S.displayPos[m.playerId] ?? m.from;
        const steps = (m.to - pos + 40) % 40;
        const delay = Math.max(60, Math.min(170, 1600 / steps));
        for (let k = 0; k < steps; k++) {
          pos = (pos + 1) % 40;
          S.displayPos[m.playerId] = pos;
          placeTokens(S.room.game);
          await sleep(delay);
        }
      } else {
        await sleep(250);
        S.displayPos[m.playerId] = m.to;
        placeTokens(S.room.game);
      }
    }
  });
}

function renderDice(g) {
  const pips = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const dice = $('#dice');
  [...dice.children].forEach((d, k) => {
    d.innerHTML = Array.from({ length: 9 }, (_, j) => (pips[g.dice[k]].includes(j + 1) ? '<b></b>' : '<span></span>')).join('');
  });
  if (g.rollSeq !== S.seenRoll) {
    if (S.seededState) { dice.classList.remove('rolling'); void dice.offsetWidth; dice.classList.add('rolling'); vibrate(30); }
    S.seenRoll = g.rollSeq;
  }
}

function showCard(g) {
  if (!g.card || g.card.seq === S.seenCard) return;
  S.seenCard = g.card.seq;
  if (!S.seededState) return;
  const c = g.card;
  S.animating.then(() => {
    $('.card-pop')?.remove();
    const el = document.createElement('div');
    el.className = `card-pop ${c.deck}`;
    el.innerHTML = `<div class="k">${c.deck === 'chance' ? '❓ Opportunité' : '💎 Fortune'}</div><div>${esc(c.text)}</div>`;
    el.onclick = () => el.remove();
    $('#center').append(el);
    setTimeout(() => el.remove(), 4500);
  });
}

// --------------------------------------------------------------- jeu
function onState(room) {
  const prev = S.room;
  S.room = room;
  if (!S.session) return;
  if (room.status === 'lobby') { S.seededState = false; return renderLobby(room); }
  const g = room.game;
  if (!S.seededState || !prev?.game || prev.game.turnCount > g.turnCount) {
    // premier état reçu : pas d'animation
    for (const p of g.players) S.displayPos[p.id] = p.pos;
    S.seenMove = Math.max(0, ...g.moves.map((m) => m.seq));
    S.seenRoll = g.rollSeq; S.seenCard = g.card?.seq ?? 0;
    S.seenLog = g.log.at(-1)?.seq ?? 0;
    for (const p of g.players) S.money[p.id] = p.money;
  }
  renderGame(room);
  S.seededState = true;
}

function me() { return S.room.game.players.find((p) => p.id === S.session.playerId); }
function memberOf(id) { return S.room.members.find((m) => m.id === id); }

function renderPlayers(g) {
  $('#players').innerHTML = g.players.map((p) => {
    const conn = memberOf(p.id)?.connected;
    const delta = p.money - (S.money[p.id] ?? p.money);
    const cls = ['pchip', p.id === g.currentId && g.phase !== 'over' ? 'cur' : '', !conn ? 'off' : '', p.bankrupt ? 'out' : '', delta > 0 ? 'flash-up' : delta < 0 ? 'flash-down' : ''].join(' ');
    return `<div class="${cls}" style="--pc:${p.color}">
      <span class="tok" style="background:${p.color}2a">${p.token}</span>
      <div><div class="nm">${esc(p.name)}${p.id === S.session.playerId ? ' (toi)' : ''}</div><div class="mn">${fmt(p.money)}</div></div>
      <span class="flag">${p.inJail ? '🔒' : ''}${p.jailCards ? '🎫' : ''}${!conn && !p.bankrupt ? '📴' : ''}</span>
    </div>`;
  }).join('');
  for (const p of g.players) S.money[p.id] = p.money;
}

function renderGame(room) {
  show('game');
  const g = room.game;
  const firstRender = !$('#t0');
  if (firstRender) buildBoard();
  renderPlayers(g);
  updateBoard(g);
  if (S.seededState) animateMoves(g); else placeTokens(g);
  S.animating.then(() => placeTokens(S.room.game));
  renderDice(g);
  showCard(g);
  $('#centerMsg').textContent = g.log.at(-1)?.text || '';
  $('#feed').innerHTML = g.log.slice(-5, -1).reverse().map((l) => `<div>${esc(l.text)}</div>`).join('');
  renderActions(g);
  // Notification d'échange
  const tradeDot = g.trade && g.trade.to === S.session.playerId;
  $('[data-tab=trade]').innerHTML = `🤝 Échanger${tradeDot ? '<span class="dot"></span>' : ''}`;
  if (tradeDot && S.seenTrade !== g.trade.id) { S.seenTrade = g.trade.id; vibrate([40, 60, 40]); openSheet('trade'); }
  if (S.sheet) renderSheet();
  if (g.phase === 'over' && !S.celebrated) { S.celebrated = true; celebrate(g); }
  if (g.phase !== 'over') S.celebrated = false;
  keepAwake();
}

function renderActions(g) {
  const st = $('#status');
  const box = $('#actions');
  const mine = me();
  const cur = g.players.find((p) => p.id === g.currentId);
  const myTurn = g.currentId === mine.id && g.phase !== 'over';
  const isHost = S.room.hostId === mine.id;
  const myDebt = g.debts.find((d) => d.playerId === mine.id);
  const btn = (label, onclick, cls = '', disabled = false) => ({ label, onclick, cls, disabled });
  let buttons = [];

  if (myTurn && !S.wasMyTurn && S.seededState) { toast('🎲 C’est ton tour !'); vibrate([60, 40, 60]); }
  S.wasMyTurn = myTurn;

  if (g.phase === 'over') {
    const w = g.players.find((p) => p.id === g.winner);
    st.innerHTML = `🏆 <span class="who" style="--pc:${w?.color}">${esc(w?.name)}</span> a gagné !`;
    if (isHost) buttons.push(btn('🔁 Nouvelle partie', () => send({ t: 'start' }), 'primary big'));
    buttons.push(btn('🚪 Quitter', () => leave()));
  } else if (mine.bankrupt) {
    st.textContent = '💀 Tu es en faillite — profite du spectacle !';
    buttons.push(btn('🚪 Quitter la partie', () => leave()));
  } else if (myDebt) {
    st.innerHTML = `⚠️ Tu dois encore <b>${fmt(myDebt.amount)}</b>. Vends ou hypothèque !`;
    buttons.push(btn('🏘️ Gérer mes biens', () => openSheet('assets'), 'primary'));
    buttons.push(btn('💥 Faillite', () => { if (confirm('Déclarer faillite ? Tu seras éliminé·e.')) act('bankrupt'); }, 'danger'));
  } else if (myTurn) {
    if (g.debts.length) {
      st.textContent = '⏳ En attente du règlement des dettes…';
    } else if (g.phase === 'roll') {
      if (mine.inJail) {
        st.innerHTML = `🔒 Tu es en prison (essai ${mine.jailTurns + 1}/3)`;
        buttons.push(btn('🎲 Tenter un double', () => act('roll'), 'primary'));
        buttons.push(btn('💸 Payer 50 ₭', () => act('payJail'), '', mine.money < 50));
        if (mine.jailCards) buttons.push(btn('🎫 Utiliser ma carte', () => act('jailCard'), 'ok'));
      } else {
        st.innerHTML = g.lastRollDoubles ? 'Double ! Relance 🎉' : 'À toi de jouer !';
        buttons.push(btn('🎲 Lancer les dés', () => act('roll'), 'primary big'));
      }
    } else if (g.phase === 'buy') {
      const t = S.board.tiles[g.pendingBuy];
      st.innerHTML = `${esc(t.name)} est à vendre — <b>${fmt(t.price)}</b>`;
      buttons.push(btn(`🏷️ Acheter`, () => act('buy'), 'primary', mine.money < t.price));
      buttons.push(btn('Passer', () => act('pass')));
      buttons.push(btn('🔍 Détails', () => openSheet('tile', g.pendingBuy)));
    } else if (g.phase === 'end') {
      st.textContent = 'Construis, échange… ou termine ton tour.';
      buttons.push(btn('Fin du tour ➜', () => act('end'), 'primary big'));
    }
  } else {
    const conn = memberOf(cur.id)?.connected;
    st.innerHTML = `Tour de <span class="who" style="--pc:${cur.color}">${cur.token} ${esc(cur.name)}</span>${conn ? '' : ' <span class="muted">(hors ligne)</span>'}`;
    if (g.debts.length) st.innerHTML += '<div class="small muted">Règlement de dettes en cours…</div>';
    if (!conn) {
      const owes = g.debts.some((d) => d.playerId === cur.id);
      if (!owes) buttons.push(btn(`⏭️ Passer son tour`, () => send({ t: 'skip', playerId: cur.id }), 'primary'));
      buttons.push(btn(`Éliminer ${cur.name}`, () => { if (confirm(`Éliminer ${cur.name} ? Ses biens retournent à la banque.`)) send({ t: 'kick', playerId: cur.id }); }, 'danger'));
    }
  }

  box.innerHTML = '';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = `btn ${b.cls}`;
    el.textContent = b.label;
    el.disabled = b.disabled;
    el.onclick = b.onclick;
    box.append(el);
  }
}

for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => openSheet(b.dataset.tab);

// --------------------------------------------------------------- feuilles modales
function openSheet(type, arg) {
  if (type === 'trade' && !S.room.game.trade) S.draft = null;
  S.sheet = { type, arg };
  $('#sheet').classList.remove('hidden');
  renderSheet();
}
function closeSheet() { S.sheet = null; $('#sheet').classList.add('hidden'); }
document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });

function renderSheet() {
  const c = $('#sheetContent');
  const { type, arg } = S.sheet;
  const g = S.room?.game;
  if (!g) return closeSheet();
  if (type === 'tile') return renderTileSheet(c, g, arg);
  if (type === 'assets') return renderAssets(c, g);
  if (type === 'log') {
    c.innerHTML = `<h2>📜 Journal</h2><div class="log">${g.log.map((l) => `<div>${esc(l.text)}</div>`).join('')}</div>`;
    return;
  }
  if (type === 'react') {
    const em = ['😂', '😱', '🤑', '😭', '🔥', '👏', '😈', '🙏', '💀', '❤️'];
    c.innerHTML = `<h2>Réagir</h2><div class="react-grid">${em.map((e) => `<button>${e}</button>`).join('')}</div>`;
    for (const b of c.querySelectorAll('button')) b.onclick = () => { send({ t: 'react', emoji: b.textContent }); closeSheet(); };
    return;
  }
  if (type === 'trade') return renderTrade(c, g);
}

function rentRows(t) {
  if (t.type === 'property') {
    const labels = ['Terrain nu', '1 maison', '2 maisons', '3 maisons', '4 maisons', 'Hôtel'];
    return t.rent.map((r, k) => [labels[k], fmt(r)]);
  }
  if (t.type === 'metro') return [['1 ligne', fmt(25)], ['2 lignes', fmt(50)], ['3 lignes', fmt(100)], ['4 lignes', fmt(200)]];
  if (t.type === 'utility') return [['1 service', '4 × dés'], ['2 services', '10 × dés']];
  return [];
}

const TILE_INFO = {
  go: 'Encaisse 200 ₭ à chaque passage.',
  jail: 'Simple visite… sauf si tu y es enfermé·e. Pour sortir : un double, 50 ₭ ou une carte.',
  parking: 'Pause café ☕ Rien ne se passe ici.',
  gotojail: 'Direction la prison, sans passer par le Départ !',
  chance: 'Pioche une carte Opportunité.',
  chest: 'Pioche une carte Fortune.',
};

function renderTileSheet(c, g, i) {
  const t = S.board.tiles[i];
  const grp = S.board.groups[t.group];
  const pr = g.props[i];
  const owner = pr && g.players.find((p) => p.id === pr.owner);
  const mine = pr?.owner === S.session.playerId;
  if (!t.price) {
    c.innerHTML = `<div class="deed-head" style="--gc:linear-gradient(135deg,#8a6cff,#4fd1ff)"><div style="font-size:42px">${t.icon || ICONS[t.type] || ''}</div><h2>${esc(t.name)}</h2></div>
      <p>${t.type === 'tax' ? `Paie ${fmt(t.amount)} à la banque.` : TILE_INFO[t.type] || ''}</p>`;
    return;
  }
  const level = pr ? (t.type === 'property' ? pr.houses : null) : null;
  const rows = rentRows(t);
  c.innerHTML = `
    <div class="deed-head" style="--gc:${grp.color}">
      <div class="g">${esc(grp.name)}</div>
      <h2>${t.icon || (t.type === 'metro' ? '🚇 ' : '')}${esc(t.name)}</h2>
      <div>Prix ${fmt(t.price)}</div>
    </div>
    <div>${owner ? `Propriétaire : <b style="color:${owner.color}">${owner.token} ${esc(owner.name)}</b>${pr.mortgaged ? ' · <span style="color:var(--warn)">hypothéqué</span>' : ''}` : '<span class="muted">À vendre</span>'}</div>
    <h3>Loyers</h3>
    <table class="rent-table">${rows.map((r, k) => `<tr class="${level === k ? 'on' : ''}"><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>
    ${t.type === 'property' ? `<p class="small muted">Loyer doublé sur terrain nu si tu possèdes tout le quartier. Maison : ${fmt(grp.houseCost)}.</p>` : ''}
    <p class="small muted">Hypothèque : ${fmt(t.price / 2)} · Levée : ${fmt(Math.ceil(t.price / 2 * 1.1))}</p>
    <div class="sheet-actions"></div>`;
  if (mine && g.phase !== 'over') {
    const box = c.querySelector('.sheet-actions');
    const add = (label, a, cls = '') => {
      const b = document.createElement('button');
      b.className = `btn ${cls}`; b.textContent = label; b.onclick = () => act(a, { i });
      box.append(b);
    };
    const fullSet = t.type === 'property' && S.board.tiles.filter((x) => x.group === t.group).every((x) => g.props[x.index]?.owner === pr.owner);
    if (fullSet && !pr.mortgaged && pr.houses < 5) add(pr.houses === 4 ? `🏨 Hôtel (${fmt(grp.houseCost)})` : `🏠 Maison (${fmt(grp.houseCost)})`, 'build', 'primary');
    if (t.type === 'property' && pr.houses > 0) add(`Vendre (+${fmt(grp.houseCost / 2)})`, 'sell');
    if (!pr.mortgaged) add('Hypothéquer', 'mortgage', 'danger');
    else add('Lever l’hypothèque', 'unmortgage', 'ok');
  }
}

function renderAssets(c, g) {
  const m = me();
  const mineIdx = Object.keys(g.props).map(Number).filter((i) => g.props[i].owner === m.id).sort((a, b) => a - b);
  c.innerHTML = `<h2>🏘️ Mes biens</h2>
    <div class="muted">Trésorerie : <b style="color:var(--txt)">${fmt(m.money)}</b>${m.jailCards ? ` · 🎫 ×${m.jailCards}` : ''}</div>
    <h3>${mineIdx.length} titre(s)</h3>
    <div class="prop-list">${mineIdx.length ? mineIdx.map((i) => propItem(g, i)).join('') : '<div class="muted">Rien pour l’instant. Achète des terrains !</div>'}</div>`;
  for (const el of c.querySelectorAll('[data-i]')) el.onclick = () => openSheet('tile', Number(el.dataset.i));
}

function propItem(g, i, checkbox = null) {
  const t = S.board.tiles[i];
  const pr = g.props[i];
  const h = pr.houses === 5 ? '🏨' : '🏠'.repeat(pr.houses);
  return `<div class="prop-item ${checkbox?.checked ? 'sel' : ''}" data-i="${i}" style="--gc:${S.board.groups[t.group].color}">
    <span class="sw"></span>
    <div style="flex:1"><div class="nm">${esc(t.name)}</div><div class="meta">${pr.mortgaged ? 'Hypothéqué' : h || fmt(t.price)}</div></div>
    ${checkbox ? `<input type="checkbox" ${checkbox.checked ? 'checked' : ''} />` : '›'}
  </div>`;
}

function renderTrade(c, g) {
  const m = me();
  const tr = g.trade;
  if (tr) {
    const a = g.players.find((p) => p.id === tr.from);
    const b = g.players.find((p) => p.id === tr.to);
    const side = (s) => [
      ...s.props.map((i) => `<div class="prop-item" style="--gc:${S.board.groups[S.board.tiles[i].group].color}"><span class="sw"></span><div class="nm">${esc(S.board.tiles[i].name)}</div></div>`),
      s.money ? `<div class="prop-item"><div class="nm">💰 ${fmt(s.money)}</div></div>` : '',
      s.jailCards ? `<div class="prop-item"><div class="nm">🎫 Carte prison</div></div>` : '',
    ].join('') || '<div class="muted small">Rien</div>';
    c.innerHTML = `<h2>🤝 Proposition</h2>
      <p>${a.token} <b>${esc(a.name)}</b> → ${b.token} <b>${esc(b.name)}</b></p>
      <div class="trade-cols">
        <div class="trade-col"><div class="lbl">${esc(a.name)} donne</div>${side(tr.offer)}</div>
        <div class="trade-col"><div class="lbl">${esc(b.name)} donne</div>${side(tr.request)}</div>
      </div>
      <div class="sheet-actions"></div>`;
    const box = c.querySelector('.sheet-actions');
    const add = (label, a2, cls) => { const el = document.createElement('button'); el.className = `btn ${cls}`; el.textContent = label; el.onclick = () => act(a2); box.append(el); };
    if (tr.to === m.id) { add('✅ Accepter', 'tradeAccept', 'ok'); add('❌ Refuser', 'tradeDecline', 'danger'); }
    else if (tr.from === m.id) add('Annuler ma proposition', 'tradeDecline', 'danger');
    else box.innerHTML = '<p class="muted small">Un échange est en cours entre ces joueurs.</p>';
    return;
  }
  if (m.bankrupt || g.phase === 'over') { c.innerHTML = '<h2>🤝 Échanger</h2><p class="muted">Indisponible.</p>'; return; }
  const others = g.players.filter((p) => p.id !== m.id && !p.bankrupt);
  if (!S.draft || !others.some((p) => p.id === S.draft.to)) S.draft = { to: others[0]?.id, give: new Set(), get: new Set(), giveMoney: 0, getMoney: 0 };
  const d = S.draft;
  const other = others.find((p) => p.id === d.to);
  const tradable = (pid) => Object.keys(g.props).map(Number).filter((i) => g.props[i].owner === pid && !(S.board.tiles[i].type === 'property' && S.board.tiles.some((t) => t.group === S.board.tiles[i].group && (g.props[t.index]?.houses || 0) > 0)));
  const col = (pid, set) => tradable(pid).map((i) => propItem(g, i, { checked: set.has(i) })).join('') || '<div class="muted small">Aucun titre échangeable</div>';
  c.innerHTML = `<h2>🤝 Proposer un échange</h2>
    <div class="seg">${others.map((p) => `<button data-to="${p.id}" class="${p.id === d.to ? 'sel' : ''}">${p.token} ${esc(p.name)}</button>`).join('')}</div>
    <div class="trade-cols" style="margin-top:12px">
      <div class="trade-col" data-side="give"><div class="lbl">Tu donnes</div>
        <input type="number" inputmode="numeric" min="0" max="${m.money}" placeholder="₭" value="${d.giveMoney || ''}" data-money="giveMoney" />
        ${col(m.id, d.give)}</div>
      <div class="trade-col" data-side="get"><div class="lbl">Tu reçois</div>
        <input type="number" inputmode="numeric" min="0" max="${other?.money || 0}" placeholder="₭" value="${d.getMoney || ''}" data-money="getMoney" />
        ${col(d.to, d.get)}</div>
    </div>
    <div class="sheet-actions"><button class="btn primary big" id="sendTrade">Envoyer la proposition</button></div>`;
  for (const b of c.querySelectorAll('[data-to]')) b.onclick = () => { S.draft = { to: b.dataset.to, give: new Set(), get: new Set(), giveMoney: 0, getMoney: 0 }; renderSheet(); };
  for (const inp of c.querySelectorAll('[data-money]')) inp.oninput = () => { d[inp.dataset.money] = Math.max(0, parseInt(inp.value, 10) || 0); };
  for (const colEl of c.querySelectorAll('[data-side]')) {
    const set = colEl.dataset.side === 'give' ? d.give : d.get;
    for (const it of colEl.querySelectorAll('[data-i]')) it.onclick = () => { const i = Number(it.dataset.i); set.has(i) ? set.delete(i) : set.add(i); renderSheet(); };
  }
  $('#sendTrade').onclick = () => {
    act('trade', { to: d.to, offer: { money: d.giveMoney, props: [...d.give] }, request: { money: d.getMoney, props: [...d.get] } });
    S.draft = null;
  };
}

// --------------------------------------------------------------- effets
function floatReaction(pid, emoji) {
  const p = S.room?.game?.players.find((x) => x.id === pid) || S.room?.members.find((x) => x.id === pid);
  const el = document.createElement('div');
  el.className = 'float-react';
  el.style.left = `${10 + Math.random() * 70}%`;
  el.innerHTML = `${esc(emoji)}<small>${esc(p?.name || '')}</small>`;
  $('#reactions').append(el);
  setTimeout(() => el.remove(), 2300);
}

function celebrate(g) {
  const colors = ['#ff5d8f', '#8a6cff', '#4fd1ff', '#ffd23f', '#2fd08b'];
  for (let k = 0; k < 90; k++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    el.style.left = `${Math.random() * 100}vw`;
    el.style.background = colors[k % colors.length];
    el.style.animationDuration = `${2 + Math.random() * 2.5}s`;
    el.style.animationDelay = `${Math.random() * 0.8}s`;
    document.body.append(el);
    setTimeout(() => el.remove(), 5500);
  }
  if (g.winner === S.session.playerId) vibrate([100, 50, 100, 50, 300]);
}

async function keepAwake() {
  if (S.wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try { S.wakeLock = await navigator.wakeLock.request('screen'); S.wakeLock.onrelease = () => { S.wakeLock = null; }; } catch { /* ignoré */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (S.net && !S.net.connected) S.net.client.reconnect();
    if (S.room?.game) keepAwake();
  }
});

// --------------------------------------------------------------- démarrage
(function boot() {
  initHome();
  if (S.session) $('#conn').classList.remove('hidden'); else show('home');
  connect();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
