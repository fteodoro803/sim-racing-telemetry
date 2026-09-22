// Replays demo-laps.json as a stream of frames, the same shape a bridge would send.
// Uses a virtual clock so playback speed can change without touching frame timestamps.

/**
 * A plausible FL/FR/RL/RR tyre temperature (°C) for a given speed: not modeled physics, just
 * something that visibly varies with the demo lap so the Tyres widget has something to show,
 * front slightly hotter than rear under load at speed.
 */
function tyreTempAt(speedKmh) {
  const base = 65 + Math.min(35, speedKmh * 0.15);
  return [base + 4, base + 3, base - 2, base - 3];
}

/**
 * A frame source backed by demo-laps.json; the same interface a live source would have.
 *
 * Frames are built on demand from the columnar data. `advance` releases them against a virtual
 * clock, `feedUntilLap` releases the opening laps instantly.
 */
export class DemoSource {
  constructor(data) {
    this.data = data;
    this.count = data.x.length;
    this.dt = data.dtMs;
    this.lapAt = new Array(this.count);
    for (let i = 0; i < data.lapStarts.length; i++) {
      const [lap, from] = data.lapStarts[i];
      const to = i + 1 < data.lapStarts.length ? data.lapStarts[i + 1][1] : this.count;
      for (let k = from; k < to; k++) this.lapAt[k] = lap;
    }
    this.reset();
  }

  /** Rewind to the start of the session. */
  reset() {
    this.index = 0;
    this.clock = 0;
  }

  /** True once every frame has been emitted. */
  get done() {
    return this.index >= this.count;
  }

  /** Build frame `i` in the shape a bridge decoder would emit (see the README's frame format). */
  frame(i) {
    const d = this.data;
    const f = {
      t: i * this.dt,
      lap: this.lapAt[i],
      x: d.x[i], z: d.z[i],
      speed: d.speed[i], throttle: d.throttle[i], brake: d.brake[i], clutch: 0,   // not modeled, same as the fake console
      tyreTemp: tyreTempAt(d.speed[i]),
      gear: d.gear[i], suggestedGear: d.suggestedGear[i], rpm: d.rpm[i],
      rpmWarning: d.rpmWarning, rpmLimiter: d.rpmLimiter,
    };
    const last = d.lastLapAt[i];
    if (last !== undefined) f.lastLap = last;
    return f;
  }

  /** Emit frames instantly until the given lap begins (used to open the demo with some history). */
  feedUntilLap(lap, emit) {
    while (!this.done && this.lapAt[this.index] < lap) emit(this.frame(this.index++));
    this.clock = this.index * this.dt;
  }

  /** Advance the virtual clock by realMs * speed and emit every frame that is now due. */
  advance(realMs, speed, emit) {
    this.clock += realMs * speed;
    while (!this.done && this.index * this.dt <= this.clock) emit(this.frame(this.index++));
  }
}
