/* variants.test.js — the optional rule variants (off by default).
 *     node test/variants.test.js
 *
 *   { target: 61 }      short game: first to 61 wins; skunk below 31.
 *   { fiveCard: true }  five-card cribbage: five dealt, two each to the crib,
 *                       three kept; the play stops at the first 31 or go;
 *                       the first non-dealer pegs 3; game to 61; a 3-card
 *                       flush scores 3 (4 with the starter).
 * Both must also be playable by every computer level without an illegal move.
 */
const S = require("../js/score.js");
const E = require("../js/engine.js");
const AI = require("../js/ai.js");
const { cardsFromCodes: C, cardFromCode: c1 } = S;

let passed = 0;
const failures = [];
function eq(actual, expected, what) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failures.push(`${what}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const ok = (c, what) => eq(!!c, true, what);
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}
const P = [{ uid: "a", name: "A" }, { uid: "b", name: "B" }];

function aiContext(st, seat, level) {
  const pub = E.publicView(st);
  const priv = E.privateView(st, st.uids[seat]);
  return {
    hand: priv.hand, seq: pub.pegSeq,
    seen: priv.hand.concat(priv.thrown, pub.pegPlayed0, pub.pegPlayed1, pub.starter == null ? [] : [pub.starter]),
    myScore: pub.scores[seat], oppScore: pub.scores[E.other(seat)],
    oppCards: seat === 0 ? pub.handSize1 : pub.handSize0, level,
    target: pub.target, fiveCard: pub.fiveCard,
  };
}
function playGame(levels, rng, opts) {
  let st = E.initGame(P, rng, opts);
  let steps = 0, illegal = 0;
  while (st.winner === null && steps++ < 4000) {
    let a;
    if (st.phase === "discard") {
      const p = st.dealt[0].length ? 1 : 0;
      a = { type: "discard", by: st.uids[p], cards: AI.chooseDiscard(st.hands[p], st.dealer === p, levels[p], rng).cards };
    } else if (st.phase === "cut") a = { type: "cut", by: st.uids[E.other(st.dealer)] };
    else if (st.phase === "pegging") {
      const p = st.peg.turn;
      const c = AI.choosePlay(aiContext(st, p, levels[p]), rng).card;
      if (!E.legalPlays(st, p).includes(c)) { illegal++; break; }
      a = { type: "play", by: st.uids[p], card: c };
    } else a = { type: "next", by: "a" };
    const r = E.applyAction(st, a, rng);
    if (!r.ok) { illegal++; break; }
    st = r.state;
  }
  return { st, illegal };
}

// ---- defaults unchanged ----
{
  const st = E.initGame(P, seeded(1));
  eq(st.target, 121, "the default game is to 121");
  eq(st.fiveCard, false, "five-card is off by default");
  eq(st.hands[0].length, 6, "six cards each by default");
  eq(E.publicView(st).target, 121, "public view carries the target");
}

// ---- short game to 61 ----
{
  const st = E.initGame(P, seeded(2), { target: 61 });
  eq(st.target, 61, "short game target is 61");
  eq(E.publicView(st).target, 61, "…and the public view says so");
  const s = JSON.parse(JSON.stringify(st));
  s.scores = [59, 20];
  E._internal.award(s, 0, 2, "Test");
  eq(s.winner, 0, "reaching 61 wins the short game");
  eq(s.scores[0], 61, "the score stops at 61");
  eq(s.skunk, 1, "a loser under 31 is skunked in a 61 game");
  const t = JSON.parse(JSON.stringify(st));
  t.scores = [60, 40];
  E._internal.award(t, 0, 1, "Test");
  eq(t.skunk, 0, "a loser on 40 is not skunked in a 61 game");
  let wins = 0, illegal = 0, maxScore = 0;
  for (let g = 0; g < 20; g++) {
    const r = playGame(["hard", "medium"], seeded(100 + g), { target: 61 });
    illegal += r.illegal; if (r.st.winner !== null) wins++;
    maxScore = Math.max(maxScore, ...r.st.scores);
  }
  eq(illegal, 0, "computers play the short game with no illegal move");
  eq(wins, 20, "every short game finishes");
  eq(maxScore, 61, "nobody passes 61");
}

// ---- five-card scoring ----
{
  eq(S.scoreHand(C("2H 7H 9H"), c1("KS")).points, 3, "a three-card flush in hand scores 3");
  eq(S.handValue(C("2H 7H 9H"), c1("KS"), false), 3, "…handValue agrees");
  eq(S.scoreHand(C("2H 7H 9H"), c1("KH")).points, 4, "with a matching starter it scores 4");
  eq(S.handValue(C("2H 7H 9H"), c1("KH"), false), 4, "…handValue agrees");
  eq(S.scoreHand(C("2H 7H 9H QH"), c1("KS"), { isCrib: true }).points, 0, "a four-card crib flush needs the starter");
  eq(S.scoreHand(C("2H 7H 9H KH"), c1("4S")).points, 4 + 2, "the four-card hand flush is unchanged");
}

// ---- five-card deal, three for last, the short play ----
{
  const st = E.initGame(P, seeded(3), { fiveCard: true });
  eq(st.fiveCard, true, "five-card flag is set");
  eq(st.target, 61, "five-card plays to 61");
  eq(st.hands[0].length + st.hands[1].length, 10, "five cards each");
  const nd = E.other(st.dealer);
  eq(st.scores[nd], 3, "the first non-dealer pegs 3");
  eq(st.scores[st.dealer], 0, "the dealer starts on 0");
  eq(E.publicView(st).fiveCard, true, "public view carries five-card");
}
{
  // the play ends at the first 31 or go, even with cards left
  let endedEarly = 0, hands = 0, illegal = 0, wins = 0;
  for (let g = 0; g < 30; g++) {
    const rng = seeded(500 + g);
    let st = E.initGame(P, rng, { fiveCard: true });
    let sawShow = false;
    for (let i = 0; i < 4000 && st.winner === null; i++) {
      let a;
      if (st.phase === "discard") {
        const p = st.dealt[0].length ? 1 : 0;
        a = { type: "discard", by: st.uids[p], cards: AI.chooseDiscard(st.hands[p], st.dealer === p, "hard", rng).cards };
      } else if (st.phase === "cut") a = { type: "cut", by: st.uids[E.other(st.dealer)] };
      else if (st.phase === "pegging") {
        const p = st.peg.turn;
        const c = AI.choosePlay(aiContext(st, p, g % 2 ? "easy" : "hard"), rng).card;
        if (!E.legalPlays(st, p).includes(c)) { illegal++; break; }
        a = { type: "play", by: st.uids[p], card: c };
      } else a = { type: "next", by: "a" };
      const before = st;
      const r = E.applyAction(st, a, rng);
      if (!r.ok) { illegal++; break; }
      st = r.state;
      if (before.phase === "pegging" && st.phase === "show") {
        hands++;
        if (st.hands[0].length + st.hands[1].length > 0) endedEarly++;
        eq(st.dealt[0].length, 3, "each hand keeps three cards for the show");
        eq(st.crib.length, 4, "the crib has four cards");
        sawShow = true;
      }
    }
    if (st.winner !== null) wins++;
    ok(sawShow || st.winner !== null, "a five-card hand reaches the show");
  }
  eq(illegal, 0, "computers play five-card with no illegal move");
  eq(wins, 30, "every five-card game finishes");
  ok(hands > 50, `plenty of hands were played (${hands})`);
  ok(endedEarly > 0, `the play stops at the first 31 or go, leaving cards unplayed (${endedEarly} of ${hands})`);
}
{
  // a five-card discard is chosen from all ten ways to throw two of five
  const r = AI.chooseDiscard(C("5H 5S 6D 7C KH"), true, "hard", seeded(9));
  eq(r.analysis.length, 10, "five cards give ten throw options");
  eq(r.analysis[0].keep.length, 3, "each keeps three");
}

console.log(failures.length ? `\n  ${passed} passed, ${failures.length} FAILED\n` : `\n  variants — ${passed} assertions passed\n`);
for (const f of failures) console.log("  ✗ " + f + "\n");
if (failures.length) process.exit(1);
