// The dashboard's widgets: one definition per widget, each building its own DOM once and then
// updating it from shared state.
//
// A definition is { title, build(body) -> refs, update(refs, ctx), onTap?(ctx), noLabel? }. The page
// creates a card for each widget in the layout, calls `build` once, then `update` on every render.
// `ctx` carries everything a widget may read: the lap tracker, its live state, the latest frame
// (null before any arrives), the theme colours, and a few page flags. Widgets never talk to each
// other or to the data source, which is what will let them be added, removed and moved later.

import { drawChart } from './charts.js';
import { deltaClass, el, setClass, setText, svgEl } from './dom.js';
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

// The gauge variant (design/Widget Responsive Behavior.dc.html, Delta "D — Compact gauge") has no
// natural max delta to scale against, so its bar clamps to this range either way.
const DELTA_GAUGE_RANGE_MS = 1500;

const delta = {
  title: 'Delta',
  build(body) {
    const minimalWrap = el('div', 'delta-minimal');
    const minimalRow = el('div', 'delta-minimal-row');
    const value = el('div', 'v v-xl dim');
    const chip = el('span', 'chip');
    minimalRow.append(value, chip);
    const sub = el('div', 'sub');
    minimalWrap.append(minimalRow, sub);

    const gaugeWrap = el('div', 'delta-gauge');
    const gaugeHead = el('div', 'delta-gauge-head');
    const gaugeLabel = el('div', 'delta-gauge-label');
    const gaugeValue = el('div', 'delta-gauge-value');
    gaugeHead.append(gaugeLabel, gaugeValue);
    const gaugeTrack = el('div', 'delta-gauge-track');
    const gaugeFill = el('div', 'delta-gauge-fill');
    gaugeTrack.append(gaugeFill);
    gaugeWrap.append(gaugeHead, gaugeTrack);

    body.append(minimalWrap, gaugeWrap);
    return { value, chip, sub, gaugeLabel, gaugeValue, gaugeFill };
  },
  update(r, { live, tracker }) {
    const has = live?.recording && live.delta !== undefined;
    const against = tracker.compareMode === 'last' ? 'LAST' : 'BEST';

    setText(r.value, has ? fmtDelta(live.delta) : DASH);
    setClass(r.value, `v v-xl ${has ? deltaClass(live.delta) : 'dim'}`);
    setText(r.chip, `vs ${against}`);
    setClass(r.chip, `chip ${has ? deltaClass(live.delta) : ''}`);
    setText(r.sub, has ? NBSP : live?.referenceLap ? 'recording reference lap' : 'no data');

    setText(r.gaugeLabel, `Delta · vs ${against[0]}${against.slice(1).toLowerCase()}`);
    setText(r.gaugeValue, has ? fmtDelta(live.delta) : DASH);
    setClass(r.gaugeValue, `delta-gauge-value ${has ? deltaClass(live.delta) : 'dim'}`);
    const frac = has ? Math.max(-1, Math.min(1, live.delta / DELTA_GAUGE_RANGE_MS)) * 50 : 0;
    r.gaugeFill.style.left = `${50 - Math.max(0, -frac)}%`;
    r.gaugeFill.style.width = `${Math.abs(frac)}%`;
    setClass(r.gaugeFill, `delta-gauge-fill ${has ? deltaClass(live.delta) : ''}`);
  },
  onTap({ tracker }) {
    tracker.setCompareMode(tracker.compareMode === 'best' ? 'last' : 'best');
  },
};

/** One sector card for the 'segments' variant: its label, this lap's time in it, and the delta. */
function makeSegmentCard() {
  const node = el('div', 'sector');
  const label = el('div', 'sector-label');
  const time = el('div', 'v v-md');
  const deltaLine = el('div', 'sector-delta');
  node.append(label, time, deltaLine);
  return { node, label, time, delta: deltaLine };
}

/** One row for the 'list' variant: label, time and delta inline. */
function makeSectorListRow() {
  const node = el('div', 'sector-list-row');
  const label = el('span', 'sector-list-label');
  const time = el('span', 'sector-list-time');
  const deltaLine = el('span', 'sector-list-delta');
  node.append(label, time, deltaLine);
  return { node, label, time, delta: deltaLine };
}

/** One chip for the 'chips' variant: label and delta only, no absolute time. */
function makeSectorChip() {
  const node = el('div', 'sector-chip');
  const label = el('span', 'sector-chip-label');
  const deltaLine = el('span', 'sector-chip-delta');
  node.append(label, deltaLine);
  return { node, label, delta: deltaLine };
}

/** One block for the 'fill' variant: label+delta, time, and a bar showing progress through the sector. */
function makeSectorFillCard() {
  const node = el('div', 'sector-fill-card');
  const head = el('div', 'sector-fill-head');
  const label = el('span', 'sector-fill-label');
  const deltaLine = el('span', 'sector-fill-delta');
  head.append(label, deltaLine);
  const time = el('div', 'v v-md');
  const track = el('div', 'sector-fill-track');
  const bar = el('div', 'sector-fill-bar');
  track.append(bar);
  node.append(head, time, track);
  return { node, label, time, delta: deltaLine, bar };
}

const sectors = {
  title: 'Sectors',
  build(body) {
    const segmentsRow = el('div', 'sector-row sectors-segments');
    const listCol = el('div', 'sector-list sectors-list');
    const chipsRow = el('div', 'sector-chips sectors-chips');
    const fillCol = el('div', 'sector-fill-row sectors-fill');
    body.append(segmentsRow, listCol, chipsRow, fillCol);
    return { segmentsRow, listCol, chipsRow, fillCol, segments: [], list: [], chips: [], fills: [], count: 0 };
  },
  update(r, { tracker, live }) {
    const n = tracker.sectorCount();
    if (r.count !== n) {
      r.segmentsRow.replaceChildren();
      r.segments = Array.from({ length: n }, makeSegmentCard);
      r.segments.forEach((c) => r.segmentsRow.append(c.node));
      r.listCol.replaceChildren();
      r.list = Array.from({ length: n }, makeSectorListRow);
      r.list.forEach((c) => r.listCol.append(c.node));
      r.chipsRow.replaceChildren();
      r.chips = Array.from({ length: n }, makeSectorChip);
      r.chips.forEach((c) => r.chipsRow.append(c.node));
      r.fillCol.replaceChildren();
      r.fills = Array.from({ length: n }, makeSectorFillCard);
      r.fills.forEach((c) => r.fillCol.append(c.node));
      r.count = n;
    }
    const best = tracker.bestSectors();
    const showLive = live?.recording && tracker.ref;
    const cuts = showLive ? [0, ...tracker.splitsM(), tracker.ref.length] : null;
    for (let i = 0; i < n; i++) {
      const done = showLive && live.sector > i;
      const current = showLive && live.sector === i;
      const state = current ? 'current' : done ? 'done' : '';
      const label = `S${i + 1}${current ? ' · LIVE' : done ? ' · DONE' : ''}`;
      const t = showLive ? tracker.liveSectorTime(i) : null;
      const timeText = t == null ? '––.–––' : fmtSector(t);
      const d = showLive ? tracker.sectorDelta(i, best.laps[i]) : null;
      const dText = d == null ? NBSP : fmtDelta(d);
      const dCls = deltaClass(d);
      const fraction = !showLive ? 0 : done ? 1 : current ? Math.max(0, Math.min(1, (live.p - cuts[i]) / (cuts[i + 1] - cuts[i]))) : 0;

      const seg = r.segments[i];
      setClass(seg.node, `sector ${state}`);
      setText(seg.label, label);
      setText(seg.time, timeText);
      setClass(seg.time, `v v-md ${t == null ? 'faint' : current ? 'accent' : ''}`);
      setText(seg.delta, dText);
      setClass(seg.delta, `sector-delta ${dCls}`);

      const row = r.list[i];
      setClass(row.node, `sector-list-row ${state}`);
      setText(row.label, `S${i + 1}`);
      setText(row.time, timeText);
      setClass(row.time, `sector-list-time ${t == null ? 'faint' : current ? 'accent' : ''}`);
      setText(row.delta, dText);
      setClass(row.delta, `sector-list-delta ${dCls}`);

      const chip = r.chips[i];
      setClass(chip.node, `sector-chip ${state}`);
      setText(chip.label, `S${i + 1}`);
      setText(chip.delta, dText);
      setClass(chip.delta, `sector-chip-delta ${dCls}`);

      const fc = r.fills[i];
      setClass(fc.node, `sector-fill-card ${state}`);
      setText(fc.label, label);
      setText(fc.delta, dText);
      setClass(fc.delta, `sector-fill-delta ${dCls}`);
      setText(fc.time, timeText);
      setClass(fc.time, `v v-md ${t == null ? 'faint' : current ? 'accent' : ''}`);
      fc.bar.style.setProperty('--fill', `${(fraction * 100).toFixed(1)}%`);
    }
  },
};

const deltaChart = {
  title: 'Delta over lap',
  build(body) {
    const note = el('div', 'chart-note', 'above zero = slower');
    const readout = el('div', 'chart-readout v v-md dim');
    const canvas = el('canvas');
    body.closest('.widget').classList.add('has-chart');
    body.append(note, readout, canvas);
    return { canvas, readout, key: '' };
  },
  update(r, { tracker, theme, live }) {
    const has = live?.recording && live.delta !== undefined;
    setText(r.readout, has ? fmtDelta(live.delta) : DASH);
    setClass(r.readout, `chart-readout v v-md ${has ? deltaClass(live.delta) : 'dim'}`);

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
    drawChart(r.canvas, ds ? [{ x: ds.p, y: seconds, signColors: { neg: theme.good, pos: theme.bad }, fill: true, width: 2 }] : [], {
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

/** The most recent valid lap before `lap`, or null (used by the 'dual' Last Lap variant). */
function previousValidLap(tracker, lap) {
  if (!lap) return null;
  const idx = tracker.laps.indexOf(lap);
  for (let i = idx - 1; i >= 0; i--) if (tracker.laps[i].valid) return tracker.laps[i];
  return null;
}

const lastLap = {
  title: 'Last lap',
  build(body) {
    const stackedWrap = el('div', 'lastlap-stacked');
    const { value: stackedValue, sub: stackedSub } = valueAndSub(stackedWrap, 'v-lg');

    const rowWrap = el('div', 'lastlap-row');
    const rowValue = el('div', 'v v-lg');
    const rowDelta = el('div', 'lastlap-row-delta');
    rowWrap.append(rowValue, rowDelta);

    const dualWrap = el('div', 'lastlap-dual');
    const dualValue = el('div', 'v v-lg');
    const dualRows = el('div', 'lastlap-dual-rows');
    const bestRow = el('div', 'lastlap-dual-row');
    bestRow.append(el('span', 'lastlap-dual-label', 'vs best'), el('span', 'lastlap-dual-value'));
    const prevRow = el('div', 'lastlap-dual-row');
    prevRow.append(el('span', 'lastlap-dual-label', 'vs previous'), el('span', 'lastlap-dual-value'));
    dualRows.append(bestRow, prevRow);
    dualWrap.append(dualValue, dualRows);

    const trendWrap = el('div', 'lastlap-trend');
    const trendArrow = el('div', 'lastlap-trend-arrow');
    const trendCol = el('div', 'lastlap-trend-col');
    const trendDelta = el('div', 'lastlap-trend-delta');
    const trendValue = el('div', 'v v-lg');
    trendCol.append(trendDelta, trendValue);
    trendWrap.append(trendArrow, trendCol);

    body.append(stackedWrap, rowWrap, dualWrap, trendWrap);
    return {
      stackedValue, stackedSub, rowValue, rowDelta, dualValue,
      bestValue: bestRow.lastChild, prevValue: prevRow.lastChild,
      trendArrow, trendDelta, trendValue,
    };
  },
  update(r, { tracker }) {
    const last = tracker.lastLap, best = tracker.bestLap;
    const notCounted = !!last && !last.valid;
    const isBest = !!last && last === best;
    const deltaMs = last && best && !notCounted && !isBest ? last.timeMs - best.timeMs : null;
    const text = last ? fmtLap(last.timeMs) : fmtLap(null);
    const cls = `v v-lg ${last ? '' : 'faint'}`;
    const deltaText = !last ? NBSP : notCounted ? '—' : isBest ? 'best' : fmtDelta(deltaMs);
    const deltaCls = notCounted ? 'dim' : isBest ? 'best' : deltaClass(deltaMs);

    setText(r.stackedValue, text);
    setClass(r.stackedValue, cls);
    if (!last) setDeltaSub(r.stackedSub, null);
    else if (notCounted) { setText(r.stackedSub, 'not counted'); setClass(r.stackedSub, 'sub dim'); }
    else if (isBest) { setText(r.stackedSub, 'best so far'); setClass(r.stackedSub, 'sub best'); }
    else setDeltaSub(r.stackedSub, deltaMs);

    setText(r.rowValue, text);
    setClass(r.rowValue, cls);
    setText(r.rowDelta, deltaText);
    setClass(r.rowDelta, `lastlap-row-delta ${deltaCls}`);

    setText(r.dualValue, text);
    setClass(r.dualValue, cls);
    setText(r.bestValue, deltaText);
    setClass(r.bestValue, `lastlap-dual-value ${deltaCls}`);
    const prev = previousValidLap(tracker, last);
    const prevMs = last && prev && !notCounted ? last.timeMs - prev.timeMs : null;
    setText(r.prevValue, !last ? NBSP : notCounted ? '—' : prev ? fmtDelta(prevMs) : '—');
    setClass(r.prevValue, `lastlap-dual-value ${deltaClass(prevMs)}`);

    const arrow = !last || notCounted || deltaMs == null ? '–' : deltaMs > 0 ? '▲' : deltaMs < 0 ? '▼' : '–';
    setText(r.trendArrow, arrow);
    setClass(r.trendArrow, `lastlap-trend-arrow ${notCounted ? 'dim' : isBest ? 'best' : deltaClass(deltaMs)}`);
    setText(r.trendDelta, deltaText);
    setClass(r.trendDelta, `lastlap-trend-delta ${deltaCls}`);
    setText(r.trendValue, text);
    setClass(r.trendValue, cls);
  },
};

const bestLap = {
  title: 'Best lap',
  build(body) {
    const minimalWrap = el('div', 'bestlap-minimal');
    const { value: minimalValue, sub: minimalSub } = valueAndSub(minimalWrap, 'v-lg best');

    const lapNumWrap = el('div', 'bestlap-lapnum');
    const lapNumHead = el('div', 'bestlap-lapnum-head');
    const lapNumChip = el('span', 'chip best');
    lapNumHead.append(lapNumChip);
    const lapNumValue = el('div', 'v v-lg best');
    lapNumWrap.append(lapNumHead, lapNumValue);

    const sectorWrap = el('div', 'bestlap-sectors');
    const sectorHead = el('div', 'bestlap-sectors-head');
    const sectorValue = el('div', 'v v-lg best');
    const sectorRow = el('div', 'bestlap-sectors-row');
    sectorWrap.append(sectorHead, sectorValue, sectorRow);

    const wideWrap = el('div', 'bestlap-wide');
    const wideValue = el('div', 'v v-lg best');
    wideWrap.append(wideValue);

    body.append(minimalWrap, lapNumWrap, sectorWrap, wideWrap);
    return {
      minimalValue, minimalSub, lapNumChip, lapNumValue,
      sectorHead, sectorValue, sectorRow, sectorCards: [], sectorCount: 0,
      wideValue,
    };
  },
  update(r, { tracker }) {
    const best = tracker.bestLap, theory = tracker.theoreticalBest();
    const text = best ? fmtLap(best.timeMs) : fmtLap(null);
    const cls = `v v-lg ${best ? 'best' : 'faint'}`;

    setText(r.minimalValue, text);
    setClass(r.minimalValue, cls);
    setText(r.minimalSub, theory !== null ? `theoretical ${fmtLap(theory)}` : NBSP);
    setClass(r.minimalSub, 'sub dim');

    setText(r.lapNumChip, best ? `LAP ${best.n}` : NBSP);
    setText(r.lapNumValue, text);
    setClass(r.lapNumValue, cls);

    setText(r.sectorHead, best ? `Lap ${best.n}` : NBSP);
    setText(r.sectorValue, text);
    setClass(r.sectorValue, cls);
    const n = tracker.sectorCount();
    if (r.sectorCount !== n) {
      r.sectorRow.replaceChildren();
      r.sectorCards = Array.from({ length: n }, () => {
        const node = el('div', 'bestlap-sector');
        const label = el('div', 'bestlap-sector-label');
        const value = el('div', 'bestlap-sector-value');
        node.append(label, value);
        return { node, label, value };
      });
      r.sectorCards.forEach((c) => r.sectorRow.append(c.node));
      r.sectorRow.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
      r.sectorCount = n;
    }
    const secs = best ? tracker.lapSectors(best) : [];
    r.sectorCards.forEach((c, i) => {
      setText(c.label, `S${i + 1}`);
      setText(c.value, secs[i] != null ? fmtSector(secs[i]) : '––.–––');
    });

    setText(r.wideValue, text);
    setClass(r.wideValue, cls);
  },
};

const predicted = {
  title: 'Predicted',
  build(body) {
    const stackedWrap = el('div', 'predicted-stacked');
    const { value: stackedValue, sub: stackedSub } = valueAndSub(stackedWrap, 'v-lg accent');

    const basisWrap = el('div', 'predicted-basis');
    const basisValue = el('div', 'v v-lg accent');
    const basisRow = el('div', 'predicted-basis-row');
    const basisDelta = el('span', 'predicted-basis-delta');
    const basisNote = el('span', 'predicted-basis-note');
    basisRow.append(basisDelta, basisNote);
    basisWrap.append(basisValue, basisRow);

    const rangeWrap = el('div', 'predicted-range');
    const rangeHead = el('div', 'predicted-range-head');
    const rangeDelta = el('span', 'predicted-range-delta');
    rangeHead.append(rangeDelta);
    const rangeValue = el('div', 'v v-lg accent');
    const rangeTrack = el('div', 'predicted-range-track');
    const rangeFill = el('div', 'predicted-range-fill');
    const rangeMarker = el('div', 'predicted-range-marker');
    rangeTrack.append(rangeFill, rangeMarker);
    const rangeLabels = el('div', 'predicted-range-labels');
    const rangeBest = el('span');
    const rangeWorst = el('span');
    rangeLabels.append(rangeBest, rangeWorst);
    rangeWrap.append(rangeHead, rangeValue, rangeTrack, rangeLabels);

    const compactWrap = el('div', 'predicted-compact');
    const compactValue = el('div', 'v v-lg');
    compactWrap.append(compactValue);

    body.append(stackedWrap, basisWrap, rangeWrap, compactWrap);
    return {
      stackedValue, stackedSub, basisValue, basisDelta, basisNote,
      rangeDelta, rangeValue, rangeFill, rangeMarker, rangeBest, rangeWorst,
      compactValue,
    };
  },
  update(r, { live, tracker }) {
    const has = live?.recording && live.predicted !== undefined;
    const text = has ? fmtLap(live.predicted) : fmtLap(null);
    const cls = `v v-lg ${has ? 'accent' : 'faint'}`;
    const deltaText = has ? fmtDelta(live.delta) : DASH;
    const deltaCls = has ? deltaClass(live.delta) : 'dim';

    setText(r.stackedValue, text);
    setClass(r.stackedValue, cls);
    setDeltaSub(r.stackedSub, has ? live.delta : null);

    setText(r.basisValue, text);
    setClass(r.basisValue, cls);
    setText(r.basisDelta, deltaText);
    setClass(r.basisDelta, `predicted-basis-delta ${deltaCls}`);
    const doneThrough = has ? live.sector : 0;
    const basisText = !has ? NBSP : doneThrough <= 0 ? 'based on partial lap' : doneThrough === 1 ? 'based on S1' : `based on S1–S${doneThrough}`;
    setText(r.basisNote, basisText);

    setText(r.rangeDelta, deltaText);
    setClass(r.rangeDelta, `predicted-range-delta ${deltaCls}`);
    setText(r.rangeValue, text);
    setClass(r.rangeValue, cls);
    const best = tracker.bestLap, worst = tracker.worstLap;
    const hasRange = has && best && worst && worst.timeMs > best.timeMs;
    if (hasRange) {
      const frac = Math.max(0, Math.min(1, (live.predicted - best.timeMs) / (worst.timeMs - best.timeMs)));
      r.rangeFill.style.width = `${(frac * 100).toFixed(1)}%`;
      r.rangeMarker.style.left = `${(frac * 100).toFixed(1)}%`;
    }
    r.rangeFill.style.visibility = hasRange ? 'visible' : 'hidden';
    r.rangeMarker.style.visibility = hasRange ? 'visible' : 'hidden';
    setText(r.rangeBest, best ? `best ${fmtLap(best.timeMs)}` : NBSP);
    setText(r.rangeWorst, worst ? `worst ${fmtLap(worst.timeMs)}` : NBSP);

    setText(r.compactValue, text);
    setClass(r.compactValue, `v v-lg ${has ? '' : 'faint'}`);
  },
};

/** Lap Table row markup for the 'table' variant (unchanged from before variants existed). */
function tableRowHtml(lap, tracker, n, best, bestSec) {
  if (!lap.valid) {
    return `<tr class="invalid"><td>${lap.n}</td><td colspan="${n}">interrupted</td><td>${fmtLap(lap.timeMs)}</td><td>–</td></tr>`;
  }
  const cells = tracker.lapSectors(lap).map((s, i) => `<td class="${bestSec.laps[i] === lap ? 'best' : ''}">${fmtSector(s)}</td>`);
  const d = lap === best ? '–' : fmtDelta(lap.timeMs - best.timeMs);
  return `<tr><td>${lap.n}</td>${cells.join('')}<td class="${lap === best ? 'best' : ''}">${fmtLap(lap.timeMs)}</td><td>${d}</td></tr>`;
}

/** Rebuilds all four Lap Table variants' row markup; called only when the lap data itself changes. */
function buildLapTableVariants(r, tracker, n) {
  const best = tracker.bestLap, bestSec = tracker.bestSectors();
  const laps = tracker.laps.slice().reverse();

  // A: full grid table
  const headsA = ['Lap', ...Array.from({ length: n }, (_, i) => `S${i + 1}`), 'Time', 'Δ best'];
  r.table.thead.innerHTML = `<tr>${headsA.map((h) => `<th>${h}</th>`).join('')}</tr>`;
  const liveCellsA = `<td></td>${'<td></td>'.repeat(n)}<td></td><td></td>`;
  r.table.tbody.innerHTML = `<tr class="live">${liveCellsA}</tr>${laps.map((lap) => tableRowHtml(lap, tracker, n, best, bestSec)).join('')}`;
  r.table.liveRow = r.table.tbody.querySelector('tr.live');

  // B: compact list, no sector columns
  r.compact.thead.innerHTML = '<tr><th>Lap</th><th>Total</th><th>Δ</th></tr>';
  const rowsB = laps.map((lap) => {
    if (!lap.valid) return `<tr class="invalid"><td>${lap.n}</td><td>${fmtLap(lap.timeMs)}</td><td>interrupted</td></tr>`;
    const d = lap === best ? 'best' : fmtDelta(lap.timeMs - best.timeMs);
    const dCls = lap === best ? 'best' : deltaClass(lap.timeMs - best.timeMs);
    return `<tr><td>${lap.n}</td><td class="${lap === best ? 'best' : ''}">${fmtLap(lap.timeMs)}</td><td class="${dCls}">${d}</td></tr>`;
  });
  r.compact.tbody.innerHTML = `<tr class="live"><td></td><td></td><td></td></tr>${rowsB.join('')}`;
  r.compact.liveRow = r.compact.tbody.querySelector('tr.live');

  // C: bordered row cards, live pinned at the top
  r.cards.wrap.replaceChildren();
  const liveCard = el('div', 'laptable-card live');
  r.cards.wrap.append(liveCard);
  r.cards.liveCard = liveCard;
  for (const lap of laps) {
    const card = el('div', `laptable-card${lap === best ? ' best' : ''}${!lap.valid ? ' invalid' : ''}`);
    if (!lap.valid) {
      card.innerHTML = `<span class="laptable-card-lap">LAP ${lap.n}</span><span class="laptable-card-note">interrupted</span><span class="laptable-card-total">${fmtLap(lap.timeMs)}</span>`;
    } else {
      const cells = tracker.lapSectors(lap).map((s, i) => `<span class="${bestSec.laps[i] === lap ? 'best' : ''}">${fmtSector(s)}</span>`).join('');
      const d = lap === best ? 'best' : fmtDelta(lap.timeMs - best.timeMs);
      const dCls = lap === best ? 'best' : deltaClass(lap.timeMs - best.timeMs);
      card.innerHTML = `<span class="laptable-card-lap">LAP ${lap.n}</span>${cells}<span class="laptable-card-total${lap === best ? ' best' : ''}">${fmtLap(lap.timeMs)}</span><span class="laptable-card-delta ${dCls}">${d}</span>`;
    }
    r.cards.wrap.append(card);
  }

  // D: dense spreadsheet, every sector cell colored vs. the same sector on the previous lap
  const headsD = ['Lap', ...Array.from({ length: n }, (_, i) => `S${i + 1}`), 'Total', 'Δ'];
  const cellsHtml = headsD.map((h) => `<div class="laptable-sheet-cell head">${h}</div>`);
  cellsHtml.push(Array.from({ length: n + 3 }, () => '<div class="laptable-sheet-cell live-row"></div>').join(''));
  laps.forEach((lap, li) => {
    const prev = laps[li + 1];   // chronologically the lap before this one
    if (!lap.valid) {
      cellsHtml.push(`<div class="laptable-sheet-cell dim">${lap.n}</div>${'<div class="laptable-sheet-cell dim">–.–––</div>'.repeat(n)}<div class="laptable-sheet-cell dim">${fmtLap(lap.timeMs)}</div><div class="laptable-sheet-cell dim">–</div>`);
      return;
    }
    const secs = tracker.lapSectors(lap);
    const prevSecs = prev && prev.valid ? tracker.lapSectors(prev) : null;
    const lapCells = secs.map((s, i) => {
      const cls = bestSec.laps[i] === lap ? 'best' : prevSecs ? deltaClass(s - prevSecs[i]) : '';
      return `<div class="laptable-sheet-cell ${cls}">${fmtSector(s)}</div>`;
    }).join('');
    const d = lap === best ? 'best' : fmtDelta(lap.timeMs - best.timeMs);
    const dCls = lap === best ? 'best' : deltaClass(lap.timeMs - best.timeMs);
    cellsHtml.push(`<div class="laptable-sheet-cell">${lap.n}</div>${lapCells}<div class="laptable-sheet-cell">${fmtLap(lap.timeMs)}</div><div class="laptable-sheet-cell ${dCls}">${d}</div>`);
  });
  r.sheet.grid.style.gridTemplateColumns = `64px repeat(${n + 2}, minmax(0,1fr))`;
  r.sheet.grid.innerHTML = cellsHtml.join('');
  r.sheet.liveCells = Array.from(r.sheet.grid.querySelectorAll('.live-row'));
}

/** Updates the live (in-progress) row/card across all four Lap Table variants; runs every frame. */
function updateLapTableLive(r, tracker, live, hideLiveRow, n) {
  const hidden = !!hideLiveRow || !live?.recording;
  const timing = live?.recording && tracker.ref;
  const lapLabel = live ? `${live.n} ●` : '';   // the game's lap number, which differs from ours if we joined mid-session
  const totalText = live?.recording ? fmtLap(live.elapsed) : '';
  const deltaText = live?.delta !== undefined ? fmtDelta(live.delta) : '';
  const sectorTexts = Array.from({ length: n }, (_, i) => (timing ? fmtSector(tracker.liveSectorTime(i)) : ''));

  if (r.table.liveRow) {
    r.table.liveRow.hidden = hidden;
    const cells = r.table.liveRow.children;
    setText(cells[0], lapLabel);
    for (let i = 0; i < n; i++) setText(cells[i + 1], sectorTexts[i]);
    setText(cells[n + 1], totalText);
    setText(cells[n + 2], deltaText);
  }
  if (r.compact.liveRow) {
    r.compact.liveRow.hidden = hidden;
    const cells = r.compact.liveRow.children;
    setText(cells[0], lapLabel);
    setText(cells[1], totalText);
    setText(cells[2], deltaText);
  }
  if (r.cards.liveCard) {
    r.cards.liveCard.hidden = hidden;
    const parts = [
      `<span class="laptable-card-lap">LAP ${live ? live.n : ''}</span>`,
      ...sectorTexts.map((t) => `<span>${t}</span>`),
      `<span class="laptable-card-total">${totalText}</span>`,
      `<span class="laptable-card-delta ${deltaClass(live?.delta)}">${deltaText}</span>`,
    ];
    r.cards.liveCard.innerHTML = parts.join('');
  }
  if (r.sheet.liveCells?.length) {
    const vals = [lapLabel, ...sectorTexts, totalText, deltaText];
    r.sheet.liveCells.forEach((cell, i) => { cell.hidden = hidden; setText(cell, vals[i] ?? ''); });
  }
}

const lapTable = {
  title: 'Laps',
  build(body) {
    const tableWrap = el('div', 'table-wrap laptable-table');
    tableWrap.innerHTML = '<table><thead></thead><tbody></tbody></table>';
    const compactWrap = el('div', 'table-wrap laptable-compact');
    compactWrap.innerHTML = '<table><thead></thead><tbody></tbody></table>';
    const cardsWrap = el('div', 'laptable-cards');
    const sheetWrap = el('div', 'table-wrap laptable-sheet');
    sheetWrap.innerHTML = '<div class="laptable-sheet-grid"></div>';
    body.append(tableWrap, compactWrap, cardsWrap, sheetWrap);
    return {
      table: { thead: tableWrap.querySelector('thead'), tbody: tableWrap.querySelector('tbody'), liveRow: null },
      compact: { thead: compactWrap.querySelector('thead'), tbody: compactWrap.querySelector('tbody'), liveRow: null },
      cards: { wrap: cardsWrap, liveCard: null },
      sheet: { grid: sheetWrap.querySelector('.laptable-sheet-grid'), liveCells: [] },
      key: '',
    };
  },
  update(r, { tracker, live, hideLiveRow }) {
    const n = tracker.sectorCount();
    const key = `${tracker.laps.length}|${n}|${tracker.splits.join(',')}|${tracker.bestLap?.id}`;
    if (r.key !== key) {
      r.key = key;
      buildLapTableVariants(r, tracker, n);
    }
    updateLapTableLive(r, tracker, live, hideLiveRow, n);
  },
};

// ---- Driving -------------------------------------------------------------------------------

const RG_LIGHTS = 12;   // shift-light segments (design/Widget Responsive Behavior.dc.html, "RPM + Gear (combined)")
// The ring's background/progress arc: a 270° sweep (radius 42 around a 100x100 viewBox), open at the
// bottom, traced clockwise from bottom-left to bottom-right over the top - see the design file.
const RG_RING_D = 'M 20.3 79.7 A 42 42 0 1 1 79.7 79.7';

/** Zone for an rpm value against the warning/limiter thresholds: '', 'warn' or 'limit'. */
function rpmZone(value, warnRpm, limiter) {
  return value >= limiter * 0.98 ? 'limit' : value >= warnRpm ? 'warn' : '';
}

const rpmGear = {
  title: 'RPM + Gear',
  noLabel: true,   // no title bar - the gear digit and "RPM" label carry the widget's identity, per the design
  build(body) {
    const wrap = el('div', 'rg');

    const gearRow = el('div', 'rg-gear-row');
    const gearValue = el('div', 'rg-gear');
    const gearHint = el('div', 'rg-hint');
    gearRow.append(gearValue, gearHint);

    const rpmRow = el('div', 'rg-rpm-row');
    const rpmLabel = el('div', 'rg-rpm-label', 'RPM');
    const rpmValue = el('div', 'rg-rpm-value');
    rpmRow.append(rpmLabel, rpmValue);

    const lights = el('div', 'rg-lights');
    for (let i = 0; i < RG_LIGHTS; i++) lights.append(el('div', 'rg-light'));

    const ring = el('div', 'rg-ring');
    const svg = svgEl('svg', { viewBox: '0 0 100 100' });
    const ringBg = svgEl('path', { d: RG_RING_D, class: 'rg-ring-bg' });
    const ringFg = svgEl('path', { d: RG_RING_D, class: 'rg-ring-fg' });
    svg.append(ringBg, ringFg);
    const ringGear = el('div', 'rg-ring-gear');
    ring.append(svg, ringGear);
    // The dash math needs the path's real drawn length, which only a live path can report.
    const ringLen = ringFg.getTotalLength();
    ringFg.style.strokeDasharray = `${ringLen} ${ringLen}`;

    wrap.append(gearRow, rpmRow, lights, ring);
    body.append(wrap);
    return { gearValue, gearHint, rpmValue, lights: Array.from(lights.children), ringFg, ringGear, ringLen };
  },
  update(r, { frame }) {
    const gear = frame?.gear;
    if (gear == null) {
      setText(r.gearValue, DASH);
      setText(r.ringGear, DASH);
      setText(r.gearHint, NBSP);
    } else {
      // Zero is neutral; -1 is reverse (GT7 gives no direct signal for it, see bridge/frames.py).
      const label = gear === 0 ? 'N' : gear === -1 ? 'R' : String(gear);
      setText(r.gearValue, label);
      setText(r.ringGear, label);
      const suggested = frame.suggestedGear;
      setText(r.gearHint, suggested > 0 && suggested !== gear ? `→ ${suggested}` : NBSP);
    }

    if (!frame || frame.rpm == null) {
      setText(r.rpmValue, DASH);
      for (const light of r.lights) setClass(light, 'rg-light');
      r.ringFg.style.strokeDashoffset = `${r.ringLen}`;
      r.ringFg.setAttribute('class', 'rg-ring-fg');   // SVG elements don't support plain `.className =` assignment
      return;
    }
    const limiter = frame.rpmLimiter > 0 ? frame.rpmLimiter : 9000;
    const warnRpm = frame.rpmWarning > 0 ? frame.rpmWarning : limiter;
    const max = limiter * 1.08;
    // `revLimitAlert` is the game's own "actively bouncing off the limiter" bit; fall back to the
    // rpm/limiter threshold for cars or frames where that bit hasn't been confirmed reliable.
    const atLimit = frame.revLimitAlert || frame.rpm >= limiter * 0.98;
    const level = atLimit ? 'limit' : rpmZone(frame.rpm, warnRpm, limiter);
    setText(r.rpmValue, String(Math.round(frame.rpm)));
    // Each light is an equal slice of the same 0..max range as the ring/bar; it lights up once the
    // rpm reaches its slice, in whichever zone (normal/warn/limit) that slice falls in.
    r.lights.forEach((light, i) => {
      const segStart = (i / RG_LIGHTS) * max;
      const lit = frame.rpm >= segStart;
      setClass(light, `rg-light ${lit ? 'lit' : ''} ${rpmZone(segStart, warnRpm, limiter)}`);
    });
    const fraction = Math.min(1, frame.rpm / max);
    r.ringFg.style.strokeDashoffset = `${r.ringLen * (1 - fraction)}`;
    r.ringFg.setAttribute('class', `rg-ring-fg ${level} ${frame.revLimitAlert ? 'flash' : ''}`);
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
  rpmGear, speed, pedals, tyres,
};
