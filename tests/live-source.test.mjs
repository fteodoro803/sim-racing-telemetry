import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveSource } from '../web/live-source.js';

/** A stand-in for the browser's WebSocket that the test drives by hand. */
class FakeSocket {
  static instances = [];
  constructor(url) { this.url = url; this.closed = false; FakeSocket.instances.push(this); }
  close() { this.closed = true; }
  // helpers the test uses to play the server's part
  open() { this.onopen?.(); }
  message(obj) { this.onmessage?.({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) }); }
  drop() { this.onclose?.(); }
}

/** A LiveSource wired to a fake socket, a manual clock and manual timers. */
function setup() {
  FakeSocket.instances = [];
  const log = { states: [], frames: [], statuses: [] };
  const clock = { t: 0 };
  const timers = [];        // one-shot timers: { at, fn }
  const repeating = [];     // repeating timers: { fn }
  const src = new LiveSource('ws://bridge/ws', {
    WebSocketImpl: FakeSocket,
    onState: (s) => log.states.push(s),
    onFrame: (f) => log.frames.push(f),
    onStatus: (s) => log.statuses.push(s),
    now: () => clock.t,
    setTimer: (fn, ms) => { timers.push({ at: clock.t + ms, fn }); return timers.length - 1; },
    clearTimer: (id) => { if (timers[id]) timers[id].fn = null; },
    setRepeating: (fn) => { repeating.push({ fn }); return repeating.length - 1; },
    clearRepeating: (id) => { if (repeating[id]) repeating[id].fn = null; },
  });
  const advance = (ms) => {
    clock.t += ms;
    for (const t of timers) if (t.fn && t.at <= clock.t) { const fn = t.fn; t.fn = null; fn(); }
    for (const r of repeating) r.fn?.();
  };
  return { src, log, advance, socket: () => FakeSocket.instances.at(-1) };
}

test('goes connecting, then waiting once open, then live on the first frame', () => {
  const { src, log, socket } = setup();
  src.connect();
  assert.equal(src.state, 'connecting');
  assert.equal(socket().url, 'ws://bridge/ws');
  socket().open();
  assert.equal(src.state, 'waiting');
  socket().message({ type: 'hello', bridge: true });
  assert.equal(src.state, 'waiting');                 // a greeting alone isn't data
  socket().message({ type: 'frame', t: 1, lap: 1, speed: 100 });
  assert.equal(src.state, 'live');
  assert.deepEqual(log.states, ['connecting', 'waiting', 'live']);
  assert.equal(log.frames.length, 1);
  assert.equal(log.frames[0].speed, 100);
});

test('ignores messages that are not JSON', () => {
  const { src, log, socket } = setup();
  src.connect(); socket().open();
  socket().message('this is not json');
  socket().message({ type: 'something-else' });
  assert.equal(log.frames.length, 0);
  assert.equal(src.state, 'waiting');
});

test('falls back to waiting when frames stop, and recovers when they resume', () => {
  const { src, advance, socket } = setup();
  src.connect(); socket().open();
  socket().message({ type: 'frame', t: 1 });
  advance(1000);
  assert.equal(src.state, 'live');
  advance(2000);                                       // 3 s with no frames
  assert.equal(src.state, 'waiting');
  socket().message({ type: 'frame', t: 2 });
  assert.equal(src.state, 'live');
});

test('a status message saying nothing is arriving moves live to waiting at once', () => {
  const { src, log, socket } = setup();
  src.connect(); socket().open();
  socket().message({ type: 'frame', t: 1 });
  socket().message({ type: 'status', receiving: false });
  assert.equal(src.state, 'waiting');
  assert.equal(log.statuses.length, 1);
});

test('a dropped connection is lost, then retried with a growing delay', () => {
  const { src, log, advance } = setup();
  src.connect();
  FakeSocket.instances[0].open();
  FakeSocket.instances[0].drop();
  assert.equal(src.state, 'lost');
  advance(999);
  assert.equal(FakeSocket.instances.length, 1);        // not yet
  advance(1);
  assert.equal(FakeSocket.instances.length, 2);        // after 1 s
  assert.equal(src.state, 'connecting');

  FakeSocket.instances[1].drop();                      // fails again without ever opening
  assert.equal(src.state, 'lost');
  advance(1999);
  assert.equal(FakeSocket.instances.length, 2);
  advance(1);
  assert.equal(FakeSocket.instances.length, 3);        // after 2 s this time

  FakeSocket.instances[2].open();                      // success resets the backoff
  FakeSocket.instances[2].drop();
  advance(1000);
  assert.equal(FakeSocket.instances.length, 4);
  assert.ok(log.states.includes('lost'));
});

test('close stops for good: no reconnect, back to idle', () => {
  const { src, advance, socket } = setup();
  src.connect(); socket().open();
  const s = socket();
  src.close();
  assert.equal(src.state, 'idle');
  assert.equal(s.closed, true);
  advance(60000);
  assert.equal(FakeSocket.instances.length, 1);
});

test('close while a retry is pending cancels it', () => {
  const { src, advance } = setup();
  src.connect();
  FakeSocket.instances[0].drop();
  assert.equal(src.state, 'lost');
  src.close();
  advance(60000);
  assert.equal(FakeSocket.instances.length, 1);
  assert.equal(src.state, 'idle');
});

test('a malformed address is retried rather than throwing', () => {
  const { src } = setup();
  class Throwing { constructor() { throw new SyntaxError('bad url'); } }
  const bad = new LiveSource('nonsense', { WebSocketImpl: Throwing, setTimer: () => 0, setRepeating: () => 0 });
  bad.connect();
  assert.equal(bad.state, 'lost');
  assert.ok(src);
});
