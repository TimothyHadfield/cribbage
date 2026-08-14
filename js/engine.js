/* ============================================================================
 * engine.js — the cribbage game itself. A pure state machine: no DOM, no
 * network, no timers, no randomness beyond an injected `rng`.
 *
 * WHY PURE: the same code runs in three places. Playing the computer, it runs
 * in your tab. Playing a stranger, it runs in the HOST's tab and the result is
 * published to Firestore. In tests, it runs in Node with a seeded rng. If the
 * engine ever reached for the DOM or `Math.random` directly, none of that
 * would hold — and a desynced referee is the worst bug an online game can have.
 *
 *   initGame(players, rng)        → fresh state, first hand dealt
 *   applyAction(state, act, rng)  → { ok, state, error }   (never mutates)
 *   publicView(state)             → what BOTH players may see
 *   privateView(state, uid)       → what ONE player may see (their cards)
 *
 * The action/view shape mirrors Secret_Hitler/js/engine.js so the online host
 * loop can be lifted across with minimal change.
 * ==========================================================================*/

(function (root, factory) {
  const Score = typeof require === "function" ? require("./score.js") : root.Score;
  const api = factory(Score);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined") root.Engine = api;
})(typeof self !== "undefined" ? self : this, function (S) {
  "use strict";

  const TARGET = 121;
  const other = (p) => (p === 0 ? 1 : 0);
  const clone = (s) => JSON.parse(JSON.stringify(s));

  // ------------------------------------------------------------------ deck
  function shuffled(rng) {
    const deck = S.fullDeck();
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    return deck;
  }

  const bySort = (a, b) => a - b;

  // ----------------------------------------------------------------- setup
  /**
   * @param {Array<{uid:string,name:string}>} players exactly two
   * @param {function():number} rng
   */
  function initGame(players, rng) {
    if (!players || players.length !== 2) throw new Error("Cribbage is a two-player game here.");
    const state = {
      version: 1,
      uids: [players[0].uid, players[1].uid],
      names: [players[0].name || "Player 1", players[1].name || "Player 2"],
      scores: [0, 0],
      prevScores: [0, 0],   // the BACK peg — where you were before your last score
      dealer: Math.floor(rng() * 2),
      handNumber: 0,
      phase: "discard",
      deck: [],
      hands: [[], []],      // cards still IN HAND (shrinks during pegging)
      dealt: [[], []],      // the four kept cards, preserved for the show
      thrown: [[], []],     // what each player put in the crib — private to them
      crib: [],
      starter: null,
      peg: { turn: 0, seq: [], played: [[], []], lastPlayer: null },
      show: { step: 0, items: [], points: 0, who: null, label: "" },
      log: [],
      winner: null,
      skunk: 0,             // 0 none, 1 skunk (<91), 2 double skunk (<61)
    };
    deal(state, rng);
    return state;
  }

  /** Start a hand: shuffle, six each, dealer's crib. */
  function deal(state, rng) {
    state.handNumber++;
    const deck = shuffled(rng);
    state.hands = [deck.slice(0, 6).sort(bySort), deck.slice(6, 12).sort(bySort)];
    state.deck = deck.slice(12);
    state.dealt = [[], []];
    state.thrown = [[], []];
    state.crib = [];
    state.starter = null;
    state.peg = { turn: other(state.dealer), seq: [], played: [[], []], lastPlayer: null };
    state.show = { step: 0, items: [], points: 0, who: null, label: "" };
    state.phase = "discard";
    log(state, `Hand ${state.handNumber} — ${state.names[state.dealer]} to deal.`);
  }

  // --------------------------------------------------------------- scoring
  /**
   * The ONLY place points are ever added. Everything funnels through here so
   * the 121 rule is enforced in exactly one spot: the game stops the instant a
   * peg reaches 121, and surplus points are discarded rather than recorded.
   * A player who wins mid-show never hands the loser a chance to count.
   */
  function award(state, p, points, label) {
    if (!points || state.winner !== null) return;
    state.prevScores[p] = state.scores[p];
    state.scores[p] = Math.min(TARGET, state.scores[p] + points);
    log(state, `${state.names[p]}: ${label} for ${points}`, p, points);
    if (state.scores[p] >= TARGET) {
      state.winner = p;
      state.phase = "gameover";
      const loser = state.scores[other(p)];
      state.skunk = loser < 61 ? 2 : loser < 91 ? 1 : 0;
      log(state, `${state.names[p]}: 121 — game${state.skunk === 2 ? ", a double skunk!" : state.skunk === 1 ? ", a skunk!" : "."}`, p);
    }
  }

  /**
   * Log lines are phrased so they read correctly whatever a player is called.
   * One of the two is usually named "You", so anything in the third person
   * ("Alice cuts the nine") turns into "You cuts the nine". Everything here
   * therefore uses the "Name: thing" form, which agrees with any name.
   */
  function log(state, text, by, points) {
    state.log.push({ text, by: by == null ? null : by, points: points || 0 });
    if (state.log.length > 60) state.log.splice(0, state.log.length - 60);
  }

  // ---------------------------------------------------------------- actions
  /**
   * Apply one action. Returns a NEW state; the input is never mutated, so a
   * rejected action can never leave the game half-changed.
   *
   * Actions: { type:'discard', by, cards:[c,c] }
   *          { type:'cut',     by }
   *          { type:'play',    by, card }
   *          { type:'next',    by }        — acknowledge a show step
   */
  function applyAction(state, action, rng) {
    rng = rng || Math.random;
    if (!action || !action.type) return { ok: false, error: "No action." };
    if (state.winner !== null) return { ok: false, error: "The game is over." };

    const p = state.uids.indexOf(action.by);
    if (p < 0) return { ok: false, error: "You are not in this game." };

    const s = clone(state);
    switch (action.type) {
      case "discard": return doDiscard(s, p, action, rng);
      case "cut":     return doCut(s, p, rng);
      case "play":    return doPlay(s, p, action, rng);
      case "next":    return doNext(s, p, rng);
      default:        return { ok: false, error: "Unknown action." };
    }
  }

  // ---- discard two to the crib ----
  function doDiscard(s, p, action, rng) {
    if (s.phase !== "discard") return { ok: false, error: "Not the discard phase." };
    if (s.dealt[p].length) return { ok: false, error: "You have already discarded." };
    const cards = action.cards || [];
    if (cards.length !== 2) return { ok: false, error: "Discard exactly two cards." };
    if (cards[0] === cards[1]) return { ok: false, error: "Discard two different cards." };
    for (const c of cards) if (!s.hands[p].includes(c)) return { ok: false, error: "You don't hold that card." };

    s.crib = s.crib.concat(cards);
    s.thrown[p] = cards.slice().sort(bySort);
    s.hands[p] = s.hands[p].filter((c) => !cards.includes(c));
    s.dealt[p] = s.hands[p].slice();

    // Both in? Move to the cut. The crib is kept sorted so its order leaks
    // nothing about who contributed which cards.
    if (s.dealt[0].length && s.dealt[1].length) {
      s.crib.sort(bySort);
      s.phase = "cut";
    }
    return { ok: true, state: s };
  }

  // ---- cut for the starter ----
  function doCut(s, p, rng) {
    if (s.phase !== "cut") return { ok: false, error: "Not time to cut." };
    if (p !== other(s.dealer)) return { ok: false, error: "The non-dealer cuts." };
    const idx = Math.floor(rng() * s.deck.length);
    s.starter = s.deck.splice(idx, 1)[0];
    log(s, `${s.names[p]}: cuts the ${S.cardName(s.starter)}`, p);
    // His heels: the dealer takes two for a cut jack — and this can win the game.
    if (S.rankOf(s.starter) === 11) award(s, s.dealer, 2, "His heels");
    if (s.winner === null) {
      s.phase = "pegging";
      s.peg.turn = other(s.dealer); // non-dealer always leads the play
    }
    return { ok: true, state: s };
  }

  // ---- the play (pegging) ----
  function doPlay(s, p, action, rng) {
    if (s.phase !== "pegging") return { ok: false, error: "Not the play phase." };
    if (s.peg.turn !== p) return { ok: false, error: "Not your turn." };
    const card = action.card;
    if (!s.hands[p].includes(card)) return { ok: false, error: "You don't hold that card." };
    const count = S.pegCount(s.peg.seq);
    if (count + S.valueOf(card) > 31) return { ok: false, error: "That would take the count past 31." };

    s.hands[p] = s.hands[p].filter((c) => c !== card);
    s.peg.seq.push(card);
    s.peg.played[p].push(card);
    s.peg.lastPlayer = p;

    const r = S.scorePegPlay(s.peg.seq);
    for (const it of r.items) {
      award(s, p, it.points, it.label);
      if (s.winner !== null) return { ok: true, state: s };
    }

    advancePeg(s, rng);
    return { ok: true, state: s };
  }

  const canPlay = (s, p) => {
    const count = S.pegCount(s.peg.seq);
    return s.hands[p].some((c) => count + S.valueOf(c) <= 31);
  };

  /**
   * Decide who plays next — and hand out the go / last-card point when neither
   * player can move. "Go" is automatic rather than a button: a player with no
   * legal card has no decision to make, and making them click one only creates
   * a way for an online game to stall.
   */
  function advancePeg(s, rng) {
    const last = s.peg.lastPlayer;
    const count = S.pegCount(s.peg.seq);
    const spent = s.hands[0].length === 0 && s.hands[1].length === 0;

    if (count === 31) {
      // Already paid two for the 31 — no go point on top. Reset and the other
      // player leads the next sub-count.
      resetCount(s, last);
    } else if (canPlay(s, other(last))) {
      s.peg.turn = other(last);
      return;
    } else if (canPlay(s, last)) {
      // Opponent says go; the last player carries on alone.
      if (!spent) log(s, `${s.names[other(last)]}: go`, other(last));
      s.peg.turn = last;
      return;
    } else {
      award(s, last, 1, spent ? "Last card" : "Go");
      if (s.winner !== null) return;
      resetCount(s, last);
    }

    if (s.hands[0].length === 0 && s.hands[1].length === 0) {
      s.phase = "show";
      s.show = { step: 0, items: [], points: 0, who: null, label: "" };
      scoreShowStep(s);
    }
  }

  /** Count back to zero; the player who did NOT play last leads. */
  function resetCount(s, last) {
    s.peg.seq = [];
    let t = other(last);
    if (s.hands[t].length === 0 && s.hands[other(t)].length > 0) t = other(t);
    s.peg.turn = t;
  }

  // ---- the show ----
  // Three steps, strictly ordered: non-dealer, dealer, crib. The order is the
  // whole point — in a close game the non-dealer can go out before the dealer
  // ever counts, which is why the engine awards each step separately and stops
  // dead the moment someone reaches 121.
  function showStepInfo(s, step) {
    const nonDealer = other(s.dealer);
    if (step === 0) return { who: nonDealer, cards: s.dealt[nonDealer], isCrib: false, label: "hand" };
    if (step === 1) return { who: s.dealer, cards: s.dealt[s.dealer], isCrib: false, label: "hand" };
    return { who: s.dealer, cards: s.crib, isCrib: true, label: "crib" };
  }

  /** Score the CURRENT show step and park the breakdown for the UI. */
  function scoreShowStep(s) {
    const info = showStepInfo(s, s.show.step);
    const r = S.scoreHand(info.cards, s.starter, { isCrib: info.isCrib });
    s.show.items = r.items;
    s.show.points = r.points;
    s.show.who = info.who;
    s.show.label = info.label;
    s.show.cards = info.cards.slice();
    award(s, info.who, r.points, info.isCrib ? "Crib" : "Hand");
    if (r.points === 0) log(s, `${s.names[info.who]}: nothing in ${info.isCrib ? "the crib" : "hand"}`, info.who);
  }

  /** Acknowledge the current show step and move on. Either player may send it. */
  function doNext(s, p, rng) {
    if (s.phase !== "show") return { ok: false, error: "Nothing to acknowledge." };
    if (s.show.step < 2) {
      s.show.step++;
      scoreShowStep(s);
      return { ok: true, state: s };
    }
    // Hand complete — the deal passes and we go again.
    s.dealer = other(s.dealer);
    deal(s, rng);
    return { ok: true, state: s };
  }

  // ------------------------------------------------------------------ views
  /**
   * What both players may see. Deliberately FLAT: Firestore rejects arrays of
   * arrays, so per-player lists become `…0` / `…1` keys rather than a nested
   * pair. Hidden information is simply absent — not merely un-rendered.
   */
  function publicView(s) {
    const revealed = s.phase === "show" || s.phase === "gameover";
    const step = s.show.step;
    return {
      phase: s.phase,
      handNumber: s.handNumber,
      dealer: s.dealer,
      names: s.names.slice(),
      scores: s.scores.slice(),
      prevScores: s.prevScores.slice(),
      starter: s.starter,
      cribCount: s.crib.length,
      // The crib stays face down until it is actually counted.
      crib: revealed && (step >= 2 || s.phase === "gameover") ? s.crib.slice() : [],
      pegTurn: s.peg.turn,
      pegSeq: s.peg.seq.slice(),
      pegCount: S.pegCount(s.peg.seq),
      pegPlayed0: s.peg.played[0].slice(),
      pegPlayed1: s.peg.played[1].slice(),
      handSize0: s.hands[0].length,
      handSize1: s.hands[1].length,
      discarded0: s.dealt[0].length > 0,
      discarded1: s.dealt[1].length > 0,
      // Hands are revealed one at a time, as they are counted.
      showStep: step,
      showWho: s.show.who,
      showLabel: s.show.label,
      showPoints: s.show.points,
      showItems: revealed ? s.show.items : [],
      showCards: revealed && s.show.cards ? s.show.cards.slice() : [],
      revealed0: revealed && isRevealed(s, 0) ? s.dealt[0].slice() : [],
      revealed1: revealed && isRevealed(s, 1) ? s.dealt[1].slice() : [],
      log: s.log.slice(-12),
      winner: s.winner,
      skunk: s.skunk,
      target: TARGET,
    };
  }

  function isRevealed(s, p) {
    if (s.phase === "gameover") return true;
    const nonDealer = other(s.dealer);
    if (p === nonDealer) return s.show.step >= 0;
    return s.show.step >= 1;
  }

  /** What exactly one player may see: their own cards, and nothing else's. */
  function privateView(s, uid) {
    const p = s.uids.indexOf(uid);
    if (p < 0) return { hand: [], dealt: [], thrown: [], seat: -1 };
    // `thrown` is yours to know — you chose those two cards — and knowing them
    // is what lets a player (or the AI) reason about the crib honestly.
    return { seat: p, hand: s.hands[p].slice(), dealt: s.dealt[p].slice(), thrown: s.thrown[p].slice() };
  }

  /** Legal moves for a seat, so the UI never offers an illegal card. */
  function legalPlays(s, p) {
    if (s.phase !== "pegging" || s.peg.turn !== p) return [];
    const count = S.pegCount(s.peg.seq);
    return s.hands[p].filter((c) => count + S.valueOf(c) <= 31);
  }

  /** A compact record of a finished game, for the statistics work later on. */
  function toRecordedGame(s) {
    return {
      playedAt: null, // stamped by the caller — the engine has no clock
      names: s.names.slice(),
      uids: s.uids.slice(),
      scores: s.scores.slice(),
      winner: s.winner,
      skunk: s.skunk,
      hands: s.handNumber,
    };
  }

  return {
    TARGET, other, initGame, applyAction, publicView, privateView,
    legalPlays, toRecordedGame, shuffled,
    _internal: { deal, award, advancePeg, canPlay, showStepInfo, scoreShowStep },
  };
});
