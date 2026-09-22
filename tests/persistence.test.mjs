import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSessionRecord, sessionRecord } from '../web/persistence.js';
import { LapTracker } from '../web/timing.js';
import { DemoSource } from '../web/demo-source.js';
import { readFileSync } from 'node:fs';

// The IndexedDB-touching functions (saveSession/loadSession/clearSession) need a browser and are
// checked there instead; this covers the plain-object shape they're built on, which is what matters
// for correctness (a wrong shape would silently fail to restore, or restore the wrong thing).

const data = JSON.parse(readFileSync(new URL('../web/demo-laps.json', import.meta.url)));

function drivenTracker() {
  const tr = new LapTracker();
  const src = new DemoSource(data);
  while (!src.done) tr.ingest(src.frame(src.index++));
  return tr;
}

test('sessionRecord captures exactly what restoreSession needs, and nothing live-only', () => {
  const tr = drivenTracker();
  tr.setCompareMode('last');
  const record = sessionRecord(tr);
  assert.deepEqual(record.laps, tr.laps);
  assert.deepEqual(record.splits, tr.splits);
  assert.equal(record.compareMode, 'last');
  assert.equal(typeof record.savedAt, 'number');
  // Round-trips through a fresh tracker, the same as loading it back after a reload would.
  const restored = new LapTracker();
  restored.restoreSession(record);
  assert.deepEqual(restored.laps.map((l) => l.timeMs), tr.laps.map((l) => l.timeMs));
});

test('sessionRecord of an empty tracker has no laps', () => {
  assert.deepEqual(sessionRecord(new LapTracker()).laps, []);
});

test('isSessionRecord accepts a real record and rejects junk', () => {
  const tr = drivenTracker();
  assert.equal(isSessionRecord(sessionRecord(tr)), true);

  for (const bad of [
    null, undefined, {}, [], 'a string', 42,
    { laps: [] },                                    // no laps: nothing to restore
    { laps: [{ t: [1, 2], p: [1] }] },                // mismatched sample arrays
    { laps: [{ t: [1], speed: [1] }] },               // missing p
    { laps: 'not an array' },
  ]) {
    assert.equal(isSessionRecord(bad), false, JSON.stringify(bad));
  }
});
