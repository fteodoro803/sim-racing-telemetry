// Exporting and importing a session as a JSON file (PROJECT_CONTEXT.md Known issue 8).
//
// buildExport/readImport are the pure data-shape functions, testable without a browser; downloadJson
// is the actual file save, a thin DOM wrapper kept separate so it doesn't need a DOM to test.

export const FORMAT = 'telemetry-session-1';

/** The plain object written to an exported file, for a tracker's current session. */
export function buildExport(tracker, { source = 'live' } = {}) {
  return {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    source,
    splits: tracker.splits,
    compareMode: tracker.compareMode,
    laps: tracker.laps,
  };
}

/**
 * Parse an imported file's text into the shape `LapTracker#restoreSession` expects.
 *
 * Throws an Error whose message is meant to be shown to the user directly, if the file isn't a
 * session export from this app or has no laps in it.
 */
export function readImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (data?.format !== FORMAT || !Array.isArray(data.laps) || !data.laps.length) {
    throw new Error("That doesn't look like a session export from this app.");
  }
  return { laps: data.laps, splits: data.splits, compareMode: data.compareMode };
}

/** A filename for an export, from the given (default: current) time. */
export function exportFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `telemetry-session-${stamp}.json`;
}

/** Trigger a browser download of `data`, JSON-encoded, as `filename`. */
export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
