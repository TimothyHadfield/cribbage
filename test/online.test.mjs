// Cribbage through the shared online kit (js/game-online.js = _online/online.js, unchanged):
// the adapter (js/crib-online.js) plays whole games, keeps hands secret, and a local room finishes.
//     node test/online.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.Score = require('../js/score.js');
globalThis.CribEV = require('../js/crib-ev.js');
globalThis.Engine = require('../js/engine.js');
globalThis.AI = require('../js/ai.js');
const { game } = require('../js/crib-online.js');
const { createLocal } = await import('../js/game-online.js');

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const copy = (s) => JSON.parse(JSON.stringify(s));

function playOut(seed, kinds) {
  const rng = mulberry(seed);
  let s = game.setup(2, { level: 'medium' }, rng, kinds.map((k, i) => ({ kind: k, name: 'P' + i })));
  let moves = 0;
  while (!game.isOver(s)) {
    const who = game.toAct(s);
    assert.ok(who.length >= 1, 'someone must be able to act in ' + s.phase);
    const seat = who[0];
    const ctx = { pub: game.publicView(s), mine: game.privateView(s, seat), state: s };
    s = game.apply(copy(s), seat, game.bot(ctx, seat, rng), rng);
    assert.deepStrictEqual(copy(s), s);
    assert.ok(++moves < 5000);
  }
  return { s, moves };
}

test('whole games: bot moves always legal, someone always to act, JSON-safe', () => {
  for (let g = 0; g < 40; g++) {
    const { s } = playOut(g + 1, g % 2 ? ['human', 'human'] : ['human', 'computer']);
    assert.ok(s.winner === 0 || s.winner === 1);
    assert.strictEqual(Math.max(...s.scores), 121);
  }
});

test('turns: discard is simultaneous, cut and pegging are one seat, a computer never steps the show', () => {
  const rng = mulberry(9);
  let s = game.setup(2, {}, rng, [{ kind: 'human' }, { kind: 'computer' }]);
  assert.deepStrictEqual(game.toAct(s), [0, 1]);
  s = game.apply(s, 0, game.bot({ pub: game.publicView(s), mine: game.privateView(s, 0), state: s }, 0, rng), rng);
  assert.deepStrictEqual(game.toAct(s), [1]);
  while (s.phase !== 'show') { const seat = game.toAct(s)[0]; s = game.apply(s, seat, game.bot({ pub: game.publicView(s), mine: game.privateView(s, seat), state: s }, seat, rng), rng); }
  assert.deepStrictEqual(game.toAct(s), [0], 'the person steps the count, not the computer');
});

test('the show: two "Continue" taps for the same step move it on once', () => {
  const rng = mulberry(31);
  let s = game.setup(2, {}, rng, [{ kind: 'human' }, { kind: 'human' }]);
  while (s.phase !== 'show') { const seat = game.toAct(s)[0]; s = game.apply(s, seat, game.bot({ pub: game.publicView(s), mine: game.privateView(s, seat), state: s }, seat, rng), rng); }
  assert.deepStrictEqual(game.toAct(s), [0, 1]);
  const pub = game.publicView(s);
  const a = { type: 'next', step: pub.showStep, hand: pub.handNumber };
  s = game.apply(s, 0, a, rng);
  assert.strictEqual(s.show.step, pub.showStep + 1);
  assert.throws(() => game.apply(copy(s), 1, a, rng), /already/);
});

test('a move out of turn or for the wrong seat is refused', () => {
  const rng = mulberry(5);
  let s = game.setup(2, {}, rng, [{ kind: 'human' }, { kind: 'human' }]);
  for (const seat of [0, 1]) s = game.apply(s, seat, { type: 'discard', cards: s.hands[seat].slice(0, 2) }, rng);
  const cutter = game.toAct(s)[0];
  assert.throws(() => game.apply(copy(s), 1 - cutter, { type: 'cut' }, rng));
  const cut = game.apply(copy(s), cutter, { type: 'cut', by: 's' + (1 - cutter) }, rng);   // a forged "by" is ignored: the move is the sender's
  assert.strictEqual(cut.phase, 'pegging');
});

test('secrecy: neither the table nor the other seat sees a hand, a throw or the deck', () => {
  const rng = mulberry(77);
  let s = game.setup(2, {}, rng, [{ kind: 'human' }, { kind: 'human' }]);
  for (let k = 0; k < 2000 && !game.isOver(s); k++) {
    const pub = game.publicView(s);
    assert.ok(!('deck' in pub) && !('hands' in pub) && !('thrown' in pub) && !('uids' in pub));
    if (s.phase === 'discard' || s.phase === 'cut' || s.phase === 'pegging') {
      for (const seat of [0, 1]) {
        const theirs = s.hands[1 - seat].concat(s.thrown[1 - seat]).filter((c) => !s.peg.played[1 - seat].includes(c));
        const shown = new Set([].concat(pub.pegSeq, pub.pegPlayed0, pub.pegPlayed1, pub.crib, pub.revealed0, pub.revealed1, pub.showCards, pub.starter == null ? [] : [pub.starter]));
        const mine = game.privateView(s, seat);
        for (const c of theirs) {
          assert.ok(!mine.hand.includes(c) && !mine.thrown.includes(c) && !mine.dealt.includes(c), 'seat ' + seat + ' private view holds a card of the other seat');
          assert.ok(!shown.has(c), 'public view shows hidden card ' + c + ' in ' + s.phase);
        }
      }
    }
    const seat = game.toAct(s)[0];
    s = game.apply(s, seat, game.bot({ pub: game.publicView(s), mine: game.privateView(s, seat), state: s }, seat, rng), rng);
  }
});

test('a local room (the kit): one person + one computer plays to the end', async () => {
  const room = createLocal({ game, seats: ['human', 'computer'], options: { level: 'easy' }, names: ['You'], botDelayMs: 0 });
  let snap = null;
  room.on('change', (x) => { snap = x; });
  room.start();
  const rng = mulberry(3);
  for (let i = 0; i < 4000 && snap.status !== 'finished'; i++) {
    if (snap.myTurn) room.act(game.bot({ pub: snap.pub, mine: snap.mine }, snap.mySeat, rng));
    await new Promise((r) => setTimeout(r, 0));
  }
  assert.strictEqual(snap.status, 'finished');
  assert.strictEqual(Math.max(...snap.pub.scores), 121);
});
