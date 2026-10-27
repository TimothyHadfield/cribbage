/* muggins.test.js — the optional "count your own hand" rule.
 *     node test/muggins.test.js
 *
 * With muggins on for a seat, that seat's hand and crib are NOT counted for it:
 * the show stops, the breakdown stays hidden, and the player must claim a
 * number. Claim short and the opponent takes the points you missed ("Muggins").
 * Claim too much and you only get what is really there. Off by default.
 */
const S = require("../js/score.js");
const E = require("../js/engine.js");

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

/** Discard, cut and peg with the first legal card until the show starts (or someone wins). */
function toShow(st, rng) {
  for (let i = 0; i < 200 && st.phase !== "show" && st.winner === null; i++) {
    let a;
    if (st.phase === "discard") {
      const p = st.dealt[0].length ? 1 : 0;
      a = { type: "discard", by: st.uids[p], cards: st.hands[p].slice(0, 2) };
    } else if (st.phase === "cut") a = { type: "cut", by: st.uids[E.other(st.dealer)] };
    else if (st.phase === "pegging") {
      const p = st.peg.turn;
      a = { type: "play", by: st.uids[p], card: E.legalPlays(st, p)[0] };
    }
    const r = E.applyAction(st, a, rng);
    if (!r.ok) throw new Error(r.error);
    st = r.state;
  }
  return st;
}

/** Find a seeded game whose first show reaches the given seat's hand with points > 0. */
function findGame(mugSeat, wantPoints) {
  for (let seed = 1; seed < 400; seed++) {
    const rng = seeded(seed);
    const muggins = [false, false]; muggins[mugSeat] = true;
    let st = E.initGame(P, rng, { muggins });
    st = toShow(st, rng);
    if (st.phase !== "show") continue;
    // walk the show until the muggins seat is up
    while (st.phase === "show" && !st.show.pending && st.show.step < 2) {
      st = E.applyAction(st, { type: "next", by: "a" }, rng).state;
    }
    if (st.phase === "show" && st.show.pending && st.show.who === mugSeat && wantPoints(st.show.points)) return { st, rng };
  }
  throw new Error("no fixture found");
}

// ---- default: no muggins, nothing pending, same as before ----
{
  const rng = seeded(7);
  let st = E.initGame(P, rng);
  eq(st.muggins, [false, false], "muggins is off for both seats by default");
  st = toShow(st, rng);
  ok(st.phase === "show" && !st.show.pending, "default show counts automatically");
}

// ---- pending: hidden breakdown, next refused ----
{
  const { st, rng } = findGame(0, (p) => p >= 2);
  const pub = E.publicView(st);
  eq(pub.showPending, true, "public view says a claim is pending");
  eq(pub.showItems, [], "the breakdown is hidden while the claim is pending");
  eq(pub.showPoints, null, "the total is hidden while the claim is pending");
  ok(pub.showCards.length === 4 || pub.showCards.length === 4, "the cards being counted are shown");
  const before = st.scores.slice();
  eq(E.applyAction(st, { type: "next", by: "a" }, rng).ok, false, "next is refused until the hand is claimed");
  eq(E.applyAction(st, { type: "claim", by: "b", points: 3 }, rng).ok, false, "only the counting player may claim");
  eq(E.applyAction(st, { type: "claim", by: "a", points: 30 }, rng).ok, false, "a claim over 29 is refused");
  eq(E.applyAction(st, { type: "claim", by: "a", points: -1 }, rng).ok, false, "a negative claim is refused");

  // exact claim
  const exact = E.applyAction(st, { type: "claim", by: "a", points: st.show.points }, rng).state;
  eq(exact.scores[0], Math.min(121, before[0] + st.show.points), "an exact claim scores the hand");
  eq(exact.scores[1], before[1], "an exact claim gives the opponent nothing");
  eq(exact.show.pending, false, "claim clears the pending flag");
  eq(E.publicView(exact).showItems.length > 0, true, "breakdown revealed after the claim");
  eq(E.publicView(exact).showClaim, st.show.points, "the claim is public");

  // short claim -> muggins
  const short = E.applyAction(st, { type: "claim", by: "a", points: 1 }, rng).state;
  eq(short.scores[0], before[0] + 1, "a short claim scores only what was claimed");
  eq(short.scores[1], Math.min(121, before[1] + st.show.points - 1), "the opponent takes the missed points");
  ok(short.log.some((l) => /Muggins/.test(l.text) && l.by === 1), "the log says Muggins for the opponent");

  // over claim -> corrected
  const over = E.applyAction(st, { type: "claim", by: "a", points: 29 }, rng).state;
  eq(over.scores[0], Math.min(121, before[0] + st.show.points), "an over-claim is corrected to the real count");
  eq(over.scores[1], before[1], "an over-claim costs the opponent nothing");

  // after claiming, next works
  ok(E.applyAction(exact, { type: "next", by: "a" }, rng).ok, "next works after the claim");
}

// ---- the other seat is untouched ----
{
  const { st } = findGame(1, (p) => p >= 0);
  eq(st.show.who, 1, "seat 1 claims its own hand");
}

// ---- a zero hand claimed as zero ----
{
  const { st, rng } = findGame(0, (p) => p === 0);
  const r = E.applyAction(st, { type: "claim", by: "a", points: 0 }, rng);
  ok(r.ok && r.state.scores[0] === st.scores[0] && r.state.scores[1] === st.scores[1], "claiming nothing on a nineteen changes no score");
}

// ---- JSON-safe (online carries the state) ----
{
  const { st } = findGame(0, (p) => p >= 0);
  eq(JSON.parse(JSON.stringify(st)).show.pending, true, "pending survives JSON");
}

console.log(failures.length ? `\n  ${passed} passed, ${failures.length} FAILED\n` : `\n  muggins — ${passed} assertions passed\n`);
for (const f of failures) console.log("  ✗ " + f + "\n");
if (failures.length) process.exit(1);
