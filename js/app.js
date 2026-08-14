/* ============================================================================
 * app.js — the controller. Owns the screens, turns clicks into actions, and
 * redraws whenever a transport publishes a new state.
 *
 * It deliberately does NOT know whether it is driving a local game or an
 * online one. Both transports publish the same `game:state` event and accept
 * the same `submit(action)` calls, so everything below is written once. The
 * only place the distinction shows up is which object `transport` points at,
 * and what the Quit button has to tear down.
 * ==========================================================================*/

(function (root) {
  "use strict";
  const S = root.Score, E = root.Engine, UI = root.UI, AI = root.AI;

  const $ = (id) => document.getElementById(id);
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

  // --------------------------------------------------------------- elements
  const screens = { menu: $("screen-menu"), waiting: $("screen-waiting"), game: $("screen-game") };
  const board = $("board"), promptBox = $("prompt"), actionsBox = $("actions");
  const oppHand = $("opp-hand"), yourHand = $("your-hand"), seqBox = $("seq");
  const starterSlot = $("starter-slot"), cribSlot = $("crib-slot"), countBig = $("count-big");
  const oppLabel = $("opp-label"), oppMeta = $("opp-meta"), youMeta = $("you-meta");
  const logBox = $("log"), bannerSlot = $("banner-slot");
  const gameTitle = $("game-title"), gameSub = $("game-sub");
  const onlineStatus = $("online-status");

  // ------------------------------------------------------------------ state
  let transport = null;      // window.Local or window.Online
  let current = null;        // { pub, priv, seat, mode, thinking, level }
  let selected = [];         // cards picked for the discard
  let hint = null;           // the discard advice, once asked for
  let level = "hard";
  let lastLocalOpts = null;  // so "play again" deals the same kind of game

  const NAME_KEY = "cribbage.name.v1";
  const LEVEL_KEY = "cribbage.level.v1";
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

  function showScreen(name) {
    for (const k of Object.keys(screens)) screens[k].classList.toggle("active", k === name);
    window.scrollTo(0, 0);
  }

  function setStatus(text, kind) {
    onlineStatus.textContent = text || "";
    onlineStatus.className = "status" + (kind ? " " + kind : "");
  }

  // ================================================================= menu ==
  for (const b of $("difficulty").querySelectorAll("button")) {
    b.addEventListener("click", () => {
      level = b.dataset.level;
      lsSet(LEVEL_KEY, level);
      for (const other of $("difficulty").querySelectorAll("button")) {
        other.setAttribute("aria-pressed", String(other === b));
      }
    });
  }

  $("btn-vs-cpu").addEventListener("click", () => {
    const typed = ($("display-name").value || "").trim();
    if (typed) lsSet(NAME_KEY, typed);
    // With nothing typed the local player is simply "You" — but that is a
    // label, not a name, so it is never saved as one.
    lastLocalOpts = { level, yourName: typed || "You", cpuName: "Computer" };
    transport = root.Local;
    selected = []; hint = null;
    root.Local.start(lastLocalOpts);
    gameTitle.textContent = "You vs the computer";
    gameSub.textContent = AI.describeLevel(level);
    showScreen("game");
  });

  // ---- online entry points. These only ask; online.js does the work. ----
  const myName = () => (($("display-name").value || "").trim() || "Player").slice(0, 20);

  function requireOnline() {
    if (!root.Online || !root.Online.ready) {
      setStatus("Online play isn't available — the connection to the game server hasn't been set up yet.", "err");
      return false;
    }
    return true;
  }

  $("btn-find").addEventListener("click", async () => {
    if (!requireOnline()) return;
    lsSet(NAME_KEY, myName());
    setStatus("Connecting…", "busy");
    const r = await root.Online.find(myName());
    if (!r.ok) setStatus(r.message, "err"); else setStatus("");
  });

  $("btn-host").addEventListener("click", async () => {
    if (!requireOnline()) return;
    lsSet(NAME_KEY, myName());
    setStatus("Creating a room…", "busy");
    const r = await root.Online.host(myName());
    if (!r.ok) setStatus(r.message, "err"); else setStatus("");
  });

  $("btn-join").addEventListener("click", async () => {
    if (!requireOnline()) return;
    const code = ($("join-code").value || "").trim().toUpperCase();
    if (code.length < 4) { setStatus("Enter the six-character room code.", "err"); return; }
    lsSet(NAME_KEY, myName());
    setStatus("Joining " + code + "…", "busy");
    const r = await root.Online.join(code, myName());
    if (!r.ok) setStatus(r.message, "err"); else setStatus("");
  });

  $("btn-cancel-wait").addEventListener("click", async () => {
    if (root.Online) await root.Online.cancel();
    showScreen("menu");
    setStatus("");
  });

  $("btn-quit").addEventListener("click", async () => {
    if (current && current.mode === "online" && current.pub.winner === null) {
      if (!confirm("Leave the game? Your opponent will be told you resigned.")) return;
    }
    await leaveGame();
  });

  async function leaveGame() {
    if (transport === root.Online && root.Online) await root.Online.leave();
    else if (root.Local) root.Local.stop();
    transport = null; current = null; selected = []; hint = null;
    showScreen("menu");
  }

  // ============================================================== rendering
  document.addEventListener("game:state", (e) => {
    current = e.detail;
    render();
  });

  /** Cards a player has already laid down this hand, shown small and faded. */
  function appendPlayed(container, played) {
    if (!played.length) return;
    const sep = UI.el("div");
    sep.style.cssText = "width:1px;align-self:stretch;background:var(--line);margin:0 4px";
    container.appendChild(sep);
    for (const c of played) container.appendChild(UI.cardEl(c, { small: true, dim: true }));
  }

  function render() {
    if (!current) return;
    const { pub, priv, seat, thinking } = current;
    const opp = E.other(seat);

    UI.renderBoard(board, pub, seat);
    oppLabel.textContent = pub.names[opp];

    // ---- the felt ----
    starterSlot.textContent = "";
    starterSlot.appendChild(pub.starter == null ? UI.placeholder() : UI.cardEl(pub.starter));

    cribSlot.textContent = "";
    if (pub.crib.length) {
      for (const c of pub.crib) cribSlot.appendChild(UI.cardEl(c, { small: true }));
    } else {
      for (let i = 0; i < Math.max(1, pub.cribCount); i++) {
        cribSlot.appendChild(pub.cribCount ? UI.cardEl(null, { small: true }) : UI.placeholder(true));
      }
    }

    countBig.textContent = pub.phase === "pegging" ? String(pub.pegCount) : "—";
    seqBox.textContent = "";
    for (const c of pub.pegSeq) seqBox.appendChild(UI.cardEl(c));

    // ---- opponent ----
    const oppRevealed = seat === 0 ? pub.revealed1 : pub.revealed0;
    const oppPlayed = seat === 0 ? pub.pegPlayed1 : pub.pegPlayed0;
    const oppSize = seat === 0 ? pub.handSize1 : pub.handSize0;
    oppHand.textContent = "";
    if (oppRevealed.length) {
      for (const c of oppRevealed) oppHand.appendChild(UI.cardEl(c));
    } else {
      for (let i = 0; i < oppSize; i++) oppHand.appendChild(UI.cardEl(null));
      appendPlayed(oppHand, oppPlayed);
    }
    // The heartbeat in online.js is the only way to notice a tab that closed
    // without saying goodbye, so it outranks whatever else we'd have said.
    oppMeta.textContent = current.oppStale ? "not responding…"
      : pub.phase === "pegging" && pub.pegTurn === opp ? (thinking ? "thinking…" : "to play")
      : pub.phase === "discard" && (opp === 0 ? pub.discarded0 : pub.discarded1) ? "has thrown"
      : "";
    oppMeta.className = "meta" + ((current.oppStale || (pub.pegTurn === opp && pub.phase === "pegging")) ? " turn" : "");

    // ---- your cards ----
    const myPlayed = seat === 0 ? pub.pegPlayed0 : pub.pegPlayed1;
    const myTurn = pub.phase === "pegging" && pub.pegTurn === seat;
    const legal = myTurn ? priv.hand.filter((c) => pub.pegCount + S.valueOf(c) <= 31) : [];

    yourHand.textContent = "";
    const showCards = (pub.phase === "show" || pub.phase === "gameover") ? priv.dealt : priv.hand;
    for (const c of showCards) {
      const canPick = pub.phase === "discard" && priv.dealt.length === 0;
      const canPlay = myTurn && legal.includes(c);
      yourHand.appendChild(UI.cardEl(c, {
        playable: canPick || canPlay,
        selected: selected.includes(c),
        dim: myTurn && !legal.includes(c),
      }));
    }
    if (pub.phase === "pegging") appendPlayed(yourHand, myPlayed);
    youMeta.textContent = myTurn ? "your turn" : "";
    youMeta.className = "meta" + (myTurn ? " turn" : "");

    UI.renderLog(logBox, pub.log, seat);
    renderPhase(pub, priv, seat, opp, thinking);
  }

  /** The prompt and the buttons — everything that depends on whose move it is. */
  function renderPhase(pub, priv, seat, opp, thinking) {
    actionsBox.textContent = "";
    bannerSlot.textContent = "";

    if (pub.phase === "gameover") {
      const won = pub.winner === seat;
      const banner = UI.el("div", "banner");
      banner.appendChild(UI.el("h2", null, won ? "You win" : pub.names[pub.winner] + " wins"));
      const margin = pub.skunk === 2 ? " — a double skunk" : pub.skunk === 1 ? " — a skunk" : "";
      banner.appendChild(UI.el("p", null,
        `${pub.scores[seat]}–${pub.scores[opp]} after ${pub.handNumber} hand${pub.handNumber === 1 ? "" : "s"}${margin}.`));
      bannerSlot.appendChild(banner);

      UI.renderPrompt(promptBox, won ? "Nicely played." : "Better luck next deal.",
        "The game ends the moment someone reaches 121.");
      if (current.mode === "local") {
        actionsBox.appendChild(UI.button("Play again", "primary", () => {
          selected = []; hint = null;
          root.Local.start(lastLocalOpts);
        }));
      }
      actionsBox.appendChild(UI.button("Back to the menu", "ghost", leaveGame));
      return;
    }

    if (pub.phase === "discard") {
      if (priv.dealt.length === 0) {
        const mine = pub.dealer === seat;
        UI.renderPrompt(promptBox,
          mine ? "Throw two cards into your own crib" : `Throw two cards into ${pub.names[opp]}'s crib`,
          mine ? "You count the crib at the end of the hand, so give it something."
               : "Whatever you throw, they count. Give them as little as you can.",
          hint ? hintLine(hint) : null);
        actionsBox.appendChild(UI.button(
          selected.length === 2 ? "Throw these two" : `Pick ${2 - selected.length} more`,
          "primary",
          () => {
            const r = transport.submit({ type: "discard", cards: selected.slice() });
            if (r && r.then) r.then(() => {}); // online returns a promise
            selected = []; hint = null;
          },
          selected.length !== 2));
        actionsBox.appendChild(UI.button("What should I throw?", "ghost small", () => {
          hint = AI.analyseDiscards(priv.hand, pub.dealer === seat, "hard")
                   .sort((a, b) => b.value - a.value)[0];
          render();
        }));
      } else {
        UI.renderPrompt(promptBox, "Thrown.", `Waiting for ${pub.names[opp]}…`);
      }
      return;
    }

    if (pub.phase === "cut") {
      if (E.other(pub.dealer) === seat) {
        UI.renderPrompt(promptBox, "Cut for the starter",
          "The card you turn up counts in every hand — and in the crib.");
        actionsBox.appendChild(UI.button("Cut the deck", "primary", () => transport.submit({ type: "cut" })));
      } else {
        UI.renderPrompt(promptBox, `${pub.names[opp]} is cutting`,
          "A jack turned up gives you two for his heels.");
      }
      return;
    }

    if (pub.phase === "pegging") {
      if (pub.pegTurn === seat) {
        const legal = priv.hand.filter((c) => pub.pegCount + S.valueOf(c) <= 31);
        UI.renderPrompt(promptBox, "Your turn",
          `The count is ${pub.pegCount}. ` + (legal.length === priv.hand.length
            ? "Tap a card to play it."
            : `Only ${legal.length} of your cards will fit under 31.`));
      } else {
        UI.renderPrompt(promptBox, `${pub.names[opp]} to play`,
          thinking ? "Thinking…" : `The count is ${pub.pegCount}.`);
      }
      return;
    }

    if (pub.phase === "show") {
      const who = pub.showWho;
      const mine = who === seat;
      const what = pub.showLabel === "crib"
        ? (mine ? "your crib" : `${pub.names[who]}'s crib`)
        : (mine ? "your hand" : `${pub.names[who]}'s hand`);

      const panel = UI.el("div");
      const counted = UI.el("div", "cards");
      counted.style.marginTop = "10px";
      for (const c of pub.showCards) counted.appendChild(UI.cardEl(c, { small: true }));
      if (pub.starter != null) {
        counted.appendChild(UI.el("span", null, "+"));
        counted.appendChild(UI.cardEl(pub.starter, { small: true, hl: true }));
      }
      panel.appendChild(counted);
      panel.appendChild(UI.renderBreakdown(pub.showItems, pub.showPoints,
        pub.showLabel === "crib" ? "The crib" : "The hand"));

      UI.renderPrompt(promptBox, `Counting ${what}`,
        pub.showStep === 0 ? "The non-dealer always counts first." :
        pub.showStep === 1 ? "Now the dealer." : "And last, the crib.",
        panel);

      actionsBox.appendChild(UI.button(
        pub.showStep < 2 ? "Continue" : "Next hand", "primary",
        () => transport.submit({ type: "next" })));
      return;
    }
  }

  /** The one-line discard recommendation. */
  function hintLine(best) {
    const line = UI.el("div", "p-sub");
    line.style.color = "var(--accent-warm)";
    line.style.marginTop = "6px";
    line.textContent =
      `Throw ${best.throw.map(S.cardName).join(" and ")} — keeps ` +
      `${best.keep.map(S.cardName).join(" ")}, worth ${best.expected.toFixed(1)} on average` +
      ` with the crib ${best.crib.toFixed(1)}.`;
    return line;
  }

  // ------------------------------------------------------------ card clicks
  function cardFromEvent(e) {
    const node = e.target.closest(".card-el");
    if (!node || !node.dataset.card || !node.classList.contains("playable")) return null;
    return Number(node.dataset.card);
  }

  yourHand.addEventListener("click", (e) => {
    const card = cardFromEvent(e);
    if (card == null || !current) return;
    const { pub, priv, seat } = current;

    if (pub.phase === "discard" && priv.dealt.length === 0) {
      const at = selected.indexOf(card);
      if (at >= 0) selected.splice(at, 1);
      else if (selected.length < 2) selected.push(card);
      render();
      return;
    }
    if (pub.phase === "pegging" && pub.pegTurn === seat) {
      transport.submit({ type: "play", card });
    }
  });
  yourHand.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); yourHand.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
  });

  // ========================================================= online bridge
  // online.js announces what it is doing; the controller only decides which
  // screen that corresponds to.
  document.addEventListener("online:waiting", (e) => {
    transport = root.Online;
    const code = e.detail && e.detail.code;
    $("wait-title").textContent = code ? "Waiting for your friend" : "Looking for an opponent…";
    $("wait-sub").textContent = code
      ? "They can join from the menu with this code."
      : "You'll be matched with the next person who's also looking.";
    $("wait-code").hidden = !code;
    $("wait-note").hidden = !code;
    if (code) $("wait-code").textContent = code;
    showScreen("waiting");
  });

  document.addEventListener("online:matched", (e) => {
    transport = root.Online;
    selected = []; hint = null;
    const oppName = (e.detail && e.detail.opponent) || "your opponent";
    gameTitle.textContent = "You vs " + oppName;
    gameSub.textContent = "online game";
    showScreen("game");
  });

  document.addEventListener("online:ended", (e) => {
    const msg = (e.detail && e.detail.message) || "The game ended.";
    if (current && current.pub && current.pub.winner !== null) return; // a finished game keeps its banner
    transport = null; current = null;
    showScreen("menu");
    setStatus(msg, "err");
  });

  document.addEventListener("online:status", (e) => {
    setStatus(e.detail && e.detail.text, e.detail && e.detail.kind);
  });

  // ------------------------------------------------------------------ boot
  const savedName = lsGet(NAME_KEY);
  if (savedName) $("display-name").value = savedName;
  const savedLevel = lsGet(LEVEL_KEY);
  if (savedLevel) {
    level = savedLevel;
    for (const b of $("difficulty").querySelectorAll("button")) {
      b.setAttribute("aria-pressed", String(b.dataset.level === level));
    }
  }

  root.App = { showScreen, setStatus, get current() { return current; } };
})(typeof self !== "undefined" ? self : this);
