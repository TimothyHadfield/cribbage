/* local.test.js — playing the computer: Undo, seeded deals, muggins option.
 *     node test/local.test.js
 */
globalThis.Score = require("../js/score.js");
globalThis.CribEV = require("../js/crib-ev.js");
globalThis.Engine = require("../js/engine.js");
globalThis.AI = require("../js/ai.js");
const Local = require("../js/local.js");
const S = globalThis.Score;

let passed = 0;
const failures = [];
function eq(actual, expected, what) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failures.push(`${what}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const ok = (c, what) => eq(!!c, true, what);
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

Local.pace.discard = Local.pace.cut = Local.pace.play = 1;
let last = null;
Local.listen((v) => { last = v; });
/** Let the computer finish whatever it is doing. */
async function settle() { for (let i = 0; i < 60; i++) { await tick(3); if (!last.thinking) { await tick(3); if (!last.thinking) return; } } }

(async () => {
  // ---- same seed, same deal (Daily game) ----
  Local.start({ level: "hard", seed: 12345 });
  const d1 = last.priv.hand.slice(), dealer1 = last.pub.dealer;
  Local.start({ level: "hard", seed: 12345 });
  eq(last.priv.hand, d1, "the same seed deals the same six cards");
  eq(last.pub.dealer, dealer1, "…and the same dealer");
  Local.start({ level: "hard", seed: 999 });
  ok(JSON.stringify(last.priv.hand) !== JSON.stringify(d1), "a different seed deals differently");

  // ---- undo the throw ----
  Local.start({ level: "hard", seed: 4242 });
  await settle();
  eq(last.canUndo, false, "nothing to undo before your first move");
  const six = last.priv.hand.slice();
  Local.submit({ type: "discard", cards: six.slice(0, 2) });
  await settle();
  eq(last.canUndo, true, "after throwing, Undo is offered");
  // play on to the cut, if it is yours
  if (last.pub.phase === "cut") { Local.submit({ type: "cut" }); await settle(); }
  const starter1 = last.pub.starter;
  ok(starter1 != null, "the starter is cut");
  eq(Local.undo().ok, true, "undo works");
  await settle();
  eq(last.priv.hand, six, "undo gives back all six cards");
  eq(last.pub.phase, "discard", "…in the discard phase");
  eq(Local.undos, 1, "the undo is counted");
  // throw differently, cut again: the starter must be the same card (no re-cut cheat)
  Local.submit({ type: "discard", cards: six.slice(4, 6) });
  await settle();
  if (last.pub.phase === "cut") { Local.submit({ type: "cut" }); await settle(); }
  eq(last.pub.starter, starter1, "re-throwing after undo cuts the same starter");

  // ---- undo a card in the play ----
  for (let i = 0; i < 40 && !(last.pub.phase === "pegging" && last.pub.pegTurn === 0); i++) await settle();
  if (last.pub.phase === "pegging" && last.pub.pegTurn === 0) {
    const hand = last.priv.hand.slice();
    const card = hand.find((c) => last.pub.pegCount + S.valueOf(c) <= 31);
    Local.submit({ type: "play", card });
    await settle();
    Local.undo();
    await settle();
    eq(last.priv.hand, hand, "undo puts the played card back in your hand");
    eq(last.pub.pegTurn, 0, "…and it is your turn again");
  } else ok(false, "reached your turn in the play");

  // ---- muggins option reaches the engine ----
  Local.start({ level: "easy", seed: 7, muggins: true });
  eq(Local._state().muggins, [true, false], "the muggins option is for your seat only");
  Local.start({ level: "easy", seed: 7 });
  eq(Local._state().muggins, [false, false], "muggins is off unless asked for");

  // ---- save + resume (a reload, or iOS dropping the tab) ----
  Local.start({ level: "medium", seed: 4242 });
  await settle();
  Local.submit({ type: "discard", cards: last.priv.hand.slice(0, 2) });
  await settle();
  const saved = JSON.parse(JSON.stringify(Local.snapshot()));
  const before = JSON.stringify(Local._state());
  ok(saved && saved.history.length === 1, "the snapshot keeps the undo history");
  Local.stop();
  eq(Local.resume(saved).ok, true, "a saved game resumes");
  eq(JSON.stringify(Local._state()), before, "the resumed game is exactly the saved one");
  eq(last.canUndo, before.includes('"phase":"show"') ? false : true, "undo still works after resuming");
  eq(Local.resume({ v: 1, state: Object.assign({}, saved.state, { winner: 0 }) }).ok, false, "a finished game doesn't resume");
  Local.stop();

  // ---- a whole game to the end: undo is gone once it's over ----
  Local.start({ level: "easy", seed: 31337 });
  let showChecked = false;
  for (let i = 0; i < 4000 && last.pub.winner === null; i++) {
    await settle();
    const { pub, priv } = last;
    if (pub.winner !== null) break;
    if (pub.phase === "show" && !showChecked) {
      showChecked = true;
      eq(last.canUndo, false, "no undo once the counting starts");
      eq(Local.undo().ok, false, "undo refuses during the show");
    }
    if (pub.phase === "discard" && priv.dealt.length === 0) Local.submit({ type: "discard", cards: priv.hand.slice(0, 2) });
    else if (pub.phase === "cut" && pub.dealer === 1) Local.submit({ type: "cut" });
    else if (pub.phase === "pegging" && pub.pegTurn === 0) Local.submit({ type: "play", card: priv.hand.find((c) => pub.pegCount + S.valueOf(c) <= 31) });
    else if (pub.phase === "show") Local.submit({ type: "next" });
  }
  ok(last.pub.winner !== null, "a full game vs the computer finishes");
  eq(last.canUndo, false, "no undo after the game is over");
  Local.stop();

  console.log(failures.length ? `\n  ${passed} passed, ${failures.length} FAILED\n` : `\n  local.js — ${passed} assertions passed\n`);
  for (const f of failures) console.log("  ✗ " + f + "\n");
  if (failures.length) process.exit(1);
})();
