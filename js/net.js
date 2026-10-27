/* ============================================================================
 * net.js — playing a friend online. The second TRANSPORT next to local.js.
 *
 * It wraps the shared online kit (js/game-online.js, a byte-identical copy of
 * Board and Card Games/_online/online.js, Firestore project th-board-games).
 * Nothing touches the network until a room is made, joined or resumed: the
 * kit's module and the Firebase SDK load on first use.
 *
 * It publishes the same `game:state` event as local.js (mode "online"), so
 * app.js draws the table the same way, plus `net:room` with the kit's whole
 * snapshot for the lobby (room code, seats, host, status).
 * ==========================================================================*/
(function (root) {
  "use strict";
  let room = null, loading = null, snap = null;

  const emit = (name, detail) => root.document.dispatchEvent(new root.CustomEvent(name, { detail }));

  function load() {
    if (room) return Promise.resolve(room);
    if (!loading) {
      loading = import("./game-online.js?v=20261027n").then((m) => {
        room = m.createOnline({ game: root.CribOnline.game, gameId: "cribbage", botDelayMs: 900 });
        room.on("change", onChange);
        room.on("error", (msg) => emit("net:error", typeof msg === "string" ? msg : (msg && msg.message) || "Online error"));
        return room;
      }).catch((e) => { loading = null; throw e; });
    }
    return loading;
  }

  function onChange(s) {
    snap = s;
    emit("net:room", s);
    if (s.status !== "playing" && s.status !== "finished") return;
    if (!s.pub || !s.mine || s.mySeat < 0) return;
    emit("game:state", { mode: "online", seat: s.mySeat, pub: s.pub, priv: s.mine, thinking: false, level: (s.options || {}).level || "medium", canUndo: false, net: s });
  }

  const fail = (e) => ({ ok: false, message: (e && e.message) || "Online play couldn't load. Check your internet and try again." });

  const Net = {
    get active() { return !!snap && !["none", "closed", "left"].includes(snap.status); },
    get snap() { return snap; },
    async create(name, withComputer) {
      try { const o = await load(); return await o.createRoom({ name, seats: ["human", withComputer ? "computer" : "empty"], options: { level: "medium" } }); }
      catch (e) { return fail(e); }
    },
    async join(code, name) { try { const o = await load(); return await o.joinRoom(code, name); } catch (e) { return fail(e); } },
    async start() { return room ? room.start() : fail(); },
    async setSeat(i, kind) { return room ? room.setSeat(i, kind) : fail(); },
    /** Same shape as Local.submit: answers at once; a refusal arrives as a `net:error`. */
    submit(action) {
      if (!room) return { ok: false };
      room.act(action).then((r) => { if (r && !r.ok && r.message) emit("net:error", r.message); });
      return { ok: true };
    },
    async leave() { const r = room; snap = null; if (r) await r.leave(); },
    /** After a reload: back into the room this browser was in, if any. Only loads the kit when it was in one. */
    async resume() {
      try { if (!root.localStorage.getItem("online.cribbage")) return false; } catch (e) { return false; }   // the kit's own "which room was I in" key
      try { const o = await load(); return await o.resume(); } catch (e) { return false; }
    },
    stop() {},
  };
  root.Net = Net;
})(typeof self !== "undefined" ? self : this);
