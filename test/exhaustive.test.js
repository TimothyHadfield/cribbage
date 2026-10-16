/* ============================================================================
 * exhaustive.test.js — every scoring rule checked against an INDEPENDENT
 * reference written here from the official rules, over every case there is
 * rather than a sample.
 *     node test/exhaustive.test.js        (about 6 minutes)
 *
 *  1. The show: all 12,994,800 (four-card hand, starter) deals, in hand AND
 *     crib mode, scored by handValue and by the reference below. The hand-mode
 *     distribution is also checked against the published table of how many
 *     deals score each total (0 … 29), which nobody's code wrote.
 *  2. scoreHand (the itemised version the player sees) against the reference
 *     on every distinct rank pattern × every flush / nobs arrangement.
 *  3. The play: every possible pegging sequence (any order of ranks, at most
 *     four of each, count never past 31), scored card by card.
 *  4. Go, 31 and last card: thousands of whole hands played through the engine
 *     with random legal choices, refereed in parallel by a separate simulator
 *     that knows only the rulebook, comparing who is to play and every score.
 * ==========================================================================*/

const S = require("../js/score.js");
const E = require("../js/engine.js");

let passed = 0;
const failures = [];
let lastLap = Date.now();
function lap(name) {
  console.log(`  ${name}: ${((Date.now() - lastLap) / 1000).toFixed(1)} s`);
  lastLap = Date.now();
}
function eq(actual, expected, what) {
  if (actual === expected) { passed++; return; }
  failures.push(`${what}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const rank = (c) => (c % 13) + 1;
const suit = (c) => Math.floor(c / 13);
const val = (c) => Math.min(rank(c), 10);

const MASKS_OF_SIZE = [[], [], [], [], [], []];
for (let m = 0; m < 32; m++) {
  let n = 0;
  for (let i = 0; i < 5; i++) if (m & (1 << i)) n++;
  MASKS_OF_SIZE[n].push(m);
}

// ===================================================== reference: the show
// Written from the rules, deliberately by different methods than score.js:
// fifteens by counting subset sums with a DP, runs by testing every 3-, 4- and
// 5-card subset and keeping only the longest length found.
function refShow(hand, starter, isCrib) {
  const all = hand.concat([starter]);
  let pts = 0;

  // Fifteens: number of subsets whose values sum to 15, two each.
  const ways = new Array(16).fill(0);
  ways[0] = 1;
  for (const c of all) {
    const v = val(c);
    for (let s = 15; s >= v; s--) ways[s] += ways[s - v];
  }
  pts += 2 * ways[15];

  // Pairs: two for every pair of cards of equal rank.
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) if (rank(all[i]) === rank(all[j])) pts += 2;

  // Runs: every subset of distinct, consecutive ranks; only the longest count.
  const rk = [rank(all[0]), rank(all[1]), rank(all[2]), rank(all[3]), rank(all[4])];
  for (let size = 5; size >= 3; size--) {
    let found = 0;
    for (const mask of MASKS_OF_SIZE[size]) {
      let seen = 0, lo = 99, hi = 0, dup = false;
      for (let i = 0; i < 5; i++) {
        if (!(mask & (1 << i))) continue;
        const r = rk[i];
        if (seen & (1 << r)) dup = true;
        seen |= 1 << r;
        if (r < lo) lo = r;
        if (r > hi) hi = r;
      }
      if (!dup && hi - lo === size - 1) found++;
    }
    if (found) { pts += found * size; break; }
  }

  // Flush: four in the hand score 4 (5 with the starter). Crib: all five or nothing.
  const fourSame = hand.every((c) => suit(c) === suit(hand[0]));
  if (fourSame) {
    if (suit(starter) === suit(hand[0])) pts += 5;
    else if (!isCrib) pts += 4;
  }

  // His nobs: a jack in hand (or crib) of the starter's suit.
  for (const c of hand) if (rank(c) === 11 && suit(c) === suit(starter)) pts += 1;
  return pts;
}

// ---- 1. every deal, handValue vs reference, and the published distribution ----
// Number of (hand, starter) deals scoring each total 0..29 in a HAND (not crib).
// Source: the standard cribbage hand-score frequency table (12,994,800 deals,
// mean 4.7692); 19, 25, 26 and 27 are impossible.
const PUBLISHED = [
  1009008, 99792, 2813796, 505008, 2855676, 697508, 1800268, 751324, 1137236, 361224,
  388740, 51680, 317340, 19656, 90100, 9168, 58248, 11196, 2708, 0,
  8068, 2496, 444, 356, 3680, 0, 0, 0, 76, 4,
];
{
  const dist = new Array(30).fill(0);
  let deals = 0, handMismatch = 0, cribMismatch = 0, firstBad = null;
  for (let a = 0; a < 52; a++)
  for (let b = a + 1; b < 52; b++)
  for (let c = b + 1; c < 52; c++)
  for (let d = c + 1; d < 52; d++) {
    const hand = [a, b, c, d];
    for (let st = 0; st < 52; st++) {
      if (st === a || st === b || st === c || st === d) continue;
      deals++;
      const hv = S.handValue(hand, st, false);
      dist[hv]++;
      const ref = refShow(hand, st, false);
      if (hv !== ref) { handMismatch++; firstBad = firstBad || [hand, st, "hand"]; }
      // The crib differs from a hand only by the four-card flush, so its
      // reference is the hand's minus that (saves a second full count).
      const fourOnly = suit(a) === suit(b) && suit(a) === suit(c) && suit(a) === suit(d) && suit(st) !== suit(a);
      if (S.handValue(hand, st, true) !== ref - (fourOnly ? 4 : 0)) { cribMismatch++; firstBad = firstBad || [hand, st, "crib"]; }
    }
  }
  eq(deals, 12994800, "every (four-card hand, starter) deal enumerated");
  eq(handMismatch, 0, "handValue matches the reference on every deal as a hand" +
    (firstBad ? "  first: " + JSON.stringify(firstBad) : ""));
  eq(cribMismatch, 0, "handValue matches the reference on every deal as a crib");
  lap("every deal");
  for (let s = 0; s < 30; s++) eq(dist[s], PUBLISHED[s], `deals scoring exactly ${s} match the published table`);
  let total = 0;
  for (let s = 0; s < 30; s++) total += s * dist[s];
  eq((total / deals).toFixed(4), "4.7692", "the average hand is worth 4.7692");
}

// ---- 2. scoreHand (what the player is shown) on every rank pattern × suit arrangement ----
// Rank-only categories depend only on the five ranks; flush and nobs only on
// suits and which card is the starter. Every multiset of five ranks (max four
// of a rank), each with suit arrangements covering every flush/nobs case.
{
  let checked = 0, bad = 0, itemsBad = 0, firstBad = null;
  const ranksets = [];
  (function gen(start, acc) {
    if (acc.length === 5) { ranksets.push(acc.slice()); return; }
    for (let r = start; r <= 13; r++) {
      if (acc.filter((x) => x === r).length >= 4) continue;
      acc.push(r); gen(r, acc); acc.pop();
    }
  })(1, []);
  eq(ranksets.length, 6175, "all 6,175 possible rank patterns of a five-card show");
  const SUIT_PATTERNS = [];
  (function gen(acc, top) {
    if (acc.length === 5) { SUIT_PATTERNS.push(acc.slice()); return; }
    for (let s = 0; s <= Math.min(3, top + 1); s++) { acc.push(s); gen(acc, Math.max(top, s)); acc.pop(); }
  })([], -1);
  eq(SUIT_PATTERNS.length, 51, "all 51 suit patterns of five cards");

  for (const rs of ranksets) {
    // Every way to pick which of the five is the starter.
    for (let sIdx = 0; sIdx < 5; sIdx++) {
      if (sIdx > 0 && rs[sIdx] === rs[sIdx - 1]) continue; // same rank, same case
      // Suit arrangements: every pattern of "same suit as / different suit
      // from" across the five cards (suit names themselves can't matter), with
      // no duplicate cards. That covers every flush and nobs case.
      for (const suits of SUIT_PATTERNS) {
        const cards = rs.map((r, i) => suits[i] * 13 + (r - 1));
        if (new Set(cards).size !== 5) continue;
        const starter = cards[sIdx];
        const hand = cards.filter((_, i) => i !== sIdx);
        for (const isCrib of [false, true]) {
          checked++;
          const r = S.scoreHand(hand, starter, { isCrib });
          const want = refShow(hand, starter, isCrib);
          if (r.points !== want) { bad++; firstBad = firstBad || [hand, starter, isCrib, r.points, want]; }
          let sum = 0;
          for (const it of r.items) sum += it.points;
          if (sum !== r.points) itemsBad++;
        }
      }
    }
  }
  eq(bad, 0, `scoreHand matches the reference on ${checked.toLocaleString()} rank/suit/starter cases` +
    (firstBad ? "  first: " + JSON.stringify(firstBad) : ""));
  eq(itemsBad, 0, "the itemised breakdown always adds up to the total shown");
  lap("scoreHand patterns");
}

// ====================================================== reference: the play
function refPeg(seq) {
  let pts = 0, count = 0;
  for (const c of seq) count += val(c);
  if (count === 15) pts += 2;
  if (count === 31) pts += 2;
  // Pairs: the new card plus every card of the same rank directly before it.
  let k = 1;
  while (k < seq.length && rank(seq[seq.length - 1 - k]) === rank(seq[seq.length - 1])) k++;
  pts += [0, 0, 2, 6, 12][k];
  // Runs: the longest run formed by the last n cards, n >= 3, in any order.
  let best = 0;
  for (let n = 3; n <= seq.length; n++) {
    const rs = seq.slice(-n).map(rank).sort((a, b) => a - b);
    let ok = true;
    for (let i = 1; i < n; i++) if (rs[i] !== rs[i - 1] + 1) ok = false;
    if (ok) best = n;
  }
  return pts + best;
}

// ---- 3. every legal pegging sequence ----
{
  let seqs = 0, bad = 0, firstBad = null;
  const used = new Array(14).fill(0);
  const seq = [];
  (function dfs(count) {
    for (let r = 1; r <= 13; r++) {
      const v = Math.min(r, 10);
      if (count + v > 31 || used[r] >= 4) continue;
      const card = used[r] * 13 + (r - 1); // the k-th copy of a rank gets suit k
      used[r]++; seq.push(card);
      seqs++;
      if (S.scorePegPlay(seq).points !== refPeg(seq)) { bad++; firstBad = firstBad || seq.map(S.cardCode).join(" "); }
      if (seq.length < 8) dfs(count + v); // a single count never holds more than 8 cards
      seq.pop(); used[r]--;
    }
  })(0);
  eq(bad, 0, `scorePegPlay matches the reference on all ${seqs.toLocaleString()} pegging sequences` +
    (firstBad ? "  first: " + firstBad : ""));
  lap("pegging sequences");
}

// ============================================ reference: go, 31, last card
/**
 * A separate pegging referee, straight from the rulebook:
 *  - non-dealer leads; players alternate;
 *  - a player who cannot play without passing 31 says "go"; the other keeps
 *    playing while they can;
 *  - when neither can play, the last player to lay a card pegs 1 (a "go"),
 *    or 2 for reaching exactly 31 (no extra 1); the count restarts and the
 *    player who did NOT lay the last card leads (if they still hold cards);
 *  - the very last card of the hand pegs 1 unless it made 31.
 */
function makeRefPeg(hands, dealer) {
  const h = [hands[0].slice(), hands[1].slice()];
  const st = { h, seq: [], turn: 1 - dealer, last: null, pts: [0, 0], done: false };
  const count = () => st.seq.reduce((a, c) => a + val(c), 0);
  const can = (p) => st.h[p].some((c) => count() + val(c) <= 31);
  st.play = (p, card) => {
    st.h[p] = st.h[p].filter((c) => c !== card);
    st.seq.push(card);
    st.last = p;
    st.pts[p] += refPeg(st.seq);
    const o = 1 - p;
    if (count() === 31) { st.seq = []; st.turn = st.h[o].length ? o : p; }
    else if (can(o)) { st.turn = o; return; }
    else if (can(p)) { st.turn = p; return; }
    else { st.pts[p] += 1; st.seq = []; st.turn = st.h[o].length ? o : p; }
    if (!st.h[0].length && !st.h[1].length) st.done = true;
  };
  return st;
}

{
  const hands = 20000;
  let turnBad = 0, pegBad = 0, showBad = 0, finished = 0, firstBad = null;
  let seed = 4242;
  const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const P = [{ uid: "a", name: "A" }, { uid: "b", name: "B" }];

  for (let g = 0; g < hands; g++) {
    let s = E.initGame(P, rng);
    // Discard two random cards each.
    for (const p of [0, 1]) {
      const hs = s.hands[p].slice();
      const i = Math.floor(rng() * 6);
      let j = Math.floor(rng() * 5); if (j >= i) j++;
      s = E.applyAction(s, { type: "discard", by: P[p].uid, cards: [hs[i], hs[j]] }, rng).state;
    }
    const dealer = s.dealer;
    s = E.applyAction(s, { type: "cut", by: P[1 - dealer].uid }, rng).state;
    const heels = rank(s.starter) === 11 ? 2 : 0;
    const ref = makeRefPeg(s.hands, dealer);

    // Play it out, both engine and referee taking the same random choices.
    let guard = 0;
    while (s.phase === "pegging" && guard++ < 20) {
      if (s.peg.turn !== ref.turn) { turnBad++; firstBad = firstBad || ["turn", g]; break; }
      const p = ref.turn;
      const legal = E.legalPlays(s, p);
      const card = legal[Math.floor(rng() * legal.length)];
      ref.play(p, card);
      const r = E.applyAction(s, { type: "play", by: P[p].uid, card }, rng);
      if (!r.ok) { turnBad++; break; }
      s = r.state;
    }
    if (!ref.done || s.phase !== "show") { turnBad++; continue; }
    const pegEngine = [s.scores[0] - (dealer === 0 ? heels : 0), s.scores[1] - (dealer === 1 ? heels : 0)];
    // The non-dealer's hand has already been counted as the show opened.
    const nd = 1 - dealer;
    const ndHand = refShow(s.dealt[nd], s.starter, false);
    pegEngine[nd] -= ndHand;
    if (pegEngine[0] !== ref.pts[0] || pegEngine[1] !== ref.pts[1]) {
      pegBad++; firstBad = firstBad || ["peg", g, pegEngine, ref.pts];
    }
    // The show: dealer's hand, then the crib.
    const before = s.scores.slice();
    s = E.applyAction(s, { type: "next", by: "a" }, rng).state;
    const dHand = s.scores[dealer] - before[dealer];
    s = E.applyAction(s, { type: "next", by: "a" }, rng).state;
    const crib = s.scores[dealer] - before[dealer] - dHand;
    if (dHand !== refShow(s.dealt[dealer], s.starter, false) ||
        crib !== refShow(s.crib, s.starter, true)) {
      showBad++; firstBad = firstBad || ["show", g];
    }
    finished++;
  }
  eq(finished, hands, `${hands.toLocaleString()} whole hands played through pegging and the show`);
  eq(turnBad, 0, "the engine always gives the turn to the player the rules say plays next" +
    (firstBad ? "  first: " + JSON.stringify(firstBad) : ""));
  eq(pegBad, 0, "pegging points (pairs, runs, 15, 31, go, last card) match the referee every hand");
  eq(showBad, 0, "the dealer's hand and the crib are counted exactly as the rules say");
  lap("whole hands");
}

// ---------------------------------------------------------------- results
if (failures.length) {
  console.log(`\n  ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.log("  ✗ " + f + "\n");
  process.exit(1);
}
console.log(`\n  exhaustive — ${passed} assertions passed\n`);
