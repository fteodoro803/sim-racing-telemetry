// Minimal hand-drawn canvas line charts for the speed and delta traces.
//
// No library: two charts don't justify a dependency.

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
 * Stroke a line whose colour depends on which side of zero it is on (for the delta chart).
 *
 * Splits the line where it crosses zero so each piece is drawn in its own colour, and batches runs of
 * the same colour into one path, since this is redrawn on every animation frame.
 */
function strokeSigned(ctx, s, sx, sy) {
  ctx.lineWidth = s.width || 1.5;
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  let color = null;
  const flush = () => { if (color) { ctx.strokeStyle = color; ctx.stroke(); } };
  const segment = (x0, y0, x1, y1, c) => {
    if (c !== color) { flush(); color = c; ctx.beginPath(); ctx.moveTo(sx(x0), sy(y0)); }
    ctx.lineTo(sx(x1), sy(y1));
  };
  const { neg, pos } = s.signColors;
  for (let i = 1; i < s.x.length; i++) {
    const x0 = s.x[i - 1], y0 = s.y[i - 1], x1 = s.x[i], y1 = s.y[i];
    if (y0 * y1 < 0) {
      const xm = x0 + (y0 / (y0 - y1)) * (x1 - x0);   // where it crosses zero
      segment(x0, y0, xm, 0, y0 < 0 ? neg : pos);
      segment(xm, 0, x1, y1, y1 < 0 ? neg : pos);
    } else {
      segment(x0, y0, x1, y1, y0 + y1 < 0 ? neg : pos);
    }
  }
  flush();
}

/**
 * Draw a line chart onto a canvas: grid, axis labels, split markers, the data series and a position dot.
 *
 * series: [{ x: number[], y: number[], color, width?, dash?, signColors?: {neg, pos} }], drawn in order.
 *         With `signColors`, the line is drawn in `neg` below zero and `pos` above it instead of `color`.
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
  const pad = { l: 46, r: 10, t: 8, b: 20 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const { xMax, yMin, yMax } = opts;
  const sx = (x) => pad.l + (x / xMax) * pw;
  const sy = (y) => pad.t + (1 - (y - yMin) / (yMax - yMin)) * ph;

  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
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
    if (s.signColors) { strokeSigned(ctx, s, sx, sy); continue; }
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
