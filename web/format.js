// Time formatting. Lap times read 1:02.345, sector times 20.123, deltas +0.123 / -0.123.

const pad = (n, w) => String(n).padStart(w, '0');

/** Format a lap time as m:ss.mmm (1:02.345); missing values show as dashes. */
export function fmtLap(ms) {
  if (ms == null || !isFinite(ms)) return '–:––.–––';
  const total = Math.round(ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  return `${m}:${pad(s, 2)}.${pad(total % 1000, 3)}`;
}

/** Format a sector time as s.mmm (20.123), or as a lap time if it runs to a minute or more. */
export function fmtSector(ms) {
  if (ms == null || !isFinite(ms)) return '––.–––';
  const total = Math.round(ms);
  if (total >= 60000) return fmtLap(total);
  return `${Math.floor(total / 1000)}.${pad(total % 1000, 3)}`;
}

/** Format a signed delta as +s.mmm or −s.mmm (a true minus sign), with ± for exactly zero. */
export function fmtDelta(ms) {
  if (ms == null || !isFinite(ms)) return '±–.–––';
  const r = Math.round(ms);
  const sign = r > 0 ? '+' : r < 0 ? '−' : '±';
  const abs = Math.abs(r);
  return `${sign}${Math.floor(abs / 1000)}.${pad(abs % 1000, 3)}`;
}
