// Smooths out frames that arrive in bursts, by replaying them a fixed delay behind real time.
//
// A network stall (Wi-Fi channel hopping, a busy router) delivers nothing for ~100 ms and then a
// burst of frames at once, which the page shows as a freeze then a jump. Holding each frame until
// `delay` ms after it "should" have arrived spreads the burst back out. Delay 0 turns it off and
// frames pass straight through (it still counts the stalls it would have hidden).

const OFFSET_BUCKET_MS = 1000;   // arrival-minus-frame-time is tracked as the minimum per bucket...
const OFFSET_BUCKETS = 5;        // ...over this many buckets, so slow clock drift is followed
const MAX_QUEUED = 300;          // a hidden tab stops polling; don't let the queue grow without bound
const TIME_JUMP_MS = 1000;       // a frame time this far off the last one is a restart, not jitter
const LATE_TOLERANCE_MS = 8;     // half a 60 Hz frame: ordinary jitter smaller than this isn't a visible stutter
const LATE_WINDOW_MS = 10000;    // how far back `lateRecently` counts

/**
 * Queues frames and releases each at `frame.t + offset + delay`.
 *
 * `offset` is the smallest (arrival time - frame time) seen recently, i.e. the least-delayed path
 * the frames have taken, so a burst after a stall doesn't drag the schedule later. A frame that
 * arrives after its slot has already passed is released at once and counted as late: that is the
 * stutter the current delay failed to hide, which is what a user tunes the delay against.
 *
 * Call `push(frame)` when a frame arrives and `poll()` often (once per animation frame); `emit`
 * receives frames in order. The clock is injectable for tests.
 */
export class JitterBuffer {
  constructor({ emit, delayMs = 0, now = () => performance.now() } = {}) {
    this.emit = emit;
    this.delayMs = delayMs;
    this.now = now;
    this._queue = [];
    this._buckets = [];      // [{ start, min }] of recent arrival-minus-frame-time offsets
    this._lastT = null;
    this._late = [];         // arrival times of late frames within the window
  }

  /** Change the delay; takes effect for the next frame (queued ones keep their slot, a shorter delay just makes them due). */
  setDelay(ms) {
    this.delayMs = Math.max(0, Number(ms) || 0);
    if (this.delayMs === 0) this._flush();   // release everything now rather than waiting for the next poll
  }

  /** Drop everything queued and forget the timing history (a new connection, or the source restarted). */
  reset() {
    this._queue = [];
    this._buckets = [];
    this._lastT = null;
    this._late = [];
  }

  /** Frames waiting to be released. */
  get queued() {
    return this._queue.length;
  }

  /** How many frames in the last few seconds arrived after their slot, at the current delay. */
  get lateRecently() {
    this._trimLate(this.now());
    return this._late.length;
  }

  /** Take one arriving frame. With no delay it is emitted immediately. */
  push(frame) {
    const arrival = this.now();
    // A jump in frame time means a restart or a change of clock: the old offsets no longer apply.
    if (this._lastT !== null && Math.abs(frame.t - this._lastT) > TIME_JUMP_MS) {
      this._flush();
      this._buckets = [];
    }
    this._lastT = frame.t;

    // Lateness is judged against the schedule at the current delay, whether or not it is on: at 0
    // it says how much stutter there is to hide.
    const due = frame.t + this._offset(arrival, arrival - frame.t) + this.delayMs;
    if (arrival - due > LATE_TOLERANCE_MS) this._late.push(arrival);
    if (this.delayMs === 0) {
      this.emit(frame);
      return;
    }
    this._queue.push({ frame, due });
    while (this._queue.length > MAX_QUEUED) this.emit(this._queue.shift().frame);
  }

  /** Release every queued frame whose time has come, in order. */
  poll() {
    const now = this.now();
    while (this._queue.length && this._queue[0].due <= now) this.emit(this._queue.shift().frame);
  }

  /** Emit whatever is queued immediately. */
  _flush() {
    const queued = this._queue;
    this._queue = [];
    for (const { frame } of queued) this.emit(frame);
  }

  /** Record this frame's arrival-minus-frame-time and return the smallest recent one. */
  _offset(arrival, sample) {
    const start = Math.floor(arrival / OFFSET_BUCKET_MS) * OFFSET_BUCKET_MS;
    const last = this._buckets[this._buckets.length - 1];
    if (last && last.start === start) last.min = Math.min(last.min, sample);
    else this._buckets.push({ start, min: sample });
    while (this._buckets.length > OFFSET_BUCKETS) this._buckets.shift();
    return Math.min(...this._buckets.map((b) => b.min));
  }

  _trimLate(now) {
    while (this._late.length && now - this._late[0] > LATE_WINDOW_MS) this._late.shift();
  }
}
