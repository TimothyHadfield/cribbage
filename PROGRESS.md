# Cribbage — progress

## START HERE
Last updated 2026-10-17.
Read order: this file → [CLAUDE.md](CLAUDE.md) (file map, run/test/deploy) → [README.md](README.md) (design, online setup steps) → [chat.md](chat.md) (session log). The full pre-October notes are archived verbatim in [docs/archive/PROGRESS-2026-08-10.md](docs/archive/PROGRESS-2026-08-10.md).

Live: https://timothyhadfield.github.io/cribbage/ · Repo: `TimothyHadfield/cribbage` (public) · Card on the Board & Card Games hub: yes.

## Goal right now
Single-player cribbage vs the computer is **finished and live**. The only open goal is **online play**, which is written and rules-tested but **switched off** (`js/firebase-config.js` exports `null`) until Tim creates/approves a free (Spark) Firebase project. Nothing else is waiting.

## Status
| Piece | State (checked 2026-10-17) |
|---|---|
| Live site | **Live** on GitHub Pages, serving `2277252` (index.html, js/app.js, js/online.js, js/firebase-config.js byte-identical to HEAD). |
| Scoring (`js/score.js`) | Done. 81 assertions pass. Exhaustive test vs an independent reference: no scoring bugs. |
| Engine (`js/engine.js`) | Done. 95 assertions pass (incl. 300 random full games). |
| AI (`js/ai.js`, `js/crib-ev.js`) | Done. 71 assertions pass (+ 900-game tournament). |
| Exhaustive test (`test/exhaustive.test.js`) | **43/43 pass**, re-run 2026-10-17 (~6 min): every deal, every pegging sequence, 20,000 refereed hands. |
| UI / vs computer | Done. Full game to 121 driven headlessly in WebKit at 390px on 2026-10-16: 0 console errors, no overflow. |
| Online (`js/online.js`, `firestore.rules`) | Written. **Off**: `FIREBASE_CONFIG = null`, so the SDK is never loaded and no backend is contacted. Never run against a real project. |
| Rules tests (`test/rules.test.js`) | **59/59 pass** in the local emulator (Java 21.0.12, firebase-tools 15), re-run 2026-10-17. |
| Speed (Lighthouse mobile, 2026-10-16) | Perf 99, A11y 100, page weight 40 KiB (Firebase SDK now lazy-loaded). |
| Simulated-hand statistics | Deliberately not started (comes after online play). |

## Authorized next steps
- 2026-10-17, Tim: "any fixes or improvements you feel confident about go ahead and do, pretty much always. You don't have to ask me." Covers clear fixes, e.g. the two small known issues under Traps and the two rules hardenings below (rules changes need the emulator tests to pass first).
- **Not authorized / Tim only:** creating the Firebase project. Once he has, the order is: fill in `js/firebase-config.js` (README → "Setting up online play"), add `timothyhadfield.github.io` to Authorized domains, deploy rules, then the two-browser check (two searchers pair exactly once, room code works, neither `private/{uid}` readable by the other, host reload resumes).
- Before switching online on (from the 2026-10-16 Firebase audit, still open): pin queue `createdAt == request.time` in the create rule (blocks the 1970-date jam of the 10-oldest window); client timeout for "claimed but no matchId after ~15 s" (someone claims you and walks away). Optional: `keys().hasOnly([...])` on create rules, App Check.

## Standing instructions (Tim's words)
- "any fixes or improvements you feel confident about go ahead and do, pretty much always. You don't have to ask me." (2026-10-17)
- No other quotes from Tim are recorded in this project's files. Global rules apply ($0 / Spark plan only; Tim decides visuals and wording).

## Traps
- **Firestore rejects arrays of arrays**: the show breakdown travels as `showItemsJson`; per-player lists are `pegPlayed0/1`.
- **Matchmaking avoids a composite index on purpose**: one `orderBy`, `claimedBy` filtered client-side.
- **Keep the Firebase SDK import lazy** (`online.js`, dynamic import only when config is set), or every visit downloads ~245 KB.
- **Rules forbid listing `matches/*/private`**, even for the host; cleanup deletes those docs by id.
- **Rules tests need Java 21+** (firebase-tools 15 refuses 17). Run `cd test && npm ci && npm test`.
- **`js/crib-ev.js` is generated** by `tools/build-crib-ev.js`; don't hand-edit.
- **No test account** (anonymous sign-in). `.claude/test/` is git-ignored.
- **Known small issues, not fixed** (judgment calls from the sweep): after playing a card by keyboard, focus jumps to the page top (hand is redrawn); the log can say "Name: go" for a player with no cards left.
- 2026-10-17 fix wave: online Quit's browser `confirm()` replaced by in-page `appConfirm()` (js/app.js, overlay CSS in index.html; commit f55c80b, live). Use `appConfirm`, never browser dialogs. The fix-1017 worktree is merged and removed (branch kept).

## Decisions
- Host-authoritative online play; the host can see your cards. Accepted: Cloud Functions need the paid plan, the project stays on Spark.
- Anonymous auth: nobody needs an account to play one game. Account linking later, optional.
- Crib EV table is sampled with a simplified opponent model; see `tools/build-crib-ev.js` header before "improving" it.
- Cards are integers 0-51 (AI speed, flat Firestore arrays).
- `handValue` duplicates `scoreHand` on purpose (fast vs itemised); tests cross-check them.
- Log lines use "Name: thing" form, because one player is "You".
- "Go" is automatic, not a button.
- Two lanes instead of a peg-hole board: reads better on a phone.

## NOT verified
- Online play against a real Firebase project (none exists). Online fixes from 2026-10-16 are checked only by emulator rules tests and reasoning.
- Real iPhone Safari (only WebKit via phone-view).
- Live site not opened in a browser on 2026-10-17 (checked by curl + byte comparison only).

## Rejected / parked
- ~~Account linking~~ — parked: not needed for one-off games; data model allows it later.
- ~~Muggins~~ — parked: needs an interactive show instead of a Continue button.
- ~~Three- and four-player cribbage~~ — parked: engine assumes two seats throughout.
- ~~Traditional peg-hole board~~ — parked: lanes read better on a phone.
- ~~Cloud Functions referee~~ — rejected: needs the paid Blaze plan ($0 rule).
- ~~Simulated-hand statistics~~ — parked until online play is done; `test/ai.test.js` has a self-play driver to start from.
