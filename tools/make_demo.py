#!/usr/bin/env python3
"""Generate web/demo-laps.json: SYNTHETIC telemetry for the demo mode.

Nothing here is recorded from a game. It builds a made-up closed circuit, works
out a speed profile from curvature and grip/brake limits, then "drives" an
out-lap plus several flying laps with slightly different grip per zone, so that
different laps are fastest in different places (which makes sector comparison
and theoretical best worth looking at).

Output is columnar (one array per channel, one entry per frame) to keep the file
small. Frames are what a bridge decoder would emit; see README "Frame format".

Run:  python3 tools/make_demo.py
"""
import bisect
import json
import math
import random
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "web" / "demo-laps.json"

HZ = 20
DT_MS = 1000 // HZ
VMAX = 88.0      # m/s, ~317 km/h
A_LAT = 14.0     # m/s^2 cornering limit at grip 1.0
A_BRAKE = 16.0   # m/s^2
GEAR_UP = [0, 55, 95, 135, 175, 220, 265]  # km/h at which each gear starts
RPM_WARNING = 7600   # the game's shift alert starts here
RPM_LIMITER = 8200

# One entry per lap: (grip in three zones, [(position 0..1, width m, speed factor)], seed)
LAPS = [
    ((0.965, 0.955, 0.970), [], 1),
    ((0.975, 0.970, 0.965), [(0.62, 70, 0.88)], 2),
    ((0.985, 0.960, 0.980), [], 3),
    ((0.980, 0.985, 0.975), [], 4),
    ((0.990, 0.980, 0.985), [], 5),
    ((0.985, 0.990, 0.990), [(0.30, 60, 0.90)], 6),
    ((0.995, 0.985, 0.980), [], 7),
    ((0.970, 0.990, 0.995), [], 8),
]
OUT_LAP = ((0.75, 0.75, 0.75), [], 0)
OUT_LAP_START = 0.72  # out-lap starts 72% round the track (as if leaving the pits)


def build_track():
    """Build the demo circuit: a closed star-shaped curve resampled to uniform spacing.

    Returns the points, the heading at each, a smoothed curvature per point (1/m) and the spacing
    between points (m). The star shape guarantees the curve never crosses itself.
    """
    radius, n = 430.0, 40000
    fine = []
    for i in range(n):
        th = 2 * math.pi * i / n
        r = radius * (1 + 0.20 * math.cos(2 * th + 0.6) + 0.14 * math.cos(3 * th + 2.1)
                      + 0.08 * math.cos(5 * th + 4.0) + 0.035 * math.cos(8 * th + 1.0))
        fine.append((r * math.cos(th), r * math.sin(th)))
    cum = [0.0]
    for i in range(1, n + 1):
        a, b = fine[i - 1], fine[i % n]
        cum.append(cum[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    length = cum[-1]
    count = round(length / 2.0)
    step = length / count
    pts, j = [], 0
    for k in range(count):
        s = k * step
        while cum[j + 1] < s:
            j += 1
        u = (s - cum[j]) / (cum[j + 1] - cum[j])
        a, b = fine[j], fine[(j + 1) % n]
        pts.append((a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])))
    # curvature from heading change, box-smoothed
    head = [math.atan2(pts[(k + 1) % count][1] - pts[k][1], pts[(k + 1) % count][0] - pts[k][0])
            for k in range(count)]
    raw = []
    for k in range(count):
        d = head[k] - head[k - 1]
        d = (d + math.pi) % (2 * math.pi) - math.pi
        raw.append(abs(d) / step)
    w = 6
    kappa = [sum(raw[(k + o) % count] for o in range(-w, w + 1)) / (2 * w + 1) for k in range(count)]
    return pts, head, kappa, step


def zone_grip(f, g):
    """Grip multiplier at track position `f` (0..1), blended smoothly between three zone values.

    Each zone's value applies at its centre and is cosine-blended into the next, wrapping round
    the lap, so laps differ by region and the speed profile never has a hard step.
    """
    x = (f * 3 - 0.5) % 3
    i = int(x)
    u = 0.5 - 0.5 * math.cos(math.pi * (x - i))
    return g[i % 3] * (1 - u) + g[(i + 1) % 3] * u


def accel_limit(v):
    """Forward acceleration limit (m/s^2) at speed `v`: strong when slow, tapering towards top speed."""
    return max(1.0, 9.0 * (1 - v / 95.0))


def simulate(kappa, step, grips, mistakes):
    """Work out a lap's speed profile and pedal inputs from the track's curvature.

    Corner speed is limited by lateral grip; braking and acceleration limits are then applied in
    backward and forward passes (twice round, so the loop wraps consistently). Returns per-point
    speed `v` (m/s), the cumulative time `t` at each point, and throttle and brake (0..1).

    `mistakes` are (position, width in m, factor) windows where the speed limit is scaled down.
    """
    count = len(kappa)
    vlim = [min(VMAX, math.sqrt(A_LAT * zone_grip(k / count, grips) / max(kappa[k], 1e-3)))
            for k in range(count)]
    for pos, width, factor in mistakes:
        centre = int(pos * count)
        half = int(width / step / 2)
        for o in range(-half, half + 1):
            vlim[(centre + o) % count] *= factor
    v = vlim[:]
    for _ in range(2):
        for k in range(2 * count - 1, -1, -1):
            i, j = k % count, (k + 1) % count
            v[i] = min(v[i], math.sqrt(v[j] ** 2 + 2 * A_BRAKE * step))
        for k in range(2 * count):
            i, j = k % count, (k + 1) % count
            v[j] = min(v[j], math.sqrt(v[i] ** 2 + 2 * accel_limit(v[i]) * step))
    t = [0.0]
    for k in range(count):
        t.append(t[-1] + step / ((v[k] + v[(k + 1) % count]) / 2))
    thr, brk = [], []
    for k in range(count):
        a = (v[(k + 1) % count] ** 2 - v[k] ** 2) / (2 * step)
        brk.append(min(1.0, -a / 15) if a < -1.5 else 0.0)
        thr.append(0.0 if a < -0.5 else 1.0 if a > 1.0 else max(0.0, min(1.0, 0.4 + a * 0.6)))
    return v, t, thr, brk


def gear_rpm(kmh):
    """Pick a gear from speed and derive a plausible rpm within it (illustrative, not a real gearbox)."""
    g = max(i for i, s in enumerate(GEAR_UP) if kmh >= s) + 1
    lo = GEAR_UP[g - 1]
    hi = GEAR_UP[g] if g < len(GEAR_UP) else 320
    return g, 4500 + 3700 * min(1.0, (kmh - lo) / (hi - lo))


def main():
    """Build the demo circuit, simulate the laps, and write web/demo-laps.json.

    Frames are sampled at a fixed rate from one session timeline: an out-lap, the flying laps, and a
    phantom frame past the finish that closes the last lap the way a game would.
    """
    # 1. Build the circuit and its curvature
    pts, head, kappa, step = build_track()
    count = len(pts)
    length = count * step

    # 2. Simulate the out-lap (partial) and then each flying lap
    plan = [(OUT_LAP, int(OUT_LAP_START * count))] + [(lap, 0) for lap in LAPS]
    sims = []
    for (grips, mistakes, seed), start in plan:
        v, t, thr, brk = simulate(kappa, step, grips, mistakes)
        rng = random.Random(seed)
        sims.append({
            "v": v, "t": t, "thr": thr, "brk": brk, "start": start,
            "dur": (t[count] - t[start]) * 1000,
            "ph": [rng.uniform(0, 6.28) for _ in range(2)],
            "wave": rng.choice([3, 4, 5]),
            "amp": 1.2 if seed else 0.5,
        })

    # 3. Lay the laps end to end on one session timeline
    starts, acc = [], 0.0
    for s in sims:
        starts.append(acc)
        acc += s["dur"]
    total = acc
    # One phantom frame past the finish so the final lap is closed the way a game would close it
    # (the first frame of the next lap carries the previous lap's time).
    starts.append(total)
    sims.append(dict(sims[-1]))

    # 4. Sample the session at a fixed frame rate, as the game would
    cols = {k: [] for k in ("x", "z", "speed", "throttle", "brake", "gear", "suggestedGear", "rpm")}
    lap_starts, last_lap_at = [], {}
    n_frames = math.ceil(total / DT_MS) + 1
    m = 0
    for i in range(n_frames):
        t_ms = i * DT_MS
        while m + 1 < len(sims) and t_ms >= starts[m + 1]:
            m += 1
        s = sims[m]
        if not lap_starts or lap_starts[-1][0] != m:
            lap_starts.append([m, i])
            if m >= 2:
                last_lap_at[i] = round(sims[m - 1]["dur"])
        tau = (t_ms - starts[m]) / 1000 + s["t"][s["start"]]
        k = min(count - 1, max(0, bisect.bisect_right(s["t"], tau) - 1))
        f = (tau - s["t"][k]) / (s["t"][k + 1] - s["t"][k])
        j = (k + 1) % count
        pos = (k + f) * step
        v = s["v"][k] + f * (s["v"][j] - s["v"][k])
        cx = pts[k][0] + f * (pts[j][0] - pts[k][0])
        cz = pts[k][1] + f * (pts[j][1] - pts[k][1])
        h = head[k]
        off = (s["amp"] * math.sin(2 * math.pi * pos / (length / s["wave"]) + s["ph"][0])
               + 0.5 * math.sin(2 * math.pi * pos / 137 + s["ph"][1]))
        kmh = v * 3.6
        gear, rpm = gear_rpm(kmh)
        cols["x"].append(round(cx - math.sin(h) * off, 1))
        cols["z"].append(round(cz + math.cos(h) * off, 1))
        cols["speed"].append(round(kmh, 1))
        cols["throttle"].append(round(s["thr"][k] * 100))
        cols["brake"].append(round(s["brk"][k] * 100))
        cols["gear"].append(gear)
        cols["suggestedGear"].append(min(gear + 1, len(GEAR_UP)) if round(rpm / 10) * 10 > RPM_WARNING else gear)   # compare the stored (rounded) rpm
        cols["rpm"].append(round(rpm / 10) * 10)

    # 5. Write the columnar output
    data = {
        "meta": {"synthetic": True, "generator": "tools/make_demo.py"},
        "track": {"name": "Demo Circuit"},
        "dtMs": DT_MS,
        "lapStarts": lap_starts,   # [lap number, first frame index]
        "lastLapAt": last_lap_at,  # frame index -> previous lap time (ms), as the game reports it
        "rpmWarning": RPM_WARNING,
        "rpmLimiter": RPM_LIMITER,
        **cols,
    }
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KiB), {n_frames} frames, track {length:.0f} m")
    for idx, s in enumerate(sims):
        label = "out-lap (partial)" if idx == 0 else f"lap {idx}"
        print(f"  {label:18s} {s['dur'] / 1000:8.3f} s")


if __name__ == "__main__":
    main()
