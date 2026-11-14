'use strict';
const { TILES, GROUPS, GROUP_TILES, CHANCE, CHEST } = require('./board');

const START_MONEY = 1500;
const GO_SALARY = 200;
const JAIL_FINE = 50;
const JAIL_POS = 10;

class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

function shuffle(arr, rng) {
  const a = arr.map((_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Game {
  /**
   * @param {{id:string,name:string,token:string,color:string}[]} players
   */
  constructor(players, rng = Math.random) {
    this.rng = rng;
    this.players = players.map((pl) => ({
      id: pl.id, name: pl.name, token: pl.token, color: pl.color,
      money: START_MONEY, pos: 0, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false,
    }));
    // Ordre de jeu aléatoire
    const order = shuffle(this.players, rng);
    this.players = order.map((i) => this.players[i]);
    this.props = {}; // index -> { owner, houses, mortgaged }
    this.turn = 0;
    this.phase = 'roll'; // roll | buy | end | over
    this.dice = [1, 1];
    this.rollSeq = 0;
    this.doubles = 0;
    this.lastRollDoubles = false;
    this.pendingBuy = null;
    this.debts = []; // { playerId, amount, creditor|null }
    this.trade = null;
    this.card = null; // { deck, text, seq }
    this.cardSeq = 0;
    this.decks = { chance: shuffle(CHANCE, rng), chest: shuffle(CHEST, rng) };
    this.jailCardOwners = { chance: null, chest: null };
    this.moves = []; // { playerId, from, to, kind: 'walk'|'jump', seq }
    this.moveSeq = 0;
    this.log = [];
    this.logSeq = 0;
    this.winner = null;
    this.turnCount = 1;
    this.addLog(`La partie commence ! ${this.cur.name} ouvre le bal.`);
  }

  // ---------- helpers ----------
  get cur() { return this.players[this.turn]; }
  player(id) { return this.players.find((x) => x.id === id) || fail('Joueur inconnu'); }
  active() { return this.players.filter((x) => !x.bankrupt); }
  addLog(text) {
    this.log.push({ seq: ++this.logSeq, text });
    if (this.log.length > 80) this.log.shift();
  }
  ownerOf(i) { return this.props[i]?.owner ?? null; }
  ownedBy(id) { return Object.keys(this.props).map(Number).filter((i) => this.props[i].owner === id); }
  hasMonopoly(id, group) { return GROUP_TILES[group].every((i) => this.props[i]?.owner === id); }
  groupHasBuildings(group) { return GROUP_TILES[group].some((i) => (this.props[i]?.houses || 0) > 0); }

  roll() {
    const d = () => 1 + Math.floor(this.rng() * 6);
    this.dice = [d(), d()];
    this.rollSeq++;
    return this.dice;
  }

  move(pl, to, kind = 'walk', collectGo = true) {
    const from = pl.pos;
    if (collectGo && kind === 'walk' && to < from) {
      pl.money += GO_SALARY;
      this.addLog(`${pl.name} passe par le Départ et encaisse ${GO_SALARY} ₭.`);
    }
    pl.pos = to;
    this.moves.push({ playerId: pl.id, from, to, kind, seq: ++this.moveSeq });
    if (this.moves.length > 20) this.moves.shift();
  }

  sendToJail(pl) {
    this.move(pl, JAIL_POS, 'jump', false);
    pl.inJail = true;
    pl.jailTurns = 0;
    this.doubles = 0;
    this.lastRollDoubles = false;
    this.addLog(`🚓 ${pl.name} est envoyé·e en prison.`);
  }

  /** Transfère de l'argent. Si le débiteur ne peut pas payer, une dette est créée. */
  charge(pl, amount, creditorId = null) {
    if (amount <= 0) return;
    const paid = Math.min(Math.max(pl.money, 0), amount);
    pl.money -= paid;
    if (creditorId) this.player(creditorId).money += paid;
    const rest = amount - paid;
    if (rest > 0) {
      this.debts.push({ playerId: pl.id, amount: rest, creditor: creditorId });
      this.addLog(`⚠️ ${pl.name} doit encore ${rest} ₭ — vends ou hypothèque pour payer !`);
    }
  }

  settleDebts() {
    for (const d of this.debts) {
      const pl = this.player(d.playerId);
      const pay = Math.min(pl.money, d.amount);
      if (pay > 0) {
        pl.money -= pay;
        d.amount -= pay;
        if (d.creditor) this.player(d.creditor).money += pay;
      }
    }
    const before = this.debts.length;
    this.debts = this.debts.filter((d) => d.amount > 0);
    if (before && !this.debts.length) this.addLog('Toutes les dettes sont réglées.');
  }

  rentFor(i, diceSum, multiplier = 1) {
    const t = TILES[i];
    const pr = this.props[i];
    if (!pr || pr.mortgaged) return 0;
    if (t.type === 'property') {
      if (pr.houses > 0) return t.rent[pr.houses];
      return t.rent[0] * (this.hasMonopoly(pr.owner, t.group) ? 2 : 1);
    }
    if (t.type === 'metro') {
      const n = GROUP_TILES.metro.filter((j) => this.props[j]?.owner === pr.owner).length;
      return 25 * 2 ** (n - 1) * multiplier;
    }
    if (t.type === 'utility') {
      const n = GROUP_TILES.utility.filter((j) => this.props[j]?.owner === pr.owner).length;
      return diceSum * (n === 2 ? 10 : 4);
    }
    return 0;
  }

  // ---------- résolution d'une case ----------
  land(pl, opts = {}) {
    const t = TILES[pl.pos];
    switch (t.type) {
      case 'property': case 'metro': case 'utility': {
        const owner = this.ownerOf(pl.pos);
        if (owner === null) {
          this.pendingBuy = pl.pos;
          return 'buy';
        }
        if (owner === pl.id) return null;
        const pr = this.props[pl.pos];
        if (pr.mortgaged) { this.addLog(`${t.name} est hypothéqué : pas de loyer.`); return null; }
        const ownerPl = this.player(owner);
        if (ownerPl.bankrupt) return null;
        const sum = this.dice[0] + this.dice[1];
        const rent = this.rentFor(pl.pos, sum, opts.metroDouble ? 2 : 1);
        this.addLog(`${pl.name} paie ${rent} ₭ de loyer à ${ownerPl.name} (${t.name}).`);
        this.charge(pl, rent, owner);
        return null;
      }
      case 'tax':
        this.addLog(`${pl.name} paie ${t.amount} ₭ (${t.name}).`);
        this.charge(pl, t.amount, null);
        return null;
      case 'gotojail':
        this.sendToJail(pl);
        return 'jailed';
      case 'chance': case 'chest':
        return this.drawCard(pl, t.type);
      default:
        return null;
    }
  }

  drawCard(pl, deck) {
    const defs = deck === 'chance' ? CHANCE : CHEST;
    let idx = this.decks[deck].shift();
    // Saute la carte "sortie de prison" si elle est détenue par un joueur
    if (defs[idx].kind === 'jailCard' && this.jailCardOwners[deck]) {
      this.decks[deck].push(idx);
      idx = this.decks[deck].shift();
    }
    const c = defs[idx];
    if (c.kind !== 'jailCard') this.decks[deck].push(idx);
    this.card = { deck, text: c.text, seq: ++this.cardSeq, playerId: pl.id };
    this.addLog(`${deck === 'chance' ? '🎲 Opportunité' : '💎 Fortune'} — ${pl.name} : « ${c.text} »`);

    switch (c.kind) {
      case 'money':
        if (c.amount > 0) pl.money += c.amount; else this.charge(pl, -c.amount, null);
        return null;
      case 'move':
        this.move(pl, c.to, 'walk', true);
        return this.land(pl);
      case 'moveBy': {
        const to = (pl.pos + c.steps + 40) % 40;
        this.move(pl, to, 'jump', false);
        return this.land(pl);
      }
      case 'nearest': {
        let to = pl.pos;
        do { to = (to + 1) % 40; } while (TILES[to].type !== c.target);
        this.move(pl, to, 'walk', true);
        return this.land(pl, { metroDouble: c.target === 'metro' });
      }
      case 'jail':
        this.sendToJail(pl);
        return 'jailed';
      case 'jailCard':
        pl.jailCards++;
        this.jailCardOwners[deck] = pl.id;
        return null;
      case 'payEach':
        for (const o of this.active()) if (o.id !== pl.id) this.charge(pl, c.amount, o.id);
        return null;
      case 'collectEach':
        for (const o of this.active()) if (o.id !== pl.id) this.charge(o, c.amount, pl.id);
        return null;
      case 'repairs': {
        let total = 0;
        for (const i of this.ownedBy(pl.id)) {
          const h = this.props[i].houses;
          total += h === 5 ? c.hotel : h * c.house;
        }
        if (total) { this.addLog(`${pl.name} paie ${total} ₭ de travaux.`); this.charge(pl, total, null); }
        return null;
      }
      default: return null;
    }
  }

  afterResolution(result) {
    if (result === 'buy') { this.phase = 'buy'; return; }
    if (result === 'jailed' || this.cur.inJail || this.cur.bankrupt) { this.phase = 'end'; return; }
    this.phase = this.lastRollDoubles ? 'roll' : 'end';
    if (this.phase === 'roll') this.addLog(`Double ! ${this.cur.name} rejoue.`);
  }

  // ---------- actions ----------
  assertTurn(pid) {
    if (this.phase === 'over') fail('La partie est terminée');
    if (this.cur.id !== pid) fail('Ce n’est pas ton tour');
  }
  assertNoDebt() {
    if (this.debts.length) fail('Des dettes doivent être réglées d’abord');
  }

  actRoll(pid) {
    this.assertTurn(pid);
    if (this.phase !== 'roll') fail('Tu ne peux pas lancer les dés maintenant');
    this.assertNoDebt();
    const pl = this.cur;
    const [a, b] = this.roll();
    const isDouble = a === b;
    this.card = null;

    if (pl.inJail) {
      if (isDouble) {
        pl.inJail = false; pl.jailTurns = 0;
        this.addLog(`${pl.name} fait un double (${a}+${b}) et sort de prison !`);
        this.lastRollDoubles = false; // pas de relance après sortie
      } else {
        pl.jailTurns++;
        if (pl.jailTurns >= 3) {
          this.addLog(`${pl.name} (${a}+${b}) paie ${JAIL_FINE} ₭ et sort de prison.`);
          pl.inJail = false; pl.jailTurns = 0;
          this.charge(pl, JAIL_FINE, null);
          this.lastRollDoubles = false;
        } else {
          this.addLog(`${pl.name} fait ${a}+${b} : reste en prison (essai ${pl.jailTurns}/3).`);
          this.phase = 'end';
          return;
        }
      }
    } else {
      this.lastRollDoubles = isDouble;
      if (isDouble) {
        this.doubles++;
        if (this.doubles >= 3) {
          this.addLog(`${pl.name} fait trois doubles d’affilée !`);
          this.sendToJail(pl);
          this.phase = 'end';
          return;
        }
      }
      this.addLog(`${pl.name} lance ${a}+${b}.`);
    }
    const to = (pl.pos + a + b) % 40;
    this.move(pl, to, 'walk', true);
    this.afterResolution(this.land(pl));
  }

  actBuy(pid) {
    this.assertTurn(pid);
    if (this.phase !== 'buy') fail('Rien à acheter');
    const i = this.pendingBuy;
    const t = TILES[i];
    const pl = this.cur;
    if (pl.money < t.price) fail('Pas assez d’argent');
    pl.money -= t.price;
    this.props[i] = { owner: pl.id, houses: 0, mortgaged: false };
    this.addLog(`🏷️ ${pl.name} achète ${t.name} pour ${t.price} ₭.`);
    this.pendingBuy = null;
    this.afterResolution(null);
  }

  actPass(pid) {
    this.assertTurn(pid);
    if (this.phase !== 'buy') fail('Rien à refuser');
    this.addLog(`${this.cur.name} ne prend pas ${TILES[this.pendingBuy].name}.`);
    this.pendingBuy = null;
    this.afterResolution(null);
  }

  actPayJail(pid) {
    this.assertTurn(pid);
    const pl = this.cur;
    if (!pl.inJail || this.phase !== 'roll') fail('Action impossible');
    if (pl.money < JAIL_FINE) fail('Pas assez d’argent');
    pl.money -= JAIL_FINE;
    pl.inJail = false; pl.jailTurns = 0;
    this.addLog(`${pl.name} paie ${JAIL_FINE} ₭ de caution et sort de prison.`);
  }

  actUseJailCard(pid) {
    this.assertTurn(pid);
    const pl = this.cur;
    if (!pl.inJail || this.phase !== 'roll' || pl.jailCards < 1) fail('Action impossible');
    pl.jailCards--;
    // remet la carte dans son paquet
    for (const deck of ['chance', 'chest']) {
      if (this.jailCardOwners[deck] === pl.id) {
        this.jailCardOwners[deck] = null;
        const defs = deck === 'chance' ? CHANCE : CHEST;
        this.decks[deck].push(defs.findIndex((c) => c.kind === 'jailCard'));
        break;
      }
    }
    pl.inJail = false; pl.jailTurns = 0;
    this.addLog(`${pl.name} utilise sa carte et sort de prison.`);
  }

  actEndTurn(pid) {
    this.assertTurn(pid);
    if (this.phase !== 'end') fail('Termine d’abord ton action');
    this.assertNoDebt();
    this.nextTurn();
  }

  nextTurn() {
    this.doubles = 0;
    this.lastRollDoubles = false;
    this.pendingBuy = null;
    this.card = null;
    if (this.active().length <= 1) return this.finish();
    do { this.turn = (this.turn + 1) % this.players.length; } while (this.cur.bankrupt);
    this.phase = 'roll';
    this.turnCount++;
  }

  finish() {
    const w = this.active()[0];
    this.phase = 'over';
    this.winner = w ? w.id : null;
    if (w) this.addLog(`🏆 ${w.name} remporte la partie !`);
  }

  actBuild(pid, i) {
    const pl = this.player(pid);
    const t = TILES[i]; const pr = this.props[i];
    if (this.phase === 'over') fail('Partie terminée');
    if (!t || t.type !== 'property' || pr?.owner !== pid) fail('Ce terrain ne t’appartient pas');
    if (!this.hasMonopoly(pid, t.group)) fail('Il faut posséder tout le quartier');
    const g = GROUP_TILES[t.group];
    if (g.some((j) => this.props[j].mortgaged)) fail('Un terrain du quartier est hypothéqué');
    if (pr.houses >= 5) fail('Déjà un hôtel');
    if (pr.houses > Math.min(...g.map((j) => this.props[j].houses))) fail('Construis de façon équilibrée dans le quartier');
    const cost = GROUPS[t.group].houseCost;
    if (pl.money < cost) fail('Pas assez d’argent');
    pl.money -= cost;
    pr.houses++;
    this.addLog(`🏠 ${pl.name} construit ${pr.houses === 5 ? 'un hôtel' : 'une maison'} sur ${t.name}.`);
  }

  actSell(pid, i) {
    const pl = this.player(pid);
    const t = TILES[i]; const pr = this.props[i];
    if (!t || t.type !== 'property' || pr?.owner !== pid) fail('Ce terrain ne t’appartient pas');
    if (pr.houses < 1) fail('Aucune construction');
    const g = GROUP_TILES[t.group];
    if (pr.houses < Math.max(...g.map((j) => this.props[j].houses))) fail('Vends de façon équilibrée dans le quartier');
    pr.houses--;
    const refund = GROUPS[t.group].houseCost / 2;
    pl.money += refund;
    this.addLog(`${pl.name} revend une construction sur ${t.name} (+${refund} ₭).`);
    this.settleDebts();
  }

  actMortgage(pid, i) {
    const pl = this.player(pid);
    const t = TILES[i]; const pr = this.props[i];
    if (!t || pr?.owner !== pid) fail('Ce terrain ne t’appartient pas');
    if (pr.mortgaged) fail('Déjà hypothéqué');
    if (t.type === 'property' && this.groupHasBuildings(t.group)) fail('Vends d’abord les constructions du quartier');
    pr.mortgaged = true;
    pl.money += t.price / 2;
    this.addLog(`${pl.name} hypothèque ${t.name} (+${t.price / 2} ₭).`);
    this.settleDebts();
  }

  actUnmortgage(pid, i) {
    const pl = this.player(pid);
    const t = TILES[i]; const pr = this.props[i];
    if (!t || pr?.owner !== pid) fail('Ce terrain ne t’appartient pas');
    if (!pr.mortgaged) fail('Pas hypothéqué');
    const cost = Math.ceil((t.price / 2) * 1.1);
    if (pl.money < cost) fail('Pas assez d’argent');
    pl.money -= cost;
    pr.mortgaged = false;
    this.addLog(`${pl.name} lève l’hypothèque de ${t.name} (-${cost} ₭).`);
  }

  actBankrupt(pid) {
    const pl = this.player(pid);
    if (pl.bankrupt) fail('Déjà en faillite');
    const debt = this.debts.find((d) => d.playerId === pid);
    const creditor = debt?.creditor ? this.player(debt.creditor) : null;
    // Liquidation des constructions
    for (const i of this.ownedBy(pid)) {
      const pr = this.props[i];
      if (pr.houses) { pl.money += (pr.houses * GROUPS[TILES[i].group].houseCost) / 2; pr.houses = 0; }
    }
    if (creditor) {
      creditor.money += Math.max(pl.money, 0);
      creditor.jailCards += pl.jailCards;
      for (const deck of ['chance', 'chest']) if (this.jailCardOwners[deck] === pid) this.jailCardOwners[deck] = creditor.id;
      for (const i of this.ownedBy(pid)) this.props[i].owner = creditor.id;
      this.addLog(`💥 ${pl.name} fait faillite ! ${creditor.name} récupère tous ses biens.`);
    } else {
      for (const i of this.ownedBy(pid)) delete this.props[i];
      for (const deck of ['chance', 'chest']) {
        if (this.jailCardOwners[deck] === pid) {
          this.jailCardOwners[deck] = null;
          const defs = deck === 'chance' ? CHANCE : CHEST;
          this.decks[deck].push(defs.findIndex((c) => c.kind === 'jailCard'));
        }
      }
      this.addLog(`💥 ${pl.name} fait faillite ! Ses biens retournent à la banque.`);
    }
    pl.money = 0; pl.jailCards = 0; pl.bankrupt = true; pl.inJail = false;
    this.debts = this.debts.filter((d) => d.playerId !== pid);
    // Dettes envers ce joueur : annulées
    this.debts = this.debts.filter((d) => d.creditor !== pid);
    if (this.trade && (this.trade.from === pid || this.trade.to === pid)) this.trade = null;
    if (this.active().length <= 1) return this.finish();
    if (this.cur.id === pid) this.nextTurn();
  }

  // ---------- échanges ----------
  validateSide(pid, side) {
    const pl = this.player(pid);
    const money = Math.floor(Number(side.money) || 0);
    if (money < 0 || money > Math.max(pl.money, 0)) fail(`${pl.name} n’a pas assez d’argent`);
    const props = [...new Set((side.props || []).map(Number))];
    for (const i of props) {
      const t = TILES[i];
      if (this.props[i]?.owner !== pid) fail(`${t?.name || 'Terrain'} n’appartient pas à ${pl.name}`);
      if (t.type === 'property' && this.groupHasBuildings(t.group)) fail(`Vends d’abord les constructions du quartier ${GROUPS[t.group].name}`);
    }
    const jailCards = Math.floor(Number(side.jailCards) || 0);
    if (jailCards < 0 || jailCards > pl.jailCards) fail('Carte prison invalide');
    return { money, props, jailCards };
  }

  actProposeTrade(pid, to, offer, request) {
    if (this.phase === 'over') fail('Partie terminée');
    if (this.trade) fail('Un échange est déjà en cours');
    if (pid === to) fail('Échange impossible avec toi-même');
    const a = this.player(pid); const b = this.player(to);
    if (a.bankrupt || b.bankrupt) fail('Joueur éliminé');
    const o = this.validateSide(pid, offer || {});
    const r = this.validateSide(to, request || {});
    if (!o.money && !o.props.length && !r.money && !r.props.length && !o.jailCards && !r.jailCards) fail('Échange vide');
    this.trade = { id: Date.now().toString(36), from: pid, to, offer: o, request: r };
    this.addLog(`🤝 ${a.name} propose un échange à ${b.name}.`);
  }

  actRespondTrade(pid, accept) {
    const tr = this.trade;
    if (!tr) fail('Aucun échange');
    if (accept) {
      if (tr.to !== pid) fail('Cet échange ne t’est pas destiné');
      const o = this.validateSide(tr.from, tr.offer);
      const r = this.validateSide(tr.to, tr.request);
      const a = this.player(tr.from); const b = this.player(tr.to);
      a.money += r.money - o.money; b.money += o.money - r.money;
      a.jailCards += r.jailCards - o.jailCards; b.jailCards += o.jailCards - r.jailCards;
      for (const deck of ['chance', 'chest']) {
        if (o.jailCards && this.jailCardOwners[deck] === a.id && a.jailCards === 0) this.jailCardOwners[deck] = b.id;
        if (r.jailCards && this.jailCardOwners[deck] === b.id && b.jailCards === 0) this.jailCardOwners[deck] = a.id;
      }
      for (const i of o.props) this.props[i].owner = b.id;
      for (const i of r.props) this.props[i].owner = a.id;
      this.addLog(`✅ ${b.name} accepte l’échange avec ${a.name}.`);
      this.trade = null;
      this.settleDebts();
    } else {
      if (tr.to !== pid && tr.from !== pid) fail('Action impossible');
      this.addLog(tr.from === pid ? `${this.player(pid).name} annule sa proposition.` : `❌ ${this.player(pid).name} refuse l’échange.`);
      this.trade = null;
    }
  }

  /** Point d'entrée unique pour les actions client */
  dispatch(pid, msg) {
    switch (msg.a) {
      case 'roll': return this.actRoll(pid);
      case 'buy': return this.actBuy(pid);
      case 'pass': return this.actPass(pid);
      case 'payJail': return this.actPayJail(pid);
      case 'jailCard': return this.actUseJailCard(pid);
      case 'end': return this.actEndTurn(pid);
      case 'build': return this.actBuild(pid, Number(msg.i));
      case 'sell': return this.actSell(pid, Number(msg.i));
      case 'mortgage': return this.actMortgage(pid, Number(msg.i));
      case 'unmortgage': return this.actUnmortgage(pid, Number(msg.i));
      case 'bankrupt': return this.actBankrupt(pid);
      case 'trade': return this.actProposeTrade(pid, msg.to, msg.offer, msg.request);
      case 'tradeAccept': return this.actRespondTrade(pid, true);
      case 'tradeDecline': return this.actRespondTrade(pid, false);
      default: fail('Action inconnue');
    }
  }

  toJSON() {
    return {
      players: this.players, props: this.props, turn: this.turn, currentId: this.cur.id,
      phase: this.phase, dice: this.dice, lastRollDoubles: this.lastRollDoubles, rollSeq: this.rollSeq, pendingBuy: this.pendingBuy,
      debts: this.debts, trade: this.trade, card: this.card, moves: this.moves,
      log: this.log.slice(-40), winner: this.winner, turnCount: this.turnCount,
    };
  }
}

module.exports = { Game, GameError, START_MONEY };
