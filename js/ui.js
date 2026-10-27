/* ============================================================================
 * ui.js — rendering helpers. Builds DOM from plain data and returns it; it
 * never reads the game state, decides a move, or talks to a transport.
 * Cards are drawn by the shared table kit (js/table.js, TABLE.pc / TABLE.back).
 * ==========================================================================*/

(function (root) {
  "use strict";
  const S = root.Score, T = root.TABLE;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const fromHTML = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const SUIT_NAMES = ["spades", "hearts", "diamonds", "clubs"];

  /**
   * One playing card.
   * @param {number|null} card  null renders a face-down back
   * @param {object} [opts] { mini, playable, selected, dim, hl, played }
   */
  function cardEl(card, opts) {
    opts = opts || {};
    let n;
    if (card == null) {
      n = fromHTML(T.back({ pattern: "lattice", cls: "tbl-blue" }));
      n.setAttribute("aria-label", "face-down card");
    } else {
      n = fromHTML(T.pc(S.cardCode(card)));
      const rank = S.RANK_NAMES[S.rankOf(card) - 1];
      n.setAttribute("aria-label", rank + " of " + SUIT_NAMES[S.suitOf(card)]);
      n.dataset.card = String(card);
      n.dataset.suit = S.SUIT_SYMBOLS[S.suitOf(card)];
    }
    if (opts.mini) n.classList.add("mini");
    if (opts.playable) { n.classList.add("playable", "focus-ring"); n.setAttribute("role", "button"); n.tabIndex = 0; }
    if (opts.selected) n.classList.add("is-up");
    if (opts.dim) n.classList.add("dim");
    if (opts.hl) n.classList.add("hl");
    if (opts.played) n.classList.add("played");
    return n;
  }

  /** "5♥ K♠" with red suits marked, for count lines. */
  function cardsText(cards) {
    const box = el("span", "cs");
    cards.forEach((c, i) => {
      const s = el("span", S.isRed(c) ? "red" : null, S.cardName(c));
      box.appendChild(s);
      if (i < cards.length - 1) box.appendChild(document.createTextNode(" "));
    });
    return box;
  }

  /** The itemised count at the show — every scoring combination, with its cards. */
  function renderBreakdown(items, points, label, wait) {
    const box = el("div", "bd");
    if (!items.length) {
      box.appendChild(el("div", "bd-none", "Nothing — a nineteen."));
    } else {
      items.forEach((it, i) => {
        const row = el("div", "bd-item" + (wait ? " wait" : ""));
        row.dataset.i = String(i);
        row.appendChild(el("span", "p", "+" + it.points));
        row.appendChild(el("span", "l", it.label));
        row.appendChild(cardsText(it.cards));
        box.appendChild(row);
      });
    }
    const total = el("div", "bd-total");
    total.appendChild(el("span", null, label || "Total"));
    const t = el("span", "tot", String(wait ? 0 : points));
    total.appendChild(t);
    box.appendChild(total);
    return box;
  }

  function renderPrompt(container, title, sub, extra) {
    container.textContent = "";
    container.appendChild(el("div", "p-title", title));
    if (sub) container.appendChild(el("div", "p-sub", sub));
    if (extra) container.appendChild(extra);
  }

  function renderLog(container, entries, seat) {
    container.textContent = "";
    const ul = el("ul", "log-list");
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      ul.appendChild(el("li", entry.by === seat ? "mine" : null, entry.text));
    }
    if (!entries.length) ul.appendChild(el("li", "empty", "Nothing yet."));
    container.appendChild(ul);
  }

  /** Every count this game, newest first: whose, which cards, each item, the total. */
  function renderReviews(container, reviews, seat) {
    container.textContent = "";
    if (!reviews.length) { container.appendChild(el("p", "empty", "Counts appear here after each hand.")); return; }
    for (let i = reviews.length - 1; i >= 0; i--) {
      const r = reviews[i];
      const box = el("div", "rev");
      const head = el("div", "rev-head");
      head.appendChild(el("span", null, `Hand ${r.hand} · ${r.title}`));
      head.appendChild(el("span", "tot", String(r.points)));
      box.appendChild(head);
      const cards = el("div", "rev-cards");
      cards.appendChild(cardsText(r.cards));
      cards.appendChild(document.createTextNode(" + "));
      cards.appendChild(cardsText([r.starter]));
      box.appendChild(cards);
      const items = el("div", "rev-items");
      items.textContent = r.items.length ? r.items.map((it) => `${it.label} +${it.points}`).join(" · ") : "Nothing — a nineteen.";
      box.appendChild(items);
      if (r.claim != null && r.claim !== r.points) {
        box.appendChild(el("div", "claim-note bad", r.claim < r.points ? `Claimed ${r.claim}: muggins took ${r.points - r.claim}.` : `Claimed ${r.claim}, corrected to ${r.points}.`));
      }
      container.appendChild(box);
    }
  }

  function button(label, cls, onClick, disabled) {
    const b = el("button", "btn " + (cls || ""), label);
    if (disabled) b.disabled = true;
    else b.addEventListener("click", onClick);
    return b;
  }

  root.UI = { el, cardEl, cardsText, renderBreakdown, renderPrompt, renderLog, renderReviews, button };
})(typeof self !== "undefined" ? self : this);
