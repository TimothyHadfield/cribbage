# Progress

Running notes for whoever picks this up next — including me. Read this before
changing anything; `README.md` explains how the code works, this explains where
it stands and why.

_Last updated: 2026-08-10_

---

## Where it stands

**Playing the computer works end to end and is finished.** A full game to 121
has been played through in a real browser (headless Chrome, driving the actual
DOM) with no console errors — deal, discard, cut, pegging with gos and 31s, the
show in the right order, the deal alternating, and the game stopping dead on
121 mid-show with the crib uncounted.

**Online play is written but has never connected to a live Firebase project**,
because there isn't one yet. See "What's blocked" below.

| Piece | State |
|---|---|
| Scoring (`js/score.js`) | Done. 81 assertions. |
| Engine (`js/engine.js`) | Done. 95 assertions, incl. 300 random full games. |
| AI (`js/ai.js`, `js/crib-ev.js`) | Done. 71 assertions + a 900-game tournament. |
| UI (`index.html`, `js/ui.js`, `js/app.js`) | Done, verified in a browser. |
| vs computer (`js/local.js`) | Done. |
| Online (`js/online.js`, `firestore.rules`) | Written, **unverified against a real project**. |
| Security-rules tests | Written, **could not be run** — see below. |
| Deployment | Not done. Not pushed anywhere. |
| Simulated-hand statistics | Deliberately not started. |

## What's blocked, and on whom

**1. Online play needs a Firebase project that only you can create.**
`js/firebase-config.js` is deliberately `null`, which makes `Online.ready`
false and the menu say so rather than failing at a network call. The six setup
steps are in README.md → "Setting up online play". Nothing else is waiting on
anything.

**2. The security-rules tests cannot run on this machine.** The Firestore
emulator exits immediately and silently with code `-1`. This is *not* a problem
with `firestore.rules` or the test — the identical failure happens in the
sibling Secret Hitler project, which has run these tests before. It looks like
the known incompatibility between the bundled emulator jar and **Java 21**
(installed here: 21.0.5). Try a JDK 17 `JAVA_HOME`, or
`firebase setup:emulators:firestore` for a newer jar. Until then
`test/rules.test.js` is 60-odd unexecuted assertions.

That matters more than it sounds: with no server and anonymous sign-in, those
rules are the entire security boundary. **Run them before pointing this at a
real project.**

## Decisions worth not relitigating

- **Host-authoritative, and the host can see your cards.** Accepted knowingly.
  Cloud Functions need the paid plan; the project stays on Spark. Documented in
  the README rather than hidden. The engine is kept pure specifically so a real
  referee can be dropped in later.
- **Anonymous auth.** Nobody should have to make an account to play one game.
  Account linking is a later, optional addition — the data model doesn't
  prevent it.
- **The crib table is sampled, not exact,** with a simplified opponent model
  (they keep their best four). This slightly overvalues the enemy crib and
  undervalues your own, symmetrically, by a fraction of a point. Modelling it
  properly needs the table to model itself. See the header of
  `tools/build-crib-ev.js` before "improving" it.
- **Cards are integers 0-51, not objects.** The AI evaluates hundreds of
  thousands of hands per decision, and Firestore stores flat number arrays
  happily.
- **`handValue` duplicates `scoreHand`.** Intentional: one is the readable
  itemised version for the UI, one is the allocation-free version for the AI's
  hot loop. `test/score.test.js` cross-checks them over 20,000 random deals so
  they cannot drift apart silently.
- **Log lines are all "Name: thing" form.** Because one player is usually
  called "You", and third-person prose produces "You cuts the nine".

## Gotchas discovered the hard way

- **Firestore rejects arrays containing arrays.** The scoring breakdown is
  exactly that, so `js/online.js` ships it as `showItemsJson` and rebuilds it
  on arrival. Per-player lists are `pegPlayed0` / `pegPlayed1` for the same
  reason.
- **The matchmaking query deliberately avoids a composite index.** It uses one
  `orderBy` and filters `claimedBy` client-side. Adding `where("claimedBy","==",null)`
  would work but silently require an index nobody remembers to create.
- **"Go" is automatic, not a button.** A player with no legal card has no
  decision to make, and a button there is one more way for an online game to
  stall waiting on someone.

## Next, in order

1. Create the Firebase project; fill in `js/firebase-config.js`; deploy the rules.
2. Fix the emulator (Java 17) and actually run `test/rules.test.js`.
3. Two browsers, one normal and one private: confirm two searchers pair exactly
   once and neither is orphaned in the queue; confirm a room code works;
   confirm in the Firestore console that neither `private/{uid}` document is
   readable by the other player; reload the host mid-game and confirm it resumes.
4. Deploy: own repo `cribbage`, Pages from `main` / root, then add a card to
   `../Hub/index.html` and a row to `../Hub/README.md`.
5. Only then: simulated-hand statistics. `js/engine.js` and `js/ai.js` are pure
   and Node-requireable, and `test/ai.test.js` already contains a headless
   self-play driver that a simulation harness can start from.

## Ideas parked

- Account linking, so a returning player keeps a record.
- Muggins (claiming points your opponent missed) — fun, but it needs the show
  to become interactive rather than a Continue button.
- Three- and four-player cribbage. The engine assumes two seats throughout.
- A traditional peg-holes board instead of the two lanes. The lanes read better
  on a phone, which is where this will mostly be played.
