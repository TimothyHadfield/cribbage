/* ============================================================================
 * build-crib-ev.js — generates js/crib-ev.js, the AI's crib lookup table.
 *
 *     node tools/build-crib-ev.js [samples]
 *
 * WHY A TABLE. Choosing a discard means comparing "what do I keep" against
 * "what am I giving away". The first half is exact and cheap — 15 possible
 * keeps × 46 possible starters. The second half is not: the crib's value
 * depends on two cards the opponent hasn't chosen yet and a starter nobody has
 * cut. Evaluating that honestly at decision time would mean ~700,000 hand
 * evaluations per discard, which is a visible freeze in a browser. So it is
 * measured once, here, and shipped as 169 numbers.
 *
 * THE OPPONENT MODEL. Crib value depends on what the other player throws, so
 * the sampler doesn't throw at random — it deals the opponent six cards and
 * has them keep the four with the best standalone value, which is roughly what
 * a person does. This is a deliberate simplification: a real non-dealer throws
 * defensively to the dealer's crib and a real dealer throws generously to
 * their own, so one shared table slightly overvalues the enemy crib and
 * undervalues your own. The error is a fraction of a point and identical in
 * both directions, which is the sort of approximation that costs nothing in
 * play. Replacing it needs the table to model itself, so it stays.
 *
 * The output file is checked in — you only rerun this if the model changes.
 * ==========================================================================*/

const fs = require("fs");
const path = require("path");
const S = require("../js/score.js");

const SAMPLES = parseInt(process.argv[2], 10) || 8000;

// Deterministic, so regenerating the table produces the same file and a diff
// means a real change rather than sampling noise.
let seed = 20260810;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

const card = (rank, suit) => suit * 13 + (rank - 1);

/** What a plain player keeps from six cards, judged without a starter. */
function opponentDiscard(six) {
  let bestScore = -1;
  let bestPair = null;
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      const keep = [];
      for (let k = 0; k < 6; k++) if (k !== i && k !== j) keep.push(six[k]);
      const v = S.handValue(keep, null, false);
      if (v > bestScore) { bestScore = v; bestPair = [six[i], six[j]]; }
    }
  }
  return bestPair;
}

/** Mean crib value when THESE two cards are thrown in. */
function measure(a, b) {
  const pool = S.fullDeck().filter((c) => c !== a && c !== b); // 50 cards
  const n = pool.length;
  let total = 0;

  for (let s = 0; s < SAMPLES; s++) {
    // Partial Fisher-Yates: the first seven slots become a fresh random draw
    // while the array stays a valid permutation for the next sample.
    for (let i = 0; i < 7; i++) {
      const j = i + Math.floor(rnd() * (n - i));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const six = pool.slice(0, 6);
    const starter = pool[6];
    const thrown = opponentDiscard(six);
    total += S.handValue([a, b, thrown[0], thrown[1]], starter, true);
  }
  return total / SAMPLES;
}

// ---------------------------------------------------------------- generate
const table = {};
const started = Date.now();
let done = 0;
const totalKeys = 13 * 14 / 2 + 78; // 91 rank pairs + the 78 suited variants

for (let r1 = 1; r1 <= 13; r1++) {
  for (let r2 = r1; r2 <= 13; r2++) {
    // Unsuited representative: same ranks, different suits.
    table[`${r1}-${r2}-0`] = +measure(card(r1, 0), card(r2, 1)).toFixed(3);
    done++;
    // Suited representative — impossible when the ranks match, since that
    // would be the same card twice.
    if (r1 !== r2) {
      table[`${r1}-${r2}-1`] = +measure(card(r1, 0), card(r2, 0)).toFixed(3);
      done++;
    }
    process.stdout.write(`\r  ${done}/${totalKeys} discards measured…`);
  }
}
const secs = ((Date.now() - started) / 1000).toFixed(1);
process.stdout.write(`\r  ${done}/${totalKeys} discards measured in ${secs}s\n`);

// ------------------------------------------------------------------ report
const entries = Object.entries(table).sort((a, b) => b[1] - a[1]);
console.log("\n  Most valuable throws:");
for (const [k, v] of entries.slice(0, 6)) console.log(`    ${describe(k)}  ${v.toFixed(2)}`);
console.log("  Least valuable throws:");
for (const [k, v] of entries.slice(-6)) console.log(`    ${describe(k)}  ${v.toFixed(2)}`);

function describe(key) {
  const [r1, r2, suited] = key.split("-").map(Number);
  const nm = (r) => S.RANK_NAMES[r - 1];
  return `${nm(r1)}-${nm(r2)}${suited ? " suited" : ""}`.padEnd(16);
}

// ------------------------------------------------------------------- write
const out = `/* ============================================================================
 * crib-ev.js — GENERATED FILE. Do not edit by hand.
 *
 *   node tools/build-crib-ev.js         (${SAMPLES} samples per entry)
 *
 * Expected value of the crib for each pair of cards thrown into it, keyed by
 * "lowRank-highRank-suited". Ranks are 1..13 (ace low, king high); the suited
 * flag is 1 when both thrown cards share a suit, which matters only because a
 * crib flush needs all five cards to match.
 *
 * See tools/build-crib-ev.js for the sampling method and its known limits.
 * ==========================================================================*/

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined") root.CribEV = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TABLE = ${JSON.stringify(table, null, 0).replace(/","/g, '","\n    "').replace(/^\{/, "{\n    ").replace(/\}$/, ",\n  }")};

  /** Expected crib value of throwing these two cards. Order does not matter. */
  function cribEV(a, b) {
    const ra = (a % 13) + 1, rb = (b % 13) + 1;
    const lo = Math.min(ra, rb), hi = Math.max(ra, rb);
    const suited = Math.floor(a / 13) === Math.floor(b / 13) ? 1 : 0;
    const v = TABLE[lo + "-" + hi + "-" + suited];
    return v === undefined ? TABLE[lo + "-" + hi + "-0"] : v;
  }

  return { cribEV, TABLE };
});
`;

const dest = path.join(__dirname, "..", "js", "crib-ev.js");
fs.writeFileSync(dest, out, "utf8");
console.log(`\n  wrote ${path.relative(process.cwd(), dest)} — ${Object.keys(table).length} entries, ${SAMPLES} samples each\n`);
