# Cribbage — progress

## START HERE
Last updated 2026-10-28 (wave 3: stronger Hard, variants, computer speed, videos).
Read order: this file → [CLAUDE.md](CLAUDE.md) (file map, run/test/deploy) → [README.md](README.md) (design; its "Online play" section describes the OLD own-project setup, now dead; live online uses `_online`, see Status) → [chat.md](chat.md) (session log). Pre-October notes: [docs/archive/PROGRESS-2026-08-10.md](docs/archive/PROGRESS-2026-08-10.md).

Live: https://timothyhadfield.github.io/cribbage/ · Repo: `TimothyHadfield/cribbage` (public) · Card on the Board & Card Games hub: yes.

## Goal right now
Brought up to the 2026-10 wave games (improve-1027): table look, wooden peg board, sounds, muggins, undo, count review, My stats, Daily game, resume. **Online is ON** (friend rooms by code) since 2026-10-27, Tim's go: "it'll be okay to enable it to all games for now and we can disable it later if it becomes too much".

## Status
| Piece | State (checked 2026-10-27) |
|---|---|
| Table look | Shared `_table` 1.0.2 cards on felt; SVG wooden peg board (`js/board.js`), 3 streets × 40 in fives, skunk lines; back peg hops past the front one when scoring (animated). |
| Sounds / motion | `_fx` 1.0.3 + Settings sheet (sound, animations, speed). Custom "peg" sound. |
| Count review | Every count itemised (15s, pairs, runs, flush, nobs) and animated; Counts tab lists every count of the game (side column on laptop, sheet on phone). |
| Muggins | Setting, **off by default**. You name your total; missed points go to the computer. Engine-level (`claim` action). |
| Undo vs computer | Throw and each card; not once the count starts or the game ends. Seeded deals per (seed, hand) so undo can't re-cut. |
| Resume | Game in progress saved to localStorage (`cribbage.save.v1`); "Resume game" on the menu after a reload. Cleared on quit / game end. |
| My stats | `_profile` 1.0.1. Games vs computer are **rated** unless Hint or Undo was used ("with help"). Daily game = Hard, same deal for everyone that day. |
| Computer levels | **2026-10-28:** Hard pegs by a whole-play search (minimax over 24 sampled opponent hands, pegging out = terminal); Medium keeps within 1 pt of the best hand and pegs greedily (no reply look-ahead). Measured 3,000 games/pair: Hard beats Medium **66.7% ±1.7** (+121 Elo), Medium beats Easy 67.7% (+129), Hard beats Easy 81.6% (+259). Before: 53.0 / 76.0 / 80.6. Anchors: Easy 1000, Medium 1129, Hard 1255. Online computer seat is Medium (so it got weaker too). |
| Variants | Settings → Rules: **Short game (61)** and **Five-card** (5 dealt, keep 3, play stops at first 31/go, first non-dealer pegs 3, to 61, 3-card flush). Off by default, remembered, vs computer only (Daily and online always standard). Board shows 61 finish + S(31) lines. `test/variants.test.js`. |
| Settings | Computer → Speed Normal/Fast (Fast = 0.4× the computer's pauses), remembered. Level, muggins, variants all remembered. |
| Videos | Rules sheet → Videos: 4 YouTube links (Rulies how-to-play; Huddle Around Games beginners, discard fundamentals, 15 tips), all oEmbed 200 with matching titles 2026-10-28. |
| Layout | No page scroll, no overflow, 0 console errors at 393×659 and 320×568 (WebKit), 659×393 landscape, 1280×800 and 1440×900 (Chrome). 2026-10-27. |
| Tests | score 81, engine 95, ai 71 (~2 min now; hard>medium bar 58% over 400 games), muggins 24, local 24, variants 451 assertions; exhaustive 43/43; `node --test test/online.test.mjs` 6 (failed before `crib-online.js`). `node test/ui.online.mjs <url> [dir]`: two headless phones, real Firestore, whole game with the friend reloading mid-game (10-27: passed, 1.9 min, 121–94, no errors). |
| Online | **On (2026-10-27).** "Play a friend online" on the menu → name, Make a room / Join by 5-letter code. Shared kit `_online` v2 copied as `js/game-online.js` (byte-identical; `js/online.js` was taken by the old code). Rules adapter `js/crib-online.js`, transport `js/net.js` (lazy-loads the kit, Firestore `th-board-games`). Friend rooms only, no matchmaking. Empty seat at start = computer (Medium). Old own-project files (`js/online.js`, `js/firebase-config.js`, `firestore.rules`, `firebase.json`, `test/rules.test.js`) left in the repo, not loaded. |

## Online cost (2026-10-27, measured with the kit cost harness, v2 batching)
- One 2-person game: **331 writes, 693 reads, 71 deletes** (134 moves). Free plan: 20K writes / 50K reads a day → ~60 games a day before writes run out.

## Authorized next steps
- 2026-10-17, Tim: "any fixes or improvements you feel confident about go ahead and do, pretty much always. You don't have to ask me."
- 2026-10-27, Tim: online on for all games ("we can disable it later if it becomes too much"). Done.
- **Not authorized:** removing the old own-project online files (harmless, left for Tim's call).

## Standing instructions (Tim's words)
- "any fixes or improvements you feel confident about go ahead and do, pretty much always. You don't have to ask me." (2026-10-17)
- "For Online play, talk to me before you're going to set something up that requires anything more than the firebase system we already have set up or takes up a large portion of our free plan that we have." (2026-10)
- Global rules apply ($0; Tim decides visuals and wording).

## Traps
- **game-online.js cache stamp (2026-10-27):** `js/net.js` imports the shared kit as `game-online.js?v=a3d0418b`, the `_online` content stamp. After a re-copy: put the new stamp from `node ../_online/tools/stamp.mjs` there, bump `js/net.js?v=` in index.html, then `node ../_online/tools/stamp.mjs --check .` must say OK.
- **SVG gradient ids must be unique per board** (`js/board.js` uses `pb1-…`, `pb2-…`): the menu has a hidden board, and Chrome resolves `url(#id)` to the first match → the game board drew with no wood or holes.
- **Kit copies are byte-identical** (`js/table.js`, `js/fx.js`, `js/profile.js`, `css/table.css`, `css/profile.css`; `.gitattributes` `-text`). Re-copy from `Board and Card Games/_table|_fx|_profile`; never edit here.
- `publicView.log` is only the last 12 lines; use `logCount` to tell which are new (pegging callouts).
- Script tags carry `?v=YYYYMMDDx`; bump on every JS/CSS change or phones keep the old file.
- `js/crib-ev.js` is generated by `tools/build-crib-ev.js`; don't hand-edit.
- Firestore rejects arrays of arrays (old online code: `showItemsJson`, `pegPlayed0/1`).
- No test account (no logins).
- Known small issue: the log can say "Name: go" for a player with no cards left.
- **Hard vs Medium can't reach 65% by strengthening Hard alone** (2026-10-28, measured): pegging search, pegging-aware discards and more samples moved it only 53 → 55.5% vs the old Medium. The ladder came from also making Medium greedy at pegging. Pegging-aware discard gave +0.0 pts/hand — don't retry.
- `tools/measure-levels.js 3000` now takes ~15 min (Hard's search). Saves from before 10-28 have no `target` → treated as 121.

## Decisions
- Peg board replaces the two lanes (2026-10-27 brief: "wooden peg board"). Blue = you (lower row of each street), orange = computer.
- Muggins claim = − / + stepper (hold to repeat) + Claim; you name the total before the breakdown shows.
- Rated unless Hint/Undo used; Daily game always Hard.
- Undo history is per hand; no undo once the count starts.
- Cards are integers 0-51. `handValue` duplicates `scoreHand` on purpose. "Go" is automatic.
- Online = shared `_online` kit (host's phone runs the rules; hands in per-seat private docs). The show's Continue carries step + hand so a double tap can't skip a count. No ratings/My stats for online games; no Play again (new room instead).

## NOT verified
- Real iPhone Safari (WebKit via Playwright only).
- Sounds actually audible (headless has no audio).
- Peg hop animation judged from code + still frames only.
- Resume across an actual iOS tab eviction (tested by page reload).

## Rejected / parked
- ~~Online rooms via `_online` + th-board-games~~ — un-parked and built 2026-10-27 (Tim's go).
- ~~Three-player cribbage~~ — skipped: engine assumes two seats throughout; not cheap.
- ~~Traditional peg-hole board~~ — un-parked and built 2026-10-27.
- ~~Muggins~~ — un-parked and built 2026-10-27 (off by default).
- ~~Account linking~~ — parked: no accounts.
- ~~Cloud Functions referee~~ — rejected: needs the paid Blaze plan ($0 rule).
- ~~Ranked throw options / pegging hint / auto-advance the count~~ — parked from the 2026-10-27 review (polish; next wave).
- ~~Simulated-hand statistics~~ — parked; `test/ai.test.js` has a self-play driver to start from.
