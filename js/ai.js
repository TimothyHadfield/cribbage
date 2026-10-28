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
 *   the play    — Hard: a search of the whole rest of the play over sampled
 *                 opponent hands (see searchPlay). Easy and Medium take what
 *                 points they see now, without looking at the reply.
 *
 * MEASURED LADDER (2026-10-28, tools/measure-levels.js): each level beats the
 * one below about two games in three. Medium was made a little weaker in
 * that wave (near-best discard, no reply look-ahead) so it sits between.
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
    if (level === "medium") {
      // Counts every cut, ignores the crib, and settles for any keep within a
      // point of the best one: a decent player, not a calculator.
      const near = options.filter((o) => o.value >= options[0].value - 1);
      return { cards: near[Math.floor(rng() * near.length)].throw, analysis: options };
    }
    if (level === "hard") {
      // Not predictable: throws worth the same (within a twentieth of a point)
      // are chosen between at random.
      const near = options.filter((o) => o.value >= options[0].value - 0.05);
      return { cards: near[Math.floor(rng() * near.length)].throw, analysis: options };
    }
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
    const n = hand6.length;   // six, or five in five-card cribbage
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
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
   *   {number}   [target]   121 (default) or 61
   *   {boolean}  [fiveCard] five-card cribbage: the play stops at the first 31 or go
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

    for (const card of legal) {
      if (ctx.myScore + S.scorePegPlay(ctx.seq.concat([card])).points >= (ctx.target || TARGET)) return { card, why: "this wins the game" };
    }
    if (level === "hard") return searchPlay(ctx, legal, count, unseen, rng);

    let best = null;
    for (const card of legal) {
      const gain = S.scorePegPlay(ctx.seq.concat([card])).points;

      // Winning beats everything. If this card reaches 121 the AI takes it and
      // stops thinking, exactly as a person would.
      if (ctx.myScore + gain >= (ctx.target || TARGET)) return { card, why: "this wins the game" };

      // Easy and Medium peg for the moment: points now, a little wavering,
      // no thought for what the card leaves the opponent.
      const value = gain + rng() * 0.4;
      if (!best || value > best.value) best = { card, value, gain };
    }

    return { card: best.card, why: best.gain ? `takes ${best.gain}` : "no points on offer" };
  }

  // ------------------------------------------------- hard: the pegging search
  /*
   * Hard looks at the whole rest of the play, not one reply. It deals the
   * opponent SAMPLES random hands from the cards it can't account for, solves
   * the play to the end for each (both sides playing their best: minimax, with
   * the engine's go / 31 / last-card rules), and plays the card with the best
   * average. Reaching the target mid-play is a terminal win (or loss), so near
   * the end it pegs out, or blocks the opponent pegging out, over points.
   * Values within a twentieth of a point are tied and broken at random.
   */
  const SAMPLES = 24;
  const WIN = 60;
  const RK = [], VL = [];
  for (let c = 0; c < 52; c++) { RK[c] = (c % 13) + 1; VL[c] = Math.min(RK[c], 10); }

  /** Points for the last card of a play, from ranks `r[0..n)` and the count after it. */
  function pegPts(r, n, count) {
    let p = count === 15 || count === 31 ? 2 : 0;
    const last = r[n - 1];
    let same = 1;
    for (let i = n - 2; i >= 0 && r[i] === last; i--) same++;
    if (same >= 2) return p + same * (same - 1);
    for (let len = n; len >= 3; len--) {
      let mn = 99, mx = 0, mask = 0, dup = false;
      for (let i = n - len; i < n; i++) {
        const x = r[i];
        if (mask & (1 << x)) { dup = true; break; }
        mask |= 1 << x;
        if (x < mn) mn = x;
        if (x > mx) mx = x;
      }
      if (!dup && mx - mn === len - 1) return p + len;
    }
    return p;
  }

  const canPlay = (hand, count) => hand.some((c) => count + VL[c] <= 31);

  /** Solver. Values are from seat 0's (the AI's) side: its points minus the opponent's. */
  function solve(g, h, seq, count, turn) {
    const mine = h[turn];
    let best = turn === 0 ? -1e9 : 1e9, seenRanks = 0;
    for (let i = 0; i < mine.length; i++) {
      const c = mine[i];
      if (count + VL[c] > 31) continue;
      if (seenRanks & (1 << RK[c])) continue;   // two cards of a rank play the same
      seenRanks |= 1 << RK[c];
      const nc = count + VL[c];
      seq.push(RK[c]);
      const gain = pegPts(seq, seq.length, nc);
      let v;
      if (g.pts[turn] + gain >= g.need[turn]) v = turn === 0 ? WIN : -WIN;
      else {
        const rest = mine.slice(0, i).concat(mine.slice(i + 1));
        const nh = turn === 0 ? [rest, h[1]] : [h[0], rest];
        g.pts[turn] += gain;
        v = (turn === 0 ? gain : -gain) + advance(g, nh, seq, nc, turn);
        g.pts[turn] -= gain;
      }
      seq.pop();
      if (turn === 0 ? v > best : v < best) best = v;
    }
    return best;
  }

  /** After `last` played: the engine's advancePeg, as a value. */
  function advance(g, h, seq, count, last) {
    const o = 1 - last;
    if (count === 31) return g.fiveCard ? 0 : reset(g, h, last);
    if (canPlay(h[o], count)) return solve(g, h, seq, count, o);
    if (canPlay(h[last], count)) return solve(g, h, seq, count, last);
    if (g.pts[last] + 1 >= g.need[last]) return last === 0 ? WIN : -WIN;
    const spent = !h[0].length && !h[1].length;
    if (spent || g.fiveCard) return last === 0 ? 1 : -1;
    g.pts[last] += 1;
    const v = (last === 0 ? 1 : -1) + reset(g, h, last);
    g.pts[last] -= 1;
    return v;
  }

  function reset(g, h, last) {
    if (!h[0].length && !h[1].length) return 0;
    let t = 1 - last;
    if (!h[t].length && h[1 - t].length) t = 1 - t;
    return solve(g, h, [], 0, t);
  }

  function searchPlay(ctx, legal, count, unseen, rng) {
    const target = ctx.target || TARGET;
    const need = [target - ctx.myScore, target - ctx.oppScore];
    const seqR = ctx.seq.map((c) => RK[c]);
    const total = legal.map(() => 0);
    const gains = legal.map((c) => pegPts(seqR.concat([RK[c]]), seqR.length + 1, count + VL[c]));
    const k = Math.min(ctx.oppCards, unseen.length);
    for (let s = 0; s < SAMPLES; s++) {
      const u = unseen.slice(), opp = [];
      for (let i = 0; i < k; i++) {
        const j = i + Math.floor(rng() * (u.length - i));
        const t = u[i]; u[i] = u[j]; u[j] = t;
        opp.push(u[i]);
      }
      legal.forEach((card, idx) => {
        const gain = gains[idx];
        if (gain >= need[0]) { total[idx] += WIN; return; }
        const g = { pts: [gain, 0], need, fiveCard: !!ctx.fiveCard };
        const seq = seqR.concat([RK[card]]);
        total[idx] += gain + advance(g, [ctx.hand.filter((c) => c !== card), opp], seq, count + VL[card], 0);
      });
    }
    const avg = total.map((t) => t / SAMPLES);
    const top = Math.max(...avg);
    const near = legal.filter((c, i) => avg[i] >= top - 0.05);
    const card = near[Math.floor(rng() * near.length)];
    const gain = gains[legal.indexOf(card)];
    return {
      card,
      why: gain ? `takes ${gain}` : top >= 0 ? "safe" : "least dangerous",
    };
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
