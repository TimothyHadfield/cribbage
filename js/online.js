/* ============================================================================
 * online.js — playing another person. The second TRANSPORT (see js/local.js).
 *
 * SERVERLESS AND HOST-AUTHORITATIVE. There is no backend: Cloud Functions
 * need Firebase's paid plan and this project stays on the free one, so one
 * player's browser is the dealer and referee. It runs js/engine.js and
 * publishes the result; the other player submits moves to a queue that the
 * host drains. The action pump below is the same shape as the one in the
 * sibling Secret Hitler project, which has been carrying live games for a
 * while.
 *
 * WHAT THIS BUYS AND WHAT IT COSTS. Each player only ever READS their own
 * private document — the rules in firestore.rules make the opponent's
 * unreadable — so nothing leaks over the wire. But the host's own browser
 * necessarily holds the whole deal, so a host who opens devtools can see your
 * cards. That is unavoidable without a server, it is written plainly in the
 * README, and it is why engine.js is a pure module: an authoritative referee
 * can be dropped in later without touching the game.
 *
 * DATA MODEL (all top-level — this is a public lobby, not a friends list):
 *   queue/{uid}                    someone looking for a game
 *   rooms/{CODE}                   a private room, code as the invitation
 *   matches/{mid}                  public state — both players read, host writes
 *   matches/{mid}/private/{uid}    your cards — only you read, only the host writes
 *   matches/{mid}/host/state       the full deal — only the host, so a reload resumes
 *   matches/{mid}/actions/{id}     moves in, drained by the host
 *   matches/{mid}/presence/{uid}   heartbeat, so a closed tab is noticed
 * ==========================================================================*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc,
  getDocs, onSnapshot, serverTimestamp, query, orderBy, limit, runTransaction,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const E = () => window.Engine;
const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

// Unambiguous alphabet — no O/0, no I/1 — because these get read aloud.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const HEARTBEAT_MS = 20000;
const STALE_MS = 70000;

let app = null, auth = null, db = null;
let me = null;                 // { uid }
let myName = "Player";
let queueRef = null;           // my own queue document, while searching
let roomCode = null;           // the room I created or joined, for display
let myRoom = null;             // a room I OWN and therefore have to clean up
let announced = false;         // the `online:matched` event fires exactly once
let matchId = null;
let seat = -1;
let pub = null;                // the match document
let priv = null;               // my private document
let subs = [];                 // snapshot unsubscribers
let actionsUnsub = null;
let hostState = null;          // the host's authoritative engine state
let processing = false, rerun = false;
let heartbeat = null;
let oppStale = false;

const isHost = () => !!(pub && me && pub.hostUid === me.uid);

// ------------------------------------------------------------------- setup
const configured = !!window.FIREBASE_CONFIG;
if (configured) {
  app = initializeApp(window.FIREBASE_CONFIG);
  auth = getAuth(app);
  db = getFirestore(app);
  onAuthStateChanged(auth, (u) => {
    me = u ? { uid: u.uid } : null;
    if (!me) teardown();
  });
}

/** Anonymous sign-in, on demand. Nothing needs an account to play. */
async function ensureAuth() {
  if (!configured) return { ok: false, message: "Online play isn't set up for this site yet." };
  if (me) return { ok: true };
  try {
    await signInAnonymously(auth);
    // onAuthStateChanged may not have fired yet; take the credential directly.
    if (!me && auth.currentUser) me = { uid: auth.currentUser.uid };
    return me ? { ok: true } : { ok: false, message: "Couldn't sign in." };
  } catch (e) {
    return { ok: false, message: humanError(e) };
  }
}

// ------------------------------------------------------------------- paths
const pQueue = (uid) => doc(db, "queue", uid);
const cQueue = () => collection(db, "queue");
const pRoom = (code) => doc(db, "rooms", code);
const pMatch = (mid) => doc(db, "matches", mid);
const pPrivate = (mid, uid) => doc(db, "matches", mid, "private", uid);
const pHostState = (mid) => doc(db, "matches", mid, "host", "state");
const cActions = (mid) => collection(db, "matches", mid, "actions");
const pPresence = (mid, uid) => doc(db, "matches", mid, "presence", uid);
const cPresence = (mid) => collection(db, "matches", mid, "presence");

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    "m-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function newCode() {
  let s = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

// ------------------------------------------------------------- matchmaking
/**
 * Look for an opponent.
 *
 * The race this has to survive is two people searching at the same instant,
 * each finding the other, each starting a game — which would leave two
 * half-matches and no opponent in either. It is settled with a TRANSACTION
 * that claims the other player's queue entry AND your own together: whoever's
 * transaction commits first becomes the host, and the loser's retry finds both
 * entries already spoken for and simply waits to be collected instead.
 */
async function find(name) {
  const a = await ensureAuth();
  if (!a.ok) return a;
  myName = name || "Player";
  await cleanupSearch();

  try {
    await setDoc(pQueue(me.uid), {
      name: myName, claimedBy: null, matchId: null, createdAt: serverTimestamp(),
    });
  } catch (e) { return { ok: false, message: humanError(e) }; }

  queueRef = pQueue(me.uid);
  emit("online:waiting", { code: null });

  // Listen for someone else collecting me.
  subs.push(onSnapshot(queueRef, async (snap) => {
    const d = snap.exists() ? snap.data() : null;
    if (d && d.matchId && !matchId) {
      await cleanupSearch();
      await joinMatch(d.matchId);
    }
  }, () => {}));

  // …and meanwhile look for someone to collect.
  const found = await tryClaim();
  if (found) return { ok: true, matched: true };
  return { ok: true, matched: false };
}

/** One sweep of the queue. Returns true if we claimed somebody. */
async function tryClaim() {
  let waiting = [];
  try {
    // Ordered by arrival and filtered for unclaimed entries HERE rather than in
    // the query: adding `where("claimedBy","==",null)` to an `orderBy` would
    // need a composite index, which is one more thing to set up in the console
    // and to get wrong. Ten documents is nothing to filter locally.
    const snap = await getDocs(query(cQueue(), orderBy("createdAt"), limit(10)));
    snap.forEach((d) => {
      const x = d.data();
      if (d.id !== me.uid && !x.claimedBy) waiting.push({ uid: d.id, ...x });
    });
  } catch (e) {
    // A permission hiccup shouldn't strand the search — we stay in the queue
    // and let the other side do the claiming instead.
    return false;
  }

  for (const candidate of waiting) {
    let claimed = false;
    try {
      await runTransaction(db, async (tx) => {
        const theirs = await tx.get(pQueue(candidate.uid));
        const mine = await tx.get(pQueue(me.uid));
        if (!theirs.exists() || theirs.data().claimedBy !== null) throw new Error("taken");
        // If somebody has already claimed ME, stand down — they are about to
        // hand me a match id and two hosts would mean two different decks.
        if (!mine.exists() || mine.data().claimedBy !== null) throw new Error("claimed");
        tx.update(pQueue(candidate.uid), { claimedBy: me.uid });
        tx.update(pQueue(me.uid), { claimedBy: me.uid });
      });
      claimed = true;
    } catch (e) { claimed = false; }

    if (claimed) {
      const mid = await createMatch(candidate.uid, candidate.name || "Player");
      if (!mid) return false;
      try { await updateDoc(pQueue(candidate.uid), { matchId: mid }); } catch (e) {}
      try { await deleteDoc(pQueue(me.uid)); } catch (e) {}
      queueRef = null;
      await joinMatch(mid);
      return true;
    }
  }
  return false;
}

// ------------------------------------------------------------- room codes
/** Create a private room and wait there for a friend with the code. */
async function host(name) {
  const a = await ensureAuth();
  if (!a.ok) return a;
  myName = name || "Player";
  await cleanupSearch();

  // A collision just means the code is taken: `create` fails against an
  // existing document because the rules forbid overwriting one, so we try
  // again rather than stealing someone's room.
  let code = null;
  for (let attempt = 0; attempt < 6 && !code; attempt++) {
    const candidate = newCode();
    try {
      await setDoc(pRoom(candidate), {
        hostUid: me.uid, hostName: myName,
        guestUid: null, guestName: null, matchId: null,
        createdAt: serverTimestamp(),
      });
      code = candidate;
    } catch (e) { /* taken — try another */ }
  }
  if (!code) return { ok: false, message: "Couldn't create a room just now. Try again." };

  roomCode = code;
  myRoom = code;
  emit("online:waiting", { code });

  subs.push(onSnapshot(pRoom(code), async (snap) => {
    const d = snap.exists() ? snap.data() : null;
    if (!d) return;
    if (d.guestUid && !matchId && !d.matchId) {
      const mid = await createMatch(d.guestUid, d.guestName || "Player");
      if (mid) {
        try { await updateDoc(pRoom(code), { matchId: mid }); } catch (e) {}
        await joinMatch(mid);
      }
    }
  }, () => {}));

  return { ok: true, code };
}

/** Join someone's room by its code. */
async function join(code, name) {
  const a = await ensureAuth();
  if (!a.ok) return a;
  myName = name || "Player";
  code = String(code || "").trim().toUpperCase();
  await cleanupSearch();

  let ref = pRoom(code);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, message: "No room with that code." };
    if (snap.data().hostUid === me.uid) return { ok: false, message: "That's your own room." };

    await runTransaction(db, async (tx) => {
      const r = await tx.get(ref);
      if (!r.exists()) throw new Error("gone");
      if (r.data().guestUid) throw new Error("full");
      tx.update(ref, { guestUid: me.uid, guestName: myName });
    });
  } catch (e) {
    if (String(e.message) === "full") return { ok: false, message: "Someone is already in that room." };
    if (String(e.message) === "gone") return { ok: false, message: "That room has closed." };
    return { ok: false, message: humanError(e) };
  }

  roomCode = code;
  emit("online:waiting", { code });

  // The host builds the match; watch for the id to appear.
  subs.push(onSnapshot(ref, async (snap) => {
    const d = snap.exists() ? snap.data() : null;
    if (d && d.matchId && !matchId) await joinMatch(d.matchId);
  }, () => {}));

  return { ok: true };
}

// ------------------------------------------------------------- the match
/** The claiming player builds the game and deals the first hand. */
async function createMatch(otherUid, otherName) {
  const mid = newId();
  try {
    const state = E().initGame(
      [{ uid: me.uid, name: myName }, { uid: otherUid, name: otherName }],
      Math.random
    );
    hostState = state;
    await setDoc(pMatch(mid), Object.assign(flatten(E().publicView(state)), {
      hostUid: me.uid,
      players: [me.uid, otherUid],
      status: "playing",
      createdAt: serverTimestamp(),
    }));
    await setDoc(pHostState(mid), { s: JSON.stringify(state), updatedAt: serverTimestamp() });
    for (const uid of state.uids) {
      await setDoc(pPrivate(mid, uid), E().privateView(state, uid));
    }
    return mid;
  } catch (e) {
    emit("online:status", { text: humanError(e), kind: "err" });
    return null;
  }
}

/** Attach to a match: public state, my private cards, and the host's pump. */
async function joinMatch(mid) {
  matchId = mid;

  subs.push(onSnapshot(pMatch(mid), (snap) => {
    if (!snap.exists()) { ended("The game was closed."); return; }
    pub = inflate(snap.data());
    seat = (pub.players || []).indexOf(me.uid);
    if (!announced) { announced = true; emit("online:matched", { opponent: pub.names[E().other(seat)] }); }
    attachHostPump();
    publish();
  }, () => {}));

  subs.push(onSnapshot(pPrivate(mid, me.uid), (snap) => {
    priv = snap.exists() ? snap.data() : null;
    publish();
  }, () => {}));

  subs.push(onSnapshot(cPresence(mid), (snap) => {
    const now = Date.now();
    oppStale = false;
    snap.forEach((d) => {
      if (d.id === me.uid) return;
      const at = d.data().at && d.data().at.toMillis ? d.data().at.toMillis() : 0;
      if (at && now - at > STALE_MS) oppStale = true;
    });
    publish();
  }, () => {}));

  startHeartbeat();
}

function publish() {
  if (!pub || seat < 0) return;
  emit("game:state", {
    mode: "online",
    seat,
    pub,
    priv: priv || { hand: [], dealt: [], thrown: [], seat },
    thinking: false,
    oppStale,
  });
}

// ------------------------------------------------------------ the host pump
function attachHostPump() {
  if (isHost() && !actionsUnsub && matchId) {
    actionsUnsub = onSnapshot(cActions(matchId), (snap) => { processActions(snap); }, () => {});
    if (!hostState) loadHostState().then(() => { if (hostState) drain(); });
  } else if (!isHost() && actionsUnsub) {
    try { actionsUnsub(); } catch (e) {}
    actionsUnsub = null;
  }
}

async function loadHostState() {
  try {
    const snap = await getDoc(pHostState(matchId));
    if (snap.exists() && snap.data().s) hostState = JSON.parse(snap.data().s);
  } catch (e) { /* not the host, or not written yet */ }
}

/**
 * Drain the move queue in submission order, apply each to the authoritative
 * state, and publish once at the end. Serialised by `processing`; a snapshot
 * that lands mid-run sets `rerun` so nothing is dropped.
 */
async function processActions(snap) {
  if (!isHost()) return;
  if (processing) { rerun = true; return; }
  processing = true;
  try {
    if (!hostState) await loadHostState();
    if (!hostState) return;
    const docs = snap.docs.slice().sort((a, b) => {
      const ta = a.data().at && a.data().at.toMillis ? a.data().at.toMillis() : 0;
      const tb = b.data().at && b.data().at.toMillis ? b.data().at.toMillis() : 0;
      return ta - tb;
    });
    let changed = false;
    for (const d of docs) {
      const action = d.data();
      const r = E().applyAction(hostState, action, Math.random);
      // An invalid move is DROPPED, not applied — a client that asks for
      // something illegal simply doesn't get it, and the game carries on.
      if (r.ok) { hostState = r.state; changed = true; }
      try { await deleteDoc(d.ref); } catch (e) {}
    }
    if (changed) await pushState();
  } catch (e) { /* transient — the next snapshot retries */ }
  finally {
    processing = false;
    if (rerun) { rerun = false; await drain(); }
  }
}

async function drain() {
  try { await processActions(await getDocs(cActions(matchId))); } catch (e) {}
}

/** Publish the authoritative state: public projection, each player's cards, and the host's own copy. */
async function pushState() {
  if (!hostState || !matchId) return;
  await setDoc(pHostState(matchId), { s: JSON.stringify(hostState), updatedAt: serverTimestamp() });
  await updateDoc(pMatch(matchId), Object.assign(flatten(E().publicView(hostState)), {
    status: hostState.winner === null ? "playing" : "finished",
  }));
  for (const uid of hostState.uids) {
    await setDoc(pPrivate(matchId, uid), E().privateView(hostState, uid));
  }
}

/**
 * Firestore will not store an array whose elements are themselves arrays, and
 * a scoring breakdown is exactly that (a list of items, each naming its
 * cards). Rather than reshape the engine's output for the database's benefit,
 * the one offending field travels as JSON and is rebuilt on arrival.
 */
function flatten(view) {
  const out = Object.assign({}, view);
  out.showItemsJson = JSON.stringify(view.showItems || []);
  delete out.showItems;
  return out;
}
function inflate(data) {
  const out = Object.assign({}, data);
  try { out.showItems = JSON.parse(out.showItemsJson || "[]"); } catch (e) { out.showItems = []; }
  delete out.showItemsJson;
  return out;
}

// --------------------------------------------------------------- your moves
/** Submit a move. `by` is pinned to your uid so the rules can verify it. */
async function submit(action) {
  if (!matchId || !me) return { ok: false, message: "Not in a game." };
  try {
    await addDoc(cActions(matchId), Object.assign({}, action, { by: me.uid, at: serverTimestamp() }));
    return { ok: true };
  } catch (e) { return { ok: false, message: humanError(e) }; }
}

// ---------------------------------------------------------------- presence
function startHeartbeat() {
  stopHeartbeat();
  const beat = () => {
    if (!matchId || !me) return;
    setDoc(pPresence(matchId, me.uid), { at: serverTimestamp() }).catch(() => {});
  };
  beat();
  heartbeat = setInterval(beat, HEARTBEAT_MS);
}
function stopHeartbeat() { if (heartbeat) clearInterval(heartbeat); heartbeat = null; }

// ----------------------------------------------------------------- leaving
/** Drop every listener and forget the game. Deletes nothing. */
function teardown() {
  for (const u of subs) { try { u(); } catch (e) {} }
  subs = [];
  if (actionsUnsub) { try { actionsUnsub(); } catch (e) {} actionsUnsub = null; }
  stopHeartbeat();
  matchId = null; pub = null; priv = null; seat = -1;
  hostState = null; processing = false; rerun = false;
  roomCode = null; announced = false; oppStale = false;
}

/**
 * Remove what we left lying around while looking for a game: our queue entry,
 * and the room if we are the one who created it. Joining someone else's room
 * must NOT delete it — that is theirs to close.
 */
async function cleanupSearch() {
  for (const u of subs) { try { u(); } catch (e) {} }
  subs = [];
  announced = false;
  try { if (queueRef) await deleteDoc(queueRef); } catch (e) {}
  queueRef = null;
  try { if (myRoom) await deleteDoc(pRoom(myRoom)); } catch (e) {}
  myRoom = null;
  roomCode = null;
}

async function cancel() {
  await cleanupSearch();
  teardown();
  return { ok: true };
}

/**
 * Leave a game in progress. The host tidies up the documents it created —
 * per-document and host-scoped, never a wholesale delete — so an abandoned
 * match doesn't sit in the database forever.
 */
async function leave() {
  const mid = matchId, wasHost = isHost(), uid = me && me.uid;
  teardown();
  if (mid && wasHost) {
    for (const sub of ["private", "actions", "presence", "host"]) {
      try {
        const snap = await getDocs(collection(db, "matches", mid, sub));
        for (const d of snap.docs) { try { await deleteDoc(d.ref); } catch (e) {} }
      } catch (e) {}
    }
    try { await deleteDoc(pMatch(mid)); } catch (e) {}
  } else if (mid && uid) {
    try { await deleteDoc(pPresence(mid, uid)); } catch (e) {}
  }
  await cleanupSearch();
  return { ok: true };
}

function ended(message) {
  const finished = pub && pub.winner !== null;
  teardown();
  if (!finished) emit("online:ended", { message });
}

// Best-effort tidy-up when the tab closes. Not guaranteed to run, which is
// exactly why the presence heartbeat exists as well.
window.addEventListener("beforeunload", () => {
  if (queueRef) { try { deleteDoc(queueRef); } catch (e) {} }
  if (myRoom) { try { deleteDoc(pRoom(myRoom)); } catch (e) {} }
});

function humanError(e) {
  const c = (e && e.code) || "";
  if (c.includes("permission-denied")) return "The server refused that — you may not be in this game any more.";
  if (c.includes("unavailable") || c.includes("network")) return "Connection problem — check your internet.";
  if (c.includes("failed-precondition")) return "The database needs an index for matchmaking; see the README.";
  return (e && e.message) || "Something went wrong.";
}

// -------------------------------------------------------------------- api
window.Online = {
  get ready() { return configured; },
  get matchId() { return matchId; },
  get seat() { return seat; },
  get isHost() { return isHost(); },
  find, host, join, cancel, leave, submit,
  refresh: publish,
};

emit("online:loaded", { configured });
