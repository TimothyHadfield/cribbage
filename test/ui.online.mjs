// Two phones, one online room, against the real free Firebase project (th-board-games):
//   node test/ui.online.mjs <baseUrl> [outDir]
// Host makes a room, the friend joins by code, both play a whole game to 121 by tapping the real
// cards and buttons (which cards: the Medium computer's choice from that phone's own view).
// The friend reloads once mid-game and must land back in it. Fails on console/page errors,
// a phone holding the other phone's cards, scores that differ, or no finish.
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const pw = require(path.join(os.homedir(), '.claude/tools/node_modules/playwright'));
const base = process.argv[2] || 'http://127.0.0.1:18500/';
const out = process.argv[3] || '.';
const errors = [];
const browser = await pw.webkit.launch({ headless: true });
async function open(tag) {
  const ctx = await browser.newContext({ ...pw.devices['iPhone 15'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { if (!/firestore\.googleapis\.com.*channel/.test(e.message)) errors.push(tag + ' pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ' console: ' + m.text()); });
  page.on('requestfailed', (r) => { const u = r.url(); if (!/firestore\.googleapis\.com.*(Listen|Write)\/channel/.test(u)) errors.push(tag + ' failed: ' + u); });
  await page.goto(base, { waitUntil: 'load' });
  return page;
}
const driver = () => {
  window.__drv = { taps: 0, over: false, leak: null };
  setInterval(() => {
    const c = window.App.current; if (!c || c.mode !== 'online') return;
    const { pub, priv, seat } = c;
    // this phone must never hold the other seat's unplayed cards
    if (priv.seat !== seat) window.__drv.leak = 'private view for the wrong seat';
    if (pub.phase === 'gameover') { window.__drv.over = true; return; }
    if (window.__drv.wait && Date.now() < window.__drv.wait) return;
    window.__drv.wait = Date.now() + 400;
    const G = window.CribOnline.game, primary = () => document.querySelector('#actions .btn.primary:not(:disabled)');
    const tapCard = (n) => { const el = document.querySelector(`#your-hand .tbl-card[data-card="${n}"]`); if (el) { el.click(); return true; } return false; };
    if (pub.phase === 'discard' && priv.dealt.length === 0) {
      const sel = document.querySelectorAll('#your-hand .tbl-card.selected, #your-hand .tbl-card.sel, #your-hand .tbl-card[aria-pressed="true"]').length;
      const b = primary();
      if (b && /Throw these/.test(b.textContent)) { b.click(); window.__drv.taps++; return; }
      if (!window.__drv.pick || window.__drv.pickHand !== pub.handNumber) { window.__drv.pick = G.bot({ pub, mine: priv }, seat, Math.random).cards; window.__drv.pickHand = pub.handNumber; window.__drv.k = 0; }
      if (window.__drv.k < 2) { tapCard(window.__drv.pick[window.__drv.k++]); window.__drv.taps++; }
      return;
    }
    if (pub.phase === 'cut' && pub.dealer !== seat) { const b = primary(); if (b) { b.click(); window.__drv.taps++; } return; }
    if (pub.phase === 'pegging' && pub.pegTurn === seat) { const a = G.bot({ pub, mine: priv }, seat, Math.random); if (tapCard(a.card)) window.__drv.taps++; return; }
    if (pub.phase === 'show' && Math.random() < 0.5) { const b = primary(); if (b) { b.click(); window.__drv.taps++; } }
  }, 150);
};
const host = await open('host');
const friend = await open('friend');
const t0 = Date.now();
let code = '';
try {
  await host.click('#btn-online');
  await host.fill('#net-name', 'Tim');
  await host.click('#net-create');
  await host.waitForSelector('.net-code', { timeout: 30000 });
  code = (await host.textContent('.net-code')).trim();
  console.log('room', code);
  await friend.click('#btn-online');
  await friend.fill('#net-name', 'Sam');
  await friend.fill('#net-code', code.toLowerCase());
  await friend.click('#net-join');
  await friend.waitForSelector('.net-code', { timeout: 30000 });
  await host.waitForFunction(() => window.Net.snap && window.Net.snap.seats.filter((s) => s.kind === 'human').length === 2, null, { timeout: 30000 });
  await host.waitForTimeout(500);
  await host.screenshot({ path: path.join(out, 'online-lobby-host.png') });
  await friend.screenshot({ path: path.join(out, 'online-lobby-friend.png') });
  await host.click('.sheet .btn.primary');
  await friend.waitForFunction(() => window.App.current && window.App.current.mode === 'online', null, { timeout: 30000 });
  await host.evaluate(driver); await friend.evaluate(driver);
  let shot = false, reloaded = false;
  while (Date.now() - t0 < 25 * 60000) {
    await host.waitForTimeout(2500);
    const [h, f] = [await host.evaluate(() => window.__drv), await friend.evaluate(() => window.__drv)];
    if (!shot && h.taps + f.taps > 12) { shot = true; await host.screenshot({ path: path.join(out, 'online-game-host.png') }); await friend.screenshot({ path: path.join(out, 'online-game-friend.png') }); }
    if (!reloaded && h.taps + f.taps > 30) {
      reloaded = true;
      await friend.reload({ waitUntil: 'load' });
      try { await friend.waitForFunction(() => window.App.current && window.App.current.mode === 'online', null, { timeout: 30000 }); await friend.evaluate(driver); console.log('friend back after reload'); }
      catch (e) { errors.push('friend did not come back after reload'); break; }
    }
    if (h.over && f.over) break;
  }
  const [h, f] = [await host.evaluate(() => window.__drv), await friend.evaluate(() => window.__drv)];
  if (h.leak || f.leak) errors.push('leak: ' + (h.leak || f.leak));
  if (!(h.over && f.over)) errors.push('game did not finish on both phones');
  const sc = async (p) => p.evaluate(() => { const c = window.App.current; return c && [c.pub.scores[c.seat], c.pub.scores[1 - c.seat]]; });
  const [hs, fs] = [await sc(host), await sc(friend)];
  if (!hs || !fs || hs[0] !== fs[1] || hs[1] !== fs[0]) errors.push('scores differ: host ' + hs + ' friend ' + fs);
  await host.waitForTimeout(1500);
  await host.screenshot({ path: path.join(out, 'online-over-host.png') });
  await friend.screenshot({ path: path.join(out, 'online-over-friend.png') });
  console.log(JSON.stringify({ code, hostTaps: h.taps, friendTaps: f.taps, scores: hs, minutes: +((Date.now() - t0) / 60000).toFixed(1) }));
  await friend.evaluate(() => window.Net.leave()).catch(() => {});
  await host.evaluate(() => window.Net.leave()).catch(() => {});
  await host.waitForTimeout(1500);
} catch (e) { errors.push('run: ' + String(e).slice(0, 300)); }
await browser.close();
console.log(JSON.stringify({ errors }, null, 1));
if (errors.length) process.exit(1);
