/* ============================================================================
 * board.js — the wooden peg board. 121 holes per player in three streets of
 * 40 (grouped in fives), a start pair on the left and one game hole at the end.
 * Each player has two pegs: the FRONT peg is the score, the BACK peg is where
 * it was before the last score. Scoring lifts the back peg and hops it past
 * the front one ("leapfrog"), so you can always see the size of the last score.
 *
 *   PegBoard.create(el)            → board
 *   board.set(scores, prev, names, { animate, colors, you })
 *   PegBoard.holeXY(track, n)      → { x, y } in board units (pure, tested)
 *
 * Original drawing: SVG gradients and seeded grain lines, no images.
 * ==========================================================================*/

(function (root) {
  "use strict";

  // ---- geometry (SVG user units) ----
  const P = 7, G = 3, X0 = 24, TRACK = 8.5, STREET = 26, Y0 = 11;
  const W = X0 + 39 * P + 7 * G + 30, H = Y0 + 2 * STREET + TRACK + 11;
  const holeX = (i) => X0 + i * P + Math.floor(i / 5) * G;     // i = 0..39 along a street
  const END_X = holeX(39) + 17;
  /**
   * Where hole n (0..121) of a track sits. Track 0 is the upper row of each
   * street, track 1 the lower. n <= 0 = the start pair (n = -1 is the back
   * peg's starting hole). Streets run left→right, right→left, left→right.
   */
  function holeXY(track, n) {
    const rowY = (street) => Y0 + street * STREET + track * TRACK;
    if (n >= 121) return { x: END_X, y: Y0 + 2 * STREET + TRACK / 2 };
    if (n <= 0) return { x: n < 0 ? 7 : 14.5, y: rowY(0) };
    const street = Math.floor((n - 1) / 40), i = (n - 1) % 40;
    return { x: street === 1 ? holeX(39 - i) : holeX(i), y: rowY(street) };
  }

  const NS = "http://www.w3.org/2000/svg";
  const mk = (tag, attrs, parent) => {
    const n = root.document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };

  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  const animOn = () => !!(root.TABLE && root.TABLE.animOn ? root.TABLE.animOn() : true);
  const speed = () => { try { return root.FX && root.FX.settings && root.FX.settings.animSpeed === "fast" ? 0.55 : 1; } catch (e) { return 1; } };

  let boards = 0;
  function create(el) {
    // Gradient ids must be unique per board: Chrome resolves url(#id) to the FIRST match, and the menu board is hidden.
    const uid = "pb" + (++boards);
    el.textContent = "";
    el.classList.add("pegboard");
    const svg = mk("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Peg board", preserveAspectRatio: "xMidYMid meet" }, el);
    const defs = mk("defs", {}, svg);
    const wood = mk("linearGradient", { id: `${uid}-wood`, x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    mk("stop", { offset: "0", "stop-color": "#a8713f" }, wood);
    mk("stop", { offset: ".5", "stop-color": "#8c5a2f" }, wood);
    mk("stop", { offset: "1", "stop-color": "#6f4523" }, wood);
    const hole = mk("radialGradient", { id: `${uid}-hole`, cx: ".45", cy: ".4", r: ".6" }, defs);
    mk("stop", { offset: "0", "stop-color": "#140b05" }, hole);
    mk("stop", { offset: "1", "stop-color": "#3a2412" }, hole);
    // track 0 (upper rows) = the opponent, orange; track 1 (lower rows) = you, blue
    for (const [id, c1, c2] of [[`${uid}-peg0`, "#ffd9a0", "#d07a1c"], [`${uid}-peg1`, "#9cc3ff", "#2f66c9"]]) {
      const g = mk("radialGradient", { id, cx: ".35", cy: ".3", r: ".75" }, defs);
      mk("stop", { offset: "0", "stop-color": c1 }, g);
      mk("stop", { offset: "1", "stop-color": c2 }, g);
    }

    mk("rect", { x: 0.5, y: 0.5, width: W - 1, height: H - 1, rx: 7, fill: `url(#${uid}-wood)`, stroke: "#4a2c14", "stroke-width": 1 }, svg);
    // grain: long faint wavy lines, seeded so the board never changes
    const r = rng(121);
    for (let k = 0; k < 16; k++) {
      const y = 3 + r() * (H - 6), a = 0.6 + r() * 1.6;
      let d = `M2 ${y.toFixed(1)}`;
      for (let x = 20; x <= W; x += 20) d += ` Q${(x - 10).toFixed(0)} ${(y + (r() - 0.5) * a * 2).toFixed(1)} ${x} ${(y + (r() - 0.5) * a).toFixed(1)}`;
      mk("path", { d, fill: "none", stroke: r() < 0.5 ? "#5e3a1c" : "#b98250", "stroke-width": (0.3 + r() * 0.5).toFixed(2), opacity: (0.18 + r() * 0.2).toFixed(2) }, svg);
    }
    // street bands: a slightly darker inlay behind each pair of tracks
    for (let s = 0; s < 3; s++) {
      mk("rect", { x: X0 - 5, y: Y0 + s * STREET - 4.5, width: holeX(39) - X0 + 10, height: TRACK + 9, rx: 4, fill: "#000", opacity: 0.1 }, svg);
    }
    // the colour line under each track, so you can tell whose row is whose
    for (let s = 0; s < 3; s++) for (let t = 0; t < 2; t++) {
      const y = Y0 + s * STREET + t * TRACK + (t ? 2.9 : -2.9);
      mk("line", { x1: X0 - 3, x2: holeX(39) + 3, y1: y, y2: y, stroke: t ? "#2f66c9" : "#d07a1c", "stroke-width": 0.6, opacity: 0.55 }, svg);
    }
    // skunk lines (91) and double skunk (61); a short game to 61 shows its
    // finish line and its skunk line (31) instead
    const between = (n) => (holeXY(0, n).x + holeXY(0, n + 1).x) / 2;
    const lineSets = {};
    for (const [target, marks] of [[121, [[90, "S"], [60, "SS"]]], [61, [[30, "S"], [61, "61"]]]]) {
      const grp = mk("g", { class: "marks-" + target }, svg);
      for (const [n, label] of marks) {
        const x = n === 61 ? holeXY(0, 61).x + (holeXY(0, 62).x - holeXY(0, 61).x) * 0.5 : between(n);
        const st = Math.floor(n / 40);
        mk("line", { x1: x, x2: x, y1: Y0 + st * STREET - 5, y2: Y0 + st * STREET + TRACK + 5, stroke: "#f0d7a8", "stroke-width": n === 61 ? 1.1 : 0.7, opacity: 0.7, "stroke-dasharray": n === 61 ? "none" : "1.4 1.2" }, grp);
        const t = mk("text", { x, y: Y0 + st * STREET - 6.2, "text-anchor": "middle", "font-size": 4.2, fill: "#f0d7a8", opacity: 0.8, "font-family": "system-ui, sans-serif", "font-weight": 700 }, grp);
        t.textContent = label;
      }
      lineSets[target] = grp;
    }
    lineSets[61].setAttribute("display", "none");
    // every hole of both tracks, the start pairs and the game hole
    for (let t = 0; t < 2; t++) {
      for (let n = -1; n <= 120; n++) {
        const p = holeXY(t, n);
        mk("circle", { cx: p.x, cy: p.y, r: n <= 0 ? 1.6 : 1.35, fill: `url(#${uid}-hole)` }, svg);
      }
    }
    const end = holeXY(0, 121);
    mk("circle", { cx: end.x, cy: end.y, r: 2.4, fill: `url(#${uid}-hole)`, stroke: "#f0d7a8", "stroke-width": 0.5, opacity: 0.95 }, svg);
    // street numbers at the turns
    for (const [n, dx] of [[40, 6], [80, -6], [120, 6]]) {
      const p = holeXY(0, n);
      const tx = mk("text", { x: p.x + dx, y: p.y + TRACK / 2 + 1.5, "text-anchor": "middle", "font-size": 3.6, fill: "#f0d7a8", opacity: 0.55, "font-family": "system-ui, sans-serif" }, svg);
      tx.textContent = String(n);
    }

    const pegLayer = mk("g", {}, svg);
    const pegs = [[], []], at = [[-1, 0], [-1, 0]];
    for (let t = 0; t < 2; t++) {
      for (let k = 0; k < 2; k++) {
        const g = mk("g", { class: "peg" }, pegLayer);
        mk("ellipse", { cx: 0.7, cy: 1.1, rx: 2.9, ry: 2.4, fill: "#000", opacity: 0.35 }, g);
        mk("circle", { cx: 0, cy: 0, r: 2.75, fill: `url(#${uid}-peg${t})`, stroke: t ? "#1d3f80" : "#7a430c", "stroke-width": 0.45 }, g);
        mk("circle", { cx: -0.8, cy: -0.9, r: 0.8, fill: "#fff", opacity: 0.55 }, g);
        pegs[t].push(g);
      }
    }
    const place = (g, t, n) => { const p = holeXY(t, n); g.setAttribute("transform", `translate(${p.x} ${p.y})`); g.dataset.n = n; };
    for (let t = 0; t < 2; t++) { place(pegs[t][0], t, -1); place(pegs[t][1], t, 0); }

    /** Hop one peg from hole a to hole b: lifted, arcing, then set down. */
    function hop(g, t, a, b) {
      const p = holeXY(t, a), q = holeXY(t, b);
      place(g, t, b);
      if (!animOn() || !g.animate) return Promise.resolve();
      const dur = Math.round(Math.min(900, 380 + Math.abs(b - a) * 9) * speed());
      // SVG transform attribute can't be tweened by CSS, so animate a wrapper style transform from the old offset.
      const dx = p.x - q.x, dy = p.y - q.y;
      return new Promise((res) => {
        let anim;
        try {
          anim = g.animate([
            { transform: `translate(${q.x + dx}px, ${q.y + dy}px) scale(1)` },
            { transform: `translate(${q.x + dx * 0.5}px, ${q.y + dy * 0.5 - 6}px) scale(1.55)`, offset: 0.5 },
            { transform: `translate(${q.x}px, ${q.y}px) scale(1)` },
          ], { duration: dur, easing: "cubic-bezier(.3,.7,.3,1)" });
        } catch (e) { return res(); }
        const fin = () => { clearTimeout(tm); res(); }, tm = setTimeout(fin, dur + 150);
        anim.onfinish = fin; anim.oncancel = fin;
      });
    }

    let shownTarget = 121;
    const board = {
      el, svg,
      /** 121 (default) or 61: which finish and skunk lines are drawn. */
      setTarget(t) {
        t = t === 61 ? 61 : 121;
        if (t === shownTarget) return;
        shownTarget = t;
        lineSets[121].setAttribute("display", t === 121 ? "inline" : "none");
        lineSets[61].setAttribute("display", t === 61 ? "inline" : "none");
      },
      /** Current hole of each peg, for tests: [[a, b], [a, b]] by track. */
      positions: () => pegs.map((ps) => ps.map((g) => Number(g.dataset.n))),
      /**
       * Show scores. track 0 = upper rows, 1 = lower rows; seatOfTrack maps them.
       * Only a peg that has to move moves, and the one that moves is the back peg.
       */
      set(front, back, opts) {
        opts = opts || {};
        const jobs = [];
        for (let t = 0; t < 2; t++) {
          const f = front[t];
          const want = [back[t] < f ? back[t] : -1, f];
          const have = pegs[t].map((g) => Number(g.dataset.n));
          if ((have[0] === want[0] && have[1] === want[1]) || (have[0] === want[1] && have[1] === want[0])) continue;
          // leapfrog: the peg already sitting on the new back hole stays; the other one jumps to the front
          const stay = have.indexOf(want[0]);
          if (opts.animate && stay >= 0) {
            const mover = 1 - stay;
            jobs.push(hop(pegs[t][mover], t, have[mover], want[1]));
          } else {
            place(pegs[t][0], t, want[0]);
            place(pegs[t][1], t, want[1]);
          }
        }
        return Promise.all(jobs);
      },
    };
    return board;
  }

  root.PegBoard = { create, holeXY, W, H };
  if (typeof module !== "undefined" && module.exports) module.exports = { holeXY, W, H };
})(typeof self !== "undefined" ? self : globalThis);
