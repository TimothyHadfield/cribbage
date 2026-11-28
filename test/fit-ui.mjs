// Fit pass (2026-11-27): can you see everything, at a readable size, without scrolling?
//   node test/fit-ui.mjs <baseUrl> [outDir]
// Builds real engine states in the page (Local.resume), crowded and normal, and measures
// them at 393x659, 320x568, 659x393 (WebKit iPhone) and 1280x800, 1440x900 (Chrome):
//   - no page scroll either way, no console errors, key things inside the viewport
//   - numbers that matter >= 12 px (scores, the count, show points); card ranks >= 10 px
//     (>= 12 px for your hand, the pegging pile, the starter and the counted cards)
//   - overlapped cards leave a strip at least as wide as the rank, so every card stays readable
//   - tap targets (your cards, the action buttons) >= 36 px
//   - the peg board >= 46 px tall on phones (>= 120 px on laptops)
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const pw = require(path.join(os.homedir(), '.claude/tools/node_modules/playwright'));
const base = process.argv[2] || 'http://127.0.0.1:8751/';
const out = process.argv[3] || null;
if (out) fs.mkdirSync(out, { recursive: true });

const SIZES = [
  { tag: '393', engine: 'webkit', w: 393, h: 659, phone: true, band: 40 },
  { tag: '390t', engine: 'webkit', w: 390, h: 844, phone: true, band: 40 },
  // the biggest phone: the cards hit their width limits, so the spare felt is spread a bit thinner than 40
  { tag: '430t', engine: 'webkit', w: 430, h: 932, phone: true, band: 50 },
  { tag: '320', engine: 'webkit', w: 320, h: 568, phone: true },
  { tag: '659', engine: 'webkit', w: 659, h: 393, phone: true },
  { tag: '1280', engine: 'chromium', w: 1280, h: 800, phone: false },
  { tag: '1440', engine: 'chromium', w: 1440, h: 900, phone: false },
  { tag: '1280s', engine: 'chromium', w: 1280, h: 720, phone: false },
];

// ---- states, built in the page from the real engine ----
const build = (kind) => {
  const E = window.Engine, S = window.Score;
  const long = kind.endsWith('-long');
  const names = long ? ['Christopher Johnson', 'Alexandria Wellingt'] : ['You', 'Computer'];
  const rng = (() => { let a = 7; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const s = E.initGame([{ uid: 'you', name: names[0] }, { uid: 'cpu', name: names[1] }], rng, {});
  const used = new Set();
  const take = (cards) => { cards.forEach((c) => used.add(c)); return cards; };
  const rest = () => S.fullDeck().filter((c) => !used.has(c));
  if (kind.startsWith('discard')) {
    if (long) { s.scores = [112, 118]; s.prevScores = [104, 109]; s.handNumber = 14; s.dealer = 0; }
    return s;
  }
  // after the throw: kept fours, the crib, a starter
  s.scores = long ? [96, 117] : [38, 45]; s.prevScores = long ? [88, 110] : [31, 39]; s.handNumber = long ? 12 : 5;
  if (kind.startsWith('peg')) {
    // you: A♠ 2♠ 3♠ A♥ · computer: A♦ 2♥ 3♥ 2♦ · a long run of low cards on the table
    s.dealer = 1;
    const me = take([0, 1, 2, 13]), cpu = take([26, 14, 15, 27]);
    s.dealt = [me.slice(), cpu.slice()];
    s.crib = take([12, 25, 38, 51]);
    s.starter = take([9])[0];
    s.deck = rest();
    s.phase = 'pegging';
    const seven = kind.startsWith('peg7');
    const seqMe = seven ? [0, 1, 2, 13] : [0, 1, 2], seqCpu = [26, 14, 15];
    const seq = [];
    for (let i = 0; i < 4; i++) { if (seqMe[i] != null) seq.push(seqMe[i]); if (seqCpu[i] != null) seq.push(seqCpu[i]); }
    s.peg = { turn: seven ? 1 : 0, seq, played: [seqMe.slice(), seqCpu.slice()], lastPlayer: seven ? 0 : 1 };
    s.hands = [me.filter((c) => !seqMe.includes(c)), cpu.filter((c) => !seqCpu.includes(c))];
    return s;
  }
  if (kind.startsWith('show')) {
    // a 29 hand: 5♠ 5♥ 5♦ J♣ + 5♣ (the longest breakdown there is)
    s.dealer = 1;
    const me = take([4, 17, 30, 49]), cpu = take([8, 21, 22, 36]);
    s.dealt = [me, cpu]; s.hands = [[], []];
    s.crib = take([0, 13, 1, 14]); s.starter = take([43])[0]; s.deck = rest();
    s.phase = 'show';
    const r = S.scoreHand(me, s.starter, { isCrib: false });
    s.show = { step: 0, items: r.items, points: r.points, who: 0, label: 'hand', cards: me.slice(), claim: null, pending: false };
    s.scores = long ? [96 + 29, 117].map((x) => Math.min(x, 120)) : [38 + 29, 45];
    s.prevScores = long ? [96, 110] : [38, 39];
    s.peg = { turn: 0, seq: [], played: [me.slice(), cpu.slice()], lastPlayer: 1 };
    return s;
  }
  if (kind.startsWith('over')) {
    s.dealer = 1;
    const me = take([4, 17, 30, 49]), cpu = take([8, 21, 22, 36]);
    s.dealt = [me, cpu]; s.hands = [[], []];
    s.crib = take([0, 13, 1, 14]); s.starter = take([43])[0]; s.deck = rest();
    s.phase = 'gameover'; s.winner = 0; s.scores = [121, 84]; s.prevScores = [100, 80]; s.skunk = 1;
    s.peg = { turn: 0, seq: [], played: [me.slice(), cpu.slice()], lastPlayer: 1 };
    return s;
  }
  throw new Error('no state ' + kind);
};

const STATES = ['discard', 'discard-long', 'peg6', 'peg7-long', 'show', 'show-long', 'over-long'];

const measure = () => {
  const r = (el) => el && el.getBoundingClientRect();
  const fs = (el) => el ? parseFloat(getComputedStyle(el).fontSize) : null;
  const vis = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
  const W = innerWidth, H = innerHeight;
  const m = { W, H, scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, bodySH: document.body.scrollHeight, items: [] };
  const add = (name, el, extra) => {
    if (!vis(el)) return;
    const b = r(el);
    m.items.push(Object.assign({ name, top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }, extra || {}));
  };
  // card rank size + the strip each overlapped card leaves visible
  const cards = (name, box, minRank) => {
    if (!vis(box)) return;
    const els = Array.from(box.querySelectorAll('.tbl-card')).filter(vis);
    els.forEach((c, i) => {
      const idx = c.querySelector('.tbl-idx');
      if (!idx) return;   // a card back
      const b = r(c), nx = els[i + 1] && r(els[i + 1]);
      const strip = nx ? Math.max(0, Math.min(b.width, nx.left - b.left)) : b.width;
      const ib = r(idx);
      add(`${name}[${i}]`, c, { rank: +fs(idx).toFixed(1), minRank, strip: Math.round(strip), rankW: Math.round(ib.width) });
    });
  };
  for (const n of document.querySelectorAll('#scores .sc')) {
    const nm = n.querySelector('.nm');
    add('score-pts', n.querySelector('.pts'), { font: fs(n.querySelector('.pts')), minFont: 12 });
    add('score-name', nm, { font: fs(nm), minFont: 11, cut: nm.scrollWidth > nm.clientWidth + 1 });
  }
  add('pegboard', document.querySelector('#pegboard svg'));
  add('opp-name', document.querySelector('#opp-label'), { font: fs(document.querySelector('#opp-label')), minFont: 11, cut: document.querySelector('#opp-label').scrollWidth > document.querySelector('#opp-label').clientWidth + 1 });
  cards('opp', document.querySelector('#opp-hand'), 10);
  cards('crib', document.querySelector('#crib-slot'), 10);
  cards('starter', document.querySelector('#starter-slot'), 12);
  add('count', document.querySelector('#count-big'), { font: fs(document.querySelector('#count-big')), minFont: 12 });
  cards('seq', document.querySelector('#seq'), 12);
  cards('hand', document.querySelector('#your-hand'), 12);
  cards('counted', document.querySelector('#count-view .counted'), 12);
  // the breakdown may scroll inside itself on a narrow phone; its lines are checked for size and cuts only
  for (const it of document.querySelectorAll('#count-view .bd-item')) add('bd-item', it, { inner: true, font: fs(it.querySelector('.p')), minFont: 12, cut: it.scrollWidth > it.clientWidth + 1 || it.querySelector('.cs').getBoundingClientRect().right > it.getBoundingClientRect().right + 1 });
  const bd = document.querySelector('#count-view .bd');
  if (vis(bd)) add('bd', bd, { scrolls: bd.scrollHeight > bd.clientHeight + 1 });
  add('bd-total', document.querySelector('#count-view .bd-total'), { inner: true, font: fs(document.querySelector('#count-view .bd-total')), minFont: 12 });
  // the two score boxes must not run into each other
  const sc = Array.from(document.querySelectorAll('#scores .sc')).map((n) => {
    const parts = Array.from(n.children).filter((c) => c.textContent).map((c) => c.getBoundingClientRect());
    return parts;
  });
  // the big blocks must not cover each other
  const blocks = [['scores', '#scores'], ['board', '#pegboard svg'], ['opp-row', '.opp-row'], ['mid', '#mid'], ['count-view', '#count-view'], ['prompt-row', '.prompt-row'], ['hand', '#your-hand']]
    .map(([k, sel]) => [k, document.querySelector(sel)]).filter(([, el]) => vis(el)).map(([k, el]) => [k, r(el)]);
  m.blockOverlap = [];
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const [ka, a] = blocks[i], [kb, b] = blocks[j];
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > 2 && oy > 2) m.blockOverlap.push(`${ka}/${kb} ${Math.round(ox)}x${Math.round(oy)}`);
  }
  // round 2: the tallest empty band of felt between the things on it (top to bottom)
  const felt = document.querySelector('#felt'), fr = r(felt);
  const inFelt = (b) => b.left >= fr.left - 1 && b.right <= fr.right + 1 && b.height > 0;
  const parts = [];
  const push = (el) => { if (vis(el)) { const b = r(el); if (inFelt(b)) parts.push(b); } };
  push(document.querySelector('.opp-row')); push(document.querySelector('#mid'));
  push(document.querySelector('#count-view .counted')); push(document.querySelector('#count-view .bd'));
  push(document.querySelector('#banner-slot .banner')); push(document.querySelector('#prompt'));
  const acts = document.querySelector('#actions'); if (acts && acts.children.length) push(acts);
  push(document.querySelector('.hand-head'));
  for (const c of document.querySelectorAll('#your-hand .tbl-card')) push(c);
  parts.sort((a, b) => a.top - b.top);
  let reach = fr.top + parseFloat(getComputedStyle(felt).paddingTop), band = 0, where = '';
  for (const b of parts) { if (b.top - reach > band) { band = b.top - reach; where = `at y=${Math.round(reach)}`; } reach = Math.max(reach, b.bottom); }
  const tail = Math.min(fr.bottom, innerHeight) - reach;
  if (tail > band) { band = tail; where = 'at the bottom'; }
  m.band = Math.round(band); m.bandWhere = where;
  m.scoreOverlap = sc.length === 2 && sc[0].some((a) => sc[1].some((b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
  add('prompt', document.querySelector('#prompt'));
  for (const b of document.querySelectorAll('#actions .btn')) add('btn:' + b.textContent.trim().slice(0, 14), b, { tap: true });
  add('banner', document.querySelector('#banner-slot .banner'));
  return m;
};

let fails = 0;
const fail = (msg) => { fails++; console.log('  FAIL ' + msg); };
const browsers = {};
for (const size of SIZES.filter((s) => !process.env.FIT_ONLY || process.env.FIT_ONLY.split(',').includes(s.tag))) {
  const br = browsers[size.engine] || (browsers[size.engine] = await pw[size.engine].launch({ headless: true }));
  const opts = size.phone && size.engine === 'webkit'
    ? { ...pw.devices['iPhone 15'], viewport: { width: size.w, height: size.h }, screen: { width: Math.max(size.w, size.h), height: Math.max(size.w, size.h) } }
    : { viewport: { width: size.w, height: size.h } };
  const ctx = await br.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
  await page.goto(base, { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.setItem('fx.settings', JSON.stringify({ anim: false })); } catch (e) {} });
  for (const st of STATES) {
    await page.evaluate(([src, kind]) => {
      const build = eval('(' + src + ')');
      const L = window.Local;
      L.pace = { discard: 1e9, cut: 1e9, play: 1e9 };
      window.App.newGame({ level: 'medium', yourName: 'You', cpuName: 'Computer' });
      L.stop();
      const state = build(kind);
      L.resume({ v: 1, state: state.phase === 'gameover' ? Object.assign({}, state, { winner: null, phase: 'show' }) : state, level: 'medium', seed: 1, history: [], undos: 0 });
      if (state.phase === 'gameover') {
        // gameover can't be resumed; publish it straight to the app (the finale hold is skipped: prev = it)
        const E = window.Engine;
        const d = { mode: 'local', seat: 0, pub: E.publicView(state), priv: E.privateView(state, 'you'), thinking: false, level: 'medium', canUndo: false };
        document.dispatchEvent(new CustomEvent('game:state', { detail: d }));
        document.dispatchEvent(new CustomEvent('game:state', { detail: d }));
      }
    }, [build.toString(), st]);
    await page.waitForTimeout(st.startsWith('over') ? 6500 : 1200);
    const m = await page.evaluate(measure);
    const tag = `${size.tag} ${st}`;
    if (out) await page.screenshot({ path: path.join(out, `${size.tag}-${st}.png`) });
    if (m.scrollW > m.W + 1) fail(`${tag}: sideways page scroll ${m.scrollW} > ${m.W}`);
    if (m.scrollH > m.H + 1) fail(`${tag}: page scroll ${m.scrollH} > ${m.H}`);
    if (m.scoreOverlap) fail(`${tag}: the two scores overlap`);
    for (const o of m.blockOverlap) fail(`${tag}: overlap ${o}`);
    // round 2: no big empty band of felt on portrait phones (use the height for bigger cards instead)
    if (size.band && m.band > size.band) fail(`${tag}: empty felt band ${m.band}px ${m.bandWhere} (> ${size.band})`);
    const minBoard = size.phone ? 46 : 120;
    const summary = {};
    for (const it of m.items) {
      if (!it.inner && (it.bottom > m.H + 1 || it.right > m.W + 1 || it.left < -1 || it.top < -1)) fail(`${tag}: ${it.name} off screen (${it.left},${it.top})-(${it.right},${it.bottom})`);
      if (it.minFont && it.font < it.minFont) fail(`${tag}: ${it.name} ${it.font}px < ${it.minFont}`);
      // a long name may end in "…" if at least ~8 letters still show
      if (it.cut && (!/name/.test(it.name) || it.w < 60)) fail(`${tag}: ${it.name} cut off (${it.w}px shown)`);
      // where the felt is wide enough the whole count shows at once
      if (it.name === 'bd' && it.scrolls && it.w >= 340 && m.H >= 600) fail(`${tag}: the count breakdown scrolls (${it.h}px tall, ${it.w}px wide)`);
      if (it.minRank && it.rank < it.minRank) fail(`${tag}: ${it.name} rank ${it.rank}px < ${it.minRank}`);
      if (it.minRank && it.strip < it.rankW) fail(`${tag}: ${it.name} strip ${it.strip}px hides its rank (${it.rankW}px)`);
      if (it.tap && it.h < 36) fail(`${tag}: ${it.name} tap ${it.h}px < 36`);
      if (it.name === 'pegboard' && it.h < minBoard) fail(`${tag}: peg board ${it.h}px tall < ${minBoard}`);
      if (/^hand\[/.test(it.name) && it.h < 36) fail(`${tag}: ${it.name} tap ${it.h}px < 36`);
      const k = it.name.replace(/\[\d+\]$/, '');
      if (it.rank != null) summary[k] = Math.min(summary[k] ?? 99, it.rank);
      if (k === 'pegboard') summary.board = it.h;
      if (k === 'count') summary.count = it.font;
    }
    console.log(`${tag}: ranks ${JSON.stringify(summary)} band ${m.band} page ${m.scrollW}x${m.scrollH}`);
  }
  for (const e of errors) fail(`${size.tag}: ${e}`);
  await ctx.close();
}
for (const b of Object.values(browsers)) await b.close();
console.log(fails ? `${fails} FAIL` : 'fit-ui: all passed');
process.exit(fails ? 1 : 0);
