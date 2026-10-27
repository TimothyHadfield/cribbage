/* ============================================================================
 * crib-online.js — cribbage in the shape the shared online kit expects
 * (js/game-online.js, a byte-identical copy of Board and Card Games/_online/online.js).
 *
 * Seats 0 and 1 are the engine's players; the engine's uids are "s0" / "s1".
 * The host's browser holds the whole state (deck, both hands) and runs any
 * computer seat. Everyone else only ever receives publicView + their own
 * privateView, so a hand never leaves the host's phone except to its owner.
 *
 * Who may act:
 *   discard  both seats that haven't thrown (at the same time)
 *   cut      the non-dealer
 *   pegging  whoever's turn it is ("go" is automatic in the engine)
 *   show     every person at the table — either may tap Continue, as at a real
 *            table. A tap carries the step it was made on, so two taps on the
 *            same count move it on once. A computer never steps the show.
 * ==========================================================================*/
(function (root) {
  "use strict";
  const node = typeof module !== "undefined" && module.exports;
  const E = node ? require("./engine.js") : root.Engine;
  const AI = node ? require("./ai.js") : root.AI;
  const LEVELS = ["easy", "medium", "hard"];
  const uid = (seat) => "s" + seat;

  function humans(st) { return [0, 1].filter((i) => st.kinds[i] === "human"); }

  const game = {
    id: "cribbage", minSeats: 2, maxSeats: 2,

    // options: { level: 'easy'|'medium'|'hard' } for a computer seat. Muggins is off online.
    setup(n, options, rng, seats) {
      const o = options || {};
      const players = [0, 1].map((i) => {
        const s = (seats && seats[i]) || {};
        return { uid: uid(i), name: s.kind === "computer" ? "Computer" : String(s.name || "Player " + (i + 1)).slice(0, 20) };
      });
      const st = E.initGame(players, rng, { muggins: [false, false] });
      st.kinds = [0, 1].map((i) => (seats && seats[i] && seats[i].kind === "computer" ? "computer" : "human"));
      st.level = LEVELS.includes(o.level) ? o.level : "medium";
      return st;
    },

    toAct(st) {
      if (st.winner !== null) return [];
      if (st.phase === "discard") return [0, 1].filter((p) => st.dealt[p].length === 0);
      if (st.phase === "cut") return [E.other(st.dealer)];
      if (st.phase === "pegging") return [st.peg.turn];
      if (st.phase === "show") {
        if (st.show.pending) return [st.show.who];
        const h = humans(st);
        return h.length ? h : [0];
      }
      return [];
    },

    apply(st, seat, action, rng) {
      if (!action || typeof action !== "object") throw new Error("No move.");
      if (!game.toAct(st).includes(seat)) throw new Error("Not your turn.");
      if (action.type === "next" && action.step != null &&
          (action.step !== st.show.step || action.hand !== st.handNumber)) throw new Error("The count already moved on.");
      const a = { type: action.type, by: uid(seat) };
      if (action.type === "discard") a.cards = Array.isArray(action.cards) ? action.cards.slice(0, 2).map(Number) : [];
      if (action.type === "play") a.card = Number(action.card);
      if (action.type === "claim") a.points = action.points;
      const r = E.applyAction(st, a, rng);
      if (!r.ok) throw new Error(r.error || "That move isn't allowed.");
      r.state.kinds = st.kinds; r.state.level = st.level;
      return r.state;
    },

    publicView(st) { return E.publicView(st); },
    // only this seat's cards: what's in hand, what it kept, what it threw
    privateView(st, seat) { const v = E.privateView(st, uid(seat)); return { seat, hand: v.hand, dealt: v.dealt, thrown: v.thrown }; },

    // plays from what that seat can see (public table + its own cards), like the local computer
    bot(ctx, seat, rng) {
      const pub = ctx.pub || E.publicView(ctx.state), mine = ctx.mine || game.privateView(ctx.state, seat);
      const level = (ctx.state && ctx.state.level) || "medium";
      if (pub.phase === "discard") return { type: "discard", cards: AI.chooseDiscard(mine.hand, pub.dealer === seat, level, rng).cards };
      if (pub.phase === "cut") return { type: "cut" };
      if (pub.phase === "pegging") {
        const c = AI.choosePlay({
          hand: mine.hand, seq: pub.pegSeq,
          seen: mine.hand.concat(mine.thrown, pub.pegPlayed0, pub.pegPlayed1, pub.starter == null ? [] : [pub.starter]),
          myScore: pub.scores[seat], oppScore: pub.scores[E.other(seat)],
          oppCards: seat === 0 ? pub.handSize1 : pub.handSize0, level,
        }, rng);
        return { type: "play", card: c.card };
      }
      if (pub.phase === "show" && pub.showPending) return { type: "claim", points: 0 };
      return { type: "next", step: pub.showStep, hand: pub.handNumber };
    },

    isOver(st) { return st.winner !== null; },
  };

  const api = { game };
  if (node) module.exports = api; else root.CribOnline = api;
})(typeof self !== "undefined" ? self : globalThis);
