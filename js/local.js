/* ============================================================================
 * local.js — playing the computer. One of two interchangeable TRANSPORTS.
 *
 * A transport's job is to answer "what is the state, and how do I make a
 * move" — nothing else. This one runs the engine right here in the tab and
 * asks js/ai.js for the opponent's moves. js/app.js renders whatever arrives
 * in the `game:state` event:
 *
 *      start(opts) / submit(action) / undo() / stop()  +  a `game:state` event
 *
 * THE AI IS NOT GIVEN THE GAME STATE. It gets a context assembled from
 * publicView + privateView, exactly what a person in that seat can see. The
 * engine state sits one scope away and is never passed in, so the computer
 * cannot peek at your hand even by mistake.
 *
 * DEALS ARE SEEDED. Every shuffle and cut comes from (game seed, hand number),
 * so Undo can't be used to re-cut for a better starter, and the Daily game
 * deals the same cards to everyone that day.
 * ==========================================================================*/

(function (root) {
  "use strict";
  const S = root.Score, E = root.Engine, AI = root.AI;

  const YOU = "you", CPU = "cpu";
  const SEAT_YOU = 0, SEAT_CPU = 1;

  // How long the computer appears to think. Long enough to follow what it did,
  // short enough not to be waiting on it.
  const PACE = { discard: 750, cut: 550, play: 700 };

  let state = null;
  let level = "hard";
  let timer = null;
  let thinking = false;
  let seed = 1;
  let history = [];        // states just before each of your undoable moves
  let undos = 0;
  let listeners = [];

  const emit = (name, detail) => {
    if (root.document && root.CustomEvent) root.document.dispatchEvent(new root.CustomEvent(name, { detail }));
    for (const fn of listeners) fn(detail);
  };

  function mulberry32(a) {
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** The randomness for the next engine step: fixed by the seed, the hand and the phase. */
  const rngFor = (st, salt) => mulberry32((seed ^ Math.imul((st ? st.handNumber : 0) + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0);
  const SALT = { init: 1, cut: 2, next: 3 };

  /** Undo lives in the throw and the play; once the counting starts the hand is settled. */
  const undoable = () => !!state && history.length > 0 && state.winner === null && state.phase !== "show";

  function publish() {
    if (!state) return;
    emit("game:state", {
      mode: "local",
      seat: SEAT_YOU,
      pub: E.publicView(state),
      priv: E.privateView(state, YOU),
      thinking,
      level,
      canUndo: undoable(),
    });
  }

  /** Everything the computer is entitled to know, and not one card more. */
  function aiContext(seat) {
    const pub = E.publicView(state);
    const priv = E.privateView(state, state.uids[seat]);
    return {
      hand: priv.hand,
      seq: pub.pegSeq,
      seen: priv.hand
        .concat(priv.thrown)
        .concat(pub.pegPlayed0, pub.pegPlayed1)
        .concat(pub.starter == null ? [] : [pub.starter]),
      myScore: pub.scores[seat],
      oppScore: pub.scores[E.other(seat)],
      oppCards: seat === 0 ? pub.handSize1 : pub.handSize0,
      level,
      target: pub.target,
      fiveCard: pub.fiveCard,
    };
  }

  /** The computer's move, if it has one to make right now. */
  function pendingMove() {
    if (!state || state.winner !== null) return null;
    if (state.phase === "discard" && state.dealt[SEAT_CPU].length === 0) {
      return { kind: "discard", make: () => ({
        type: "discard", by: CPU,
        cards: AI.chooseDiscard(state.hands[SEAT_CPU], state.dealer === SEAT_CPU, level).cards,
      })};
    }
    if (state.phase === "cut" && E.other(state.dealer) === SEAT_CPU) {
      return { kind: "cut", make: () => ({ type: "cut", by: CPU }) };
    }
    if (state.phase === "pegging" && state.peg.turn === SEAT_CPU) {
      return { kind: "play", make: () => {
        const choice = AI.choosePlay(aiContext(SEAT_CPU));
        return choice.card == null ? null : { type: "play", by: CPU, card: choice.card };
      }};
    }
    // The show is stepped by whoever is watching — here, you.
    return null;
  }

  const apply = (action) => E.applyAction(state, action, rngFor(state, SALT[action.type] || 9));

  /**
   * Give the computer its turn, then check whether it has another. It often
   * does: after a "go" the same player keeps laying cards, so this recurses
   * rather than assuming turns alternate.
   */
  function think() {
    clearTimeout(timer);
    const move = pendingMove();
    if (!move) {
      if (thinking) { thinking = false; publish(); }
      return;
    }
    thinking = true;
    publish();
    timer = setTimeout(() => {
      const action = move.make();
      if (!action) { thinking = false; publish(); return; }
      const r = apply(action);
      if (r.ok) state = r.state;
      thinking = false;
      publish();
      think();
    }, Local.pace[move.kind] || 600);
  }

  // ------------------------------------------------------------------- api
  const Local = {
    pace: PACE,
    get active() { return state !== null; },
    get undos() { return undos; },

    /** opts: { level, yourName, cpuName, muggins, seed, target (121|61), fiveCard } */
    start(opts) {
      opts = opts || {};
      clearTimeout(timer);
      level = opts.level || "hard";
      seed = (opts.seed != null ? opts.seed : Math.floor(Math.random() * 4294967296)) >>> 0;
      history = []; undos = 0;
      state = E.initGame(
        [{ uid: YOU, name: opts.yourName || "You" },
         { uid: CPU, name: opts.cpuName || "Computer" }],
        rngFor(null, SALT.init),
        { muggins: [!!opts.muggins, false], target: opts.target, fiveCard: !!opts.fiveCard }
      );
      thinking = false;
      publish();
      think();
      return { ok: true };
    },

    /** Your move. `by` is filled in here so the UI cannot spoof a seat. */
    submit(action) {
      if (!state) return { ok: false, message: "No game in progress." };
      const before = state;
      const r = apply(Object.assign({}, action, { by: YOU }));
      if (!r.ok) return { ok: false, message: r.error };
      // Only real decisions can be taken back: the throw and each card played.
      if (action.type === "discard" || action.type === "play") history.push(before);
      // A new hand starts a fresh history: you can't undo into the last one.
      if (r.state.handNumber !== before.handNumber) history = [];
      state = r.state;
      publish();
      think();
      return { ok: true };
    },

    /** Take back your last throw or card (and whatever the computer did after it). */
    undo() {
      if (!undoable()) return { ok: false };
      clearTimeout(timer);
      state = history.pop();
      undos++;
      thinking = false;
      publish();
      think();
      return { ok: true };
    },

    stop() {
      clearTimeout(timer);
      state = null;
      thinking = false;
      history = [];
    },

    /** Everything needed to carry on after a reload (plain JSON). */
    snapshot() {
      if (!state) return null;
      return { v: 1, state, level, seed, history, undos };
    },
    /** Pick a saved game back up. Returns { ok }. */
    resume(snap) {
      if (!snap || snap.v !== 1 || !snap.state || snap.state.winner !== null) return { ok: false };
      clearTimeout(timer);
      state = snap.state; level = snap.level || "hard"; seed = snap.seed >>> 0;
      history = Array.isArray(snap.history) ? snap.history : []; undos = snap.undos | 0;
      thinking = false;
      publish();
      think();
      return { ok: true };
    },

    refresh: publish,
    /** Tests: get every published view without a DOM. Returns an unsubscribe. */
    listen(fn) { listeners.push(fn); return () => { listeners = listeners.filter((f) => f !== fn); }; },
    _state: () => state,

    /**
     * Rank your own discard options — the same analysis the computer runs on
     * itself. Used by the "what should I throw?" hint.
     */
    adviseDiscard(hand6, isDealer) {
      return AI.analyseDiscards(hand6, isDealer, "hard").sort((a, b) => b.value - a.value);
    },
  };

  root.Local = Local;
  if (typeof module !== "undefined" && module.exports) module.exports = Local;
})(typeof self !== "undefined" ? self : globalThis);
