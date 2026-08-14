/* ============================================================================
 * score.test.js — the scoring rules, checked against hands whose values are
 * settled cribbage folklore. Plain Node, no framework:
 *     node test/score.test.js
 *
 * Every implementation of cribbage gets fifteens right and then quietly gets
 * double-double runs, the crib's flush rule, or four-of-a-kind pegging wrong.
 * These are those cases.
 * ==========================================================================*/

const S = require("../js/score.js");
const { cardsFromCodes: C, cardFromCode: c1 } = S;

let passed = 0;
const failures = [];

function eq(actual, expected, what) {
  if (actual === expected) { passed++; return; }
  failures.push(`${what}\n      expected ${expected}, got ${actual}`);
}

/** Assert a hand's total. `hand` and `starter` are card-code strings. */
function hand(handCodes, starterCode, expected, what, opts) {
  const got = S.scoreHand(C(handCodes), c1(starterCode), opts).points;
  eq(got, expected, `${what}  [${handCodes} | ${starterCode}]`);

  // handValue is a second, independent implementation used by the AI's hot
  // loop. It must never disagree with the itemised one.
  const fast = S.handValue(C(handCodes), c1(starterCode), !!(opts && opts.isCrib));
  eq(fast, expected, `${what} (handValue fast path)  [${handCodes} | ${starterCode}]`);
}

// -------------------------------------------------------- the famous hands
hand("JS 5H 5D 5C", "5S", 29, "the perfect 29");
hand("5H 5D 5C 5S", "JS", 28, "four fives, jack cut (28 — no nobs, the jack is the starter)");
hand("4H 4S 5D 5C", "6H", 24, "double-double run 4455-6");
hand("6H 7S 7D 8C", "8H", 24, "double-double run 67788");
hand("4H 5S 5D 5C", "6H", 23, "triple run 4-5-5-5-6");
hand("AS 2H 8D KC", "10S", 0, "the 19 hand (there is no 19)");
hand("AS 2H 3D 4C", "5S", 7, "A-2-3-4-5: run of five (5), and the whole hand is one fifteen (2)");

// ------------------------------------------------------------------- runs
hand("3H 4S 5D KC", "9H", 5, "run of three (3) plus 5+K for fifteen (2)");
hand("3H 4S 5D 6C", "9H", 8, "run of four (4) plus the 9+6 and 4+5+6 fifteens (4)");
hand("3H 4S 5D 6C", "7H", 9, "run of five (5) plus the 3+5+7 and 4+5+6 fifteens (4)");
hand("3H 3S 4D 5C", "KH", 12, "double run (8) plus the 3+3+4+5 and 5+K fifteens (4)");
hand("3H 3S 4D 4C", "5H", 20, "double-double run (16) plus two fifteens (4)");
hand("2H 3S 4D 4C", "4H", 17, "triple run (9) + three of a kind (6) + 3+4+4+4 (2)");
hand("QH JS 10D 9C", "KH", 5, "run of five in the picture cards");
hand("KH QS JD 5C", "5H", 17, "run (3), pair of fives (2), six ten-and-five fifteens (12)");

// ------------------------------------------------------------ pairs only
hand("2H 2S 9D KC", "7H", 2, "one pair");
hand("2H 2S 2D KC", "7H", 6, "three of a kind is three pairs");
hand("2H 2S 2D 2C", "KH", 12, "four of a kind is six pairs");

// --------------------------------------------------------------- flushes
// (2-5-9-K plus a 3 also makes two fifteens: 5+K and 2+3+K.)
hand("2H 5H 9H KH", "3S", 8, "four-card flush in the hand scores 4, plus 4 in fifteens");
hand("2H 5H 9H KH", "3H", 9, "five-card flush scores 5, plus the same 4");
hand("2H 5H 9H KH", "3S", 4, "the same four-card flush in the CRIB scores nothing", { isCrib: true });
hand("2H 5H 9H KH", "3H", 9, "but a five-card flush in the crib does score", { isCrib: true });

// ------------------------------------------------------------------ nobs
// (J-2-7-K plus a 3 makes two fifteens: J+2+3 and K+2+3.)
hand("JH 2S 7D KC", "3H", 5, "his nobs (1): jack matching the starter's suit, plus 4");
hand("JH 2S 7D KC", "3S", 4, "no nobs when the suits differ — just the 4");
hand("JH JS 7D KC", "3H", 3, "the matching jack scores nobs; the pair scores 2");

// ---------------------------------------------------------------- the crib
// The crib differs from the hand in exactly one way — the flush — so every
// other category must agree.
{
  const h = C("5H 5D 5C JS");
  const st = c1("5S");
  eq(S.scoreHand(h, st, { isCrib: true }).points, 29, "the 29 counts the same in the crib");
}

// ----------------------------------------------------- breakdown integrity
{
  const r = S.scoreHand(C("JS 5H 5D 5C"), c1("5S"));
  const fifteens = r.items.filter((i) => i.type === "fifteen").length;
  const pairs = r.items.filter((i) => i.type === "pair").length;
  const nobs = r.items.filter((i) => i.type === "nobs").length;
  eq(fifteens, 8, "the 29 is built from eight distinct fifteens");
  eq(pairs, 6, "…six pairs among the four fives");
  eq(nobs, 1, "…and his nobs");
  let sum = 0;
  for (const it of r.items) sum += it.points;
  eq(sum, r.points, "itemised points sum to the reported total");
}
{
  // A double run must be reported as two separate runs, so the UI can show
  // each one — not as a single run worth double.
  const r = S.scoreHand(C("3H 3S 4D 5C"), c1("KH"));
  const runs = r.items.filter((i) => i.type === "run");
  eq(runs.length, 2, "a double run is two run items");
  eq(runs[0].points, 3, "each is worth three");
  eq(runs.every((x) => x.cards.length === 3), true, "each names its three cards");
}

// ------------------------------------------------------------- the pegging
function peg(seqCodes, expected, what) {
  eq(S.scorePegPlay(C(seqCodes)).points, expected, `peg: ${what}  [${seqCodes}]`);
}

peg("5S 10H", 2, "fifteen for two");
peg("KS 5H", 2, "fifteen for two with a face card");
peg("10S 10H 10D AC", 2, "thirty-one for two");
peg("7S 7H", 2, "pair");
peg("7S 7H 7D", 6, "three of a kind");
peg("7S 7H 7D 7C", 12, "four of a kind");
peg("3S 4H 5D", 3, "run of three");
peg("5S 3H 4D", 3, "run of three, played out of order");
peg("5S 3H 4D 6C", 4, "run of four, still out of order");
peg("5S 3H 4D 2C AH", 7, "run of five (5) that also lands on fifteen (2)");
peg("5S 3H 4D 4C", 2, "a repeated rank breaks the run — pair only");
peg("3S 4H 9D 5C", 0, "an intervening card breaks the run");
peg("AS 2H 3D 4C 5H", 7, "run of five that also lands on fifteen");
peg("8S 7H", 2, "fifteen from 8+7");
peg("9S 6H", 2, "fifteen from 9+6");
peg("2S", 0, "a lone opening card scores nothing");
peg("6S 7H 8D", 3, "run of three; twenty-one is not a scoring count");

// Only the LONGEST run counts, never a run of three inside a run of four.
{
  const r = S.scorePegPlay(C("3S 4H 5D 6C"));
  eq(r.items.filter((i) => i.type === "run").length, 1, "peg: one run item, not nested runs");
  eq(r.points, 4, "peg: nested runs are not double-counted");
}

// pegCount is what the engine gates the 31 limit on.
eq(S.pegCount(C("KS QH")), 20, "pegCount: face cards are ten each");
eq(S.pegCount(C("AS 2H 3D")), 6, "pegCount: ace is one");

// ------------------------------------------- fast path vs itemised, at scale
// The AI's handValue and the UI's scoreHand are separate code. A divergence
// would mean the computer plays by different rules than it counts by, which
// is the sort of bug that survives for months. Check them against each other
// over a large random sample, in both hand and crib mode.
{
  let mismatches = 0;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let trial = 0; trial < 20000; trial++) {
    const deck = S.fullDeck();
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const h = deck.slice(0, 4);
    const st = deck[4];
    const isCrib = trial % 2 === 0;
    if (S.scoreHand(h, st, { isCrib }).points !== S.handValue(h, st, isCrib)) mismatches++;
  }
  eq(mismatches, 0, "handValue agrees with scoreHand across 20,000 random deals");
}

// A hand can never be worth 19, 25, 26 or 27 — the classic impossible totals.
// Sampling every hand is too slow here; a wide random sweep still catches a
// run- or flush-arithmetic bug that produces one.
{
  const impossible = new Set([19, 25, 26, 27]);
  let bad = 0;
  let seed = 999;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let trial = 0; trial < 50000; trial++) {
    const deck = S.fullDeck();
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    if (impossible.has(S.handValue(deck.slice(0, 4), deck[4], false))) bad++;
  }
  eq(bad, 0, "no hand ever scores 19, 25, 26 or 27");
}

// ---------------------------------------------------------------- results
if (failures.length) {
  console.log(`\n  ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.log("  ✗ " + f + "\n");
  process.exit(1);
}
console.log(`\n  score.js — ${passed} assertions passed\n`);
