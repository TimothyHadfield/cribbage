/* ============================================================================
 * rules.test.js — automated tests for firestore.rules.
 *
 * The rules are the ENTIRE security boundary: there is no server, and sign-in
 * is anonymous, so whatever the rules permit is permitted to anyone on the
 * internet. "It deployed" is not the same as "it is correct".
 *
 * The test that matters most is `carol` and `dave` — two people with no
 * relationship to a game — trying to read the cards. Everything else is
 * housekeeping around that.
 *
 * Run from this directory:
 *     npm install && npm test
 * or from the project root:
 *     firebase emulators:exec --only firestore --project demo-cribtest \
 *       "node test/rules.test.js"
 * ==========================================================================*/

const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment, assertFails, assertSucceeds,
} = require("@firebase/rules-unit-testing");
const {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc,
} = require("firebase/firestore");

let pass = 0, fail = 0;
async function check(label, promise) {
  try {
    await promise;
    console.log("  PASS  " + label);
    pass++;
  } catch (e) {
    console.log("  FAIL  " + label + "\n          → " + String(e.message || e).split("\n")[0]);
    fail++;
  }
}

const MATCH = {
  hostUid: "alice",
  players: ["alice", "bob"],
  status: "playing",
  names: ["Alice", "Bob"],
  scores: [0, 0],
  phase: "discard",
};

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: "demo-cribtest",
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });

  /** alice hosts a game against bob; carol and dave are strangers. */
  async function seed() {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "matches/m1"), MATCH);
      await setDoc(doc(db, "matches/m1/private/alice"), { seat: 0, hand: [1, 2, 3, 4] });
      await setDoc(doc(db, "matches/m1/private/bob"), { seat: 1, hand: [40, 41, 42, 43] });
      await setDoc(doc(db, "matches/m1/host/state"), { s: "{secret}" });
      await setDoc(doc(db, "matches/m1/actions/a1"), { by: "bob", type: "next" });
      await setDoc(doc(db, "rooms/ABC123"), {
        hostUid: "alice", hostName: "Alice", guestUid: null, guestName: null, matchId: null,
      });
      await setDoc(doc(db, "queue/carol"), { name: "Carol", claimedBy: null, matchId: null });
      await setDoc(doc(db, "queue/dave"), { name: "Dave", claimedBy: null, matchId: null });
    });
  }

  const as = (uid) => testEnv.authenticatedContext(uid).firestore();
  const anon = () => testEnv.unauthenticatedContext().firestore();

  // ===================================================== THE ONE INVARIANT ==
  console.log("\n  Private cards");
  await seed();
  await check("you can read your own hand",
    assertSucceeds(getDoc(doc(as("alice"), "matches/m1/private/alice"))));
  await check("your OPPONENT cannot read your hand",
    assertFails(getDoc(doc(as("bob"), "matches/m1/private/alice"))));
  await check("a stranger cannot read anyone's hand",
    assertFails(getDoc(doc(as("carol"), "matches/m1/private/bob"))));
  await check("a signed-out visitor cannot read a hand",
    assertFails(getDoc(doc(anon(), "matches/m1/private/alice"))));
  await check("the private collection cannot be LISTED around the per-document rule",
    assertFails(getDocs(collection(as("bob"), "matches/m1/private"))));
  await check("a player cannot rewrite their own hand to something better",
    assertFails(setDoc(doc(as("bob"), "matches/m1/private/bob"), { hand: [4, 17, 30, 43] })));
  await check("the host writes the hands",
    assertSucceeds(setDoc(doc(as("alice"), "matches/m1/private/bob"), { seat: 1, hand: [5, 6, 7, 8] })));

  console.log("\n  The host's copy of the whole deal");
  await seed();
  await check("only the host reads it",
    assertSucceeds(getDoc(doc(as("alice"), "matches/m1/host/state"))));
  await check("the opponent cannot",
    assertFails(getDoc(doc(as("bob"), "matches/m1/host/state"))));
  await check("nor can a stranger",
    assertFails(getDoc(doc(as("carol"), "matches/m1/host/state"))));

  // ================================================================ matches ==
  console.log("\n  The match document");
  await seed();
  await check("a player reads the public state",
    assertSucceeds(getDoc(doc(as("bob"), "matches/m1"))));
  await check("a stranger cannot",
    assertFails(getDoc(doc(as("carol"), "matches/m1"))));
  await check("games cannot be enumerated",
    assertFails(getDocs(collection(as("alice"), "matches"))));
  await check("only the host advances the game",
    assertSucceeds(updateDoc(doc(as("alice"), "matches/m1"), { phase: "cut" })));
  await check("the non-host cannot award themselves points",
    assertFails(updateDoc(doc(as("bob"), "matches/m1"), { scores: [0, 121] })));
  await check("a stranger cannot touch it",
    assertFails(updateDoc(doc(as("carol"), "matches/m1"), { phase: "gameover" })));
  await check("only the host deletes it",
    assertFails(deleteDoc(doc(as("bob"), "matches/m1"))));
  await check("you cannot create a match you are not in",
    assertFails(setDoc(doc(as("carol"), "matches/m2"),
      { hostUid: "alice", players: ["alice", "bob"], status: "playing" })));
  await check("you cannot name yourself host of someone else's match",
    assertFails(setDoc(doc(as("carol"), "matches/m3"),
      { hostUid: "alice", players: ["carol", "alice"], status: "playing" })));

  console.log("\n  Moves");
  await seed();
  await check("a player submits their own move",
    assertSucceeds(addDoc(collection(as("bob"), "matches/m1/actions"), { by: "bob", type: "next" })));
  await check("a player cannot submit a move AS their opponent",
    assertFails(addDoc(collection(as("bob"), "matches/m1/actions"), { by: "alice", type: "next" })));
  await check("a stranger cannot submit moves at all",
    assertFails(addDoc(collection(as("carol"), "matches/m1/actions"), { by: "carol", type: "next" })));
  await check("only the host reads the queue",
    assertSucceeds(getDocs(collection(as("alice"), "matches/m1/actions"))));
  await check("the other player cannot read the queue",
    assertFails(getDocs(collection(as("bob"), "matches/m1/actions"))));
  await check("only the host clears a move",
    assertFails(deleteDoc(doc(as("bob"), "matches/m1/actions/a1"))));

  console.log("\n  Presence");
  await seed();
  await check("you write your own heartbeat",
    assertSucceeds(setDoc(doc(as("bob"), "matches/m1/presence/bob"), { at: 1 })));
  await check("you cannot fake your opponent's",
    assertFails(setDoc(doc(as("bob"), "matches/m1/presence/alice"), { at: 1 })));
  await check("a stranger writes no heartbeat here",
    assertFails(setDoc(doc(as("carol"), "matches/m1/presence/carol"), { at: 1 })));

  // ================================================================== queue ==
  console.log("\n  The matchmaking queue");
  await seed();
  await check("anyone signed in can see who is waiting",
    assertSucceeds(getDocs(collection(as("bob"), "queue"))));
  await check("a signed-out visitor cannot",
    assertFails(getDocs(collection(anon(), "queue"))));
  await check("you join the queue under your own id",
    assertSucceeds(setDoc(doc(as("bob"), "queue/bob"), { name: "Bob", claimedBy: null, matchId: null })));
  await check("you cannot queue as somebody else",
    assertFails(setDoc(doc(as("bob"), "queue/erin"), { name: "Erin", claimedBy: null, matchId: null })));
  await check("you cannot join already claimed",
    assertFails(setDoc(doc(as("bob"), "queue/bob"), { name: "Bob", claimedBy: "bob", matchId: null })));
  await check("a name over 20 characters is refused",
    assertFails(setDoc(doc(as("bob"), "queue/bob"),
      { name: "x".repeat(21), claimedBy: null, matchId: null })));

  await seed();
  await check("you may CLAIM an unclaimed entry",
    assertSucceeds(updateDoc(doc(as("dave"), "queue/carol"), { claimedBy: "dave" })));
  await check("…but only in your own name",
    assertFails(updateDoc(doc(as("dave"), "queue/carol"), { claimedBy: "erin" })));
  await seed();
  await check("claiming may not rewrite anything else",
    assertFails(updateDoc(doc(as("dave"), "queue/carol"), { claimedBy: "dave", name: "Not Carol" })));
  await check("you cannot hand a match id to someone you did not claim",
    assertFails(updateDoc(doc(as("dave"), "queue/carol"), { matchId: "m9" })));

  await seed();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), "queue/carol"), { claimedBy: "dave" });
  });
  await check("having claimed it, you may attach the match",
    assertSucceeds(updateDoc(doc(as("dave"), "queue/carol"), { matchId: "m9" })));
  await check("a third party may not re-claim a taken entry",
    assertFails(updateDoc(doc(as("bob"), "queue/carol"), { claimedBy: "bob" })));
  await check("you can always leave the queue",
    assertSucceeds(deleteDoc(doc(as("carol"), "queue/carol"))));
  await seed();
  await check("but you cannot evict someone you have no claim on",
    assertFails(deleteDoc(doc(as("bob"), "queue/carol"))));

  // ================================================================== rooms ==
  console.log("\n  Private rooms");
  await seed();
  await check("anyone with the code can look the room up",
    assertSucceeds(getDoc(doc(as("bob"), "rooms/ABC123"))));
  await check("rooms cannot be enumerated — the code is the secret",
    assertFails(getDocs(collection(as("bob"), "rooms"))));
  await check("you create a room in your own name",
    assertSucceeds(setDoc(doc(as("bob"), "rooms/XYZ789"),
      { hostUid: "bob", hostName: "Bob", guestUid: null, guestName: null, matchId: null })));
  await check("you cannot create one as somebody else",
    assertFails(setDoc(doc(as("bob"), "rooms/QQQ111"),
      { hostUid: "alice", hostName: "Alice", guestUid: null, guestName: null, matchId: null })));
  await check("you cannot overwrite an existing room to steal its code",
    assertFails(setDoc(doc(as("carol"), "rooms/ABC123"),
      { hostUid: "carol", hostName: "Carol", guestUid: null, guestName: null, matchId: null })));

  await seed();
  await check("a guest takes the empty seat",
    assertSucceeds(updateDoc(doc(as("bob"), "rooms/ABC123"), { guestUid: "bob", guestName: "Bob" })));
  await check("…and having done so, cannot then hijack the room",
    assertFails(updateDoc(doc(as("bob"), "rooms/ABC123"), { hostUid: "bob" })));
  await check("a second guest cannot displace the first",
    assertFails(updateDoc(doc(as("carol"), "rooms/ABC123"), { guestUid: "carol", guestName: "Carol" })));
  await check("a guest cannot forge the match id",
    assertFails(updateDoc(doc(as("bob"), "rooms/ABC123"), { matchId: "m9" })));
  await check("the host attaches the match",
    assertSucceeds(updateDoc(doc(as("alice"), "rooms/ABC123"), { matchId: "m9" })));
  await check("only the host closes the room",
    assertFails(deleteDoc(doc(as("bob"), "rooms/ABC123"))));
  await check("…which the host may do",
    assertSucceeds(deleteDoc(doc(as("alice"), "rooms/ABC123"))));

  // ============================================================== catch-all ==
  console.log("\n  Everything else");
  await seed();
  await check("an unknown collection is closed",
    assertFails(setDoc(doc(as("alice"), "whatever/x"), { a: 1 })));
  await check("…to reads as well",
    assertFails(getDoc(doc(as("alice"), "whatever/x"))));

  await testEnv.cleanup();
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
