// Page wiring: loads the demo, feeds its frames to the LapTracker, and renders the readouts,
// sector cards, charts and lap table from the tracker's state.
//
// All timing logic lives in timing.js; this file only reads it and updates the DOM.

import { LapTracker } from './timing.js';
import { DemoSource } from './demo-source.js';
import { drawChart, readTheme } from './charts.js';
import { fmtLap, fmtSector, fmtDelta } from './format.js';

const $ = (id) => document.getElementById(id);
const el = {
  play: $('playBtn'), restart: $('restartBtn'), speed: $('speedSel'), compare: $('compareSel'),
  status: $('status'),
  curTime: $('curTime'), curSub: $('curSub'), delta: $('delta'), deltaSub: $('deltaSub'),
  predicted: $('predicted'), lastLap: $('lastLap'), lastSub: $('lastSub'), bestLap: $('bestLap'), bestSub: $('bestSub'),
  sectors: $('sectors'), refName: $('refName'),
  speedChart: $('speedChart'), deltaChart: $('deltaChart'),
  lapHead: $('lapHead'), lapBody: $('lapBody'), lapEmpty: $('lapEmpty'),
};

const DEMO_HISTORY_LAPS = 3;   // open the demo with laps 1-2 already driven
const tracker = new LapTracker();
let source = null;
let paused = false;
let theme = readTheme();

/** Set an element's text only if it changed, so a per-frame render doesn't rewrite the DOM needlessly. */
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
/** Set an element's class only if it changed (same reason as `setText`). */
const setClass = (node, cls) => { if (node.className !== cls) node.className = cls; };
/** CSS class for a delta in ms: faster (negative) is good, slower (positive) is bad. */
const deltaClass = (ms) => (ms == null ? '' : ms < 0 ? 'good' : ms > 0 ? 'bad' : '');

// ---- session control -------------------------------------------------------

/**
 * Start (or restart) the demo session, with the first laps already driven so deltas show at once.
 *
 * Resets the tracker and the source, then replays the opening laps instantly rather than in real time.
 */
function startSession() {
  tracker.reset();
  source.reset();
  source.feedUntilLap(DEMO_HISTORY_LAPS, (f) => tracker.ingest(f));
  paused = false;
  layout.key = '';
}

/** Set the play button's label from the current state: Replay when finished, else Play/Pause. */
function updateControls() {
  el.play.textContent = source.done ? 'Replay' : paused ? 'Play' : 'Pause';
}

el.play.addEventListener('click', () => {
  if (source.done) startSession(); else paused = !paused;
  updateControls();
});
el.restart.addEventListener('click', () => { startSession(); updateControls(); });
el.compare.addEventListener('change', () => {
  tracker.setCompareMode(el.compare.value);
  setText(el.refName, el.compare.value === 'last' ? 'Last lap' : 'Best lap');
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { theme = readTheme(); });

// ---- rendering -------------------------------------------------------------

// What the lap table and sector cards were last built for; they're rebuilt only when it changes.
const layout = { key: '' };

/** Show a one-line status: what the tracker is doing, or why timing isn't running. */
function renderStatus(live) {
  let text;
  if (source.done) text = 'Demo finished. Press Replay to watch it again.';
  else if (tracker.hold) text = `Timing held (${tracker.hold}). This lap won't count towards best times.`;
  else if (!live) text = '';
  else if (!live.recording) text = 'Waiting for the start/finish line before timing begins…';
  else if (live.referenceLap) text = `Lap ${live.n}: recording the reference lap. Sectors and deltas start next lap.`;
  else text = `Lap ${live.n} · Sector ${live.sector + 1} of ${tracker.sectorCount()}`;
  setText(el.status, text);
}

/** Fill the top readouts: current lap, delta, predicted lap, last lap and best lap. */
function renderReadouts(live) {
  const best = tracker.bestLap, last = tracker.lastLap;
  const timing = live?.recording;
  setText(el.curTime, timing ? fmtLap(live.elapsed) : fmtLap(null));
  setText(el.curSub, timing ? `Lap ${live.n}` : ' ');

  const hasDelta = timing && live.delta !== undefined;
  setText(el.delta, hasDelta ? fmtDelta(live.delta) : fmtDelta(null));
  setClass(el.delta, `value big ${hasDelta ? deltaClass(live.delta) : ''}`);
  setText(el.deltaSub, hasDelta ? `vs ${tracker.compareMode === 'last' ? 'last' : 'best'} lap` : ' ');
  setText(el.predicted, hasDelta ? fmtLap(live.predicted) : fmtLap(null));

  setText(el.lastLap, fmtLap(last?.timeMs));
  setText(el.lastSub, !last ? ' ' : !last.valid ? 'Not counted (interrupted)'
    : best ? (last === best ? 'Best so far' : fmtDelta(last.timeMs - best.timeMs) + ' vs best') : ' ');
  setText(el.bestLap, fmtLap(best?.timeMs));
  const theory = tracker.theoreticalBest();
  setText(el.bestSub, theory !== null ? `Theoretical ${fmtLap(theory)}` : ' ');
}

/** Create one card per sector; called when the number of sectors changes. */
function buildSectorCards() {
  const n = tracker.sectorCount();
  el.sectors.replaceChildren();
  for (let i = 0; i < n; i++) {
    const card = document.createElement('div');
    card.className = 'panel sector';
    card.innerHTML = `
      <div class="row"><span class="label">Sector ${i + 1}</span><span class="small" data-r="state"></span></div>
      <div class="value" data-r="time">––.–––</div>
      <div class="row small"><span>vs best sector</span><span data-r="dBest">–</span></div>
      <div class="row small"><span>vs last lap</span><span data-r="dLast">–</span></div>
      <div class="row small"><span>Best</span><span data-r="best">–</span></div>`;
    el.sectors.append(card);
  }
}

/**
 * Update each sector card: this lap's time, deltas versus the best sector and the last lap, and the best time.
 *
 * A sector is 'now' while the car is in it and 'done' once passed; later sectors stay blank.
 */
function renderSectors(live) {
  const n = tracker.sectorCount();
  const bestSec = tracker.bestSectors();
  const last = tracker.lastValidLap;
  const showLive = live?.recording && tracker.ref;
  [...el.sectors.children].forEach((card, i) => {
    const r = (name) => card.querySelector(`[data-r="${name}"]`);
    const done = showLive && live.sector > i, current = showLive && live.sector === i;
    setClass(card, `panel sector ${current ? 'current' : done ? 'done' : ''}`);
    setText(r('state'), current ? 'now' : done ? 'done' : '');
    setText(r('time'), showLive ? fmtSector(tracker.liveSectorTime(i)) : fmtSector(null));

    const dBest = showLive ? tracker.sectorDelta(i, bestSec.laps[i]) : null;
    const dLast = showLive ? tracker.sectorDelta(i, last) : null;
    setText(r('dBest'), dBest == null ? '–' : fmtDelta(dBest));
    setClass(r('dBest'), deltaClass(dBest));
    setText(r('dLast'), dLast == null ? '–' : fmtDelta(dLast));
    setClass(r('dLast'), deltaClass(dLast));
    const b = bestSec.times[i];
    setText(r('best'), b == null ? '–' : `${fmtSector(b)} (lap ${bestSec.laps[i].id})`);
  });
  return n;
}

/**
 * Draw the speed and delta charts for the current lap against the comparison lap.
 *
 * Both share one x-axis (distance around the lap) and show the sector splits as dashed lines.
 */
function renderCharts(live) {
  const ref = tracker.ref;
  const cur = tracker.cur;
  const cmp = tracker.compareLap();
  const recording = cur?.recording;
  const lastP = recording ? cur.p[cur.p.length - 1] : 0;
  const xMax = ref ? ref.length : Math.max(1000, Math.ceil(lastP / 500) * 500);
  const vlines = tracker.splitsM();
  const xFormat = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`);

  const peak = Math.max(cur?.speed?.length ? Math.max(...cur.speed) : 0, cmp ? Math.max(...cmp.speed) : 0, 100);
  const series = [];
  if (cmp) series.push({ x: cmp.p, y: cmp.speed, color: theme.reference, width: 1.5, dash: [5, 4] });
  if (recording) series.push({ x: cur.p, y: cur.speed, color: theme.current, width: 2 });
  drawChart(el.speedChart, series, {
    theme, xMax, yMin: 0, yMax: Math.ceil((peak * 1.05) / 50) * 50, vlines, xFormat,
    yFormat: (v) => String(Math.round(v)),
    marker: recording ? { x: lastP, y: cur.speed[cur.speed.length - 1], color: theme.current } : null,
  });

  const ds = tracker.deltaSeries();
  const seconds = ds ? ds.d.map((v) => v / 1000) : [];
  const span = Math.max(0.25, ...seconds.map(Math.abs));
  const half = Math.ceil(span / 0.25) * 0.25;
  drawChart(el.deltaChart, ds ? [{ x: ds.p, y: seconds, color: theme.current, width: 2 }] : [], {
    theme, xMax, yMin: -half, yMax: half, vlines, zero: true, xFormat,
    yFormat: (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2),
    marker: ds && seconds.length ? { x: ds.p[ds.p.length - 1], y: seconds[seconds.length - 1], color: theme.current } : null,
  });
}

/**
 * Render the lap table: completed laps (newest first) under a live row for the lap in progress.
 *
 * The completed rows are rebuilt only when the laps, splits or best lap change; the live row's
 * cells are updated in place every frame.
 */
function renderTable(live) {
  const n = tracker.sectorCount();
  const key = `${tracker.laps.length}|${n}|${tracker.splits.join(',')}|${tracker.bestLap?.id}`;
  if (layout.key !== key) {
    layout.key = key;
    buildSectorCards();
    const heads = ['Lap', ...Array.from({ length: n }, (_, i) => `S${i + 1}`), 'Time', 'Δ best'];
    el.lapHead.innerHTML = `<tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr>`;
    const best = tracker.bestLap, bestSec = tracker.bestSectors();
    const rows = tracker.laps.slice().reverse().map((lap) => {
      if (!lap.valid) {
        // Interrupted lap: shown for the record, with no sector times and no best highlighting.
        return `<tr class="invalid"><td>${lap.id}</td><td colspan="${n}">interrupted (paused / loading / off track)</td><td>${fmtLap(lap.timeMs)}</td><td>–</td></tr>`;
      }
      const secs = tracker.lapSectors(lap);
      const cells = secs.map((s, i) => `<td class="${bestSec.laps[i] === lap ? 'best' : ''}">${fmtSector(s)}</td>`);
      const dBest = lap === best ? '–' : fmtDelta(lap.timeMs - best.timeMs);
      return `<tr><td>${lap.id}</td>${cells.join('')}<td class="${lap === best ? 'best' : ''}">${fmtLap(lap.timeMs)}</td><td>${dBest}</td></tr>`;
    });
    // Row 0 is the live lap; its cells are updated in place below.
    const liveRow = `<tr class="live" id="liveRow"><td>${tracker.laps.length + 1} ●</td>${'<td></td>'.repeat(n)}<td></td><td></td></tr>`;
    el.lapBody.innerHTML = liveRow + rows.join('');
    el.lapEmpty.hidden = tracker.laps.length > 0;
  }
  const liveRow = $('liveRow');
  if (!liveRow) return;
  liveRow.hidden = source.done;   // the demo's closing frame opens a lap that never runs
  const cells = liveRow.children;
  const timing = live?.recording && tracker.ref;
  for (let i = 0; i < n; i++) setText(cells[i + 1], timing ? fmtSector(tracker.liveSectorTime(i)) : '');
  setText(cells[n + 1], live?.recording ? fmtLap(live.elapsed) : '');
  setText(cells[n + 2], live?.delta !== undefined ? fmtDelta(live.delta) : '');
}

/** Render everything from the tracker's current state. Cheap enough to call on every animation frame. */
function render() {
  const live = tracker.live;
  renderStatus(live);
  renderReadouts(live);
  renderTable(live);
  renderSectors(live);
  renderCharts(live);
  updateControls();
}

// ---- main loop -------------------------------------------------------------

let lastNow = performance.now();
/** One animation frame: advance the demo by real elapsed time, then render. */
function tick(now) {
  const dt = Math.min(now - lastNow, 100);   // a backgrounded tab must not fast-forward the demo
  lastNow = now;
  if (!paused && !source.done) source.advance(dt, Number(el.speed.value), (f) => tracker.ingest(f));
  render();
  requestAnimationFrame(tick);
}

/** Load the demo data and start the session; shows a helpful message if the data can't be fetched. */
async function main() {
  try {
    const res = await fetch('demo-laps.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    source = new DemoSource(await res.json());
  } catch (err) {
    setText(el.status, `Could not load the demo data (${err.message}). If you opened index.html directly, serve the folder over http instead.`);
    return;
  }
  startSession();
  requestAnimationFrame(tick);
}

main();
