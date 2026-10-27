/* measure-levels.js — how strong is each computer level, really?
 *     node tools/measure-levels.js [gamesPerPair=2000]
 *
 * Plays every pair of levels against each other (seats swapped every other
 * game, seeded deals) and turns the win rates into Elo gaps:
 *     gap = 400 * log10(p / (1 - p))
 * The ratings in js/profile-crib.js come from this script's output. It is
 * plain node, no browser, so a long run costs nothing but CPU.
 */
"use strict";
const E = require("../js/engine.js");
const AI = require("../js/ai.js");

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function aiContext(st, seat, level) {
  const pub = E.publicView(st);
  const priv = E.privateView(st, st.uids[seat]);
  return {
    hand: priv.hand, seq: pub.pegSeq,
    seen: priv.hand.concat(priv.thrown).concat(pub.pegPlayed0, pub.pegPlayed1).concat(pub.starter == null ? [] : [pub.starter]),
    myScore: pub.scores[seat], oppScore: pub.scores[E.other(seat)],
    oppCards: seat === 0 ? pub.handSize1 : pub.handSize0, level,
  };
}

function play(levels, rng) {
  let st = E.initGame([{ uid: "p0", name: "A" }, { uid: "p1", name: "B" }], rng);
  for (let steps = 0; st.winner === null && steps < 8000; steps++) {
    let a;
    if (st.phase === "discard") {
      const seat = st.dealt[0].length ? 1 : 0;
      a = { type: "discard", by: st.uids[seat], cards: AI.chooseDiscard(st.hands[seat], st.dealer === seat, levels[seat], rng).cards };
    } else if (st.phase === "cut") a = { type: "cut", by: st.uids[E.other(st.dealer)] };
    else if (st.phase === "pegging") {
      const seat = st.peg.turn;
      a = { type: "play", by: st.uids[seat], card: AI.choosePlay(aiContext(st, seat, levels[seat]), rng).card };
    } else a = { type: "next", by: st.uids[0] };
    const r = E.applyAction(st, a, rng);
    if (!r.ok) throw new Error("illegal: " + r.error);
    st = r.state;
  }
  return st.winner;
}

const N = Number(process.argv[2]) || 2000;
const pairs = [["medium", "easy"], ["hard", "medium"], ["hard", "easy"]];
const out = {};
const t0 = Date.now();
for (const [a, b] of pairs) {
  let wins = 0;
  for (let g = 0; g < N; g++) {
    const swap = g % 2 === 1;
    const w = play(swap ? [b, a] : [a, b], mulberry32(77000 + g));
    if (w === (swap ? 1 : 0)) wins++;
  }
  const p = wins / N;
  const se = Math.sqrt(p * (1 - p) / N);
  const gap = 400 * Math.log10(p / (1 - p));
  out[a + ">" + b] = { games: N, p: +p.toFixed(4), se: +se.toFixed(4), elo: Math.round(gap) };
  console.log(`${a} vs ${b}: ${(p * 100).toFixed(1)}% ±${(se * 100).toFixed(1)} over ${N} games -> ${gap.toFixed(0)} Elo`);
}
console.log(JSON.stringify(out));
console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
