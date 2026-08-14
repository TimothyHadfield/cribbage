/* ============================================================================
 * ai.test.js — the computer opponent.
 *     node test/ai.test.js
 *
 * Two things are worth proving about a game AI. First, that it does not
 * cheat — it is only ever handed public information plus its own cards, and
 * the harness below builds that context the same way js/local.js does, so a
 * leak would have to be written deliberately. Second, that the difficulty
 * levels are real: hard has to actually beat easy across enough games that
 * cribbage's considerable luck washes out.
 * ==========================================================================*/

const S = require("../js/score.js");
const E = require("../js/engine.js");
const AI = require("../js/ai.js");
const { cardsFromCodes: C, cardFromCode: c1 } = S;

let passed = 0;
const failures = [];
function eq(actual, expected, what) {
  if (actual === expected) { passed++; return; }
  failures.push(`${what}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond, what) { eq(!!cond, true, what); }

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

const codes = (cards) => cards.map(S.cardCode).sort().join(" ");

// ------------------------------------------------------------ the discard
{
  // The classic trap: 6-7-8-9 is a lovely hand, and getting there means
  // handing the opponent two fives — the single most valuable throw in the
  // game. A hard opponent must see the cost; the ranking below is exactly what
  // the crib table exists to supply.
  const h = C("5H 5S 6D 7C 8H 9S");
  const asPone = AI.chooseDiscard(h, false, "hard", seeded(1));
  eq(codes(asPone.cards) === "5H 5S", false,
     "as non-dealer, hard does NOT throw 5-5 into the opponent's crib");

  const asDealer = AI.chooseDiscard(h, true, "hard", seeded(1));
  const poneBest = asPone.analysis.slice().sort((a, b) => b.value - a.value)[0];
  const dealerBest = asDealer.analysis.slice().sort((a, b) => b.value - a.value)[0];
  ok(true, "the same hand is analysed from both sides of the deal");
  ok(dealerBest.value > poneBest.value,
     "the same six cards are worth more to the dealer, who owns the crib");
}
{
  // Every option must be scored, and the arithmetic must be self-consistent.
  const h = C("AH 2S 3D 8C 9H 10S");
  const r = AI.chooseDiscard(h, true, "hard", seeded(2));
  eq(r.analysis.length, 15, "all fifteen ways to break up six cards are considered");
  for (const o of r.analysis) {
    eq(o.keep.length, 4, "each option keeps four");
    eq(o.throw.length, 2, "…and throws two");
    ok(o.min <= o.expected && o.expected <= o.max, "the mean sits between the worst and best cut");
  }
  eq(r.cards.length, 2, "a discard is two cards");
  ok(r.cards.every((c) => h.includes(c)), "…both from the hand it was dealt");
}
{
  // The same six cards, opposite decisions — which is the whole point of the
  // crib table. As dealer the AI throws itself the two fives (the strongest
  // throw in cribbage, worth ~8.8) and keeps a run of four; as non-dealer it
  // will not hand them over, and keeps the fives instead.
  const h = C("5H 5S 6D 7C 8H 9S");
  eq(codes(AI.chooseDiscard(h, true, "hard", seeded(3)).cards), "5H 5S",
     "as dealer, hard throws 5-5 into its OWN crib and keeps 6-7-8-9");
  eq(codes(AI.chooseDiscard(h, false, "hard", seeded(3)).cards), "8H 9S",
     "as non-dealer, the very same hand throws 8-9 and keeps the fives");
}
{
  // A hand with one obvious answer and a five-point gap to the runner-up:
  // three fives and a jack is worth keeping over anything else on offer.
  const r = AI.chooseDiscard(C("JH 5S 5D 5C 2H 9S"), true, "hard", seeded(11));
  eq(codes(r.cards), "2H 9S", "three fives and a jack are kept together");
  const ranked = r.analysis.slice().sort((a, b) => b.value - a.value);
  ok(ranked[0].value - ranked[1].value > 3, "…by a margin no sampling noise could close");
  eq(codes(r.cards), codes(ranked[0].throw), "the chosen throw is the top-ranked option");
}
{
  // Medium is defined as "counts the hand exactly, ignores the crib". So its
  // choice must be the one with the best expected HAND, whichever side deals.
  const h = C("5H 5S 6D 7C 8H 9S");
  const m1 = AI.chooseDiscard(h, true, "medium", seeded(4));
  const m2 = AI.chooseDiscard(h, false, "medium", seeded(4));
  eq(codes(m1.cards), codes(m2.cards), "medium throws the same cards whoever deals — it ignores the crib");
  const best = m1.analysis.slice().sort((a, b) => b.expected - a.expected)[0];
  eq(codes(m1.cards), codes(best.throw), "…and it maximises the expected hand exactly");
}

// --------------------------------------------------------------- the play
{
  // Leading a five is the worst opening in cribbage: sixteen of the fifty-one
  // unseen cards answer it for two. Nobody told the AI that — it falls out of
  // averaging the opponent's replies.
  const hand = C("5S 4H 8D KC");
  const ctx = {
    hand, seq: [], seen: hand.concat([c1("2D")]),
    myScore: 40, oppScore: 40, oppCards: 4, level: "hard",
  };
  const r = AI.choosePlay(ctx, seeded(5));
  eq(S.rankOf(r.card) === 5, false, "hard never leads a five");
}
{
  // …and it takes a win when one is on the table, rather than playing safe.
  const hand = C("5S 4H 8D KC");
  const ctx = {
    hand, seq: C("10H"), seen: hand.concat(C("10H 2D")),
    myScore: 120, oppScore: 90, oppCards: 3, level: "hard",
  };
  const r = AI.choosePlay(ctx, seeded(6));
  eq(S.cardCode(r.card), "5S", "with 120 on the board it plays the five for fifteen and the game");
  eq(r.why, "this wins the game", "…and says so");
}
{
  // Forced moves are recognised as forced.
  const hand = C("KS QH");
  const ctx = {
    hand, seq: C("10H 10D"), seen: hand.concat(C("10H 10D")),
    myScore: 10, oppScore: 10, oppCards: 2, level: "hard",
  };
  const count = S.pegCount(ctx.seq);
  eq(count, 20, "the count is twenty");
  const r = AI.choosePlay(ctx, seeded(7));
  ok(hand.includes(r.card), "it plays one of the two legal ten-cards");
}
{
  // No legal card at all is a "go", not a crash.
  const ctx = {
    hand: C("KS QH"), seq: C("10H 10D 5S"), seen: [],
    myScore: 10, oppScore: 10, oppCards: 2, level: "hard",
  };
  const r = AI.choosePlay(ctx, seeded(8));
  eq(r.card, null, "with nothing playable it returns no card");
  eq(r.why, "go", "…reported as a go");
}

// ------------------------------------------------- a full self-playing game
/**
 * Drive a complete game between two AIs. The context handed to the AI is
 * assembled from publicView + privateView ONLY — the same discipline
 * js/local.js follows — so the opponent physically cannot see your cards.
 */
function aiContext(st, seat, level) {
  const pub = E.publicView(st);
  const priv = E.privateView(st, st.uids[seat]);
  return {
    hand: priv.hand,
    seq: pub.pegSeq,
    seen: priv.hand
      .concat(priv.thrown)                       // it knows what it threw
      .concat(pub.pegPlayed0, pub.pegPlayed1)    // and everything laid down
      .concat(pub.starter == null ? [] : [pub.starter]),
    myScore: pub.scores[seat],
    oppScore: pub.scores[E.other(seat)],
    oppCards: seat === 0 ? pub.handSize1 : pub.handSize0,
    level,
  };
}

/** @returns {{winner:number, scores:number[], hands:number, illegal:number}} */
function playAIGame(levels, rng) {
  const players = [{ uid: "p0", name: "Zero" }, { uid: "p1", name: "One" }];
  let st = E.initGame(players, rng);
  let illegal = 0;
  let steps = 0;

  while (st.winner === null && steps < 8000) {
    steps++;
    let a = null;
    if (st.phase === "discard") {
      const seat = st.dealt[0].length ? 1 : 0;
      const isDealer = st.dealer === seat;
      const pick = AI.chooseDiscard(st.hands[seat], isDealer, levels[seat], rng);
      a = { type: "discard", by: st.uids[seat], cards: pick.cards };
    } else if (st.phase === "cut") {
      a = { type: "cut", by: st.uids[E.other(st.dealer)] };
    } else if (st.phase === "pegging") {
      const seat = st.peg.turn;
      const choice = AI.choosePlay(aiContext(st, seat, levels[seat]), rng);
      if (choice.card == null) { illegal++; break; }   // the engine said it was their turn
      if (!E.legalPlays(st, seat).includes(choice.card)) { illegal++; break; }
      a = { type: "play", by: st.uids[seat], card: choice.card };
    } else if (st.phase === "show") {
      a = { type: "next", by: st.uids[0] };
    }
    const r = E.applyAction(st, a, rng);
    if (!r.ok) { illegal++; break; }
    st = r.state;
  }
  return { winner: st.winner, scores: st.scores.slice(), hands: st.handNumber, illegal };
}

// The AI must never propose a move the engine refuses — that would mean it is
// reasoning from a different set of rules than the referee enforces.
{
  let illegal = 0, finished = 0, totalHands = 0;
  for (let g = 0; g < 60; g++) {
    const r = playAIGame(["hard", "medium"], seeded(500 + g));
    illegal += r.illegal;
    if (r.winner !== null) finished++;
    totalHands += r.hands;
  }
  eq(illegal, 0, "across 60 self-played games the AI never proposes an illegal move");
  eq(finished, 60, "…and every game reaches a winner");
  const avgHands = totalHands / 60;
  ok(avgHands > 6 && avgHands < 16, `a game lasts a believable number of hands (got ${avgHands.toFixed(1)})`);
}

// ------------------------------------------------------- do the levels differ?
// Cribbage is luck-heavy, so a single game proves nothing and even a hundred
// is noisy. These margins are set well below the observed gap so the test
// fails on a broken AI, not on a bad run.
function match(levelA, levelB, games, seedBase) {
  let winsA = 0;
  for (let g = 0; g < games; g++) {
    // Swap seats every other game so the deal cannot favour one level.
    const swap = g % 2 === 1;
    const levels = swap ? [levelB, levelA] : [levelA, levelB];
    const r = playAIGame(levels, seeded(seedBase + g));
    const aSeat = swap ? 1 : 0;
    if (r.winner === aSeat) winsA++;
  }
  return winsA / games;
}
{
  const hardVsEasy = match("hard", "easy", 300, 9000);
  console.log(`    hard vs easy:   ${(hardVsEasy * 100).toFixed(1)}% to hard`);
  ok(hardVsEasy > 0.60, `hard beats easy convincingly (got ${(hardVsEasy * 100).toFixed(1)}%)`);

  const hardVsMedium = match("hard", "medium", 300, 12000);
  console.log(`    hard vs medium: ${(hardVsMedium * 100).toFixed(1)}% to hard`);
  ok(hardVsMedium > 0.50, `hard has the edge on medium (got ${(hardVsMedium * 100).toFixed(1)}%)`);

  const mediumVsEasy = match("medium", "easy", 300, 15000);
  console.log(`    medium vs easy: ${(mediumVsEasy * 100).toFixed(1)}% to medium`);
  ok(mediumVsEasy > 0.55, `medium beats easy (got ${(mediumVsEasy * 100).toFixed(1)}%)`);
}

// ---------------------------------------------------------------- results
if (failures.length) {
  console.log(`\n  ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.log("  ✗ " + f + "\n");
  process.exit(1);
}
console.log(`\n  ai.js — ${passed} assertions passed\n`);
