// Minimal hand-drawn canvas line charts: the speed and delta traces (lap-distance x-axis), plus the
// Pedal Trace (a rolling time window instead).
//
// No library: a handful of charts don't justify a dependency.

/**
 * Read the chart colours from the page's CSS variables, so charts follow light/dark mode.
 *
 * Call again when the colour scheme changes; drawChart takes the result as `opts.theme`.
 */
export function readTheme() {
  const css = getComputedStyle(document.documentElement);
  const get = (name) => css.getPropertyValue(name).trim();
  return {
    text: get('--muted'), grid: get('--grid'), line: get('--line'),
    current: get('--accent'), reference: get('--reference'), good: get('--good'), bad: get('--bad'),
    split: get('--split'), amber: get('--amber'),
  };
}

/** Pick a round tick spacing (1, 2, 5 times a power of ten) that gives roughly `ticks` ticks across `range`. */
function niceStep(range, ticks) {
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
}

/**
 * Split a signed series into runs of same-coloured points (for the delta chart).
 *
 * Splits the line where it crosses zero, so a run never mixes the `neg`/`pos` colours, and batches
 * consecutive points of the same colour into one run.
 */
function signedRuns(s) {
  const { neg, pos } = s.signColors;
  const runs = [];
  let current = null;
  const point = (x, y, c) => {
    if (c !== current?.color) { current = { color: c, points: [] }; runs.push(current); }
    current.points.push([x, y]);
  };
  for (let i = 0; i < s.x.length; i++) {
    if (i === 0) { point(s.x[0], s.y[0], s.y[0] < 0 ? neg : pos); continue; }
    const x0 = s.x[i - 1], y0 = s.y[i - 1], x1 = s.x[i], y1 = s.y[i];
    if (y0 * y1 < 0) {
      const xm = x0 + (y0 / (y0 - y1)) * (x1 - x0);   // where it crosses zero
      point(xm, 0, y0 < 0 ? neg : pos);
      point(xm, 0, y1 < 0 ? neg : pos);
    }
    point(x1, y1, y1 < 0 ? neg : pos);
  }
  return runs;
}

/** Stroke a line whose colour depends on which side of zero it is on, one path per same-colour run. */
function strokeSigned(ctx, s, sx, sy) {
  ctx.lineWidth = s.width || 1.5;
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  for (const run of signedRuns(s)) {
    ctx.strokeStyle = run.color;
    ctx.beginPath();
    run.points.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(sx(x), sy(y)); else ctx.lineTo(sx(x), sy(y));
    });
    ctx.stroke();
  }
}

/** Fill the area between a signed line and zero, one polygon per same-colour run, at low opacity. */
function fillSigned(ctx, s, sx, sy, opacity = 0.18) {
  ctx.globalAlpha = opacity;
  for (const run of signedRuns(s)) {
    if (run.points.length < 2) continue;
    ctx.fillStyle = run.color;
    ctx.beginPath();
    ctx.moveTo(sx(run.points[0][0]), sy(0));
    for (const [x, y] of run.points) ctx.lineTo(sx(x), sy(y));
    ctx.lineTo(sx(run.points[run.points.length - 1][0]), sy(0));
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * Draw a line chart onto a canvas: grid, axis labels, split markers, the data series and a position dot.
 *
 * series: [{ x: number[], y: number[], color, width?, dash?, signColors?: {neg, pos}, fill? }], drawn
 *         in order. With `signColors`, the line is drawn in `neg` below zero and `pos` above it
 *         instead of `color`; `fill` (signed series only) also shades the area down to zero.
 * opts:   { xMax, yMin, yMax, yFormat?, xFormat?, vlines?: number[], zero?: bool, marker?: {x, y, color}, theme }
 *
 * Redraws from scratch every call, sized to the canvas's CSS size and the screen's pixel density.
 */
export function drawChart(canvas, series, opts) {
  // 1. Size the canvas for the screen's pixel density and clear it
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const th = opts.theme;
  // Text and the padding it needs scale with the canvas's own size, the same as the CSS around it
  // (style.css's container-query rules), so a chart shrunk or grown in edit mode stays legible
  // and doesn't waste space on axis labels sized for a bigger widget.
  const fontPx = Math.max(9, Math.min(h * 0.09, w * 0.035, 14));
  const pad = { l: fontPx * 4.2, r: 10, t: 8, b: fontPx * 1.8 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const { xMax, yMin, yMax } = opts;
  const sx = (x) => pad.l + (x / xMax) * pw;
  const sy = (y) => pad.t + (1 - (y - yMin) / (yMax - yMin)) * ph;

  ctx.font = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textBaseline = 'middle';

  // 2. Horizontal grid lines and y-axis labels
  const step = niceStep(yMax - yMin, 4);
  ctx.textAlign = 'right';
  for (let v = Math.ceil(yMin / step) * step; v <= yMax + 1e-9; v += step) {
    const y = Math.round(sy(v)) + 0.5;
    ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillStyle = th.text;
    ctx.fillText(opts.yFormat ? opts.yFormat(v) : String(v), pad.l - 6, y);
  }

  // 3. X-axis labels
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const xStep = niceStep(xMax, Math.max(2, Math.floor(pw / 90)));
  for (let v = 0; v <= xMax + 1e-9; v += xStep) {
    ctx.fillStyle = th.text;
    ctx.fillText(opts.xFormat ? opts.xFormat(v) : String(v), sx(v), h - pad.b + 5);
  }

  // 4. Zero line (the delta chart)
  if (opts.zero) {
    const y = Math.round(sy(0)) + 0.5;
    ctx.strokeStyle = th.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
  }

  // 5. Sector split markers
  if (opts.vlines) {
    ctx.strokeStyle = th.split; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    for (const v of opts.vlines) {
      const x = Math.round(sx(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // 6. The data series, clipped to the plot area
  ctx.save();
  ctx.beginPath(); ctx.rect(pad.l, pad.t, pw, ph); ctx.clip();
  for (const s of series) {
    if (!s.x.length) continue;
    if (s.signColors) {
      if (s.fill) fillSigned(ctx, s, sx, sy);
      strokeSigned(ctx, s, sx, sy);
      continue;
    }
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.5; ctx.lineJoin = 'round';
    ctx.setLineDash(s.dash || []);
    ctx.beginPath();
    for (let i = 0; i < s.x.length; i++) {
      const x = sx(s.x[i]), y = sy(s.y[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.setLineDash([]);

  // 7. A dot at the current position
  if (opts.marker) {
    const x = sx(opts.marker.x), y = sy(opts.marker.y);
    ctx.fillStyle = opts.marker.color;
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
}

/**
 * Append `sample` (`{t, ...}`, `t` in ms) to a rolling buffer and trim anything older than `windowMs`
 * before the newest sample - the Pedal Trace widget's rolling window of recent throttle/brake values,
 * kept across redraws in the widget's own refs rather than in the lap tracker (it isn't lap-relative).
 *
 * Clears the buffer first if `sample.t` is more than a second behind the last one, rather than
 * bridging the gap: the game clock went backwards, meaning a new session started (frame.t is
 * monotonic per session - see the README's frame format), not that time is standing still.
 *
 * Mutates and returns `samples`.
 */
export function pushTraceSample(samples, sample, windowMs) {
  const last = samples[samples.length - 1];
  if (last && sample.t < last.t - 1000) samples.length = 0;
  samples.push(sample);
  const cutoff = sample.t - windowMs;
  while (samples.length > 1 && samples[0].t < cutoff) samples.shift();
  return samples;
}

/**
 * Draw the Pedal Trace widget onto `canvas`: throttle and brake, both 0-100, over the last `windowMs`
 * of `samples` (`{t, thr, brk}`, oldest first), newest sample pinned to the right edge ("now").
 *
 * Unlike `drawChart`, both series share one axis with no signed/zero split, and where their filled
 * areas overlap is what the widget exists to show - drawn with `globalCompositeOperation: 'screen'`
 * so the two translucent fills blend to a lighter colour on their own, with no separate overlap
 * polygon to compute. `variant` picks how much chart chrome is drawn (D27, like any other widget
 * shape): 'compact' drops the fill and all padding/labels down to bare lines; 'gridlines' adds a
 * faint vertical line every second so an overlap's width can be read against a known interval.
 */
export function drawPedalTrace(canvas, samples, { windowMs, theme, variant = 'filled' }) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!samples.length) return;

  const compact = variant === 'compact';
  const fill = variant === 'filled' || variant === 'gridlines';
  const now = samples[samples.length - 1].t;
  const start = now - windowMs;

  const fontPx = Math.max(9, Math.min(h * 0.12, w * 0.035, 13));
  const pad = compact ? { l: 2, r: 2, t: 2, b: 2 } : { l: fontPx * 2.4, r: 6, t: 6, b: fontPx * 1.6 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const sx = (t) => pad.l + ((t - start) / windowMs) * pw;
  const sy = (v) => pad.t + (1 - v / 100) * ph;

  ctx.font = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  if (!compact) {
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of [0, 50, 100]) ctx.fillText(String(v), pad.l - 6, sy(v));
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`−${Math.round(windowMs / 1000)}s`, pad.l, h - pad.b + 4);
    ctx.textAlign = 'right';
    ctx.fillText('now', w - pad.r, h - pad.b + 4);
  }

  if (variant === 'gridlines') {
    ctx.strokeStyle = theme.grid; ctx.lineWidth = 1;
    for (let t = Math.ceil(start / 1000) * 1000; t <= now; t += 1000) {
      const x = Math.round(sx(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke();
    }
  }

  ctx.save();
  ctx.beginPath(); ctx.rect(pad.l, pad.t, pw, ph); ctx.clip();
  const drawSeries = (key, color) => {
    if (fill) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(sx(samples[0].t), sy(0));
      for (const s of samples) ctx.lineTo(sx(s.t), sy(s[key]));
      ctx.lineTo(sx(samples[samples.length - 1].t), sy(0));
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = compact ? 1.5 : 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    samples.forEach((s, i) => {
      const x = sx(s.t), y = sy(s[key]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };
  drawSeries('thr', theme.current);
  drawSeries('brk', theme.bad);
  ctx.restore();
}
