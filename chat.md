# Cribbage — session log

One entry per session, newest last. Older entries move to `docs/archive/`.

## 2026-10-17 — handoff refresh
- **Asked (manager, for Tim):** PROGRESS.md was dated 2026-08-10 and said "not deployed"; rewrite it in place so it is true today, in Tim's handoff format. Tim: "any fixes or improvements you feel confident about go ahead and do, pretty much always. You don't have to ask me."
- **Decided:** docs only, no code changes. Old PROGRESS.md body archived verbatim to `docs/archive/PROGRESS-2026-08-10.md`.
- **Built:** new PROGRESS.md; this chat.md (first entry); one stale pointer in CLAUDE.md ("step 1 of PROGRESS.md Next" → "Authorized next steps").
- **Verified how:** `curl -sI` live site → 200 from GitHub.com; live index.html, js/app.js, js/online.js, js/firebase-config.js byte-identical to HEAD `2277252`. `node test/score|engine|ai.test.js` → 81 / 95 / 71 pass. `cd test && npm test` (emulator, Java 21.0.12) → 59 passed, 0 failed. `node test/exhaustive.test.js` → 43 assertions pass (~350 s). `js/firebase-config.js` read: `const FIREBASE_CONFIG = null;`.
- **Open:** Firebase project (Tim only). Rules hardenings before going online (queue `createdAt` pin, claim timeout). Worktree `.claude/worktrees/fix-1017` with uncommitted edits seen; not mine, left alone.

## 2026-10-27 — improve wave (builder, resumed after a laptop crash)
- **Asked (manager):** bring Cribbage up to the wave games and past Cribbage Pro: `_table` look + wooden peg board, `_fx` sounds, no-scroll layouts, online via `_online` (Online guard), undo, count review, muggins (off by default), measured levels, `_profile` My stats (rated unless Hint/Undo). 3-player only if cheap.
- **Decided:** online STOPPED by the guard (≈600 writes/game, busy day ≈30% of free writes); kept hidden, old files left. 3-player skipped (engine is 2-seat). Peg board blue = you, orange = computer. Daily game at Hard. Elo anchor Easy 1000.
- **Built:** muggins `claim` in the engine; seeded deals + undo + snapshot/resume in local.js; board.js; profile-crib.js; new index.html/app.js/ui.js; tools/measure-levels.js; tests muggins + local. After a read-only player review: resume after reload, pegging callouts by the count, hold-to-repeat claim, played cards fade, count view without duplicate hand, unique board gradient ids (Chrome bug).
- **Verified how:** muggins and local tests failed on the old code first, then pass (24 / 24); score 81, engine 95, ai 71; exhaustive 43/43. Playwright shots, 8 scenes × 5 sizes (WebKit 393×659, 320×568, 659×393; Chrome 1280×800, 1440×900): no scroll, no overflow, 0 console errors. Reload → Resume restores the same hand and scores (WebKit). Levels: 3,000 games per pair.
- **Open:** Tim's calls — online over the guard, board colours/layout, top-bar icons, claim stepper. Parked polish: ranked throw options, pegging hint, auto-advance count.

## 2026-10-28 — wave 3 "just make the games better" (builder)
- **Asked (manager):** Hard must beat Medium ≥65% (was 53%); Videos in the rules; variants (61 game, five-card) off by default; computer speed / remember setup; layout checks.
- **Decided:** Hard alone topped out ~55.5% vs old Medium (measured), so Medium was also made weaker (near-best keep, greedy pegging) to sit midway. Variants vs computer only; Daily + online stay standard. Variant games still rated.
- **Built:** ai.js whole-play pegging search + random tie-breaks; engine `target`/`fiveCard`; 3-card flush in score.js; board 61 lines; Settings rule switches + Speed; rules Variants + 4 videos; test/variants.test.js; Elo anchors.
- **Verified how:** variants test failed on old engine (crash), 451 pass; new ai.test bar failed on old ai.js (51.7%), passes (71.3%); score/engine/muggins/local/online pass; exhaustive 43/43; measure-levels 3000/pair. Headless WebKit full five-card game to 61 (no errors); screenshots 393, 320, 659×393 (WebKit), 1280, 1440 (Chrome): no overflow, no page scroll. Daily with five-card on → 6 cards, 121.
- **Open:** Tim's calls listed in the report (weaker Medium, variant games rated, labels).

## 2026-11-28 — fit pass (builder, from the manager's all-games brief)
- **Asked:** Tim: "make sure that they all are good in that aspect specifically" (spacing, sizing, can see everything). Focus: peg board, hand of 6/4, pegging pile + count >= 12 px, crib/starter, show breakdown, online screens.
- **Built (c75a769):** pile + starter 58 px on iPhone (rank 9.7 → 12.2), pile overlap grows with its size (`--n` from app.js); small phones and sideways draw table cards corner-index style (rank 7.1/6.3 → 13.4/12.8), hand 58; sideways: scores one per line (fixed "+8+7117" collision), computer's row under the board; breakdown 2 columns when >= 7 lines and >= 340 px wide; laptops <= 760 px tall: smaller board so the hand isn't cut off (was cut ~50 px at 1280×720).
- **Verified how:** new `test/fit-ui.mjs` (7 states × 6 sizes, WebKit phones + Chrome laptops): 188 FAIL on main → all pass. score/engine/muggins/local/variants + online.test pass. Online lobby sheet fits at 393/320/659×393 (no inner scroll, buttons >= 38 px).
- **Open:** none for Tim beyond the report.

## 2026-11-28 — fit pass round 2 (builder, from group manager B)
- **Asked:** after shot had ~170 px of empty felt at 393×659 and the hand sat at the very bottom; use that height (bigger pile, crib/starter, hand higher and larger) so no empty band > ~40 px at 393×659, 390×844, 430×932 in discard, pegging and show. Keep 320 and sideways as good.
- **Built (720597a):** one media block for upright phones (<900 wide, >600 tall): cards grow with height (hand 72 → up to 160, crib/starter 58 → up to 106, pile up to 78, computer's row up to 44, count cards up to the width limit, breakdown text/rows taller); felt shares spare room evenly (space-evenly, empty action row and banner slot collapse); "Your hand" sits in the fan's lift room (−10 px); played cards ride up 4% so an all-played hand doesn't leave a hole. fit-ui: empty-band check + 390×844 and 430×932.
- **Verified how:** band check failed 17× on main (worst 50 / 229 / 335 px at 393 / 390×844 / 430×932) → all pass (worst 36 / 39 / 48). 320, sideways and laptops unchanged. ai/engine/score/muggins/local/variants + online.test pass.
- **Open:** 430×932 limit set at 50 px (cards hit width limits there); a short show count (2–3 lines) still leaves room around the breakdown.
