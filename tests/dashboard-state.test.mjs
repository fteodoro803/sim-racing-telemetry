import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadState, saveState, currentLayout, switchPreset, saveAsCustom, resetActivePreset, isLayout,
} from '../web/dashboard-state.js';
import { PRESET_LAYOUTS } from '../web/layout.js';

/** A tiny in-memory stand-in for localStorage. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
  };
}

test('isLayout accepts a real layout and rejects junk', () => {
  assert.equal(isLayout(PRESET_LAYOUTS.everything), true);
  assert.equal(isLayout([]), true);   // an empty layout (Custom, blank) is still a valid layout
  for (const bad of [null, undefined, {}, 'not an array', [{ widget: 'gear' }], [{ col: 1, row: 1, w: 1, h: 1 }]]) {
    assert.equal(isLayout(bad), false, JSON.stringify(bad));
  }
});

test('loadState defaults to Everything with a blank Custom when nothing is stored', () => {
  const state = loadState(fakeStorage());
  assert.equal(state.presetId, 'everything');
  assert.equal(state.custom, null);
});

test('loadState ignores a malformed or unknown saved value', () => {
  const storage = fakeStorage();
  storage.setItem('telemetry.dashboard', 'not json');
  assert.deepEqual(loadState(storage), { presetId: 'everything', custom: null });

  storage.setItem('telemetry.dashboard', JSON.stringify({ presetId: 'nonsense', custom: 'also nonsense' }));
  assert.deepEqual(loadState(storage), { presetId: 'everything', custom: null });
});

test('currentLayout returns the built-in preset, or Custom (empty until something is saved)', () => {
  assert.equal(currentLayout({ presetId: 'timing' }), PRESET_LAYOUTS.timing);
  assert.deepEqual(currentLayout({ presetId: 'custom', custom: null }), []);
  const custom = [{ widget: 'gear', col: 1, row: 1, w: 2, h: 2 }];
  assert.equal(currentLayout({ presetId: 'custom', custom }), custom);
});

test('switchPreset changes only the active preset, keeping Custom\'s saved layout untouched', () => {
  const custom = [{ widget: 'gear', col: 1, row: 1, w: 2, h: 2 }];
  const state = { presetId: 'everything', custom };
  const next = switchPreset(state, 'driving');
  assert.equal(next.presetId, 'driving');
  assert.equal(next.custom, custom);
  assert.equal(switchPreset(state, 'not-a-preset').presetId, 'everything');   // unknown id: no-op
});

test('saveAsCustom copies the given layout into Custom and switches to it', () => {
  const layout = [{ widget: 'gear', col: 1, row: 1, w: 2, h: 2 }];
  const state = saveAsCustom({ presetId: 'driving', custom: null }, layout);
  assert.equal(state.presetId, 'custom');
  assert.deepEqual(state.custom, layout);
  assert.notEqual(state.custom, layout);   // a copy, not the same array
});

test('resetActivePreset clears Custom back to blank, and does nothing to a built-in preset', () => {
  const custom = [{ widget: 'gear', col: 1, row: 1, w: 2, h: 2 }];
  assert.equal(resetActivePreset({ presetId: 'custom', custom }).custom, null);
  const driving = { presetId: 'driving', custom };
  assert.equal(resetActivePreset(driving), driving);
});

test('saveState/loadState round-trip through storage', () => {
  const storage = fakeStorage();
  const custom = [{ widget: 'gear', col: 1, row: 1, w: 2, h: 2 }];
  saveState(storage, { presetId: 'custom', custom });
  assert.deepEqual(loadState(storage), { presetId: 'custom', custom });
});

test('loadState never throws when storage itself throws (private browsing, quota, etc.)', () => {
  const throwing = { getItem() { throw new Error('nope'); }, setItem() { throw new Error('nope'); } };
  assert.deepEqual(loadState(throwing), { presetId: 'everything', custom: null });
  assert.doesNotThrow(() => saveState(throwing, { presetId: 'everything', custom: null }));
});
