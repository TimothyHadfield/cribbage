/* ============================================================================
 * app.js — the controller. Owns the screens, turns taps into actions, and
 * redraws whenever the transport publishes a new state. Sounds and motion are
 * worked out from the DIFFERENCE between the last view and this one, so the
 * same code animates the computer's moves and yours.
 * ==========================================================================*/

(function (root) {
  "use strict";
  const S = root.Score, E = root.Engine, UI = root.UI, AI = root.AI, T = root.TABLE;
  const FX = root.FX, Profile = root.Profile, CP = root.CribProfile;

  const $ = (id) => document.getElementById(id);
  const fx = (name, o) => { try { if (FX) FX.play(name, o); } catch (e) { /* never break the game for a sound */ } };
  const animOn = () => !!(T && T.animOn && T.animOn());
  const speed = () => { try { return FX && FX.settings.animSpeed === "fast" ? 0.55 : 1; } catch (e) { return 1; } };

  // --------------------------------------------------------------- elements
  const screens = { menu: $("screen-menu"), game: $("screen-game") };
  const promptBox = $("prompt"), actionsBox = $("actions");
  const oppHand = $("opp-hand"), yourHand = $("your-hand"), seqBox = $("seq");
  const starterSlot = $("starter-slot"), cribSlot = $("crib-slot"), countBig = $("count-big");
  const oppLabel = $("opp-label"), oppMeta = $("opp-meta"), youMeta = $("you-meta");
  const bannerSlot = $("banner-slot"), countView = $("count-view"), mid = $("mid");
  const scoresBox = $("scores"), undoBtn = $("btn-undo");
  const gameTitle = $("game-title"), gameSub = $("game-sub");

  // ------------------------------------------------------------------ state
  let current = null;        // { pub, priv, seat, mode, thinking, level, canUndo }
  let prev = null;           // the view before this one, for sounds and motion
  let selected = [];         // cards picked for the discard
  let hint = null;           // the discard advice, once asked for
  let level = "hard";
  let lastOpts = null;       // so "Play again" deals the same kind of game
  let game = null;           // { id, daily, day, hinted, recorded, muggins, bestHand, reviews }
  let claimVal = 0;
  let fan = null;
  let countToken = 0;
  let gameSeq = 0;

  const LEVEL_KEY = "cribbage.level.v1";
  const MUGGINS_KEY = "cribbage.muggins.v1";
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  let muggins = lsGet(MUGGINS_KEY) === "1";

  function showScreen(name) {
    for (const k of Object.keys(screens)) screens[k].classList.toggle("active", k === name);
  }

  // ============================================================ kits setup ==
  if (FX) FX.init({ game: "cribbage", accent: "#6ea8fe" });
  if (FX) FX.define("peg", (k) => { k.tone({ f: 640, f2: 470, dur: 0.07, vol: 0.5, type: "triangle" }); k.noise({ f: 2600, filter: "bandpass", dur: 0.03, vol: 0.35 }); });

  if (Profile) {
    Profile.init({
      game: "cribbage", levels: CP.LEVELS, achievements: CP.ACHIEVEMENTS,
      modes: { help: { name: "Computer, with help" }, friends: { hide: true }, online: { hide: true } },
      daily: { title: "Daily game", onPlay: () => startDaily() },
      onChange: () => paintMe(),
    });
  }
  function paintMe() {
    if (!Profile) return;
    $("btn-stats").innerHTML = Profile.avatarSVG(Profile.avatar, 26);
    $("btn-stats-menu").innerHTML = Profile.avatarSVG(Profile.avatar, 22) + "<span>My stats</span>";
    const done = Profile.daily.played();
    $("btn-daily").innerHTML = done ? 'Daily game <span class="daily-done">✓ played</span>' : "Daily game";
  }
  paintMe();
  $("btn-stats").addEventListener("click", () => Profile && Profile.openPanel());
  $("btn-stats-menu").addEventListener("click", () => Profile && Profile.openPanel());

  // the boards: a decorative one on the menu, the live one in the game
  const menuBoard = root.PegBoard.create($("menu-board"));
  menuBoard.set([74, 96], [68, 87]);
  const board = root.PegBoard.create($("pegboard"));

  // ================================================================= menu ==
  function pressLevel() {
    for (const b of $("difficulty").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.level === level));
  }
  for (const b of $("difficulty").querySelectorAll("button")) {
    b.addEventListener("click", () => { level = b.dataset.level; lsSet(LEVEL_KEY, level); pressLevel(); });
  }

  function newGame(opts) {
    lastOpts = opts;
    gameSeq++;
    game = { id: gameSeq, daily: !!opts.daily, day: opts.day || null, hinted: false, recorded: false,
             muggins: !!opts.muggins, bestHand: 0, reviews: [], seen: {} };
    selected = []; hint = null; prev = null; current = null; claimVal = 0;
    gameTitle.textContent = opts.daily ? "Daily game" : "You vs the computer";
    gameSub.textContent = (opts.level[0].toUpperCase() + opts.level.slice(1)) + " computer" + (opts.muggins ? " · muggins" : "");
    gameSub.title = AI.describeLevel(opts.level);
    showScreen("game");
    root.Local.start(opts);
  }

  $("btn-vs-cpu").addEventListener("click", () => newGame({ level, muggins, yourName: "You", cpuName: "Computer" }));

  function startDaily() {
    if (!Profile) return;
    if (Profile.daily.played()) { Profile.openPanel({ tab: "daily" }); return; }
    if (Profile.isOpen && Profile.isOpen()) Profile.closePanel();
    const day = Profile.daily.date();
    newGame({ level: "hard", muggins, yourName: "You", cpuName: "Computer", daily: true, day, seed: Profile.daily.seed(day, "deal") });
  }
  $("btn-daily").addEventListener("click", startDaily);

  // ================================================================ sheets ==
  function openSheet(title, build, tabs) {
    closeSheet();
    const back = UI.el("div", "sheet-back");
    back.id = "sheet-back";
    const sheet = UI.el("div", "sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", title);
    const head = UI.el("div", "sheet-head");
    head.appendChild(UI.el("h3", null, title));
    const x = UI.el("button", "icon-btn", "✕");
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", closeSheet);
    head.appendChild(x);
    sheet.appendChild(head);
    build(sheet);
    back.appendChild(sheet);
    back.addEventListener("click", (e) => { if (e.target === back) closeSheet(); });
    document.body.appendChild(back);
    x.focus();
  }
  function closeSheet() { const b = $("sheet-back"); if (b) b.remove(); }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("sheet-back")) closeSheet(); });

  function buildSettings(sheet) {
    const body = UI.el("div", "sheet-body");
    body.appendChild(UI.el("h4", null, "Rules"));
    const row = UI.el("div", "set-row");
    const lab = UI.el("span", "lab");
    const l = UI.el("label", null, "Muggins");
    l.htmlFor = "set-muggins";
    lab.appendChild(l);
    const q = UI.el("button", "q", "?");
    q.type = "button";
    q.setAttribute("aria-label", "What is muggins?");
    lab.appendChild(q);
    row.appendChild(lab);
    const sw = UI.el("label", "switch");
    const inp = document.createElement("input");
    inp.type = "checkbox"; inp.id = "set-muggins"; inp.checked = muggins;
    sw.appendChild(inp); sw.appendChild(UI.el("span"));
    row.appendChild(sw);
    body.appendChild(row);
    const why = UI.el("div", "set-why", "You count your own hand and crib. Miss points and the computer takes them. Starts with your next game.");
    why.hidden = true;
    body.appendChild(why);
    q.addEventListener("click", () => { why.hidden = !why.hidden; });
    inp.addEventListener("change", () => { muggins = inp.checked; lsSet(MUGGINS_KEY, muggins ? "1" : "0"); });
    body.appendChild(UI.el("h4", null, "Sound & effects"));
    if (FX) FX.renderSettings(body);
    sheet.appendChild(body);
  }
  $("btn-settings").addEventListener("click", () => openSheet("Settings", buildSettings));
  $("btn-settings-menu").addEventListener("click", () => openSheet("Settings", buildSettings));
  $("btn-rules").addEventListener("click", () => openSheet("How cribbage works", (sheet) => {
    const body = UI.el("div", "sheet-body");
    body.appendChild($("rules-text").content.cloneNode(true));
    sheet.appendChild(body);
  }));

  /** Log + count review, as tabs. Used by the phone sheet and the laptop side column. */
  let infoTab = "counts";
  function buildInfo(box) {
    const tabs = UI.el("div", "sheet-tabs");
    tabs.setAttribute("role", "tablist");
    const body = UI.el("div", "sheet-body");
    const draw = () => {
      for (const b of tabs.children) b.setAttribute("aria-selected", String(b.dataset.tab === infoTab));
      if (!current) { body.textContent = ""; return; }
      if (infoTab === "counts") UI.renderReviews(body, game ? game.reviews : [], current.seat);
      else UI.renderLog(body, current.pub.log, current.seat);
    };
    for (const [id, label] of [["counts", "Counts"], ["log", "Log"]]) {
      const b = UI.el("button", null, label);
      b.dataset.tab = id; b.setAttribute("role", "tab");
      b.addEventListener("click", () => { infoTab = id; draw(); });
      tabs.appendChild(b);
    }
    box.appendChild(tabs);
    box.appendChild(body);
    draw();
    box._draw = draw;
  }
  $("btn-log").addEventListener("click", () => openSheet("This game", buildInfo));
  const side = $("side-col");
  buildInfo(side);
  const redrawInfo = () => {
    if (side._draw) side._draw();
    const s = document.querySelector("#sheet-back .sheet");
    if (s && s._draw) s._draw();
  };

  // ========================================================== leaving =====
  function appConfirm(message, okText) {
    return new Promise((resolve) => {
      const back = UI.el("div", "dialog-back");
      const box = UI.el("div", "dialog");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.appendChild(UI.el("p", "dialog-msg", message));
      const row = UI.el("div", "dialog-actions");
      const done = (answer) => { document.removeEventListener("keydown", onKey, true); back.remove(); resolve(answer); };
      const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); done(false); }
        else if (e.key === "Enter") { e.preventDefault(); done(true); }
      };
      row.appendChild(UI.button("Cancel", "ghost", () => done(false)));
      const ok = UI.button(okText || "OK", "primary", () => done(true));
      row.appendChild(ok);
      box.appendChild(row);
      back.appendChild(box);
      back.addEventListener("click", (e) => { if (e.target === back) done(false); });
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(back);
      ok.focus();
    });
  }

  $("btn-quit").addEventListener("click", async () => {
    const live = current && current.pub.winner === null;
    if (live && game && game.daily) {
      if (!(await appConfirm("Leave the Daily game? It counts as a loss.", "Leave"))) return;
      if (Profile && !game.recorded) { game.recorded = true; Profile.recordResult({ mode: "computer", level: "hard", won: false, daily: true, date: game.day }); }
    }
    leaveGame();
  });

  function leaveGame() {
    root.Local.stop();
    if (fan && fan.disconnect) fan.disconnect();
    fan = null; current = null; prev = null; selected = []; hint = null;
    countToken++;
    paintMe();
    showScreen("menu");
  }

  undoBtn.addEventListener("click", () => {
    if (!current || !current.canUndo) return;
    if (root.Local.undo().ok) { selected = []; fx("whoosh", { vol: 0.6 }); }
  });

  // ============================================================== rendering
  document.addEventListener("game:state", (e) => {
    prev = current;
    current = e.detail;
    // a new game's first view must not animate from the last game's
    if (prev && (prev.pub.handNumber > current.pub.handNumber)) prev = null;
    render();
  });

  function render() {
    if (!current) return;
    const { pub, priv, seat, thinking } = current;
    const opp = E.other(seat);
    const p = prev && prev.pub;
    const newHand = !p || p.handNumber !== pub.handNumber;
    const scored = !!p && (pub.scores[0] !== p.scores[0] || pub.scores[1] !== p.scores[1]);

    undoBtn.disabled = !current.canUndo;
    $("felt").dataset.phase = pub.phase;

    // ---- scores + the peg board ----
    renderScores(pub, seat, opp);
    board.set([pub.scores[opp], pub.scores[seat]], [pub.prevScores[opp], pub.prevScores[seat]], { animate: !!p && animOn() })
      .then(() => { if (scored) fx("peg"); });

    // ---- opponent ----
    oppLabel.textContent = pub.names[opp];
    const oppRevealed = seat === 0 ? pub.revealed1 : pub.revealed0;
    const oppPlayed = seat === 0 ? pub.pegPlayed1 : pub.pegPlayed0;
    const oppSize = seat === 0 ? pub.handSize1 : pub.handSize0;
    oppHand.textContent = "";
    if (oppRevealed.length) {
      for (const c of oppRevealed) oppHand.appendChild(UI.cardEl(c, { mini: true }));
    } else {
      for (let i = 0; i < oppSize; i++) oppHand.appendChild(UI.cardEl(null));
      if (oppPlayed.length) {
        if (oppSize) oppHand.appendChild(UI.el("span", "sep"));
        for (const c of oppPlayed) { const n = UI.cardEl(c, { mini: true }); n.classList.add("played"); oppHand.appendChild(n); }
      }
    }
    oppMeta.textContent = pub.phase === "pegging" && pub.pegTurn === opp ? (thinking ? "thinking…" : "to play")
      : pub.phase === "discard" && (opp === 0 ? pub.discarded0 : pub.discarded1) ? "has thrown"
      : pub.phase === "discard" && thinking ? "thinking…"
      : pub.dealer === opp ? "deals" : "";
    oppMeta.className = "meta" + (pub.phase === "pegging" && pub.pegTurn === opp ? " turn" : "");

    // ---- crib, starter, the count ----
    cribSlot.textContent = "";
    cribSlot.classList.toggle("is-mine", pub.dealer === seat);
    const nCrib = pub.cribCount;
    if (!nCrib) cribSlot.appendChild(UI.el("div", "tbl-spot"));
    for (let i = 0; i < nCrib; i++) {
      const b = UI.cardEl(null);
      b.style.transform = `translate(${i * 1.5}px, ${-i * 1.5}px) rotate(${(i % 2 ? 2 : -2)}deg)`;
      cribSlot.appendChild(b);
    }
    if (p && nCrib > p.cribCount && !newHand) fx("cardSlide");

    starterSlot.textContent = "";
    if (pub.starter == null) {
      const d = UI.el("div");
      T.deck(d, 52 - 12 - 0, { pattern: "lattice", cls: "tbl-blue", badge: false, max: 6 });
      starterSlot.appendChild(d);
    } else {
      const s = UI.cardEl(pub.starter);
      starterSlot.appendChild(s);
      if (p && p.starter == null && !newHand) { fx("cardFlip"); if (FX && animOn()) FX.pop(s); }
    }

    countBig.textContent = pub.phase === "pegging" ? String(pub.pegCount) : "—";
    seqBox.textContent = "";
    const grew = p && !newHand && pub.pegSeq.length > p.pegSeq.length;
    pub.pegSeq.forEach((c, i) => {
      const n = UI.cardEl(c);
      if (grew && i === pub.pegSeq.length - 1 && animOn()) {
        const mine = (seat === 0 ? pub.pegPlayed0 : pub.pegPlayed1).includes(c);
        n.classList.add(mine ? "in-up" : "in-down");
      }
      seqBox.appendChild(n);
    });
    if (grew) fx("cardDeal", { vol: 0.8 });

    // ---- your cards ----
    renderHand(pub, priv, seat, newHand);

    // ---- show vs table ----
    const showing = pub.phase === "show";
    mid.hidden = showing;
    $("felt").querySelector(".opp-row").hidden = showing;
    countView.hidden = !showing;
    if (!showing) countToken++;

    youMeta.textContent = pub.phase === "pegging" && pub.pegTurn === seat ? "your turn" : "";
    youMeta.className = pub.phase === "pegging" && pub.pegTurn === seat ? "turn" : "";

    // points scored since the last view: float the number by the score
    if (p && !newHand) {
      for (const s of [seat, opp]) {
        const gain = pub.scores[s] - p.scores[s];
        if (gain > 0 && FX && animOn()) {
          const target = scoresBox.querySelector(`[data-seat="${s}"] .pts`);
          if (target) FX.floatText(target, "+" + gain, "var(--good)");
        }
        if (gain > 0 && pub.phase === "pegging") fx("chip", { vol: 0.7 });
      }
    }
    if (newHand && p) fx("shuffle");

    renderPhase(pub, priv, seat, opp, thinking);
    trackReviews(pub, seat);
    redrawInfo();
    if (pub.phase === "gameover") finishGame(pub, seat);
  }

  function renderScores(pub, seat, opp) {
    scoresBox.textContent = "";
    const one = (s, color, right) => {
      const box = UI.el("div", "sc");
      box.dataset.seat = String(s);
      if (right) box.style.flexDirection = "row-reverse";
      const dot = UI.el("span", "dot"); dot.style.background = color;
      box.appendChild(dot);
      box.appendChild(UI.el("span", "nm", pub.names[s]));
      box.appendChild(UI.el("span", "pts", String(pub.scores[s])));
      const gain = pub.scores[s] - pub.prevScores[s];
      box.appendChild(UI.el("span", "gain", gain > 0 ? "+" + gain : ""));
      return box;
    };
    scoresBox.appendChild(one(seat, "var(--you)", false));
    scoresBox.appendChild(one(opp, "var(--opp)", true));
  }

  function renderHand(pub, priv, seat, newHand) {
    const focusedIdx = (() => { const a = document.activeElement; return a && yourHand.contains(a) ? Array.from(yourHand.children).indexOf(a) : -1; })();
    const myPlayed = seat === 0 ? pub.pegPlayed0 : pub.pegPlayed1;
    const myTurn = pub.phase === "pegging" && pub.pegTurn === seat;
    const canPick = pub.phase === "discard" && priv.dealt.length === 0;
    let cards, played = [];
    if (pub.phase === "show" || pub.phase === "gameover") cards = priv.dealt.length ? priv.dealt : priv.hand;
    else if (pub.phase === "pegging") { cards = priv.hand; played = myPlayed; }
    else cards = priv.hand;

    const els = [];
    for (const c of cards) {
      const legal = myTurn && pub.pegCount + S.valueOf(c) <= 31;
      els.push(UI.cardEl(c, { playable: canPick || legal, selected: selected.includes(c), dim: myTurn && !legal }));
    }
    for (const c of played) els.push(UI.cardEl(c, { played: true }));
    if (fan && fan.disconnect) fan.disconnect();
    fan = T.fan(yourHand, els, { pick: false, lift: 16, spread: 0.66, maxRot: 9, minHeight: 60 });
    if (newHand && animOn() && (pub.phase === "discard")) {
      yourHand.classList.remove("deal-anim"); void yourHand.offsetWidth;
      els.forEach((n, i) => { n.style.animationDelay = Math.round(i * 70 * speed()) + "ms"; });
      yourHand.classList.add("deal-anim");
    } else yourHand.classList.remove("deal-anim");
    if (focusedIdx >= 0) {
      const next = yourHand.children[Math.min(focusedIdx, yourHand.children.length - 1)];
      const target = next && next.classList.contains("playable") ? next : yourHand.querySelector(".playable");
      if (target) target.focus({ preventScroll: true });
    }
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
      const rated = UI.el("div", "rated", game && (game.hinted || root.Local.undos) ? "Hint or Undo used: counted under “with help”, not rated." : "");
      rated.id = "rated-line";
      banner.appendChild(rated);
      bannerSlot.appendChild(banner);
      mid.hidden = true;
      UI.renderPrompt(promptBox, won ? "Nicely played." : "Better luck next deal.", "The game ends the moment someone reaches 121.");
      actionsBox.appendChild(UI.button(game && game.daily ? "New game" : "Play again", "primary", () => {
        const o = Object.assign({}, lastOpts, { muggins });
        if (o.daily) { delete o.daily; delete o.seed; delete o.day; o.level = level; }
        newGame(o);
      }));
      actionsBox.appendChild(UI.button("Counts", "ghost", () => { infoTab = "counts"; openSheet("This game", buildInfo); }));
      actionsBox.appendChild(UI.button("Menu", "ghost", leaveGame));
      return;
    }

    if (pub.phase === "discard") {
      if (priv.dealt.length === 0) {
        const mine = pub.dealer === seat;
        UI.renderPrompt(promptBox,
          mine ? "Throw two to your crib" : `Throw two to ${pub.names[opp]}'s crib`,
          mine ? "You count the crib, so give it something." : "They count it. Give them as little as you can.",
          hint ? hintLine(hint) : null);
        actionsBox.appendChild(UI.button(
          selected.length === 2 ? "Throw these two" : `Pick ${2 - selected.length} more`,
          "primary",
          () => {
            const r = root.Local.submit({ type: "discard", cards: selected.slice() });
            if (r && r.ok) { selected = []; hint = null; }
          },
          selected.length !== 2));
        actionsBox.appendChild(UI.button("What should I throw?", "ghost small", () => {
          hint = AI.analyseDiscards(priv.hand, pub.dealer === seat, "hard").sort((a, b) => b.value - a.value)[0];
          if (game) game.hinted = true;
          render();
        }));
      } else {
        UI.renderPrompt(promptBox, "Thrown.", `Waiting for ${pub.names[opp]}…`);
      }
      return;
    }

    if (pub.phase === "cut") {
      if (E.other(pub.dealer) === seat) {
        UI.renderPrompt(promptBox, "Cut for the starter", "It counts in every hand, and in the crib.");
        actionsBox.appendChild(UI.button("Cut the deck", "primary", () => root.Local.submit({ type: "cut" })));
      } else {
        UI.renderPrompt(promptBox, `${pub.names[opp]} is cutting`, "A jack turned up gives you two for his heels.");
      }
      return;
    }

    if (pub.phase === "pegging") {
      if (pub.pegTurn === seat) {
        const legal = priv.hand.filter((c) => pub.pegCount + S.valueOf(c) <= 31);
        UI.renderPrompt(promptBox, "Your turn",
          `The count is ${pub.pegCount}. ` + (legal.length === priv.hand.length ? "Tap a card to play it." : `Only ${legal.length} of your cards fit under 31.`));
      } else {
        UI.renderPrompt(promptBox, `${pub.names[opp]} to play`, thinking ? "Thinking…" : `The count is ${pub.pegCount}.`);
      }
      return;
    }

    if (pub.phase === "show") renderShow(pub, seat);
  }

  function renderShow(pub, seat) {
    const who = pub.showWho, mine = who === seat;
    const what = pub.showLabel === "crib" ? (mine ? "your crib" : `${pub.names[who]}'s crib`) : (mine ? "your hand" : `${pub.names[who]}'s hand`);
    const key = `${pub.handNumber}-${pub.showStep}-${pub.showPending ? "p" : "c"}`;
    const fresh = countView.dataset.key !== key;
    countView.dataset.key = key;

    // the counted cards + starter
    if (fresh) {
      countView.textContent = "";
      const row = UI.el("div", "counted");
      for (const c of pub.showCards) row.appendChild(UI.cardEl(c));
      row.appendChild(UI.el("span", "plus", "+"));
      if (pub.starter != null) row.appendChild(UI.cardEl(pub.starter));
      countView.appendChild(row);
    }

    const order = pub.showStep === 0 ? "The non-dealer counts first." : pub.showStep === 1 ? "Now the dealer." : "And last, the crib.";

    if (pub.showPending) {
      // muggins: you name the total before seeing the breakdown
      if (mine) {
        UI.renderPrompt(promptBox, `Count ${what}`, "Miss any and the computer takes them.");
        const st = UI.el("div", "stepper");
        const val = UI.el("span", "val", String(claimVal));
        const minus = UI.button("−", "", () => { claimVal = Math.max(0, claimVal - 1); val.textContent = String(claimVal); });
        const plus = UI.button("+", "", () => { claimVal = Math.min(29, claimVal + 1); val.textContent = String(claimVal); });
        minus.setAttribute("aria-label", "One less"); plus.setAttribute("aria-label", "One more");
        st.appendChild(minus); st.appendChild(val); st.appendChild(plus);
        actionsBox.appendChild(st);
        actionsBox.appendChild(UI.button("Claim", "primary", () => {
          const r = root.Local.submit({ type: "claim", points: claimVal });
          if (r && r.ok) claimVal = 0;
        }));
      } else {
        UI.renderPrompt(promptBox, `Counting ${what}`, order);
      }
      if (fresh) { const ph = UI.el("div", "bd"); ph.appendChild(UI.el("div", "bd-none", "Count the cards above.")); countView.appendChild(ph); }
      return;
    }

    let note = null;
    if (pub.showClaim != null && pub.showClaim !== pub.showPoints) {
      note = UI.el("div", "claim-note bad", pub.showClaim < pub.showPoints
        ? `You claimed ${pub.showClaim}: muggins! ${pub.names[E.other(who)]} takes ${pub.showPoints - pub.showClaim}.`
        : `You claimed ${pub.showClaim}; it's ${pub.showPoints}.`);
    }
    UI.renderPrompt(promptBox, `Counting ${what}: ${pub.showPoints}`, order, note);
    actionsBox.appendChild(UI.button(pub.showStep < 2 ? "Continue" : "Next hand", "primary", () => root.Local.submit({ type: "next" })));

    if (fresh) {
      const label = pub.showLabel === "crib" ? "The crib" : "The hand";
      const doAnim = animOn() && pub.showItems.length > 0;
      const bd = UI.renderBreakdown(pub.showItems, pub.showPoints, label, doAnim);
      countView.appendChild(bd);
      if (doAnim) countItems(bd, pub.showItems, pub.showPoints);
      else if (pub.showPoints >= 12) fx("ding", { vol: 0.7 });
    }
  }

  /** "Fifteen two, fifteen four…": light each item and its cards in turn, counting up. */
  function countItems(bd, items, total) {
    const token = ++countToken;
    const rows = Array.from(bd.querySelectorAll(".bd-item"));
    const tot = bd.querySelector(".tot");
    const cardsRow = Array.from(countView.querySelectorAll(".counted .tbl-card"));
    let sum = 0, i = 0;
    const stepMs = Math.round(430 * speed());
    const next = () => {
      if (token !== countToken || !bd.isConnected) return;
      cardsRow.forEach((n) => n.classList.remove("hl"));
      if (i >= rows.length) {
        if (total >= 12) fx("ding", { vol: 0.7 });
        return;
      }
      const it = items[i], row = rows[i];
      row.classList.remove("wait");
      for (const n of cardsRow) if (it.cards.includes(Number(n.dataset.card))) n.classList.add("hl");
      sum += it.points;
      tot.textContent = String(sum);
      fx("chip", { pitch: 1 + i * 0.07, vol: 0.6 });
      if (row.scrollIntoView && row.offsetTop + row.offsetHeight > bd.scrollTop + bd.clientHeight) bd.scrollTop = row.offsetTop - bd.clientHeight + row.offsetHeight;
      i++;
      setTimeout(next, stepMs);
    };
    setTimeout(next, Math.round(260 * speed()));
  }

  /** Keep every count for the review tab (and the "big hand" award). */
  function trackReviews(pub, seat) {
    if (!game || pub.phase !== "show" || pub.showPending || pub.starter == null) return;
    const key = pub.handNumber + "-" + pub.showStep;
    if (game.seen[key]) return;
    game.seen[key] = true;
    const who = pub.showWho, mine = who === seat;
    const title = pub.showLabel === "crib" ? (mine ? "your crib" : `${pub.names[who]}'s crib`) : (mine ? "your hand" : `${pub.names[who]}'s hand`);
    game.reviews.push({ hand: pub.handNumber, title, who, cards: pub.showCards.slice(), starter: pub.starter,
      items: pub.showItems.slice(), points: pub.showPoints, claim: pub.showClaim });
    if (mine && pub.showLabel === "hand") game.bestHand = Math.max(game.bestHand, pub.showPoints);
  }

  function finishGame(pub, seat) {
    if (!game || game.recorded) return;
    game.recorded = true;
    const won = pub.winner === seat;
    if (FX) {
      setTimeout(() => {
        try {
          FX.celebrate({ kind: won ? "win" : "lose" });
          if (won && pub.skunk) setTimeout(() => FX.celebrate({ kind: "big", at: $("pegboard") }), 900);
        } catch (e) { /* ignore */ }
      }, 450);
    }
    if (!Profile) return;
    const helped = game.hinted || root.Local.undos > 0;
    const res = CP.result({ pub, seat, level: lastOpts.level, helped, daily: game.daily, muggins: game.muggins, bestHand: game.bestHand });
    if (game.daily) res.date = game.day;
    const out = Profile.recordResult(res);
    const line = $("rated-line");
    if (line && out && out.elo) line.textContent = `Rating ${out.elo.after} (${out.elo.change >= 0 ? "+" : ""}${out.elo.change}).`;
    paintMe();
  }

  /** The one-line discard recommendation. */
  function hintLine(best) {
    const line = UI.el("div", "hint");
    line.textContent =
      `Throw ${best.throw.map(S.cardName).join(" and ")}: keeps ` +
      `${best.keep.map(S.cardName).join(" ")}, worth ${best.expected.toFixed(1)} on average` +
      `, crib ${best.crib.toFixed(1)}.`;
    return line;
  }

  // ------------------------------------------------------------ card taps
  function cardFromEvent(e) {
    const node = e.target.closest(".tbl-card");
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
      else { selected.shift(); selected.push(card); }
      fx("cardFlip", { vol: 0.5 });
      render();
      return;
    }
    if (pub.phase === "pegging" && pub.pegTurn === seat) root.Local.submit({ type: "play", card });
  });
  yourHand.addEventListener("keydown", (e) => {
    const node = e.target.closest && e.target.closest(".tbl-card");
    if (node && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); node.click(); }
  });

  // ------------------------------------------------------------------ boot
  const savedLevel = lsGet(LEVEL_KEY);
  if (savedLevel && ["easy", "medium", "hard"].includes(savedLevel)) level = savedLevel;
  pressLevel();

  root.App = { showScreen, confirm: appConfirm, get current() { return current; }, get game() { return game; }, newGame, board };
})(typeof self !== "undefined" ? self : this);
