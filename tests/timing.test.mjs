import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LapTracker, timeAt, sectorTimes } from '../web/timing.js';
import { DemoSource } from '../web/demo-source.js';
import { fmtLap, fmtSector, fmtDelta } from '../web/format.js';

const data = JSON.parse(readFileSync(new URL('../web/demo-laps.json', import.meta.url)));

/** Feed the whole demo session through a tracker and return it. */
function runDemo(tracker = new LapTracker()) {
  const src = new DemoSource(data);
  while (!src.done) tracker.ingest(src.frame(src.index++));
  return tracker;
}

// Lap times the game would report: lastLapAt holds each completed lap's time.
const expectedLapTimes = Object.values(data.lastLapAt);

test('the out-lap is skipped and every full lap is timed with the game-reported time', () => {
  const tr = runDemo();
  assert.deepEqual(tr.laps.map((l) => l.timeMs), expectedLapTimes);
  assert.equal(tr.laps.length, expectedLapTimes.length);
});

test('reference length matches the track and progress is monotonic on every lap', () => {
  const tr = runDemo();
  assert.ok(Math.abs(tr.ref.length - 3032) < 40, `ref length ${tr.ref.length}`);
  for (const lap of tr.laps) {
    assert.equal(lap.p[0], 0);
    assert.equal(lap.p[lap.p.length - 1], tr.ref.length);
    for (let i = 1; i < lap.p.length; i++) assert.ok(lap.p[i] >= lap.p[i - 1], `lap ${lap.id} sample ${i}`);
    for (let i = 1; i < lap.t.length; i++) assert.ok(lap.t[i] >= lap.t[i - 1], `lap ${lap.id} t sample ${i}`);
  }
});

test('sector times add up to the lap time for any splits', () => {
  const tr = runDemo();
  for (const splits of [[1 / 3, 2 / 3], [0.5], [0.1, 0.4, 0.55, 0.9]]) {
    tr.setSplits(splits);
    for (const lap of tr.laps) {
      const secs = tr.lapSectors(lap);
      assert.equal(secs.length, splits.length + 1);
      assert.ok(secs.every((s) => s > 0));
      assert.ok(Math.abs(secs.reduce((a, b) => a + b, 0) - lap.timeMs) < 1e-6);
    }
  }
});

test('sector times are consistent between laps (each lap crosses the same line)', () => {
  const tr = runDemo();
  const secs = tr.laps.map((l) => tr.lapSectors(l));
  // Laps differ by at most ~0.5 s in this data, so no sector should differ wildly.
  for (let s = 0; s < 3; s++) {
    const col = secs.map((r) => r[s]);
    assert.ok(Math.max(...col) - Math.min(...col) < 600, `sector ${s + 1} spread ${Math.max(...col) - Math.min(...col)}`);
  }
});

test('changing splits re-derives sectors without touching laps', () => {
  const tr = runDemo();
  const before = tr.laps.map((l) => l.timeMs);
  tr.setSplits([0.25, 0.5, 0.75]);
  assert.equal(tr.sectorCount(), 4);
  assert.equal(tr.bestSectors().times.length, 4);
  assert.deepEqual(tr.laps.map((l) => l.timeMs), before);
});

test('theoretical best is no slower than the best lap', () => {
  const tr = runDemo();
  assert.ok(tr.theoreticalBest() <= tr.bestLap.timeMs);
});

test('live delta at the end of a lap equals the lap-time difference to the comparison lap', () => {
  const tr = new LapTracker();
  const src = new DemoSource(data);
  let lastLive = null, cmpAtEnd = null;
  while (!src.done) {
    const f = src.frame(src.index++);
    // Just before the lap rolls over, capture the live delta and what we compare against.
    if (f.lastLap !== undefined && tr.live?.delta !== undefined) { lastLive = tr.live; cmpAtEnd = tr.compareLap(); }
    tr.ingest(f);
    if (f.lastLap !== undefined && lastLive && lastLive.n === f.lap - 1 && cmpAtEnd) {
      const lap = tr.lastLap;
      const expected = lap.timeMs - cmpAtEnd.timeMs;
      assert.ok(Math.abs(lastLive.delta - expected) < 60, `lap ${lap.id}: live ${lastLive.delta} vs final ${expected}`);
      lastLive = null;
    }
  }
});

test('joining mid-lap: the partial first lap is not recorded', () => {
  const tr = new LapTracker();
  const src = new DemoSource(data);
  src.index = data.lapStarts[2][1] + 300; // partway through lap 2
  let seen = 0;
  while (!src.done && tr.laps.length < 2) { tr.ingest(src.frame(src.index++)); seen++; }
  assert.equal(tr.laps[0].n, 3);
  assert.equal(tr.laps[0].timeMs, data.lastLapAt[data.lapStarts[4][1]]);
});

test('a lap counter going backwards resets the session', () => {
  const tr = runDemo();
  assert.ok(tr.laps.length > 0);
  const src = new DemoSource(data);
  tr.ingest(src.frame(0));
  assert.equal(tr.laps.length, 0);
  assert.equal(tr.ref, null);
});

test('timeAt interpolates and clamps', () => {
  const lap = { t: [0, 1000, 2000], p: [0, 100, 300] };
  assert.equal(timeAt(lap, 50), 500);
  assert.equal(timeAt(lap, 200), 1500);
  assert.equal(timeAt(lap, -5), 0);
  assert.equal(timeAt(lap, 999), 2000);
  assert.deepEqual(sectorTimes({ ...lap, timeMs: 2000 }, [100]), [1000, 1000]);
});

test('speedSeries tracks the recording lap against the comparison lap, and extends as it grows', () => {
  const tr = new LapTracker();
  const src = new DemoSource(data);
  // Feed until at least one full lap exists (so there's a reference and a comparison lap) and
  // another is in progress.
  while (!(tr.laps.length >= 1 && tr.live?.recording)) tr.ingest(src.frame(src.index++));

  const first = tr.speedSeries();
  assert.ok(first.p.length > 0);
  assert.deepEqual(first.mine, tr.cur.speed.slice(0, first.mine.length));
  for (let i = 1; i < first.p.length; i++) assert.ok(first.p[i] >= first.p[i - 1]);
  assert.ok(first.theirs.every((v) => typeof v === 'number'));   // the comparison lap covers the whole line

  // Feed a few more frames: the cache should extend, not recompute, so earlier entries are unchanged.
  for (let i = 0; i < 20 && !src.done; i++) tr.ingest(src.frame(src.index++));
  const second = tr.speedSeries();
  assert.ok(second.p.length >= first.p.length);
  assert.deepEqual(second.p.slice(0, first.p.length), first.p);
  assert.deepEqual(second.mine.slice(0, first.mine.length), first.mine);
});

test('formatters', () => {
  assert.equal(fmtLap(62345), '1:02.345');
  assert.equal(fmtLap(59999.6), '1:00.000');
  assert.equal(fmtSector(20123), '20.123');
  assert.equal(fmtSector(5), '0.005');
  assert.equal(fmtDelta(123), '+0.123');
  assert.equal(fmtDelta(-1500), '−1.500');
  assert.equal(fmtDelta(0), '±0.000');
  assert.equal(fmtLap(null), '–:––.–––');
});

// ---- paused / loading / off-track frames --------------------------------------------------

/** The demo session as an array of frames, each tagged with its original index as `_i`. */
const cleanFrames = () => {
  const src = new DemoSource(data);
  return Array.from({ length: src.count }, (_, i) => ({ ...src.frame(i), _i: i }));
};

/** Feed an array of frames through a tracker and return it. */
function run(frames, tracker = new LapTracker()) {
  for (const f of frames) tracker.ingest(f);
  return tracker;
}

/**
 * Insert a stretch of flagged frames into a lap, simulating a pause, load or off-track gap.
 *
 * The gap starts 10 s into `lap`. It models a game that keeps sending packets while its clock
 * stands still, so every later frame is shifted in time by the length of the gap. `junk` overrides
 * the gap frames' values, to prove the tracker never reads them.
 */
function injectGap(frames, lap, flags, { count = 100, junk = {} } = {}) {
  const at = frames.findIndex((f) => f.lap === lap) + 200;
  const dt = data.dtMs, shift = count * dt, base = frames[at];
  const gap = Array.from({ length: count }, (_, k) => ({ ...base, ...junk, ...flags, _i: undefined, t: base.t + (k + 1) * dt }));
  const after = frames.slice(at + 1).map((f) => ({ ...f, t: f.t + shift }));
  return [...frames.slice(0, at + 1), ...gap, ...after];
}

const gapCases = {
  paused: [{ paused: true }, {}],
  loading: [{ loading: true }, { lap: 0, x: 0, z: 0, speed: 0 }],   // junk values must never be read
  'off track': [{ onTrack: false }, { lap: 0, x: 0, z: 0, speed: 0 }],
};

for (const [name, [flags, junk]] of Object.entries(gapCases)) {
  test(`${name} frames are dropped and the interrupted lap is marked invalid`, () => {
    const clean = run(cleanFrames());
    const tr = run(injectGap(cleanFrames(), 4, flags, { junk }));

    assert.equal(tr.laps.length, clean.laps.length);
    assert.deepEqual(tr.laps.map((l) => l.valid), clean.laps.map((_, i) => i !== 3));
    assert.deepEqual(tr.laps.map((l) => l.timeMs), clean.laps.map((l) => l.timeMs));
    // Laps that weren't interrupted come out identical to a clean run.
    for (const i of [0, 1, 2, 4, 5, 6, 7]) {
      tr.lapSectors(tr.laps[i]).forEach((s, k) => assert.ok(Math.abs(s - clean.lapSectors(clean.laps[i])[k]) < 1e-6));
    }
  });
}

test('the clock stands still during a pause, so live elapsed time matches a clean run', () => {
  const frames = cleanFrames();
  const clean = new LapTracker(), elapsedAt = [];
  for (const f of frames) { clean.ingest(f); elapsedAt[f._i] = clean.live?.elapsed; }

  const tr = new LapTracker();
  let compared = 0;
  for (const f of injectGap(cleanFrames(), 4, { paused: true })) {
    tr.ingest(f);
    if (f._i !== undefined && tr.live?.recording) {
      assert.ok(Math.abs(tr.live.elapsed - elapsedAt[f._i]) < 1e-6, `frame ${f._i}`);
      compared++;
    }
  }
  assert.ok(compared > 5000);
});

test('an interrupted lap never becomes the best lap, even when it is the fastest', () => {
  const tr = run(injectGap(cleanFrames(), 6, { paused: true }));   // lap 6 is the fastest in the data
  assert.equal(tr.laps[5].valid, false);
  assert.equal(tr.bestLap.n, 7);
  assert.ok(tr.bestSectors().laps.every((l) => l.valid));
  assert.ok(tr.theoreticalBest() <= tr.bestLap.timeMs);
});

test('comparing to "last lap" skips an interrupted lap', () => {
  const tr = run(injectGap(cleanFrames(), 4, { paused: true })
    .filter((f) => f.lap <= 5), new LapTracker({ compareMode: 'last' }));
  // Stopped right after lap 4 was recorded (invalid): the lap to compare against is lap 3.
  assert.equal(tr.lastLap.n, 4);
  assert.equal(tr.lastValidLap.n, 3);
  assert.equal(tr.compareLap().n, 3);
});

test('an interrupted first lap cannot become the reference lap', () => {
  const clean = run(cleanFrames());
  const tr = run(injectGap(cleanFrames(), 1, { paused: true }));
  assert.equal(tr.laps.length, clean.laps.length - 1);
  assert.equal(tr.laps[0].n, 2);
  assert.ok(tr.ref);
  assert.ok(tr.laps.every((l) => l.valid));
});

test('hold reports why timing is paused, and clears on resume', () => {
  const tr = new LapTracker();
  const frames = cleanFrames();
  frames.slice(0, 300).forEach((f) => tr.ingest(f));
  assert.equal(tr.hold, null);
  tr.ingest({ ...frames[300], paused: true });
  assert.equal(tr.hold, 'paused');
  tr.ingest({ ...frames[301], t: frames[300].t + 1000 });
  assert.equal(tr.hold, null);
});

// ---- driving channels in the frame ---------------------------------------------------------

test('demo frames carry gear, suggested gear and the rev markers', () => {
  const src = new DemoSource(data);
  const frames = Array.from({ length: src.count }, (_, i) => src.frame(i));
  for (const f of frames) {
    assert.ok(Number.isInteger(f.gear) && f.gear >= 1, `gear ${f.gear}`);
    assert.ok(Number.isInteger(f.suggestedGear) && f.suggestedGear >= f.gear, `suggested ${f.suggestedGear}`);
    assert.equal(f.rpmWarning, 7600);
    assert.equal(f.rpmLimiter, 8200);
  }
  // The suggestion only differs from the current gear when the revs are past the warning.
  assert.ok(frames.some((f) => f.suggestedGear > f.gear));
  assert.ok(frames.filter((f) => f.suggestedGear > f.gear).every((f) => f.rpm > f.rpmWarning));
});

// ---- a stale or implausible game lap time ---------------------------------------------------

test('a lap time the game has not yet updated is ignored in favour of our own estimate', () => {
  // Move each lap's reported time one frame late, so at the lap change it still holds the previous lap's.
  const frames = cleanFrames();
  const real = new Map();                       // frame index -> the true time for the lap that ended there
  frames.forEach((f, i) => { if (f.lastLap !== undefined) real.set(i, f.lastLap); });
  let previous;
  for (const [i, time] of real) {
    frames[i] = { ...frames[i], lastLap: previous };     // stale at the lap change (undefined for the first)
    if (i + 1 < frames.length) frames[i + 1] = { ...frames[i + 1], lastLap: time };
    previous = time;
  }
  const tr = run(frames);
  const truth = [...real.values()];
  assert.equal(tr.laps.length, truth.length);
  tr.laps.forEach((lap, i) => {
    assert.ok(Math.abs(lap.timeMs - truth[i]) < 120, `lap ${lap.id}: ${lap.timeMs} vs true ${truth[i]}`);
  });
  // Without the guard, later laps would carry the previous lap's exact time.
  const exactPrevious = tr.laps.filter((lap, i) => i > 0 && lap.timeMs === truth[i - 1]);
  assert.equal(exactPrevious.length, 0);
});

test('a game lap time far from our own estimate is not trusted', () => {
  const frames = cleanFrames();
  const at = frames.findIndex((f, i) => f.lastLap !== undefined && i > 2000);   // a later lap change
  const truth = frames[at].lastLap;
  frames[at] = { ...frames[at], lastLap: truth + 10000 };                       // absurd: 10 s off
  const tr = run(frames);
  const lap = tr.laps.find((l) => l.n === frames[at].lap - 1);
  assert.ok(Math.abs(lap.timeMs - truth) < 120, `${lap.timeMs} vs ${truth}`);
});

// ---- pinning a lap boundary to the game's own lap time --------------------------------------

/**
 * Position `d` metres (0..400, wrapping) around a 100x100 m square loop, at 10 m/s.
 *
 * A straight out-and-back line makes a degenerate reference (the return path lies exactly on the
 * outbound one, so projecting a point onto it is ambiguous everywhere), which is why this is a loop.
 */
function squarePos(d) {
  const m = ((d % 400) + 400) % 400;
  if (m < 100) return [m, 0];
  if (m < 200) return [100, m - 100];
  if (m < 300) return [100 - (m - 200), 100];
  return [0, 100 - (m - 300)];
}

/**
 * Frames for two laps of the square loop (lap 1 becomes the reference; lap 2 is the lap under test),
 * closing into lap 3 at distance `crossAt`. `gameClock` and `lastLap` on the closing frame are
 * overridable, so tests can check what pinning does and does not do to that closure.
 */
function pinningFrames({ gameClockThroughout = true, closingGameClock = gameClockThroughout, lastLap = 40037, crossAt = 5 } = {}) {
  const mk = (t, d, lap, extra = {}) => {
    const [x, z] = squarePos(d);
    return { t, x, z, speed: 36, throttle: 0, brake: 0, lap, gameClock: gameClockThroughout, ...extra };
  };
  const frames = [mk(-1000, 390, 0)];                                            // joined mid the out-lap
  for (let i = 0; i <= 40; i++) frames.push(mk(i * 1000, i * 10, 1));            // lap 1: reference, one loop
  for (let i = 1; i <= 40; i++) frames.push(mk(41000 + i * 1000, i * 10, 2));    // lap 2: t=42000..82000
  frames.push(mk(82500, crossAt, 3, { lastLap, gameClock: closingGameClock })); // crosses partway through this frame
  return frames;
}

test('when frames are on the game clock, the lap boundary is pinned to the game lap time', () => {
  const tr = run(pinningFrames());
  assert.equal(tr.laps[1].timeMs, 40037);
  assert.equal(tr.laps[1].gameClock, true);
  // Pinning sets where the next lap starts counting from to exactly startT + timeMs, rather than
  // wherever the position-based interpolation happened to land (which, right at this loop's seam,
  // is unreliable - see the interpolated case below).
  assert.equal(tr.cur.startT, tr.laps[1].startT + 40037);
});

test('an interpolated (non-pinned) crossing can land far from the game lap time, which is what pinning fixes', () => {
  // Not on the game clock, so pinning cannot apply: the interpolated crossing is used instead, and at
  // this loop's seam (the sample just before crossing sits exactly on the start/finish point) that
  // estimate is badly wrong, off by over a second from the trusted lap time.
  const tr = run(pinningFrames({ gameClockThroughout: false, closingGameClock: false }));
  assert.equal(tr.laps[1].timeMs, 40037);                                // the lap time itself is still right...
  assert.notEqual(tr.cur.startT, tr.laps[1].startT + 40037);             // ...but the next lap's clock isn't pinned to it
  assert.ok(Math.abs(tr.cur.startT - (tr.laps[1].startT + 40037)) > 500, 'expected a large interpolation error at the seam');
});

test('pinning needs both the previous and the crossing frame to be on the game clock', () => {
  // Neither case pins: one has no game-clock samples in the closing lap at all, the other's crossing
  // frame itself isn't on the game clock (which is what the pinning check looks at directly).
  const notPinned = run(pinningFrames({ gameClockThroughout: false, closingGameClock: true }));
  assert.equal(notPinned.laps[1].gameClock, false);
  assert.notEqual(notPinned.cur.startT, notPinned.laps[1].startT + 40037);

  const alsoNotPinned = run(pinningFrames({ gameClockThroughout: true, closingGameClock: false }));
  assert.notEqual(alsoNotPinned.cur.startT, alsoNotPinned.laps[1].startT + 40037);
});

test('an implausible game lap time is not trusted, so pinning does not use it either', () => {
  // 5000 ms off is well past the trust tolerance (1500 ms): the tracker falls back to its own estimate
  // for timeMs, and pinning (which only ever uses a trusted timeMs) has nothing wrong to pin to.
  const tr = run(pinningFrames({ lastLap: 45037 }));
  assert.notEqual(tr.laps[1].timeMs, 45037);
  assert.notEqual(tr.cur.startT, tr.laps[1].startT + 45037);
});

// ---- events: onEvent notifications ------------------------------------------------------------

test('onEvent fires "lap" with the finished lap, in order, and "reset" with a reason', () => {
  const events = [];
  const tr = new LapTracker({ onEvent: (type, payload) => events.push({ type, payload }) });
  const src = new DemoSource(data);
  while (!src.done) tr.ingest(src.frame(src.index++));

  const lapEvents = events.filter((e) => e.type === 'lap');
  assert.equal(lapEvents.length, tr.laps.length);
  assert.deepEqual(lapEvents.map((e) => e.payload.lap.id), tr.laps.map((l) => l.id));
  assert.equal(lapEvents.at(-1).payload.lap, tr.laps.at(-1));   // the actual stored lap object, not a copy

  events.length = 0;
  tr.reset();
  assert.deepEqual(events, [{ type: 'reset', payload: { reason: 'manual' } }]);
});

test('the constructor never fires onEvent for its own initial (empty) state', () => {
  const events = [];
  new LapTracker({ onEvent: (type) => events.push(type) });
  assert.deepEqual(events, []);
});

// ---- restoreSession -----------------------------------------------------------------------------

test('restoreSession rebuilds the reference from the first restored lap and continues timing from there', () => {
  const clean = runDemo();
  const keep = clean.laps.slice(0, -2);                  // restore all but the last two laps...
  const rest = clean.laps.slice(-2);                     // ...then drive through them again from scratch
  const saved = { laps: keep.map((l) => ({ ...l })), splits: clean.splits, compareMode: 'last' };

  const events = [];
  const tr = new LapTracker({ onEvent: (type, payload) => events.push({ type, payload }) });
  tr.restoreSession(saved);

  assert.equal(tr.laps.length, keep.length);
  assert.deepEqual(tr.laps.map((l) => l.timeMs), keep.map((l) => l.timeMs));
  assert.deepEqual(tr.laps.map((l) => l.id), keep.map((_, i) => i + 1));   // renumbered fresh
  assert.equal(tr.compareMode, 'last');
  // Close, not identical: a stored lap already carries its closing sample (appended after the
  // original reference was built from the same lap), so rebuilding from it threads one extra
  // point through the loop. Negligible for timing (well under 1 m over a ~3 km lap).
  assert.ok(Math.abs(tr.ref.length - clean.ref.length) < 5, `ref length ${tr.ref.length} vs ${clean.ref.length}`);
  assert.deepEqual(events, [{ type: 'restore', payload: { laps: keep.length } }]);

  // Continues timing, but the lap in progress when a session is restored is always "joined
  // mid-lap" (its start is unknown, see restoreSession's own doc comment) - even feeding frames
  // starting exactly on a crossing doesn't change that, since there's no `cur` yet to notice it.
  // So the first lap fed after a restore is never recorded; the one after that is.
  const [skipped, recovered] = rest;
  const src = new DemoSource(data);
  src.feedUntilLap(skipped.n, () => {});
  while (!src.done && tr.laps.length < clean.laps.length - 1) tr.ingest(src.frame(src.index++));
  assert.deepEqual(tr.laps.slice(keep.length).map((l) => l.n), [recovered.n]);
  assert.equal(tr.laps.at(-1).timeMs, recovered.timeMs);
});

test('restoreSession with no laps starts a clean, empty session', () => {
  const tr = runDemo();
  assert.ok(tr.laps.length > 0);
  tr.restoreSession({ splits: [0.5], compareMode: 'last' });
  assert.equal(tr.laps.length, 0);
  assert.equal(tr.ref, null);
  assert.deepEqual(tr.splits, [0.5]);
  assert.equal(tr.compareMode, 'last');
});

test('restoring an empty session (no laps key at all) is a no-op-safe reset', () => {
  const tr = runDemo();
  tr.restoreSession();
  assert.equal(tr.laps.length, 0);
  assert.equal(tr.ref, null);
});

// ---- losing the reference: auto-reset after a persistent mismatch -----------------------------

test('staying far off a restored reference for a while triggers an automatic reset', () => {
  const clean = runDemo();
  const saved = { laps: clean.laps.map((l) => ({ ...l })) };

  const events = [];
  const tr = new LapTracker({ onEvent: (type, payload) => events.push({ type, payload }) });
  tr.restoreSession(saved);

  // The very first frame after a restore only opens a non-recording "joined mid-lap" placeholder
  // (its lap number is unknown to have started); a lap change is needed before anything actually
  // records samples, exactly as it would for a real reconnect mid-lap.
  tr.ingest({ t: 0, lap: 900, x: 1_000_000, z: 1_000_000, speed: 50, throttle: 0, brake: 0 });
  tr.ingest({ t: 20, lap: 901, x: 1_000_000, z: 1_000_000, speed: 50, throttle: 0, brake: 0 });
  // Now recording lap 901, feed frames miles from the restored reference for longer than
  // LOST_REFERENCE_RESET_MS (5000 ms), well outside the flags' "held" gap-skip path.
  let resetAt = null;
  for (let t = 40; t <= 6000 && resetAt === null; t += 20) {
    tr.ingest({ t, lap: 901, x: 1_000_000 + t, z: 1_000_000, speed: 50, throttle: 0, brake: 0 });
    if (events.some((e) => e.type === 'reset' && e.payload.reason === 'lost-reference')) resetAt = t;
  }
  assert.ok(resetAt !== null, 'expected an automatic reset');
  assert.ok(resetAt >= 5000, `reset fired too early, at t=${resetAt}`);
  assert.equal(tr.laps.length, 0);
  assert.equal(tr.ref, null);

  // Recovers: a normal lap driven after the reset builds a fresh reference, same as any fresh start.
  // feedUntilLap(2, ...) alone stops right at the start of lap 2, before that crossing (which is what
  // closes lap 1 and builds the reference) is actually fed in; go one lap further to be sure it lands.
  const src = new DemoSource(data);
  src.feedUntilLap(3, (f) => tr.ingest(f));
  assert.ok(tr.ref);
  assert.ok(tr.ref.length > 500);
});

test('brief excursions off a restored reference do not trigger a reset', () => {
  const clean = runDemo();
  const tr = new LapTracker();
  tr.restoreSession({ laps: clean.laps.map((l) => ({ ...l })) });
  const src = new DemoSource(data);
  // Replay a real lap's worth of driving on top of the restored session: normal telemetry noise and
  // the LOST_DISTANCE_M-level jitter this already tolerates should never accumulate into a reset.
  src.feedUntilLap(2, () => {});
  while (!src.done && src.lapAt[src.index] === 2) tr.ingest(src.frame(src.index++));
  assert.ok(tr.ref);   // still the restored reference, never cleared
  assert.ok(tr.laps.length >= clean.laps.length);
});
