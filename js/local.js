/* ============================================================================
 * local.js — playing the computer. One of two interchangeable TRANSPORTS.
 *
 * A transport's job is to answer "what is the state, and how do I make a
 * move" — nothing else. This one runs the engine right here in the tab and
 * asks js/ai.js for the opponent's moves; js/online.js answers the same two
 * questions over Firestore. Because they expose the identical surface,
 * js/app.js renders both without knowing which it is talking to:
 *
 *      start(opts) / submit(action) / stop()      +  a `game:state` event
 *
 * THE AI IS NOT GIVEN THE GAME STATE. It gets a context assembled from
 * publicView + privateView, exactly what a person in that seat can see. The
 * engine state sits one scope away and is never passed in, so the computer
 * cannot peek at your hand even by mistake.
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

  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

  function publish() {
    if (!state) return;
    emit("game:state", {
      mode: "local",
      seat: SEAT_YOU,
      pub: E.publicView(state),
      priv: E.privateView(state, YOU),
      thinking,
      level,
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
      const r = E.applyAction(state, action, Math.random);
      if (r.ok) state = r.state;
      thinking = false;
      publish();
      think();
    }, PACE[move.kind] || 600);
  }

  // ------------------------------------------------------------------- api
  const Local = {
    get active() { return state !== null; },

    start(opts) {
      opts = opts || {};
      level = opts.level || "hard";
      state = E.initGame(
        [{ uid: YOU, name: opts.yourName || "You" },
         { uid: CPU, name: opts.cpuName || "Computer" }],
        Math.random
      );
      thinking = false;
      publish();
      think();
      return { ok: true };
    },

    /** Your move. `by` is filled in here so the UI cannot spoof a seat. */
    submit(action) {
      if (!state) return { ok: false, message: "No game in progress." };
      const r = E.applyAction(state, Object.assign({}, action, { by: YOU }), Math.random);
      if (!r.ok) return { ok: false, message: r.error };
      state = r.state;
      publish();
      think();
      return { ok: true };
    },

    stop() {
      clearTimeout(timer);
      state = null;
      thinking = false;
    },

    refresh: publish,

    /**
     * Rank your own discard options — the same analysis the computer runs on
     * itself. Used by the "what should I throw?" hint.
     */
    adviseDiscard(hand6, isDealer) {
      return AI.analyseDiscards(hand6, isDealer, "hard").sort((a, b) => b.value - a.value);
    },
  };

  root.Local = Local;
})(typeof self !== "undefined" ? self : this);
