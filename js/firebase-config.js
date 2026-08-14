/* ============================================================================
 * firebase-config.js — which Firebase project this app talks to.
 *
 * These values are PUBLIC BY DESIGN and safe in a public repo: they identify
 * the project, they do not grant access to it. The security boundary is
 * `firestore.rules` (deployed with `firebase deploy --only firestore:rules`),
 * plus the authorised-domains list in the Firebase console — NOT this file.
 * The same reasoning is written out at length in the sibling Secret Hitler
 * project, which uses an identical setup.
 *
 * TO FILL THIS IN (see README.md → "Setting up online play"):
 *   firebase apps:sdkconfig WEB --project <your-project-id>
 * and paste the object it prints over the placeholder below.
 *
 * Until then FIREBASE_CONFIG stays null, online.js declines to start, and the
 * app is a perfectly good single-player cribbage game — the menu just reports
 * that online play isn't configured rather than failing at a network call.
 * ==========================================================================*/

const FIREBASE_CONFIG = null;

/* Replace the line above with the real thing, e.g.:

const FIREBASE_CONFIG = {
  apiKey: "…",
  authDomain: "cribbage-th.firebaseapp.com",
  projectId: "cribbage-th",
  storageBucket: "cribbage-th.firebasestorage.app",
  messagingSenderId: "…",
  appId: "…",
};
*/

if (typeof window !== "undefined") window.FIREBASE_CONFIG = FIREBASE_CONFIG;
if (typeof module !== "undefined" && module.exports) module.exports = FIREBASE_CONFIG;
