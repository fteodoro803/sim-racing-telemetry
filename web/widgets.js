// The dashboard's widgets: one definition per widget, each building its own DOM once and then
// updating it from shared state.
//
// A definition is { title, build(body) -> refs, update(refs, ctx), onTap?(ctx), noLabel? }. The page
// creates a card for each widget in the layout, calls `build` once, then `update` on every render.
// `ctx` carries everything a widget may read: the lap tracker, its live state, the latest frame
// (null before any arrives), the theme colours, and a few page flags. Widgets never talk to each
// other or to the data source, which is what will let them be added, removed and moved later.

import { drawChart } from './charts.js';
import { deltaClass, el, setClass, setText } from './dom.js';
import { fmtDelta, fmtLap, fmtSector } from './format.js';
import { tyreZone } from './tyre-color.js';

const NBSP = ' ';
const DASH = '—';

// ---- small pieces used by several widgets --------------------------------------------------

/** Build a value line and a sub-line, the shape of the timing readouts. Returns the two nodes. */
function valueAndSub(body, valueClass) {
  const value = el('div', `v ${valueClass}`);
  const sub = el('div', 'sub');
  body.append(value, sub);
  return { value, sub };
}

/** Text and class for a sub-line that shows a delta, or blank space when there is none. */
function setDeltaSub(sub, ms) {
  setText(sub, ms == null ? NBSP : fmtDelta(ms));
  setClass(sub, `sub ${deltaClass(ms)}`);
}

// ---- Timing --------------------------------------------------------------------------------

const currentLap = {
  title: 'Current lap',
  build(body) {
    return valueAndSub(body, 'v-xl dim');
  },
  update(r, { live, tracker }) {
    const timing = live?.recording;
    const held = timing && (tracker.hold || tracker.cur?.invalid);
    setText(r.value, timing ? fmtLap(live.elapsed) : fmtLap(null));
    setClass(r.value, `v v-xl ${!timing ? 'dim' : held ? 'dim' : 'accent'}`);
    setText(r.sub, held ? 'not counted' : timing ? `Lap ${live.n}` : NBSP);
  },
};

const delta = {
  title: 'Delta',
  build(body) {
    return valueAndSub(body, 'v-xl dim');
  },
  update(r, { live, tracker }) {
    const has = live?.recording && live.delta !== undefined;
    setText(r.value, has ? fmtDelta(live.delta) : DASH);
    setClass(r.value, `v v-xl ${has ? deltaClass(live.delta) : 'dim'}`);
    const against = tracker.compareMode === 'last' ? 'last' : 'best';
    setText(r.sub, has ? `vs ${against} lap` : live?.referenceLap ? 'recording reference lap' : 'no data');
  },
  onTap({ tracker }) {
    tracker.setCompareMode(tracker.compareMode === 'best' ? 'last' : 'best');
  },
};

/** One sector card: its label, this lap's time in it, and the delta against the best sector. */
function makeSectorCard() {
  const node = el('div', 'sector');
  const label = el('div', 'sector-label');
  const time = el('div', 'v v-md');
  const deltaLine = el('div', 'sector-delta');
  node.append(label, time, deltaLine);
  return { node, label, time, delta: deltaLine };
}

const sectors = {
  title: 'Sectors',
  build(body) {
    const row = el('div', 'sector-row');
    body.append(row);
    return { row, cards: [], count: 0 };
  },
  update(r, { tracker, live }) {
    const n = tracker.sectorCount();
    if (r.count !== n) {
      r.row.replaceChildren();
      r.cards = Array.from({ length: n }, makeSectorCard);
      r.cards.forEach((c) => r.row.append(c.node));
      r.count = n;
    }
    const best = tracker.bestSectors();
    const showLive = live?.recording && tracker.ref;
    r.cards.forEach((c, i) => {
      const done = showLive && live.sector > i;
      const current = showLive && live.sector === i;
      setClass(c.node, `sector ${current ? 'current' : done ? 'done' : ''}`);
      setText(c.label, `S${i + 1}${current ? ' · LIVE' : done ? ' · DONE' : ''}`);
      const t = showLive ? tracker.liveSectorTime(i) : null;
      setText(c.time, t == null ? '––.–––' : fmtSector(t));
      setClass(c.time, `v v-md ${t == null ? 'faint' : current ? 'accent' : ''}`);
      const d = showLive ? tracker.sectorDelta(i, best.laps[i]) : null;
      setText(c.delta, d == null ? NBSP : fmtDelta(d));
      setClass(c.delta, `sector-delta ${deltaClass(d)}`);
    });
  },
};

const deltaChart = {
  title: 'Delta over lap',
  build(body) {
    const note = el('div', 'chart-note', 'above zero = slower');
    const canvas = el('canvas');
    body.closest('.widget').classList.add('has-chart');
    body.append(note, canvas);
    return { canvas, key: '' };
  },
  update(r, { tracker, theme }) {
    const ds = tracker.deltaSeries();
    const count = ds ? ds.p.length : 0;
    // Redrawing thousands of points 60 times a second is wasteful when nothing has changed.
    const key = `${count}|${r.canvas.clientWidth}x${r.canvas.clientHeight}|${tracker.compareMode}|${tracker.cur?.n}`;
    if (key === r.key) return;
    r.key = key;
    const seconds = ds ? ds.d.map((v) => v / 1000) : [];
    const span = Math.max(0.25, ...seconds.map(Math.abs));
    const half = Math.ceil(span / 0.25) * 0.25;
    const xMax = tracker.ref ? tracker.ref.length : 1000;
    drawChart(r.canvas, ds ? [{ x: ds.p, y: seconds, signColors: { neg: theme.good, pos: theme.bad }, width: 2 }] : [], {
      theme, xMax, yMin: -half, yMax: half, vlines: tracker.splitsM(), zero: true,
      xFormat: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`),
      yFormat: (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2),
      marker: seconds.length ? { x: ds.p[ds.p.length - 1], y: seconds[seconds.length - 1], color: theme.current } : null,
    });
  },
};

const speedChart = {
  title: 'Speed over lap',
  build(body) {
    const legend = el('div', 'chart-legend');
    legend.append(
      el('span', 'legend-item cur', 'this lap'),
      el('span', 'legend-item ref', 'best lap'),
    );
    const canvas = el('canvas');
    body.closest('.widget').classList.add('has-chart');
    body.append(legend, canvas);
    return { canvas, key: '' };
  },
  update(r, { tracker, theme }) {
    const ds = tracker.speedSeries();
    const count = ds ? ds.p.length : 0;
    const key = `${count}|${r.canvas.clientWidth}x${r.canvas.clientHeight}|${tracker.compareMode}|${tracker.cur?.n}`;
    if (key === r.key) return;
    r.key = key;
    const xMax = tracker.ref ? tracker.ref.length : 1000;
    const seen = ds ? ds.mine.concat(ds.theirs.filter((v) => v != null)) : [];
    const yMax = Math.max(20, ...seen) * 1.05;
    drawChart(r.canvas, ds ? [
      { x: ds.p, y: ds.theirs, color: theme.reference, width: 2, dash: [3, 4] },
      { x: ds.p, y: ds.mine, color: theme.current, width: 2 },
    ] : [], {
      theme, xMax, yMin: 0, yMax, vlines: tracker.splitsM(),
      xFormat: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`),
      yFormat: (v) => String(Math.round(v)),
      marker: ds && ds.mine.length ? { x: ds.p[ds.p.length - 1], y: ds.mine[ds.mine.length - 1], color: theme.current } : null,
    });
  },
};

const lastLap = {
  title: 'Last lap',
  build(body) {
    return valueAndSub(body, 'v-lg');
  },
  update(r, { tracker }) {
    const last = tracker.lastLap, best = tracker.bestLap;
    setText(r.value, last ? fmtLap(last.timeMs) : fmtLap(null));
    setClass(r.value, `v v-lg ${last ? '' : 'faint'}`);
    if (!last) setDeltaSub(r.sub, null);
    else if (!last.valid) { setText(r.sub, 'not counted'); setClass(r.sub, 'sub dim'); }
    else if (last === best) { setText(r.sub, 'best so far'); setClass(r.sub, 'sub best'); }
    else setDeltaSub(r.sub, best ? last.timeMs - best.timeMs : null);
  },
};

const bestLap = {
  title: 'Best lap',
  build(body) {
    return valueAndSub(body, 'v-lg best');
  },
  update(r, { tracker }) {
    const best = tracker.bestLap, theory = tracker.theoreticalBest();
    setText(r.value, best ? fmtLap(best.timeMs) : fmtLap(null));
    setClass(r.value, `v v-lg ${best ? 'best' : 'faint'}`);
    setText(r.sub, theory !== null ? `theoretical ${fmtLap(theory)}` : NBSP);
    setClass(r.sub, 'sub dim');
  },
};

const predicted = {
  title: 'Predicted',
  build(body) {
    return valueAndSub(body, 'v-lg accent');
  },
  update(r, { live }) {
    const has = live?.recording && live.predicted !== undefined;
    setText(r.value, has ? fmtLap(live.predicted) : fmtLap(null));
    setClass(r.value, `v v-lg ${has ? 'accent' : 'faint'}`);
    setDeltaSub(r.sub, has ? live.delta : null);
  },
};

const lapTable = {
  title: 'Laps',
  build(body) {
    const wrap = el('div', 'table-wrap');
    wrap.innerHTML = '<table><thead></thead><tbody></tbody></table>';
    body.append(wrap);
    return { thead: wrap.querySelector('thead'), tbody: wrap.querySelector('tbody'), key: '', liveRow: null };
  },
  update(r, { tracker, live, hideLiveRow }) {
    const n = tracker.sectorCount();
    const key = `${tracker.laps.length}|${n}|${tracker.splits.join(',')}|${tracker.bestLap?.id}`;
    if (r.key !== key) {
      r.key = key;
      const heads = ['Lap', ...Array.from({ length: n }, (_, i) => `S${i + 1}`), 'Time', 'Δ best'];
      r.thead.innerHTML = `<tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr>`;
      const best = tracker.bestLap, bestSec = tracker.bestSectors();
      const rows = tracker.laps.slice().reverse().map((lap) => {
        if (!lap.valid) {
          return `<tr class="invalid"><td>${lap.n}</td><td colspan="${n}">interrupted</td><td>${fmtLap(lap.timeMs)}</td><td>–</td></tr>`;
        }
        const cells = tracker.lapSectors(lap).map((s, i) => `<td class="${bestSec.laps[i] === lap ? 'best' : ''}">${fmtSector(s)}</td>`);
        const d = lap === best ? '–' : fmtDelta(lap.timeMs - best.timeMs);
        return `<tr><td>${lap.n}</td>${cells.join('')}<td class="${lap === best ? 'best' : ''}">${fmtLap(lap.timeMs)}</td><td>${d}</td></tr>`;
      });
      const liveRow = `<tr class="live"><td></td>${'<td></td>'.repeat(n)}<td></td><td></td></tr>`;
      r.tbody.innerHTML = liveRow + rows.join('');
      r.liveRow = r.tbody.querySelector('tr.live');
    }
    const row = r.liveRow;
    row.hidden = !!hideLiveRow || !live?.recording;
    const cells = row.children;
    const timing = live?.recording && tracker.ref;
    setText(cells[0], live ? `${live.n} ●` : '');   // the game's lap number, which differs from ours if we joined mid-session
    for (let i = 0; i < n; i++) setText(cells[i + 1], timing ? fmtSector(tracker.liveSectorTime(i)) : '');
    setText(cells[n + 1], live?.recording ? fmtLap(live.elapsed) : '');
    setText(cells[n + 2], live?.delta !== undefined ? fmtDelta(live.delta) : '');
  },
};

// ---- Driving -------------------------------------------------------------------------------

const RPM_LIGHTS = 12;   // shift-light segments shown once the widget is tall enough (design/Widget Responsive Behavior.dc.html, 2d)

const rpm = {
  title: 'RPM',
  noLabel: true,   // the label sits inline with the value; layout (and whether the bar/lights show) is CSS, by container size
  build(body) {
    const row = el('div', 'rpm-row');
    const label = el('div', 'w-label rpm-label', 'RPM');
    const value = el('div', 'v v-md accent rpm-value');
    const track = el('div', 'rpm-track');
    const fill = el('div', 'rpm-fill');
    const warn = el('div', 'rpm-mark');
    const limit = el('div', 'rpm-mark limit');
    track.append(fill, warn, limit);
    const lights = el('div', 'rpm-lights');
    for (let i = 0; i < RPM_LIGHTS; i++) lights.append(el('div', 'rpm-light'));
    row.append(label, value, track, lights);
    body.append(row);
    return { value, fill, warn, limit, lights: Array.from(lights.children) };
  },
  update(r, { frame }) {
    if (!frame || frame.rpm == null) {
      setText(r.value, DASH);
      r.fill.style.width = '0%';
      for (const light of r.lights) setClass(light, 'rpm-light');
      return;
    }
    const limiter = frame.rpmLimiter > 0 ? frame.rpmLimiter : 9000;
    const warnRpm = frame.rpmWarning > 0 ? frame.rpmWarning : limiter;
    const max = limiter * 1.08;
    // `revLimitAlert` is the game's own "actively bouncing off the limiter" bit; fall back to the
    // rpm/limiter threshold for cars or frames where that bit hasn't been confirmed reliable.
    const atLimit = frame.revLimitAlert || frame.rpm >= limiter * 0.98;
    const level = atLimit ? 'limit' : frame.rpm >= warnRpm ? 'warn' : '';
    setText(r.value, String(Math.round(frame.rpm)));
    setClass(r.fill, `rpm-fill ${level} ${frame.revLimitAlert ? 'flash' : ''}`);
    r.fill.style.width = `${Math.min(100, (frame.rpm / max) * 100).toFixed(1)}%`;
    r.warn.style.left = frame.rpmWarning > 0 ? `${((frame.rpmWarning / max) * 100).toFixed(1)}%` : '-10%';
    r.limit.style.left = `${((limiter / max) * 100).toFixed(1)}%`;
    // Each segment represents an equal slice of the same 0..max range as the bar; it lights up once
    // the rpm reaches its slice, in whichever zone (normal/warn/limit) that slice falls in.
    r.lights.forEach((light, i) => {
      const segStart = (i / RPM_LIGHTS) * max;
      const lit = frame.rpm >= segStart;
      const zone = segStart >= limiter * 0.98 ? 'limit' : segStart >= warnRpm ? 'warn' : '';
      setClass(light, `rpm-light ${lit ? 'lit' : ''} ${zone}`);
    });
  },
};

const gear = {
  title: 'Gear',
  build(body) {
    const value = el('div', 'v v-huge accent');
    const hint = el('div', 'gear-hint');
    body.classList.add('center');
    body.append(value, hint);
    return { value, hint };
  },
  update(r, { frame }) {
    if (!frame || frame.gear == null) {
      setText(r.value, DASH);
      setText(r.hint, NBSP);
      return;
    }
    // Zero is neutral; -1 is reverse (GT7 doesn't signal reverse directly, see bridge/frames.py).
    setText(r.value, frame.gear === 0 ? 'N' : frame.gear === -1 ? 'R' : String(frame.gear));
    const suggested = frame.suggestedGear;
    setText(r.hint, suggested > 0 && suggested !== frame.gear ? `→ ${suggested}` : NBSP);
  },
};

const speed = {
  title: 'Speed',
  build(body) {
    const row = el('div', 'speed-row');
    const value = el('div', 'v v-huge accent');
    const unit = el('div', 'unit', 'km/h');
    row.append(value, unit);
    body.classList.add('center');
    body.append(row);
    return { value };
  },
  update(r, { frame }) {
    setText(r.value, frame && frame.speed != null ? String(Math.round(frame.speed)) : DASH);
  },
};

/**
 * One pedal: a percentage, a bar and a short name, in whichever order/orientation the CSS puts
 * them (vertical bars by default, horizontal once the widget is too short for a tall bar to read -
 * see the container queries in style.css). The bar's fill is a CSS custom property, `--fill`, so
 * the same value drives its height in the vertical layout and its width in the horizontal one.
 */
function makePedal(name, kind) {
  const node = el('div', `pedal ${kind}`);
  const pct = el('div', `pedal-pct ${kind}`);
  const track = el('div', 'pedal-track');
  const fill = el('div', `pedal-fill ${kind}`);
  track.append(fill);
  node.append(pct, track, el('div', 'pedal-name', name));
  return { node, pct, fill };
}

const pedals = {
  title: 'Pedals',
  build(body) {
    const row = el('div', 'pedal-row');
    const clu = makePedal('CLU', 'clutch');
    const brk = makePedal('BRK', 'brake');
    const thr = makePedal('THR', 'throttle');
    row.append(clu.node, brk.node, thr.node);
    body.append(row);
    return { clu, brk, thr };
  },
  update(r, { frame }) {
    for (const [pedal, value] of [[r.clu, frame?.clutch], [r.brk, frame?.brake], [r.thr, frame?.throttle]]) {
      const v = value == null ? 0 : Math.max(0, Math.min(100, value));
      setText(pedal.pct, value == null ? DASH : `${Math.round(v)}%`);
      pedal.fill.style.setProperty('--fill', `${Math.max(v, 2).toFixed(1)}%`);
      pedal.fill.classList.toggle('idle', v < 3);
    }
  },
};

// Colour per temperature zone (D26 in DECISIONS.md; thresholds in tyre-color.js).
const ZONE_COLOR = { cold: 'var(--accent)', optimal: 'var(--good)', hot: 'var(--amber)', overheating: 'var(--bad)' };

/**
 * One corner's tyre + brake caliper (design/Widget Responsive Behavior.dc.html, 1a/1b). `mirrored`
 * puts the caliper on the other side, so the right-side corners' calipers face the car's centreline
 * like the left-side ones - a CSS class, not a different DOM order.
 */
function makeTyreCorner(mirrored) {
  const node = el('div', `tyre-corner${mirrored ? ' mirrored' : ''}`);
  const tyre = el('div', 'tyre');
  const temp = el('div', 'tyre-temp');
  tyre.append(temp);
  const caliper = el('div', 'caliper');
  node.append(tyre, caliper);
  return { node, tyre, temp, caliper };
}

const tyres = {
  title: 'Tyres',
  build(body) {
    const grid = el('div', 'tyre-grid');
    const fl = makeTyreCorner(false);
    const fr = makeTyreCorner(true);
    const rl = makeTyreCorner(false);
    const rr = makeTyreCorner(true);
    grid.append(fl.node, fr.node, rl.node, rr.node);
    body.append(grid);
    return { corners: [fl, fr, rl, rr] };   // order matches tyreTemp: FL, FR, RL, RR
  },
  update(r, { frame }) {
    const temps = frame?.tyreTemp;
    r.corners.forEach((c, i) => {
      const t = temps ? temps[i] : null;
      const zone = tyreZone(t);
      const color = zone ? ZONE_COLOR[zone] : 'var(--line)';
      c.tyre.style.background = color;
      c.caliper.style.background = color;
      setText(c.temp, t == null ? DASH : `${Math.round(t)}°`);
      setClass(c.temp, `tyre-temp${zone ? '' : ' dim'}`);
    });
  },
};

export const WIDGETS = {
  currentLap, delta, sectors, deltaChart, speedChart, lastLap, bestLap, predicted, lapTable,
  rpm, gear, speed, pedals, tyres,
};
