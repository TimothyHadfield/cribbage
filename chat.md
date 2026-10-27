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
