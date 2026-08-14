/* ============================================================================
 * score.js — cribbage scoring. Pure functions, no DOM, no network.
 *
 * This is the foundation everything else stands on: the UI, the AI's expected-
 * value search, and the online referee all count points through here. It is
 * deliberately dependency-free and Node-requireable so `test/score.test.js`
 * can hammer it without a browser.
 *
 * CARD REPRESENTATION: a card is a plain integer 0-51.
 *     rank = (card % 13) + 1     1=A, 2-10, 11=J, 12=Q, 13=K
 *     suit = Math.floor(card / 13)   0=♠ 1=♥ 2=♦ 3=♣
 * Integers (rather than {rank,suit} objects) because the AI evaluates hundreds
 * of thousands of hands per decision, and because Firestore stores flat arrays
 * of numbers happily but rejects nested arrays of objects less happily.
 *
 * Scoring functions return { points, items } — an itemised breakdown, not a
 * bare number. The UI shows the player *why* a hand counted 12, and the tests
 * read far better when a failure names the run it disagreed about.
 * ==========================================================================*/

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined") root.Score = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SUIT_SYMBOLS = ["♠", "♥", "♦", "♣"]; // ♠ ♥ ♦ ♣
  const SUIT_LETTERS = ["S", "H", "D", "C"];
  const RANK_NAMES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

  const rankOf = (c) => (c % 13) + 1;
  const suitOf = (c) => Math.floor(c / 13);
  /** Counting value: face cards are all 10, ace is 1. */
  const valueOf = (c) => Math.min(rankOf(c), 10);
  const isRed = (c) => suitOf(c) === 1 || suitOf(c) === 2;

  const cardName = (c) => RANK_NAMES[rankOf(c) - 1] + SUIT_SYMBOLS[suitOf(c)];
  const cardCode = (c) => RANK_NAMES[rankOf(c) - 1] + SUIT_LETTERS[suitOf(c)];

  /** Build a card id from a "5S" / "10H" / "JD" style code — for tests and fixtures. */
  function cardFromCode(code) {
    const s = String(code).trim().toUpperCase();
    const suitLetter = s.slice(-1);
    const rankPart = s.slice(0, -1);
    const suit = SUIT_LETTERS.indexOf(suitLetter);
    const rank = RANK_NAMES.indexOf(rankPart) + 1;
    if (suit < 0 || rank < 1) throw new Error("Bad card code: " + code);
    return suit * 13 + (rank - 1);
  }
  const cardsFromCodes = (str) =>
    String(str).split(/[\s,]+/).filter(Boolean).map(cardFromCode);

  /** A fresh ordered deck. Shuffling lives in engine.js, which owns randomness. */
  const fullDeck = () => Array.from({ length: 52 }, (_, i) => i);

  // ---------------------------------------------------------------- helpers
  /** All subsets of `arr` with at least `min` members, as arrays of members. */
  function subsets(arr, min) {
    const out = [];
    const n = arr.length;
    for (let mask = 1; mask < 1 << n; mask++) {
      let size = 0;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) size++;
      if (size < min) continue;
      const pick = [];
      for (let i = 0; i < n; i++) if (mask & (1 << i)) pick.push(arr[i]);
      out.push(pick);
    }
    return out;
  }

  /** Cartesian product of arrays — used to expand a double run into its combinations. */
  function product(lists) {
    let acc = [[]];
    for (const list of lists) {
      const next = [];
      for (const prefix of acc) for (const item of list) next.push(prefix.concat([item]));
      acc = next;
    }
    return acc;
  }

  const byRank = (a, b) => rankOf(a) - rankOf(b);

  // ------------------------------------------------------------ the show
  /**
   * Score a 4-card hand against the starter.
   *
   * @param {number[]} hand    exactly 4 cards
   * @param {number}   starter the cut card
   * @param {object}   [opts]  { isCrib: boolean } — the crib's flush rule is stricter
   * @returns {{points:number, items:Array<{type:string,points:number,cards:number[],label:string}>}}
   */
  function scoreHand(hand, starter, opts) {
    const isCrib = !!(opts && opts.isCrib);
    const items = [];
    const all = hand.concat(starter == null ? [] : [starter]);

    // ---- fifteens: every subset summing to exactly 15, two points each ----
    for (const sub of subsets(all, 2)) {
      let sum = 0;
      for (const c of sub) sum += valueOf(c);
      if (sum === 15) {
        items.push({ type: "fifteen", points: 2, cards: sub.slice(), label: "Fifteen" });
      }
    }

    // ---- pairs: every unordered pair of equal rank. Trips fall out as 3
    // pairs (6), quads as 6 pairs (12) — no special cases needed. ----
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (rankOf(all[i]) === rankOf(all[j])) {
          items.push({ type: "pair", points: 2, cards: [all[i], all[j]], label: "Pair" });
        }
      }
    }

    // ---- runs ----
    // Group by rank, find every MAXIMAL consecutive stretch of ranks, and keep
    // only stretches of 3+. A stretch scores (length × the product of how many
    // cards sit on each rank), which is what makes a double run 8 and a
    // double-double 16 without enumerating those cases by name.
    const byRankMap = new Map();
    for (const c of all) {
      const r = rankOf(c);
      if (!byRankMap.has(r)) byRankMap.set(r, []);
      byRankMap.get(r).push(c);
    }
    const ranks = [...byRankMap.keys()].sort((a, b) => a - b);
    let stretch = [];
    const flushStretch = () => {
      if (stretch.length >= 3) {
        const lists = stretch.map((r) => byRankMap.get(r));
        for (const combo of product(lists)) {
          items.push({
            type: "run",
            points: stretch.length,
            cards: combo.slice().sort(byRank),
            label: "Run of " + stretch.length,
          });
        }
      }
      stretch = [];
    };
    for (let i = 0; i < ranks.length; i++) {
      if (i > 0 && ranks[i] !== ranks[i - 1] + 1) flushStretch();
      stretch.push(ranks[i]);
    }
    flushStretch();

    // ---- flush ----
    // In the HAND: four matching cards score 4, five score 5.
    // In the CRIB: only a five-card flush counts at all. This asymmetry is the
    // single most commonly mis-implemented rule in cribbage.
    if (hand.length === 4) {
      const s0 = suitOf(hand[0]);
      const handFlush = hand.every((c) => suitOf(c) === s0);
      if (handFlush) {
        const withStarter = starter != null && suitOf(starter) === s0;
        if (withStarter) {
          items.push({ type: "flush", points: 5, cards: all.slice(), label: "Flush (5)" });
        } else if (!isCrib) {
          items.push({ type: "flush", points: 4, cards: hand.slice(), label: "Flush (4)" });
        }
      }
    }

    // ---- his nobs: a jack in hand matching the starter's suit ----
    if (starter != null) {
      for (const c of hand) {
        if (rankOf(c) === 11 && suitOf(c) === suitOf(starter)) {
          items.push({ type: "nobs", points: 1, cards: [c], label: "His nobs" });
        }
      }
    }

    let points = 0;
    for (const it of items) points += it.points;
    return { points, items };
  }

  /**
   * Fast path for the AI: the same number `scoreHand` returns, without building
   * the breakdown. The discard search calls this ~700 times per decision (and
   * far more when sampling the crib), so it avoids all the array allocation.
   */
  function handValue(hand, starter, isCrib) {
    let points = 0;
    const all = starter == null ? hand : hand.concat([starter]);
    const n = all.length;

    const vals = new Array(n);
    const rks = new Array(n);
    for (let i = 0; i < n; i++) {
      const c = all[i];
      const r = (c % 13) + 1;
      rks[i] = r;
      vals[i] = r < 10 ? r : 10;
    }

    // fifteens
    for (let mask = 1; mask < 1 << n; mask++) {
      let sum = 0;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) sum += vals[i];
      if (sum === 15) points += 2;
    }

    // pairs + run stretches, from a rank histogram
    const counts = new Array(14).fill(0);
    for (let i = 0; i < n; i++) counts[rks[i]]++;
    for (let r = 1; r <= 13; r++) {
      const k = counts[r];
      if (k > 1) points += k * (k - 1); // 2 points × k-choose-2 pairs
    }
    let len = 0, mult = 1;
    for (let r = 1; r <= 14; r++) {
      if (r <= 13 && counts[r] > 0) {
        len++;
        mult *= counts[r];
      } else {
        if (len >= 3) points += len * mult;
        len = 0;
        mult = 1;
      }
    }

    // flush
    if (hand.length === 4) {
      const s0 = Math.floor(hand[0] / 13);
      if (
        Math.floor(hand[1] / 13) === s0 &&
        Math.floor(hand[2] / 13) === s0 &&
        Math.floor(hand[3] / 13) === s0
      ) {
        if (starter != null && Math.floor(starter / 13) === s0) points += 5;
        else if (!isCrib) points += 4;
      }
    }

    // nobs
    if (starter != null) {
      const ss = Math.floor(starter / 13);
      for (let i = 0; i < hand.length; i++) {
        if ((hand[i] % 13) + 1 === 11 && Math.floor(hand[i] / 13) === ss) points += 1;
      }
    }

    return points;
  }

  // ------------------------------------------------------------- the play
  /**
   * Score the card just played during pegging.
   *
   * @param {number[]} seq   cards played since the last reset to zero, INCLUDING
   *                         the card just laid, in play order
   * @returns {{points:number, items:Array}}
   *
   * `go` and last-card points are the engine's business, not this function's —
   * they depend on whose turn it is, not on the cards.
   */
  function scorePegPlay(seq) {
    const items = [];
    if (!seq.length) return { points: 0, items };

    let count = 0;
    for (const c of seq) count += valueOf(c);

    // Labels are bare — "Pair", not "Pair for 2". Callers that want the points
    // in the sentence add them; engine.js's log line is "Name: Label for N".
    if (count === 15) items.push({ type: "fifteen", points: 2, cards: seq.slice(), label: "Fifteen" });
    if (count === 31) items.push({ type: "thirtyone", points: 2, cards: seq.slice(), label: "Thirty-one" });

    // Pairs: how many cards at the END of the sequence share the new card's rank.
    const lastRank = rankOf(seq[seq.length - 1]);
    let same = 0;
    for (let i = seq.length - 1; i >= 0 && rankOf(seq[i]) === lastRank; i--) same++;
    if (same >= 2) {
      // 2 for a pair, 6 for three of a kind, 12 for four — that's k(k-1).
      const pts = same * (same - 1);
      const labels = { 2: "Pair", 3: "Three of a kind", 4: "Four of a kind" };
      items.push({
        type: "pair",
        points: pts,
        cards: seq.slice(seq.length - same),
        label: labels[same] || "Pair",
      });
    }

    // Runs: the longest tail of the sequence whose ranks are distinct and
    // consecutive. Order within that tail does not matter — 5,3,4 is a run of
    // three — which is why this checks the rank SPAN rather than sortedness.
    for (let len = seq.length; len >= 3; len--) {
      const tail = seq.slice(seq.length - len);
      const rs = tail.map(rankOf);
      const uniq = new Set(rs);
      if (uniq.size !== len) continue;
      if (Math.max(...rs) - Math.min(...rs) !== len - 1) continue;
      items.push({
        type: "run",
        points: len,
        cards: tail.slice().sort(byRank),
        label: "Run of " + len,
      });
      break; // only the longest run counts
    }

    let points = 0;
    for (const it of items) points += it.points;
    return { points, items };
  }

  /** Running total of a pegging sequence. */
  function pegCount(seq) {
    let n = 0;
    for (const c of seq) n += valueOf(c);
    return n;
  }

  return {
    SUIT_SYMBOLS, SUIT_LETTERS, RANK_NAMES,
    rankOf, suitOf, valueOf, isRed, cardName, cardCode, cardFromCode, cardsFromCodes,
    fullDeck, subsets,
    scoreHand, handValue, scorePegPlay, pegCount,
  };
});
