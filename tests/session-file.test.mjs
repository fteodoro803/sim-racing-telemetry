import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildExport, exportFilename, FORMAT, readImport } from '../web/session-file.js';
import { LapTracker } from '../web/timing.js';
import { DemoSource } from '../web/demo-source.js';

// downloadJson needs a DOM (Blob, URL.createObjectURL, a clickable <a>) and is checked in the
// browser instead; this covers the JSON shape on both sides of the round trip, which is what an
// actual exported/imported file depends on.

const data = JSON.parse(readFileSync(new URL('../web/demo-laps.json', import.meta.url)));

function drivenTracker() {
  const tr = new LapTracker();
  const src = new DemoSource(data);
  while (!src.done) tr.ingest(src.frame(src.index++));
  return tr;
}

test('a tracker exported and re-imported reproduces the same laps', () => {
  const tr = drivenTracker();
  tr.setCompareMode('last');
  const exported = buildExport(tr);
  assert.equal(exported.format, FORMAT);
  assert.equal(exported.source, 'live');
  assert.match(exported.exportedAt, /^\d{4}-\d{2}-\d{2}T/);

  // The whole point of a file round trip: JSON-stringify and parse it, not just pass the object.
  const roundTripped = readImport(JSON.stringify(exported));
  const restored = new LapTracker();
  restored.restoreSession(roundTripped);
  assert.deepEqual(restored.laps.map((l) => l.timeMs), tr.laps.map((l) => l.timeMs));
  assert.equal(restored.compareMode, 'last');
});

test('buildExport takes the source label given to it', () => {
  assert.equal(buildExport(new LapTracker(), { source: 'demo' }).source, 'demo');
});

test('readImport rejects a file that is not valid JSON, with a message meant for the user', () => {
  assert.throws(() => readImport('not json at all'), /valid JSON/);
});

test('readImport rejects JSON that is not a session export from this app', () => {
  for (const text of [
    '{}',
    '{"format":"something-else","laps":[{}]}',
    `{"format":"${FORMAT}"}`,                 // no laps key
    `{"format":"${FORMAT}","laps":[]}`,       // empty laps
    '[]',
    '"just a string"',
  ]) {
    assert.throws(() => readImport(text), /session export/, text);
  }
});

test('exportFilename is a stable, sortable, valid filename', () => {
  const name = exportFilename(new Date(2026, 8, 22, 9, 5));   // 2026-09-22 09:05
  assert.equal(name, 'telemetry-session-2026-09-22-0905.json');
  assert.doesNotMatch(name, /[/\\:*?"<>|]/);   // no characters a filesystem would reject
});
