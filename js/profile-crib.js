/* ============================================================================
 * profile-crib.js — Cribbage's part of the shared player profile
 * (js/profile.js is the shared kit; never edit that one here).
 * Level ratings, the achievement list, and turning a finished game into a result.
 * ==========================================================================*/

(function (root) {
  "use strict";

  /* Elo of each computer level, measured by tools/measure-levels.js
   * (3,000 seeded games per pair, seats swapped, 2026-10-28, after Hard got the
   * whole-play search and Medium stopped looking at the reply):
   *   medium beat easy 67.7% (+129), hard beat medium 66.7% (+121), hard beat easy 81.6% (+259).
   *   (2026-10-27 before: 76.0% / 53.0% / 80.6%.)
   * Easy anchored at 1000; Hard = mean of its two paths (1250, 1259), rounded. */
  const LEVELS = [
    { id: "easy", name: "Easy", rating: 1000 },
    { id: "medium", name: "Medium", rating: 1129 },
    { id: "hard", name: "Hard", rating: 1255 },
  ];
  const RANK = { easy: 0, medium: 1, hard: 2 };
  const won = (c) => !!(c.last && c.last.won);
  const x = (c) => (c.last && c.last.extra) || {};

  const ACHIEVEMENTS = [
    { id: "first", title: "First win", desc: "Win a game", test: (c) => c.stats.wins >= 1 },
    { id: "medium", title: "Counting every cut", desc: "Beat Medium", test: (c) => won(c) && RANK[c.last.level] >= 1 },
    { id: "hard", title: "Crib master", desc: "Beat Hard", test: (c) => won(c) && c.last.level === "hard" },
    { id: "skunk", title: "Skunked", desc: "Win by 31 or more", test: (c) => won(c) && x(c).skunk >= 1 },
    { id: "double", title: "Double skunk", desc: "Win by 61 or more", test: (c) => won(c) && x(c).skunk >= 2 },
    { id: "twenty", title: "Big hand", desc: "Hold a hand worth 20+", test: (c) => (x(c).bestHand || 0) >= 20 },
    { id: "muggins", title: "Honest count", desc: "Win with muggins on", test: (c) => won(c) && !!x(c).muggins },
    { id: "streak", title: "Hat trick", desc: "Win 3 in a row", test: (c) => c.stats.bestStreak >= 3 },
    { id: "daily", title: "Daily habit", desc: "3-day Daily streak", test: (c) => c.daily && c.daily.streak >= 3 },
  ];

  /**
   * A finished game -> Profile.recordResult input. Games vs the computer are
   * rated unless you used a hint or Undo (then they count under "With help").
   */
  function result({ pub, seat, level, helped, daily, muggins, bestHand }) {
    const extra = { skunk: pub.winner === seat ? pub.skunk : 0, bestHand: bestHand || 0, muggins: !!muggins, hands: pub.handNumber, score: pub.scores[seat], opp: pub.scores[1 - seat] };
    const mode = helped ? "help" : "computer";
    return { mode, level: mode === "computer" ? level : null, won: pub.winner === seat, daily: !!daily, extra, score: pub.scores[seat] };
  }

  root.CribProfile = { LEVELS, ACHIEVEMENTS, result };
  if (typeof module !== "undefined" && module.exports) module.exports = root.CribProfile;
})(typeof self !== "undefined" ? self : globalThis);
