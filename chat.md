# Cribbage — session log

One entry per session, newest last. Older entries move to `docs/archive/`.

## 2026-10-17 — handoff refresh
- **Asked (manager, for Tim):** PROGRESS.md was dated 2026-08-10 and said "not deployed"; rewrite it in place so it is true today, in Tim's handoff format. Tim: "any fixes or improvements you feel confident about go ahead and do, pretty much always. You don't have to ask me."
- **Decided:** docs only, no code changes. Old PROGRESS.md body archived verbatim to `docs/archive/PROGRESS-2026-08-10.md`.
- **Built:** new PROGRESS.md; this chat.md (first entry); one stale pointer in CLAUDE.md ("step 1 of PROGRESS.md Next" → "Authorized next steps").
- **Verified how:** `curl -sI` live site → 200 from GitHub.com; live index.html, js/app.js, js/online.js, js/firebase-config.js byte-identical to HEAD `2277252`. `node test/score|engine|ai.test.js` → 81 / 95 / 71 pass. `cd test && npm test` (emulator, Java 21.0.12) → 59 passed, 0 failed. `node test/exhaustive.test.js` → 43 assertions pass (~350 s). `js/firebase-config.js` read: `const FIREBASE_CONFIG = null;`.
- **Open:** Firebase project (Tim only). Rules hardenings before going online (queue `createdAt` pin, claim timeout). Worktree `.claude/worktrees/fix-1017` with uncommitted edits seen; not mine, left alone.
