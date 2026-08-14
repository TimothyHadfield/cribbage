/* ============================================================================
 * engine.test.js — the game state machine.
 *     node test/engine.test.js
 *
 * The scoring tests cover "how many points is this worth". These cover the
 * things that make a cribbage program feel broken even when the arithmetic is
 * right: a pegging phase that deadlocks, a go point paid to the wrong player,
 * the deal failing to alternate, and — the one that actually decides games —
 * the loser being allowed to count after the winner has already reached 121.
 * ==========================================================================*/

const S = require("../js/score.js");
const E = require("../js/engine.js");
const { cardsFromCodes: C, cardFromCode: c1 } = S;

let passed = 0;
const failures = [];
function eq(actual, expected, what) {
  if (actual === expected) { passed++; return; }
  failures.push(`${what}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond, what) { eq(!!cond, true, what); }

/** Deterministic rng so a failing test fails the same way twice. */
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const P = [{ uid: "a", name: "Alice" }, { uid: "b", name: "Bob" }];
const act = (st, a) => E.applyAction(st, a, seeded(7));

// ------------------------------------------------------------------- setup
{
  const st = E.initGame(P, seeded(1));
  eq(st.hands[0].length, 6, "six cards dealt to seat 0");
  eq(st.hands[1].length, 6, "six cards dealt to seat 1");
  eq(st.deck.length, 40, "forty cards remain in the deck");
  eq(st.phase, "discard", "a hand opens in the discard phase");
  eq(st.scores[0] + st.scores[1], 0, "nobody has scored yet");
  eq(st.handNumber, 1, "that is hand one");

  const all = st.hands[0].concat(st.hands[1], st.deck);
  eq(new Set(all).size, 52, "every card is dealt exactly once");
}

// --------------------------------------------------------------- discarding
{
  let st = E.initGame(P, seeded(2));
  const r1 = act(st, { type: "discard", by: "a", cards: st.hands[0].slice(0, 2) });
  ok(r1.ok, "seat 0 may discard two");
  eq(r1.state.phase, "discard", "still waiting on the other player");
  eq(r1.state.hands[0].length, 4, "the discarder keeps four");

  const r2 = act(r1.state, { type: "discard", by: "a", cards: r1.state.hands[0].slice(0, 2) });
  ok(!r2.ok, "a second discard from the same player is refused");

  const r3 = act(r1.state, { type: "discard", by: "b", cards: r1.state.hands[1].slice(0, 2) });
  ok(r3.ok, "seat 1 discards");
  eq(r3.state.phase, "cut", "both discards done — on to the cut");
  eq(r3.state.crib.length, 4, "the crib holds four");

  const bad = act(st, { type: "discard", by: "a", cards: [st.hands[1][0], st.hands[1][1]] });
  ok(!bad.ok, "you cannot discard cards you do not hold");
  const one = act(st, { type: "discard", by: "a", cards: [st.hands[0][0]] });
  ok(!one.ok, "you must discard exactly two");
  const dup = act(st, { type: "discard", by: "a", cards: [st.hands[0][0], st.hands[0][0]] });
  ok(!dup.ok, "the same card twice is not a discard of two");
}

// -------------------------------------------------------------- immutability
{
  const st = E.initGame(P, seeded(3));
  const before = JSON.stringify(st);
  act(st, { type: "discard", by: "a", cards: st.hands[0].slice(0, 2) });
  act(st, { type: "play", by: "a", card: st.hands[0][0] }); // illegal here
  eq(JSON.stringify(st), before, "applyAction never mutates the state it was given");
}

// --------------------------------------------------------------- the cut
/** Reach the cut phase with hands and deck rigged to order. */
function atCut(handA, handB, deckCodes, dealer) {
  const st = E.initGame(P, seeded(4));
  st.dealer = dealer;
  st.hands = [C(handA), C(handB)];
  st.dealt = [C(handA), C(handB)];
  st.crib = C("2S 3S 4S 6S");
  st.deck = C(deckCodes);
  st.phase = "cut";
  st.peg = { turn: E.other(dealer), seq: [], played: [[], []], lastPlayer: null };
  st.log = [];
  return st;
}
{
  // Only one card in the deck, so the cut is deterministic.
  const st = atCut("KS QH JD 10C", "KH QD JS 10D", "JH", 1);
  const wrong = act(st, { type: "cut", by: "b" });
  ok(!wrong.ok, "the dealer does not cut their own starter");

  const r = act(st, { type: "cut", by: "a" });
  ok(r.ok, "the non-dealer cuts");
  eq(r.state.starter, c1("JH"), "the cut card becomes the starter");
  eq(r.state.scores[1], 2, "his heels: the dealer takes two for a cut jack");
  eq(r.state.phase, "pegging", "play begins");
  eq(r.state.peg.turn, 0, "the non-dealer leads the play");
}
{
  const st = atCut("KS QH JD 10C", "KH QD JS 10D", "9H", 1);
  const r = act(st, { type: "cut", by: "a" });
  eq(r.state.scores[1], 0, "no heels for a cut that is not a jack");
}

// ------------------------------------------------------------- the pegging
// A scripted hand of nothing but ten-cards, which forces two "go"s and ends
// on a last-card point — the exact shape that deadlocks a naive turn loop.
{
  let st = atCut("KS QH JD 10C", "KH QD JS 10D", "9H", 1);
  st = act(st, { type: "cut", by: "a" }).state;
  const play = (uid, code) => {
    const r = act(st, { type: "play", by: uid, card: c1(code) });
    ok(r.ok, `play ${code} by ${uid} is legal` + (r.ok ? "" : " — " + r.error));
    if (r.ok) st = r.state;
  };

  play("a", "KS");                       // count 10
  eq(st.peg.turn, 1, "turn passes to the opponent");
  play("b", "KH");                       // count 20, pair
  eq(st.scores[1], 2, "pair of kings pegs two");
  play("a", "QH");                       // count 30
  eq(st.scores[0], 1, "neither can reach 31 — the last player takes one for the go");
  eq(st.peg.seq.length, 0, "the count resets to zero after a go");
  eq(st.peg.turn, 1, "the player who did NOT take the go point leads next");

  play("b", "QD");                       // count 10
  play("a", "JD");                       // count 20
  play("b", "JS");                       // count 30, pair of jacks
  eq(st.scores[1], 2 + 2 + 1, "pair of jacks, then a second go");
  eq(st.peg.turn, 0, "the lead passes back");

  play("a", "10C");                      // count 10
  play("b", "10D");                      // count 20, pair, and the hand is spent
  eq(st.scores[1], 5 + 2 + 1, "pair of tens plus one for the last card");
  eq(st.phase, "show", "with every card played, the show begins");
}

// Three of a kind while pegging, and a card that would break 31 refused.
{
  let st = atCut("2C 10H 5D AS", "10D 10C 6H 3S", "9H", 1);
  st = act(st, { type: "cut", by: "a" }).state;
  const play = (uid, code) => { const r = act(st, { type: "play", by: uid, card: c1(code) }); ok(r.ok, `peg ${code} legal`); if (r.ok) st = r.state; };
  play("a", "10H");   // 10
  play("b", "10D");   // 20, pair for 2
  play("a", "2C");    // 22
  const over = act(st, { type: "play", by: "b", card: c1("10C") });
  ok(!over.ok, "a card that would take the count past 31 is refused");
  eq(E.legalPlays(st, 1).length, 2, "…and legalPlays offers only the two that fit");
}
{
  let st = atCut("10S 10H 5D 2C", "10D 10C 6H 3S", "9H", 1);
  st = act(st, { type: "cut", by: "a" }).state;
  const play = (uid, code) => { const r = act(st, { type: "play", by: uid, card: c1(code) }); ok(r.ok, `31-test: ${code} legal`); if (r.ok) st = r.state; };
  play("a", "10S");   // 10
  play("b", "10D");   // 20, pair for 2
  play("a", "10H");   // 30, three of a kind for 6 — then nobody can move, so a
                      // also takes one for the go
  eq(st.scores[0], 7, "three of a kind pegs six, plus one for the go nobody could answer");
}
{
  let st = atCut("AS 10H 5D 2C", "10D 10C 6H 3S", "9H", 1);
  st = act(st, { type: "cut", by: "a" }).state;
  let r = act(st, { type: "play", by: "a", card: c1("10H") }); st = r.state;   // 10
  r = act(st, { type: "play", by: "b", card: c1("10D") }); st = r.state;       // 20, pair 2
  r = act(st, { type: "play", by: "a", card: c1("AS") }); st = r.state;        // 21
  r = act(st, { type: "play", by: "b", card: c1("10C") }); st = r.state;       // 31
  eq(st.scores[1], 2 + 2, "thirty-one pays two on top of the earlier pair");
  eq(st.peg.seq.length, 0, "thirty-one resets the count");
  eq(st.peg.turn, 0, "the other player leads after a thirty-one");
}

// Illegal plays are refused rather than silently ignored.
{
  let st = atCut("KS QH JD 10C", "KH QD JS 10D", "9H", 1);
  st = act(st, { type: "cut", by: "a" }).state;
  ok(!act(st, { type: "play", by: "b", card: c1("KH") }).ok, "you cannot play out of turn");
  ok(!act(st, { type: "play", by: "a", card: c1("KH") }).ok, "you cannot play a card you do not hold");
  ok(!act(st, { type: "play", by: "c", card: c1("KS") }).ok, "a stranger cannot act at all");
  st = act(st, { type: "play", by: "a", card: c1("KS") }).state;
  st = act(st, { type: "play", by: "b", card: c1("KH") }).state;
  st = act(st, { type: "play", by: "a", card: c1("QH") }).state;   // count 30, go
  // After the reset it is seat 1's lead; seat 0 must wait.
  ok(!act(st, { type: "play", by: "a", card: c1("JD") }).ok, "the go winner does not also lead");
}

// legalPlays never offers a card that would break 31.
{
  let st = atCut("KS QH JD 10C", "KH QD JS 10D", "9H", 1);
  st = act(st, { type: "cut", by: "a" }).state;
  st = act(st, { type: "play", by: "a", card: c1("KS") }).state;
  st = act(st, { type: "play", by: "b", card: c1("KH") }).state;
  eq(E.legalPlays(st, 0).length, 3, "at a count of 20, all three remaining ten-cards still fit");
  st = act(st, { type: "play", by: "a", card: c1("QH") }).state;
  eq(E.legalPlays(st, 1).length, 3, "at zero after the reset, every card is legal");
}

// -------------------------------------------------- the show, and exactly 121
// The rule that decides real games: the non-dealer counts FIRST, and if that
// takes them to 121 the dealer never counts at all — not their hand, not the
// crib. Getting this wrong hands out wins that were never earned.
{
  const st = E.initGame(P, seeded(5));
  st.dealer = 1;                       // so seat 0 is the non-dealer and counts first
  st.scores = [115, 100];
  st.prevScores = [115, 100];
  st.dealt = [C("5H 5D 5C JS"), C("5S 6H 7D 8C")];   // seat 0 holds 29 with the right cut
  st.crib = C("2S 3H 4D 6C");
  st.starter = c1("5S");
  st.hands = [[], []];
  st.phase = "show";
  st.show = { step: 0, items: [], points: 0, who: null, label: "" };
  E._internal.scoreShowStep(st);

  eq(st.show.who, 0, "the non-dealer counts first");
  eq(st.show.points, 29, "…and shows a 29 hand");
  eq(st.scores[0], 121, "…which is exactly enough");
  eq(st.winner, 0, "the non-dealer wins on the show");
  eq(st.phase, "gameover", "the game is over immediately");
  eq(st.scores[1], 100, "the dealer never counts their hand or the crib");

  const r = act(st, { type: "next", by: "b" });
  ok(!r.ok, "no further action is accepted once the game is won");
}

// Points never overshoot the target.
{
  const st = E.initGame(P, seeded(6));
  st.scores = [119, 75];
  E._internal.award(st, 0, 12, "test");
  eq(st.scores[0], 121, "a score is capped at 121, never 131");
  eq(st.skunk, 1, "a loser between 61 and 90 is skunked");
}
{
  const st = E.initGame(P, seeded(6));
  st.scores = [119, 20];
  E._internal.award(st, 0, 4, "test");
  eq(st.skunk, 2, "a loser under 61 is double-skunked");
}
{
  const st = E.initGame(P, seeded(6));
  st.scores = [119, 95];
  E._internal.award(st, 0, 4, "test");
  eq(st.skunk, 0, "a loser at 91 or more is not skunked");
}

// The show steps in order, and then the deal alternates.
{
  const st = E.initGame(P, seeded(8));
  st.dealer = 1;
  st.dealt = [C("2H 3S 9D KC"), C("2D 4S 9H QC")];   // deliberately low-scoring
  st.crib = C("5S 7H 8D KH");
  st.starter = c1("10S");
  st.hands = [[], []];
  st.phase = "show";
  st.show = { step: 0, items: [], points: 0, who: null, label: "" };
  E._internal.scoreShowStep(st);
  eq(st.show.who, 0, "step 0 — the non-dealer's hand");

  let r = act(st, { type: "next", by: "a" });
  eq(r.state.show.who, 1, "step 1 — the dealer's hand");
  eq(r.state.show.label, "hand", "…still a hand, not the crib");

  r = act(r.state, { type: "next", by: "a" });
  eq(r.state.show.who, 1, "step 2 — the crib, which belongs to the dealer");
  eq(r.state.show.label, "crib", "…and it is labelled as the crib");

  const dealerWas = r.state.dealer;
  r = act(r.state, { type: "next", by: "b" });
  eq(r.state.dealer, E.other(dealerWas), "the deal alternates");
  eq(r.state.phase, "discard", "and a fresh hand is dealt");
  eq(r.state.hands[0].length, 6, "six cards again");
  eq(r.state.handNumber, 2, "hand two");
}

// -------------------------------------------------------------- the views
{
  let st = E.initGame(P, seeded(9));
  st = act(st, { type: "discard", by: "a", cards: st.hands[0].slice(0, 2) }).state;
  st = act(st, { type: "discard", by: "b", cards: st.hands[1].slice(0, 2) }).state;
  st = act(st, { type: "cut", by: st.dealer === 0 ? "b" : "a" }).state;

  const pub = E.publicView(st);
  ok(!("hands" in pub) && !("deck" in pub) && !("hand0" in pub),
     "the public view carries no hands or deck key at all");
  eq(pub.revealed0.length, 0, "no hand is revealed before the show");
  eq(pub.revealed1.length, 0, "neither is the other");
  eq(pub.crib.length, 0, "the crib stays face down");
  eq(pub.cribCount, 4, "…though its size is public");
  eq(pub.handSize0, 4, "hand sizes are public");

  // The one guarantee that matters: nothing in the public view identifies a
  // card that is still hidden.
  const hidden = st.hands[0].concat(st.hands[1], st.crib, st.deck);
  const exposed = new Set(pub.pegSeq.concat(pub.pegPlayed0, pub.pegPlayed1, [pub.starter]));
  const leaked = hidden.filter((c) => exposed.has(c) && c !== st.starter);
  eq(leaked.length, 0, "the public view leaks no hidden card");

  const priv = E.privateView(st, "a");
  eq(priv.seat, 0, "the private view knows your seat");
  eq(priv.hand.length, 4, "…and shows you your own four cards");
  const privB = E.privateView(st, "b");
  eq(privB.hand.filter((c) => priv.hand.includes(c)).length, 0, "the two private views share no card");
  eq(E.privateView(st, "zzz").seat, -1, "a stranger gets nothing");
}

// ------------------------------------------------- full games, played blind
// The real deadlock check. Drive complete games with random legal moves and
// assert every one of them terminates properly. A turn-order or go-handling
// bug shows up here as a hang, which the step budget converts into a failure.
{
  let stuck = 0, overshot = 0, finished = 0, badTurn = 0;
  for (let g = 0; g < 300; g++) {
    const rng = seeded(1000 + g);
    let st = E.initGame(P, rng);
    let steps = 0;
    while (st.winner === null && steps < 6000) {
      steps++;
      let a = null;
      if (st.phase === "discard") {
        const seat = st.dealt[0].length ? 1 : 0;
        a = { type: "discard", by: st.uids[seat], cards: st.hands[seat].slice(0, 2) };
      } else if (st.phase === "cut") {
        a = { type: "cut", by: st.uids[E.other(st.dealer)] };
      } else if (st.phase === "pegging") {
        const seat = st.peg.turn;
        const legal = E.legalPlays(st, seat);
        if (!legal.length) { badTurn++; break; }   // the engine offered a turn with no legal move
        a = { type: "play", by: st.uids[seat], card: legal[Math.floor(rng() * legal.length)] };
      } else if (st.phase === "show") {
        a = { type: "next", by: st.uids[0] };
      }
      const r = E.applyAction(st, a, rng);
      if (!r.ok) { stuck++; break; }
      st = r.state;
    }
    if (st.winner === null) { if (steps >= 6000) stuck++; }
    else {
      finished++;
      if (st.scores[st.winner] !== 121) overshot++;
      if (st.scores[E.other(st.winner)] >= 121) overshot++;
    }
  }
  eq(finished, 300, "300 random games all reach a winner");
  eq(stuck, 0, "none of them deadlock or reject a legal move");
  eq(badTurn, 0, "the engine never gives the turn to a player with no legal card");
  eq(overshot, 0, "every winner finishes on exactly 121, and the loser below it");
}

// ---------------------------------------------------------------- results
if (failures.length) {
  console.log(`\n  ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.log("  ✗ " + f + "\n");
  process.exit(1);
}
console.log(`\n  engine.js — ${passed} assertions passed\n`);
