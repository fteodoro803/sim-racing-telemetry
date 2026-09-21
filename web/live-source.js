// A frame source that reads live telemetry from the bridge over a WebSocket.
//
// It has the same job as DemoSource (produce frames for the LapTracker) but pushes them as they
// arrive instead of being polled. It also reports how the connection is doing, so the page can say
// what is happening: connecting, connected but waiting for the game, live, or lost and retrying.
//
// The WebSocket class and the timers are injectable so the state logic can be tested in Node,
// where there is no browser WebSocket.

export const STATES = ['idle', 'connecting', 'waiting', 'live', 'lost'];

const RETRY_DELAYS_MS = [1000, 2000, 3000, 5000];
const STALE_AFTER_MS = 2500;   // no frames for this long means the game has stopped sending
const STALE_CHECK_MS = 500;

/**
 * Connects to the bridge and turns its messages into frames and connection states.
 *
 * States: `idle` (not connected, not trying), `connecting` (opening the socket), `waiting` (connected
 * to the bridge but no frames arriving, so the game isn't sending), `live` (frames arriving) and
 * `lost` (the connection dropped; a reconnect is scheduled). Callbacks: `onFrame(frame)`,
 * `onState(state)` and `onStatus(message)` for the bridge's once-a-second status messages.
 */
export class LiveSource {
  constructor(url, {
    onFrame = () => {}, onState = () => {}, onStatus = () => {},
    WebSocketImpl = globalThis.WebSocket,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
    setRepeating = (fn, ms) => setInterval(fn, ms), clearRepeating = (id) => clearInterval(id),
  } = {}) {
    this.url = url;
    this.onFrame = onFrame;
    this.onState = onState;
    this.onStatus = onStatus;
    this.WebSocketImpl = WebSocketImpl;
    this.now = now;
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._setRepeating = setRepeating;
    this._clearRepeating = clearRepeating;
    this.state = 'idle';
    this.frames = 0;
    this._socket = null;
    this._retry = 0;
    this._retryTimer = null;
    this._staleTimer = null;
    this._lastFrameAt = 0;
    this._wanted = false;
  }

  _setState(state) {
    if (state !== this.state) {
      this.state = state;
      this.onState(state);
    }
  }

  /** Start connecting, and keep reconnecting if the connection drops, until `close()` is called. */
  connect() {
    this._wanted = true;
    this._open();
    if (!this._staleTimer) this._staleTimer = this._setRepeating(() => this._checkStale(), STALE_CHECK_MS);
  }

  /** Stop for good: close the socket and don't reconnect. */
  close() {
    this._wanted = false;
    if (this._retryTimer !== null) this._clearTimer(this._retryTimer);
    this._retryTimer = null;
    if (this._staleTimer !== null) this._clearRepeating(this._staleTimer);
    this._staleTimer = null;
    if (this._socket) {
      const socket = this._socket;
      this._socket = null;
      socket.onclose = socket.onmessage = socket.onopen = socket.onerror = null;
      try { socket.close(); } catch { /* already closed */ }
    }
    this._setState('idle');
  }

  _open() {
    this._setState('connecting');
    let socket;
    try {
      socket = new this.WebSocketImpl(this.url);
    } catch {
      this._scheduleRetry();   // for example a malformed address
      return;
    }
    this._socket = socket;
    socket.onopen = () => {
      this._retry = 0;
      this._setState('waiting');
    };
    socket.onmessage = (event) => this._onMessage(event.data);
    socket.onclose = () => {
      if (this._socket !== socket) return;
      this._socket = null;
      if (this._wanted) this._scheduleRetry();
    };
    socket.onerror = () => {};   // a close event follows
  }

  _scheduleRetry() {
    this._setState('lost');
    const delay = RETRY_DELAYS_MS[Math.min(this._retry, RETRY_DELAYS_MS.length - 1)];
    this._retry += 1;
    this._retryTimer = this._setTimer(() => {
      this._retryTimer = null;
      if (this._wanted) this._open();
    }, delay);
  }

  _onMessage(data) {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;   // ignore anything that isn't JSON
    }
    if (message.type === 'frame') {
      this.frames += 1;
      this._lastFrameAt = this.now();
      this._setState('live');
      this.onFrame(message);
    } else if (message.type === 'status') {
      this.onStatus(message);
      // The bridge says nothing is arriving from the console: don't wait for our own timeout.
      if (message.receiving === false && this.state === 'live') this._setState('waiting');
    }
  }

  _checkStale() {
    if (this.state === 'live' && this.now() - this._lastFrameAt > STALE_AFTER_MS) this._setState('waiting');
  }
}
