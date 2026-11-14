// Test de bout en bout : 3 téléphones jouent une partie (nécessite Playwright).
const { chromium, devices } = require('playwright');
const URL = process.env.URL || 'http://localhost:8099';
const OUT = process.env.OUT || '.';
(async () => {
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
  await a.click('#btnCreate');
  await a.waitForSelector('#lobby:not(.hidden)');
  const code = (await a.textContent('#roomCode')).trim();
  for (const p of [b, c]) { await p.fill('#code', code); await p.click('#btnJoin'); await p.waitForSelector('#lobby:not(.hidden)'); }
  await a.waitForFunction(() => document.querySelectorAll('#lobbyPlayers li').length === 3);
  await a.screenshot({ path: `${OUT}/lobby.png` });
  await a.click('#btnStart');
  for (const p of [a, b, c]) await p.waitForSelector('#game:not(.hidden) #t39');

  // Joue ~30 actions : chacun clique sur l'action principale quand c'est son tour
  const pages = [a, b, c];
  for (let k = 0; k < 45; k++) {
    for (const p of pages) {
      const btn = await p.$('#actions .btn.primary:not([disabled])');
      if (btn) { await btn.click(); await p.waitForTimeout(150); }
      const txt = await p.textContent('#actions');
      if (txt.includes('Passer') && !(await p.$('#actions .btn.primary:not([disabled])'))) await p.click('text=Passer');
      if (txt.includes('Faillite')) await p.click('text=Faillite');
    }
  }
  await a.waitForTimeout(2500);
  await a.screenshot({ path: `${OUT}/game.png` });
  await a.click('[data-tab=assets]'); await a.waitForTimeout(400);
  await a.screenshot({ path: `${OUT}/assets.png` });
  const first = await a.$('#sheetContent [data-i]');
  if (first) { await first.click(); await a.waitForTimeout(400); await a.screenshot({ path: `${OUT}/deed.png` }); }
  await a.click('.sheet-x');
  await a.click('[data-tab=trade]'); await a.waitForTimeout(400);
  await a.screenshot({ path: `${OUT}/trade.png` });

  // Reconnexion : recharge la page de B, il doit revenir dans la partie
  await b.reload();
  await b.waitForSelector('#game:not(.hidden) #t39', { timeout: 5000 });
  const log = await a.$$eval('#centerMsg', (e) => e[0].textContent);
  console.log('Dernier événement :', log);
  console.log(errors.length ? 'ERREURS JS:\n' + errors.join('\n') : '✔ aucune erreur JS côté client, reconnexion OK');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
