/* ============================================================================
 * ai.js — the computer opponent. Pure functions over public information.
 *
 * FAIRNESS IS STRUCTURAL. Every function here takes only what a human player
 * at the same seat can see: its own cards, the starter once cut, the cards
 * already played, and the score. It is never handed the game state, so it
 * cannot peek at your hand even by accident. js/local.js is what enforces
 * this, by assembling the context from publicView + privateView rather than
 * passing the engine's state through.
 *
 * TWO DECISIONS, TWO METHODS:
 *   the discard — exact search. All 15 keeps × all 46 possible starters, plus
 *                 a table lookup for what the throw is worth in the crib.
 *   the play    — one-ply risk search. Score what a card gains now against
 *                 what it hands the opponent, averaged over every card they
 *                 could still be holding.
 *
 * DIFFICULTY is not a handicap multiplier — it is how much of the above the
 * opponent actually uses, so a weaker setting plays like a weaker person
 * rather than a strong player throwing games away.
 * ==========================================================================*/

(function (root, factory) {
  const req = typeof require === "function";
  const api = factory(
    req ? require("./score.js") : root.Score,
    req ? require("./crib-ev.js") : root.CribEV
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined") root.AI = api;
})(typeof self !== "undefined" ? self : this, function (S, CribEV) {
  "use strict";

  const LEVELS = ["easy", "medium", "hard"];
  const TARGET = 121;

  // ------------------------------------------------------------- the discard
  /**
   * Choose two cards to throw from a six-card hand.
   *
   * @param {number[]} hand6
   * @param {boolean}  isDealer  is this the AI's own crib?
   * @param {string}   level     'easy' | 'medium' | 'hard'
   * @param {function} [rng]
   * @returns {{cards:number[], analysis:Array}} the throw, plus every option
   *          ranked — the UI's discard hint uses the same analysis.
   */
  function chooseDiscard(hand6, isDealer, level, rng) {
    rng = rng || Math.random;
    const options = analyseDiscards(hand6, isDealer, level);

    if (level === "easy") {
      // Judges the kept hand as it stands, with no thought for the starter or
      // the crib — and wavers. This is what a beginner's discard looks like.
      options.sort((a, b) => b.rawKeep - a.rawKeep || rng() - 0.5);
      const among = options.slice(0, 3);
      return { cards: among[Math.floor(rng() * among.length)].throw, analysis: options };
    }
    options.sort((a, b) => b.value - a.value);
    return { cards: options[0].throw, analysis: options };
  }

  /**
   * Rank all 15 ways to break up a six-card hand.
   *
   * `expected` is exact: the mean of the kept hand over every one of the 46
   * starters that could still be cut. `crib` comes from the sampled table and
   * is ADDED when it is your crib, SUBTRACTED when it is not — the same two
   * cards are a gift or a weapon depending on who deals.
   */
  function analyseDiscards(hand6, isDealer, level) {
    const rest = [];
    for (let c = 0; c < 52; c++) if (!hand6.includes(c)) rest.push(c);

    const out = [];
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        const thrown = [hand6[i], hand6[j]];
        const keep = hand6.filter((c, k) => k !== i && k !== j);

        let total = 0, min = 99, max = -1;
        for (const starter of rest) {
          const v = S.handValue(keep, starter, false);
          total += v;
          if (v < min) min = v;
          if (v > max) max = v;
        }
        const expected = total / rest.length;
        const crib = CribEV.cribEV(thrown[0], thrown[1]);

        // Medium weighs the hand only; hard weighs the crib too.
        const value = level === "hard"
          ? expected + (isDealer ? crib : -crib)
          : expected;

        out.push({
          keep, throw: thrown,
          expected: +expected.toFixed(2),
          crib: +crib.toFixed(2),
          min, max,
          rawKeep: S.handValue(keep, null, false),
          value: +value.toFixed(3),
        });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- the play
  /**
   * Choose a card to peg with.
   *
   * @param {object} ctx
   *   {number[]} hand     the AI's remaining cards
   *   {number[]} seq      cards played since the count last reset
   *   {number[]} seen     every card the AI can account for (its own hand,
   *                       everything played this hand, and the starter)
   *   {number}   myScore, oppScore
   *   {number}   oppCards how many cards the opponent still holds
   *   {string}   level
   * @returns {{card:number, why:string}}
   */
  function choosePlay(ctx, rng) {
    rng = rng || Math.random;
    const level = ctx.level || "hard";
    const count = S.pegCount(ctx.seq);
    const legal = ctx.hand.filter((c) => count + S.valueOf(c) <= 31);
    if (!legal.length) return { card: null, why: "go" };
    if (legal.length === 1) return { card: legal[0], why: "only legal card" };

    const unseen = [];
    for (let c = 0; c < 52; c++) if (!ctx.seen.includes(c)) unseen.push(c);

    let best = null;
    for (const card of legal) {
      const gain = S.scorePegPlay(ctx.seq.concat([card])).points;

      // Winning beats everything. If this card reaches 121 the AI takes it and
      // stops thinking, exactly as a person would.
      if (ctx.myScore + gain >= TARGET) return { card, why: "this wins the game" };

      let risk = 0;
      if (level !== "easy") risk = replyRisk(ctx, card, unseen, level);

      // A tiny nudge toward keeping low cards back: they are what let you keep
      // pegging after the count climbs, and they are how you reach 31.
      const flexibility = level === "hard" ? -0.02 * S.valueOf(card) : 0;

      const value = gain - risk + flexibility + (level === "easy" ? rng() * 0.4 : 0);
      if (!best || value > best.value) best = { card, value, gain, risk };
    }

    return {
      card: best.card,
      why: best.gain
        ? `takes ${best.gain}`
        : best.risk < 0.5 ? "safe" : "least dangerous",
    };
  }

  /**
   * What the opponent is expected to peg in reply, if this card is played.
   *
   * Averaged over every card the AI cannot account for, weighted equally. This
   * is what teaches it not to lead a five (any of the sixteen ten-cards
   * answers for two) and not to leave the count at 21 (a ten-card makes 31) —
   * without either rule being written down. `level` controls only how deeply
   * it looks, so a medium opponent misjudges the same situations a medium
   * player does.
   */
  function replyRisk(ctx, card, unseen, level) {
    const seq = ctx.seq.concat([card]);
    const count = S.pegCount(seq);
    if (count === 31) return 0;             // the count resets; nothing to answer
    if (ctx.oppCards <= 0) return 0;         // they have nothing left to play with

    let total = 0, considered = 0;
    for (const reply of unseen) {
      if (count + S.valueOf(reply) > 31) continue;   // they could not play it
      const gained = S.scorePegPlay(seq.concat([reply])).points;
      total += gained;
      considered++;
    }
    if (!considered) {
      // Nobody can answer — the AI takes a point for the go, which is a gain
      // rather than a risk.
      return -1;
    }
    const mean = total / considered;

    // Medium sees the immediate reply and stops there. Hard also notices that
    // a reply which pairs it can be paired back, which is what makes leading
    // into a pair less frightening than it looks.
    if (level !== "hard") return mean;

    const myRank = S.rankOf(card);
    const canRepair = ctx.hand.some((c) => c !== card && S.rankOf(c) === myRank);
    return canRepair ? mean * 0.7 : mean;
  }

  // ------------------------------------------------------------------ helper
  /** The AI's opening lead preference, used only to explain itself in the log. */
  function describeLevel(level) {
    if (level === "easy") return "plays by feel — counts its hand, ignores the crib";
    if (level === "medium") return "counts every starter, but throws to the crib blind";
    return "weighs hand and crib, and plays the odds when pegging";
  }

  return { LEVELS, chooseDiscard, analyseDiscards, choosePlay, describeLevel };
});
