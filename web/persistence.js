// Saves and restores a live session's completed laps in the browser (IndexedDB), so a refresh or a
// dropped connection doesn't lose them (PROJECT_CONTEXT.md Known issue 7). Used for live sessions
// only: the demo builds its own deterministic session every time, and restoring old laps into it
// would just be confusing.
//
// `sessionRecord`/`isSessionRecord` are the plain-object shape, kept separate from the IndexedDB
// calls so they can be tested without a browser. Every exported IndexedDB function is wrapped so a
// failure (private browsing, IndexedDB unavailable, a full quota) never breaks the page: the caller
// gets nothing back and the dashboard behaves exactly as it did before this existed - starts fresh.

const DB_NAME = 'telemetry';
const DB_VERSION = 1;
const STORE = 'liveSession';
const KEY = 'current';

/** The plain object saved for a tracker's session: everything `LapTracker#restoreSession` needs. */
export function sessionRecord(tracker) {
  return { laps: tracker.laps, splits: tracker.splits, compareMode: tracker.compareMode, savedAt: Date.now() };
}

/** True if `value` looks like something `sessionRecord` produced, or an imported file holds. */
export function isSessionRecord(value) {
  return !!value && Array.isArray(value.laps) && value.laps.length > 0
    && value.laps.every((lap) => Array.isArray(lap.t) && Array.isArray(lap.p) && lap.t.length === lap.p.length);
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('IndexedDB is not available')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Wrap an IDBRequest as a promise. */
function settle(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Save a tracker's session, or clear any saved one if it has no completed laps yet. Never throws. */
export async function saveSession(tracker) {
  try {
    const db = await openDb();
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    if (tracker.laps.length) store.put(sessionRecord(tracker), KEY);
    else store.delete(KEY);
  } catch { /* not saved; the next load just finds nothing */ }
}

/** The previously saved session, or null if there isn't one, it's malformed, or it couldn't be read. */
export async function loadSession() {
  try {
    const db = await openDb();
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const record = await settle(store.get(KEY));
    return isSessionRecord(record) ? record : null;
  } catch {
    return null;
  }
}

/** Forget the saved session (used after an auto-reset, so a stale one isn't restored next time). */
export async function clearSession() {
  try {
    const db = await openDb();
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY);
  } catch { /* nothing to clear */ }
}
