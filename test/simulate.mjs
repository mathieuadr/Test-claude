// Joue des parties aléatoires complètes pour vérifier que le moteur ne plante jamais
// et que les invariants sont respectés.
import assert from 'assert';
import { Game, GameError } from '../public/engine/game.js';
import { TILES } from '../public/engine/board.js';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function play(seed) {
  const rng = mulberry32(seed);
  const n = 2 + (seed % 5);
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, token: 'x', color: '#fff' }));
  let g = new Game(players, rng);
  let steps = 0;
  const tryAct = (pid, msg) => {
    try { g.dispatch(pid, msg); return true; } catch (e) { if (!(e instanceof GameError)) throw e; return false; }
  };

  while (g.phase !== 'over' && steps < 6000) {
    steps++;
    // 1) Dettes : le débiteur hypothèque/vend, sinon faillite
    if (g.debts.length) {
      const d = g.debts[0];
      const mine = g.ownedBy(d.playerId);
      let done = false;
      for (const i of mine) if (g.props[i].houses && tryAct(d.playerId, { a: 'sell', i })) { done = true; break; }
      if (!done) for (const i of mine) if (tryAct(d.playerId, { a: 'mortgage', i })) { done = true; break; }
      if (!done) tryAct(d.playerId, { a: 'bankrupt' });
      continue;
    }
    // 2) Échanges aléatoires
    if (g.trade) { tryAct(g.trade.to, { a: rng() < 0.5 ? 'tradeAccept' : 'tradeDecline' }); continue; }
    if (rng() < 0.03) {
      const act = g.active();
      const a = act[Math.floor(rng() * act.length)]; const b = act[Math.floor(rng() * act.length)];
      tryAct(a.id, { a: 'trade', to: b.id, offer: { money: Math.floor(rng() * 100), props: g.ownedBy(a.id).slice(0, 1) }, request: { props: g.ownedBy(b.id).slice(0, 1) } });
      continue;
    }
    const cur = g.cur;
    // 3) Constructions aléatoires
    if (rng() < 0.3) for (const i of g.ownedBy(cur.id)) tryAct(cur.id, { a: rng() < 0.8 ? 'build' : 'unmortgage', i });
    if (g.phase === 'roll' && cur.inJail && rng() < 0.3) tryAct(cur.id, { a: cur.jailCards ? 'jailCard' : 'payJail' });
    if (g.phase === 'roll') tryAct(cur.id, { a: 'roll' });
    else if (g.phase === 'buy') tryAct(cur.id, { a: rng() < 0.85 ? 'buy' : 'pass' }) || tryAct(cur.id, { a: 'pass' });
    else if (g.phase === 'end') tryAct(cur.id, { a: 'end' });

    // Invariants
    for (const pl of g.players) {
      assert(pl.money >= 0, `argent négatif ${pl.name} ${pl.money}`);
      assert(pl.pos >= 0 && pl.pos < 40);
      if (pl.bankrupt) assert.strictEqual(g.ownedBy(pl.id).length, 0, 'un joueur en faillite possède des biens');
    }
    for (const [i, pr] of Object.entries(g.props)) {
      assert(['property', 'metro', 'utility'].includes(TILES[i].type));
      assert(pr.houses >= 0 && pr.houses <= 5);
      if (pr.houses) assert(!pr.mortgaged);
    }
    assert(!g.cur.bankrupt || g.phase === 'over');
    JSON.stringify(g.toJSON());
    if (steps % 97 === 0) { const r = Game.restore(g.snapshot(), rng); assert.deepStrictEqual(r.snapshot(), g.snapshot()); g = r; }
  }
  return { steps, over: g.phase === 'over', turns: g.turnCount };
}

let finished = 0;
const N = Number(process.argv[2]) || 300;
for (let s = 1; s <= N; s++) { if (play(s).over) finished++; }
console.log(`✔ ${N} parties simulées sans erreur — ${finished} terminées par une victoire.`);
