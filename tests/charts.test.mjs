import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushTraceSample } from '../web/charts.js';

test('pushTraceSample appends and trims anything older than windowMs before the newest sample', () => {
  const samples = [];
  pushTraceSample(samples, { t: 0, thr: 0, brk: 0 }, 1000);
  pushTraceSample(samples, { t: 400, thr: 50, brk: 0 }, 1000);
  pushTraceSample(samples, { t: 900, thr: 80, brk: 0 }, 1000);
  assert.deepEqual(samples.map((s) => s.t), [0, 400, 900]);   // all within the last 1000ms of 900

  pushTraceSample(samples, { t: 1200, thr: 0, brk: 40 }, 1000);
  // window is now [200, 1200]: the t=0 sample falls out, the rest stay
  assert.deepEqual(samples.map((s) => s.t), [400, 900, 1200]);
});

test('pushTraceSample always keeps at least one sample, even if it is older than the window', () => {
  const samples = [];
  pushTraceSample(samples, { t: 0, thr: 0, brk: 0 }, 1000);
  pushTraceSample(samples, { t: 5000, thr: 100, brk: 0 }, 1000);   // a huge forward jump, still same session
  assert.deepEqual(samples.map((s) => s.t), [5000]);
});

test('pushTraceSample clears the buffer on a backwards clock jump (a new session), instead of bridging the gap', () => {
  const samples = [];
  pushTraceSample(samples, { t: 10000, thr: 60, brk: 0 }, 1000);
  pushTraceSample(samples, { t: 10300, thr: 70, brk: 0 }, 1000);
  pushTraceSample(samples, { t: 200, thr: 0, brk: 0 }, 1000);   // clock reset - a new session started
  assert.deepEqual(samples.map((s) => s.t), [200]);
});
