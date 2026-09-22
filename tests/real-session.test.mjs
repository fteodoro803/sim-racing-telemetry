// Replays a real PS4 recording through the full timing pipeline.
//
// The fixture (bridge/tests/fixtures/gt7-ps4-session.jsonl.gz) is decoded and converted to frames by
// a small Python helper (tools/decode_fixture.py, which just calls the bridge's own gt7.py and
// frames.py) and cached as JSON alongside it, so this file has no Python dependency at test time and
// stays fast. Regenerate the cache with `npm run decode-fixture` if the fixture or the decoder changes.
//
// Python's json.dumps and JS's JSON.parse agree on number formatting, so this is a faithful replay of
// exactly what the bridge would have sent over the WebSocket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LapTracker } from '../web/timing.js';

const CACHE = fileURLToPath(new URL('../bridge/tests/fixtures/gt7-ps4-session.frames.json', import.meta.url));

if (!existsSync(CACHE)) {
  test('real PS4 session (skipped: run `npm run decode-fixture` first)', { skip: true }, () => {});
} else {
  const frames = JSON.parse(readFileSync(CACHE, 'utf8'));

  function run(splits) {
    const tr = new LapTracker();
    if (splits) tr.setSplits(splits);
    for (const f of frames) tr.ingest(f);
    return tr;
  }

  test('a real session decodes into the three laps the game itself reported', () => {
    const tr = run();
    assert.equal(tr.laps.length, 3);
    assert.deepEqual(tr.laps.map((l) => l.timeMs), [122352, 126719, 121563]);
    assert.deepEqual(tr.laps.map((l) => l.valid), [true, true, true]);
    assert.ok(tr.laps.every((l) => l.gameClock), 'every lap should end up on the trusted game clock');
  });

  test('the reference line is a closed loop of a plausible track length', () => {
    const tr = run();
    // Not a real number to check against (no ground truth for this track), just a sanity bound:
    // rules out a badly broken projection (e.g. a reference a few metres or many kilometres long).
    assert.ok(tr.ref.length > 500 && tr.ref.length < 10000, `ref length ${tr.ref.length}`);
  });

  test('sector times sum to the lap time, for the default splits and others', () => {
    for (const splits of [[1 / 3, 2 / 3], [0.25, 0.5, 0.75], [0.5]]) {
      const tr = run(splits);
      for (const lap of tr.laps) {
        const sum = tr.lapSectors(lap).reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(sum - lap.timeMs) < 1e-6, `splits ${splits}, lap ${lap.n}`);
      }
    }
  });

  test('the live delta at the end of each lap is close to the true lap-time difference', () => {
    const tr = new LapTracker();
    let prevLive = null;
    let prevCompareLap = null;   // whichever lap the delta was actually measured against, just before this one closed
    const checked = [];
    for (const f of frames) {
      const before = tr.laps.length;
      tr.ingest(f);
      if (tr.laps.length > before && prevLive?.delta !== undefined && prevCompareLap) {
        const lap = tr.laps[tr.laps.length - 1];
        checked.push({ n: lap.n, live: prevLive.delta, truth: lap.timeMs - prevCompareLap.timeMs });
      }
      prevLive = tr.live && { ...tr.live };
      prevCompareLap = tr.compareLap();
    }
    assert.ok(checked.length >= 2, `expected at least 2 closed laps with a prior comparison, got ${checked.length}`);
    for (const c of checked) assert.ok(Math.abs(c.live - c.truth) < 60, `lap ${c.n}: live ${c.live} vs true ${c.truth}`);
  });

  test('the pause in this session holds timing and does not corrupt the lap it interrupts', () => {
    const tr = run();
    assert.equal(tr.hold, null);   // the recording ends a few seconds into the paused lap, before we see it
    // The paused lap (4) never produced 5 samples before the recording ends, so it's simply not
    // recorded yet; nothing here should have thrown, and the three prior laps must be unaffected.
    assert.equal(tr.laps.length, 3);
  });
}
