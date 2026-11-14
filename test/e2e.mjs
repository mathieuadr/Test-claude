// Test de bout en bout : 3 téléphones jouent ; l'hôte ferme l'app en pleine partie
// et un autre joueur doit reprendre automatiquement.
// Usage : npm start (dans un autre terminal) puis npm run e2e
// Contre le site déployé : URL="https://…/Test-claude/" npm run e2e
import { createRequire } from 'module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const URL = process.env.URL || 'http://localhost:8099/Test-claude/?broker=ws://localhost:8883';
const OUT = process.env.OUT || '.';
const browser = await chromium.launch();
const errors = [];
const phone = async (name) => {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  await page.fill('#name', name);
  return page;
};
const a = await phone('Camille'); const b = await phone('Noé'); const c = await phone('Inès');
await a.waitForFunction(() => window.navigator.onLine);
await a.waitForTimeout(1500);
await a.click('#btnCreate');
await a.waitForSelector('#lobby:not(.hidden)');
const code = (await a.textContent('#roomCode')).trim();
console.log('Salle', code);
for (const p of [b, c]) { await p.fill('#code', code); await p.click('#btnJoin'); await p.waitForSelector('#lobby:not(.hidden)', { timeout: 20000 }); }
await a.waitForFunction(() => document.querySelectorAll('#lobbyPlayers li').length === 3);
await a.screenshot({ path: `${OUT}/lobby.png` });
await a.click('#btnStart');
for (const p of [a, b, c]) await p.waitForSelector('#game:not(.hidden) #t39', { timeout: 20000 });

async function play(pages, rounds) {
  for (let k = 0; k < rounds; k++) {
    for (const p of pages) {
      const btn = await p.$('#actions .btn.primary:not([disabled])');
      if (btn) { await btn.click().catch(() => {}); await p.waitForTimeout(250); }
      const txt = await p.textContent('#actions');
      if (txt.includes('Passer') && !(await p.$('#actions .btn.primary:not([disabled])'))) await p.click('text=Passer').catch(() => {});
      if (txt.includes('Faillite')) await p.click('text=Faillite').catch(() => {});
    }
  }
}
await play([a, b, c], 25);
await a.waitForTimeout(2000);
await a.screenshot({ path: `${OUT}/game.png` });
const turnsBefore = await b.evaluate(() => document.querySelector('#game .pchip.cur')?.textContent);

// Rechargement d'un invité : il revient dans la partie
await c.reload();
await c.waitForSelector('#game:not(.hidden) #t39', { timeout: 20000 });
console.log('✔ rechargement invité OK');

// L'hôte ferme l'app : un autre doit prendre le relais
await a.context().close();
console.log('… hôte parti, attente de la reprise');
await b.waitForTimeout(20000);
const before = await b.evaluate(() => document.querySelector('#feed')?.textContent + document.querySelector('#centerMsg').textContent);
await play([b, c], 15);
await b.waitForTimeout(1500);
const after = await b.evaluate(() => document.querySelector('#feed')?.textContent + document.querySelector('#centerMsg').textContent);
await b.screenshot({ path: `${OUT}/takeover.png` });
const progressed = before !== after;
console.log(progressed ? '✔ la partie continue après le départ de l’hôte' : '✘ partie bloquée après le départ de l’hôte');
console.log(errors.length ? 'ERREURS JS:\n' + errors.join('\n') : '✔ aucune erreur JS');
await browser.close();
process.exit(errors.length || !progressed ? 1 : 0);
