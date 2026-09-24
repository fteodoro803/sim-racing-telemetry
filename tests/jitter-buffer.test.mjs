import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JitterBuffer } from '../web/jitter-buffer.js';

/** A buffer on a manual clock; `out` collects the frame times it emits, with the clock at emission. */
function setup(delayMs) {
  const clock = { t: 10000 };
  const out = [];
  const buf = new JitterBuffer({ delayMs, now: () => clock.t, emit: (f) => out.push({ t: f.t, at: clock.t }) });
  return { clock, out, buf };
}

const STEP = 1000 / 60;

/**
 * Feed 60 Hz frames for `seconds`, except that arrivals between `stallFrom` and `stallTo` (ms into
 * the run) are held and delivered together when the stall ends - a bursty network. Polls every ms.
 */
function run({ clock, buf }, seconds, stall) {
  const start = clock.t;
  const held = [];
  for (let frame = 0; frame * STEP < seconds * 1000; frame++) {
    const sentAt = start + frame * STEP;
    while (clock.t < sentAt) { clock.t += 1; buf.poll(); }
    const elapsed = sentAt - start;
    if (stall && elapsed >= stall.from && elapsed < stall.to) held.push({ t: frame * STEP });
    else {
      for (const f of held.splice(0)) buf.push(f);
      buf.push({ t: frame * STEP });
    }
  }
}

test('with no delay, frames pass straight through', () => {
  const s = setup(0);
  s.buf.push({ t: 0 });
  assert.equal(s.out.length, 1);
  assert.equal(s.buf.queued, 0);
});

test('a delayed frame is held until its slot, then released in order', () => {
  const s = setup(100);
  s.buf.push({ t: 0 });
  s.clock.t += 16.7;
  s.buf.push({ t: 16.7 });
  s.buf.poll();
  assert.equal(s.out.length, 0);
  s.clock.t += 84;
  s.buf.poll();
  assert.deepEqual(s.out.map((f) => f.t), [0]);
  s.clock.t += 20;
  s.buf.poll();
  assert.deepEqual(s.out.map((f) => f.t), [0, 16.7]);
});

test('a burst after a stall is released evenly when the delay covers the stall', () => {
  const s = setup(130);
  run(s, 3, { from: 1000, to: 1100 });   // 100 ms hole, then a burst
  const gaps = s.out.slice(1).map((f, i) => f.at - s.out[i].at);
  assert.ok(Math.max(...gaps) < 33, `largest gap between emissions was ${Math.max(...gaps)} ms`);
  assert.equal(s.buf.lateRecently, 0);
});

test('a stall longer than the delay is counted as late and released at once', () => {
  const s = setup(30);
  run(s, 3, { from: 1000, to: 1100 });
  assert.ok(s.buf.lateRecently > 0);
});

test('at delay 0 it still counts the stalls, so they can be seen before turning the delay up', () => {
  const s = setup(0);
  run(s, 3, { from: 1000, to: 1100 });
  assert.ok(s.buf.lateRecently > 0);
  assert.equal(s.buf.queued, 0);
});

test('a steady stream is never late', () => {
  const s = setup(60);
  run(s, 5);
  assert.equal(s.buf.lateRecently, 0);
});

test('setting the delay to 0 releases whatever is queued', () => {
  const s = setup(500);
  s.buf.push({ t: 0 });
  s.buf.push({ t: 16 });
  s.buf.setDelay(0);
  assert.equal(s.out.length, 2);
  assert.equal(s.buf.queued, 0);
});

test('a jump in frame time (a restart) flushes the old frames and starts fresh', () => {
  const s = setup(500);
  s.buf.push({ t: 100000 });
  s.buf.push({ t: 100016 });
  s.buf.push({ t: 5 });   // the game restarted
  assert.deepEqual(s.out.map((f) => f.t), [100000, 100016]);
  assert.equal(s.buf.queued, 1);
});

test('the queue is capped so a hidden tab cannot grow it without bound', () => {
  const s = setup(60000);
  for (let i = 0; i < 1000; i++) { s.clock.t += 1; s.buf.push({ t: i * 16 }); }
  assert.ok(s.buf.queued <= 300);
  assert.equal(s.out.length, 700);
});

test('late counts age out of the recent window', () => {
  const s = setup(0);
  run(s, 2, { from: 500, to: 700 });
  assert.ok(s.buf.lateRecently > 0);
  s.clock.t += 20000;
  assert.equal(s.buf.lateRecently, 0);
});
