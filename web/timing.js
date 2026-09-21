// Game-agnostic lap timing: turns a stream of normalised frames into laps, sector times and live deltas.
//
// Consumes the frame format described in the README ("Frame format") and has no DOM
// dependency, so it can be tested in Node.
//
// Design notes:
//  - GT7 gives position, not track distance or sectors. So the first complete lap becomes
//    the reference line, and every other lap is projected onto it to get progress `p` (metres).
//  - Every lap stores (t, p) samples. Sector times are DERIVED from those samples and the
//    current split positions, never stored. Changing the splits re-computes every lap.
//  - Splits are fractions (0..1) of the reference length, so they survive a different reference lap.

const PROJECT_AHEAD_M = 150;   // how far ahead of the last position we look for the car
const PROJECT_BACK_M = 15;     // how far behind we still look, to tolerate small backwards jitter
const LOST_DISTANCE_M = 80;    // further than this from the line: hold progress, don't guess
const MAX_CROSSING_GAP_M = 100; // a frame further than this from the line can't be used to place the crossing
const LAP_TIME_TOLERANCE_MS = 1500; // a game-reported lap time this far from our own estimate isn't trusted

export const DEFAULT_SPLITS = [1 / 3, 2 / 3];

/**
 * Look up the time (ms into the lap) at which a lap reached a given progress.
 *
 * Binary-searches the lap's (progress, time) samples and interpolates linearly between the
 * two either side. Clamps to the first or last sample when `p` is outside the lap, and returns
 * null for a lap with no samples. Progress must be non-decreasing, which the tracker guarantees.
 */
export function timeAt(lap, p) {
  const ps = lap.p, ts = lap.t, n = ps.length;
  if (n === 0) return null;
  if (p <= ps[0]) return ts[0];
  if (p >= ps[n - 1]) return ts[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ps[mid] < p) lo = mid; else hi = mid;
  }
  const span = ps[hi] - ps[lo];
  const u = span > 1e-9 ? (p - ps[lo]) / span : 0;
  return ts[lo] + u * (ts[hi] - ts[lo]);
}

/**
 * Split a completed lap into sector durations (ms) at the given split positions.
 *
 * `splitsM` are distances in metres along the reference line, in increasing order. N splits
 * give N+1 sectors, and the last sector runs to the lap's own time so the sectors always sum to it.
 */
export function sectorTimes(lap, splitsM) {
  const cuts = [0, ...splitsM.map((s) => timeAt(lap, s)), lap.timeMs];
  return cuts.slice(1).map((c, i) => c - cuts[i]);
}

/**
 * Turn a completed lap's path into the closed reference line used to measure progress.
 *
 * Adds a segment from the last sample back to the first so the loop is closed, and records the
 * cumulative distance `d` at every point. `length` is the full lap length in metres.
 */
function buildReference(lap) {
  const x = lap.x.slice(), z = lap.z.slice();
  x.push(x[0]); z.push(z[0]);            // close the loop
  const d = [0];
  for (let i = 1; i < x.length; i++) d.push(d[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]));
  return { x, z, d, length: d[d.length - 1] };
}

/**
 * Find where the car is on the reference line, as a distance in metres from the start line.
 *
 * Searches only a window around the previous segment (a little behind, a lot ahead) rather than
 * the whole line, so a track that passes close to itself can't be mistaken for another stretch.
 * Returns the segment for the next search, the distance `p`, and `off`, how far the car is from
 * the line, which the caller uses to notice it has lost the car.
 */
function project(ref, x, z, seg) {
  const { d } = ref;
  const nSeg = d.length - 1;
  let i0 = seg;
  while (i0 > 0 && d[seg] - d[i0 - 1] < PROJECT_BACK_M) i0--;
  let best = Infinity, bi = seg, bu = 0;
  for (let i = i0; i < nSeg && d[i] <= d[seg] + PROJECT_AHEAD_M; i++) {
    const ax = ref.x[i], az = ref.z[i];
    const dx = ref.x[i + 1] - ax, dz = ref.z[i + 1] - az;
    const len2 = dx * dx + dz * dz;
    let u = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const ex = ax + u * dx - x, ez = az + u * dz - z;
    const d2 = ex * ex + ez * ez;
    if (d2 < best) { best = d2; bi = i; bu = u; }
  }
  return { seg: bi, p: d[bi] + bu * (d[bi + 1] - d[bi]), off: Math.sqrt(best) };
}

const CHANNELS = ['speed', 'throttle', 'brake', 'x', 'z'];

/** Interpolate the numeric channels of two frames, a fraction `f` of the way from `a` to `b`. */
function lerpFrame(a, b, f) {
  const out = { ...b, t: a.t + f * (b.t - a.t) };
  for (const k of CHANNELS) out[k] = a[k] + f * (b[k] - a[k]);
  return out;
}

/**
 * Turns frames into laps, sector times and live comparisons for one session.
 *
 * Feed frames in order to `ingest`, then read results from `laps`, `live` and the derived-state
 * methods. The first full lap becomes the reference line (see the file header); a lap that
 * starts mid-session, or is interrupted, is handled as described on `ingest`.
 */
export class LapTracker {
  constructor({ splits = DEFAULT_SPLITS, compareMode = 'best' } = {}) {
    this.splits = splits.slice();
    this.compareMode = compareMode;
    this.reset();
  }

  /** Forget everything, including the frame-stream clock state. */
  reset() {
    this.clockOffset = 0;
    this.gapStart = null;
    this.hold = null;
    this._seenLastLap = null;
    this._clearSession();
  }

  /**
   * Forget the laps and the reference line, but keep the clock offset.
   *
   * The offset belongs to the frame stream rather than the session: dropping it would make the
   * next frame's timestamp look like time going backwards.
   */
  _clearSession() {
    this.laps = [];
    this.ref = null;
    this.cur = null;
    this.prev = null;
    this.live = null;
    this._deltaCache = null;
    this._bestSectorsCache = null;
  }

  // ---- configuration -------------------------------------------------------

  /**
   * Replace the sector split points, given as fractions (0..1) of the reference length.
   *
   * Out-of-range values are discarded and the rest sorted. Nothing is recomputed eagerly: caches
   * are cleared and sector times are re-derived on demand, which is why splits can change freely.
   */
  setSplits(fractions) {
    this.splits = fractions.filter((f) => f > 0 && f < 1).sort((a, b) => a - b);
    this._deltaCache = null;
    this._bestSectorsCache = null;
  }

  /** Choose which lap the live delta compares against: 'best' or 'last'. */
  setCompareMode(mode) {
    this.compareMode = mode;
    this._deltaCache = null;
  }

  /** The split points in metres along the reference line (empty until there is a reference). */
  splitsM() {
    return this.ref ? this.splits.map((f) => f * this.ref.length) : [];
  }

  // ---- derived state -------------------------------------------------------

  /** Laps that count towards bests and comparisons (no paused/loading/off-track frames). */
  get validLaps() {
    return this.laps.filter((l) => l.valid);
  }

  /** The fastest valid lap, or null if there isn't one yet. */
  get bestLap() {
    let best = null;
    for (const l of this.laps) if (l.valid && (!best || l.timeMs < best.timeMs)) best = l;
    return best;
  }

  /** Most recent lap, valid or not: this is what the "last lap" readout shows. */
  get lastLap() {
    return this.laps.length ? this.laps[this.laps.length - 1] : null;
  }

  /** Most recent lap that is fit to compare against. */
  get lastValidLap() {
    for (let i = this.laps.length - 1; i >= 0; i--) if (this.laps[i].valid) return this.laps[i];
    return null;
  }

  /** The lap the live delta is measured against, per the compare mode; null until one is available. */
  compareLap() {
    return this.compareMode === 'last' ? this.lastValidLap : this.bestLap;
  }

  /** Number of sectors: one more than the number of splits. */
  sectorCount() {
    return this.splits.length + 1;
  }

  /** Per-lap sector times, using the current splits. */
  lapSectors(lap) {
    return sectorTimes(lap, this.splitsM());
  }

  /** Fastest time per sector across all laps, and which lap set it. */
  bestSectors() {
    const key = `${this.laps.length}|${this.splits.join(',')}`;
    if (this._bestSectorsCache?.key === key) return this._bestSectorsCache.value;
    const n = this.sectorCount();
    const times = new Array(n).fill(null), laps = new Array(n).fill(null);
    for (const lap of this.validLaps) {
      this.lapSectors(lap).forEach((s, i) => {
        if (times[i] === null || s < times[i]) { times[i] = s; laps[i] = lap; }
      });
    }
    const value = { times, laps };
    this._bestSectorsCache = { key, value };
    return value;
  }

  /** The theoretical best lap: the sum of the fastest valid time in each sector, or null until every sector has one. */
  theoreticalBest() {
    const { times } = this.bestSectors();
    return times.length && times.every((t) => t !== null) ? times.reduce((a, b) => a + b, 0) : null;
  }

  /**
   * How far ahead (negative) or behind (positive) the current lap is versus `other` within one sector.
   *
   * Measured up to the car's position, or to the sector's end once the sector is done. Returns
   * null if there's no timed lap in progress or the car hasn't reached that sector yet.
   */
  sectorDelta(si, other) {
    const live = this.live;
    if (!live || !live.recording || !other || !this.ref) return null;
    const cuts = this.splitsM();
    const start = si === 0 ? 0 : cuts[si - 1];
    const end = si < cuts.length ? cuts[si] : this.ref.length;
    if (live.p < start) return null;
    const p = Math.min(live.p, end);
    const mine = timeAt(this.cur, p) - (si === 0 ? 0 : timeAt(this.cur, start));
    const theirs = timeAt(other, p) - (si === 0 ? 0 : timeAt(other, start));
    return mine - theirs;
  }

  /**
   * Time (ms) the current lap has spent in sector `si`, so far, or final once the sector is done.
   *
   * Null if the sector hasn't been reached or there's no timed lap in progress.
   */
  liveSectorTime(si) {
    const live = this.live;
    if (!live?.recording || !this.ref || si > live.sector) return null;
    if (si === live.sector) return live.sectorElapsed;
    const cuts = this.splitsM();
    return timeAt(this.cur, cuts[si]) - (si === 0 ? 0 : timeAt(this.cur, cuts[si - 1]));
  }

  /**
   * Delta (ms) at every sample of the current lap versus the comparison lap, for the delta chart.
   *
   * Cached and extended incrementally, so drawing on every animation frame only costs the new
   * samples. The cache is dropped when the current or comparison lap changes.
   */
  deltaSeries() {
    const cmp = this.compareLap();
    const cur = this.cur;
    if (!cur || !cmp || !this.ref || !cur.recording) return null;
    let c = this._deltaCache;
    if (!c || c.cur !== cur || c.cmp !== cmp) c = this._deltaCache = { cur, cmp, p: [], d: [] };
    for (let i = c.p.length; i < cur.p.length; i++) {
      c.p.push(cur.p[i]);
      c.d.push(cur.t[i] - timeAt(cmp, cur.p[i]));
    }
    return c;
  }

  // ---- ingest --------------------------------------------------------------

  /**
   * Feed one frame into the tracker; call this for every frame, in order.
   *
   * Frames flagged paused, loading or off-track are dropped, and the lap they interrupt is
   * marked invalid. The flags are optional, and a frame without them counts as driving.
   *
   * Deliberately simple: we don't yet know how the game reports these states in practice, so
   * this errs towards excluding a lap rather than trusting doubtful data (D7 in DECISIONS.md).
   */
  ingest(raw) {
    // 1. Drop frames where the game isn't running normally, and flag the lap they interrupt
    const hold = raw.loading ? 'loading' : raw.onTrack === false ? 'off track' : raw.paused ? 'paused' : null;
    if (hold) {
      if (this.gapStart === null) this.gapStart = raw.t;
      if (this.cur) this.cur.invalid = true;
      this.hold = hold;
      return;
    }
    this.hold = null;

    // 2. On the first frame after a gap, take the gap out of our clock
    if (this.gapStart !== null) {
      // The game clock stood still for the gap, so take that time out of ours.
      this.clockOffset += raw.t - this.gapStart;
      this.gapStart = null;
    }
    const f = this.clockOffset ? { ...raw, t: raw.t - this.clockOffset } : raw;

    // 3. Start afresh if the session restarted (lap counter or time going backwards)
    if (this.cur && (f.lap < this.cur.n || f.t < this.prev.t)) this._clearSession();

    // 4. Open the first lap, or close the one that just ended when the lap counter changes
    const staleLastLap = f.lastLap > 0 && f.lastLap === this._seenLastLap;
    if (!this.cur) {
      // Joined mid-lap: we don't know where this lap started, so it can't be timed.
      this._openLap(f.lap, false, f.t, f);
    } else if (f.lap !== this.cur.n) {
      this._closeLap(f, staleLastLap);
    }
    if (f.lastLap > 0) this._seenLastLap = f.lastLap;

    // 5. Record a sample for the lap in progress
    if (this.cur.recording) this._addSample(f, f.t - this.cur.startT);
    this.prev = f;

    // 6. Refresh the live readout
    this._updateLive(f);
  }

  /**
   * Start a new lap. A recording lap gets an opening sample at its start (time 0, progress 0).
   *
   * A lap that isn't `recording` (we joined mid-lap, so its start is unknown) only tracks the
   * lap counter and is never timed.
   */
  _openLap(n, recording, startT, openFrame) {
    this.cur = {
      n, recording, startT, seg: 0, lastP: 0, ownDist: 0, invalid: false,
      t: [], p: [], speed: [], throttle: [], brake: [], x: [], z: [],
    };
    if (recording) this._push(openFrame, 0, 0);
  }

  /** Append one sample (time, progress and the channels) to the current lap. */
  _push(f, t, p) {
    const c = this.cur;
    c.t.push(t); c.p.push(p);
    c.speed.push(f.speed); c.throttle.push(f.throttle); c.brake.push(f.brake);
    c.x.push(f.x); c.z.push(f.z);
  }

  /**
   * Add a frame to the current lap as a sample, working out its progress around the lap.
   *
   * With a reference line, progress comes from projecting the car onto it: held if the car is too
   * far from the line to trust, and never allowed to go backwards. Without one this is the
   * reference lap itself, and progress is the distance travelled along its own path.
   */
  _addSample(f, t) {
    const c = this.cur;
    // If the crossing was placed exactly on this frame, the opening sample already covers it.
    if (t <= c.t[c.t.length - 1]) return;
    let p;
    if (this.ref) {
      const hit = project(this.ref, f.x, f.z, c.seg);
      if (hit.off > LOST_DISTANCE_M) {
        p = c.lastP;
      } else {
        c.seg = hit.seg;
        p = Math.max(hit.p, c.lastP);
      }
    } else {
      // Reference lap: progress is simply distance travelled along our own path.
      const n = c.x.length;
      c.ownDist += n ? Math.hypot(f.x - c.x[n - 1], f.z - c.z[n - 1]) : 0;
      p = c.ownDist;
    }
    c.lastP = p;
    this._push(f, t, p);
  }

  /**
   * Handle the lap counter changing: finish the lap that just ended and open the next one.
   *
   * The game only tells us the counter changed, so the crossing moment is estimated to
   * sub-frame accuracy from how far each side of the line the two frames were.
   *
   * The game's own lap time is preferred, but only if it looks freshly updated: if the game changes
   * its lap counter a frame before its last-lap time, that value is still the previous lap's, so it
   * is ignored (`stale`) in favour of our estimate. It is also ignored if it is far from our estimate.
   */
  _closeLap(f, stale = false) {
    const cur = this.cur, prev = this.prev;
    let tc = f.t, xf = f;   // moment the car crossed the line, and the state at that moment

    if (cur.recording) {
      if (this.ref) {
        // 1. Place the crossing between the previous frame and this one
        const first = project(this.ref, f.x, f.z, 0);
        const toGo = this.ref.length - cur.lastP;
        if (toGo >= 0 && toGo < MAX_CROSSING_GAP_M && first.p < MAX_CROSSING_GAP_M && toGo + first.p > 0) {
          const frac = toGo / (toGo + first.p);
          tc = prev.t + frac * (f.t - prev.t);
          xf = lerpFrame(prev, f, frac);
        }
      }
      // 2. Store the lap that just ended; the game's own lap time wins when it is fresh and plausible
      const estimate = tc - cur.startT;
      const trusted = f.lastLap > 0 && !stale && Math.abs(f.lastLap - estimate) <= LAP_TIME_TOLERANCE_MS;
      this._finishLap(cur, xf, trusted ? f.lastLap : estimate);
    }

    // 3. Open the next lap, starting at the crossing
    this._openLap(f.lap, true, tc, xf);
  }

  /**
   * Store a completed lap and, if it's the first, build the reference line from it.
   *
   * Skipped if the lap has too few samples, or if it was interrupted and there is no reference
   * yet (an interrupted path may have gaps, so it can't define the track). Ends the lap with a
   * closing sample exactly on the line.
   */
  _finishLap(cur, xf, timeMs) {
    if (cur.t.length < 5) return;
    // An interrupted lap can't become the reference: its path may have gaps.
    if (cur.invalid && !this.ref) return;
    const lap = {
      id: this.laps.length + 1, n: cur.n, timeMs, valid: !cur.invalid,
      t: cur.t, p: cur.p, speed: cur.speed, throttle: cur.throttle, brake: cur.brake, x: cur.x, z: cur.z,
    };
    if (!this.ref) this.ref = buildReference(lap);
    // Closing sample sits exactly on the line: last instant of the lap.
    lap.t.push(timeMs);
    lap.p.push(this.ref.length);
    lap.speed.push(xf.speed); lap.throttle.push(xf.throttle); lap.brake.push(xf.brake);
    lap.x.push(xf.x); lap.z.push(xf.z);
    this.laps.push(lap);
  }

  /**
   * Recompute the live readout (elapsed time, delta, predicted lap, current sector) after a frame.
   *
   * Delta and prediction need both a reference line and a comparison lap; until then only the
   * elapsed time and progress are set.
   */
  _updateLive(f) {
    const c = this.cur;
    if (!c.recording) {
      this.live = { n: c.n, recording: false, elapsed: null, p: null };
      return;
    }
    const elapsed = f.t - c.startT;
    const live = { n: c.n, recording: true, elapsed, p: c.lastP, referenceLap: !this.ref };
    const cmp = this.compareLap();
    if (this.ref && cmp) {
      live.delta = elapsed - timeAt(cmp, c.lastP);
      live.predicted = cmp.timeMs + live.delta;
    }
    const cuts = this.splitsM();
    let si = 0;
    while (si < cuts.length && c.lastP >= cuts[si]) si++;
    live.sector = si;
    live.sectorElapsed = this.ref ? elapsed - (si === 0 ? 0 : timeAt(c, cuts[si - 1])) : null;
    this.live = live;
  }
}
