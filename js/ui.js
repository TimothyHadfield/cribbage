/* ============================================================================
 * ui.js — rendering. Builds DOM from a state view and returns it; it never
 * reads the game state, decides a move, or talks to a transport.
 *
 * Everything here takes plain data and gives back elements, which keeps
 * js/app.js free to be about *when* things are drawn rather than *how*.
 * ==========================================================================*/

(function (root) {
  "use strict";
  const S = root.Score;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /**
   * One playing card.
   * @param {number|null} card  null renders a face-down back
   */
  function cardEl(card, opts) {
    opts = opts || {};
    const n = el("div", "card-el");
    if (opts.small) n.classList.add("small");

    if (card == null) {
      n.classList.add("back");
      n.setAttribute("aria-label", "face-down card");
    } else {
      const rank = S.RANK_NAMES[S.rankOf(card) - 1];
      const suit = S.SUIT_SYMBOLS[S.suitOf(card)];
      n.appendChild(el("span", "r", rank));
      n.appendChild(el("span", "s", suit));
      if (S.isRed(card)) n.classList.add("red");
      n.setAttribute("aria-label", rank + " of " + ["spades", "hearts", "diamonds", "clubs"][S.suitOf(card)]);
      n.dataset.card = String(card);
    }
    if (opts.playable) { n.classList.add("playable"); n.setAttribute("role", "button"); n.tabIndex = 0; }
    if (opts.selected) n.classList.add("selected");
    if (opts.dim) n.classList.add("dim");
    if (opts.hl) n.classList.add("hl");
    return n;
  }

  /** Replace a container's contents with a row of cards. */
  function renderCards(container, cards, opts) {
    container.textContent = "";
    for (const c of cards) container.appendChild(cardEl(c, opts));
    return container;
  }

  /** An empty slot, so the felt doesn't jump around before the cut. */
  function placeholder(small) {
    const n = el("div", "card-el ghost" + (small ? " small" : ""));
    return n;
  }

  // ----------------------------------------------------------------- board
  /**
   * The pegging board: a lane each, with the front peg where you are and the
   * back peg where you were — which is how a cribbage board shows you the size
   * of the last score at a glance.
   */
  function renderBoard(container, pub, seat) {
    container.textContent = "";
    const order = [seat, seat === 0 ? 1 : 0];
    const colours = {}; colours[seat] = "var(--accent)"; colours[seat === 0 ? 1 : 0] = "var(--accent-warm)";

    for (const s of order) {
      const lane = el("div", "lane");

      const head = el("div", "lane-head");
      const name = el("div", "lane-name");
      const dot = el("span", "dot");
      dot.style.background = colours[s];
      name.appendChild(dot);
      // "You (you)" — the local game names you "You" already, so only tag the
      // seat when the name doesn't say it.
      const tagged = s === seat && pub.names[s].toLowerCase() !== "you";
      name.appendChild(document.createTextNode(pub.names[s] + (tagged ? " (you)" : "")));
      if (pub.dealer === s) name.appendChild(el("span", "crown", "DEALS"));
      head.appendChild(name);

      const score = el("div", "lane-score", String(pub.scores[s]));
      const gain = pub.scores[s] - pub.prevScores[s];
      if (gain > 0) score.appendChild(el("span", "gain", "+" + gain));
      head.appendChild(score);
      lane.appendChild(head);

      const track = el("div", "track");
      const pct = (v) => Math.max(0, Math.min(100, (v / pub.target) * 100));
      const fill = el("div", "fill");
      fill.style.width = pct(pub.scores[s]) + "%";
      fill.style.background = colours[s];
      track.appendChild(fill);
      // The skunk line at 91 — losing before it is a skunk, and worth seeing coming.
      track.appendChild(el("div", "skunk"));
      const back = el("div", "back");
      back.style.left = pct(pub.prevScores[s]) + "%";
      track.appendChild(back);
      const front = el("div", "front");
      front.style.left = "calc(" + pct(pub.scores[s]) + "% - 2px)";
      front.style.background = colours[s];
      front.style.color = colours[s];
      track.appendChild(front);
      lane.appendChild(track);

      container.appendChild(lane);
    }

    const ticks = el("div", "ticks");
    for (const t of ["0", "30", "60", "91 skunk", "121"]) ticks.appendChild(el("span", null, t));
    container.appendChild(ticks);
  }

  // ------------------------------------------------------------- breakdown
  /** The itemised count at the show — every scoring combination, with its cards. */
  function renderBreakdown(items, points, label) {
    const box = el("div", "breakdown");
    if (!items.length) {
      box.appendChild(el("div", "bd-none", "Nothing — a nineteen."));
    } else {
      for (const it of items) {
        const row = el("div", "bd-item");
        row.appendChild(el("span", "pts", "+" + it.points));
        row.appendChild(el("span", null, it.label));
        const cards = el("div", "cards");
        for (const c of it.cards) cards.appendChild(cardEl(c, { small: true }));
        row.appendChild(cards);
        box.appendChild(row);
      }
    }
    const total = el("div", "bd-total");
    total.appendChild(el("span", null, label || "Total"));
    total.appendChild(el("span", null, String(points)));
    box.appendChild(total);
    return box;
  }

  // -------------------------------------------------------------- messages
  function renderPrompt(container, title, sub, extra) {
    container.textContent = "";
    container.appendChild(el("div", "p-title", title));
    if (sub) container.appendChild(el("div", "p-sub", sub));
    if (extra) container.appendChild(extra);
  }

  function renderLog(container, entries, seat) {
    container.textContent = "";
    for (const entry of entries) {
      const li = el("li", entry.by === seat ? "mine" : null);
      li.textContent = entry.text;
      container.appendChild(li);
    }
  }

  function button(label, cls, onClick, disabled) {
    const b = el("button", "btn " + (cls || ""), label);
    if (disabled) b.disabled = true;
    else b.addEventListener("click", onClick);
    return b;
  }

  root.UI = { el, cardEl, renderCards, placeholder, renderBoard, renderBreakdown, renderPrompt, renderLog, button };
})(typeof self !== "undefined" ? self : this);
