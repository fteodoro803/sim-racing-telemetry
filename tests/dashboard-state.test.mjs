import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadState, saveState, currentLayout, switchPreset, saveAsCustom, savePresetEdit, resetActivePreset, isLayout,
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

test('loadState defaults to Everything with a blank Custom and no overrides when nothing is stored', () => {
  const state = loadState(fakeStorage());
  assert.equal(state.presetId, 'everything');
  assert.equal(state.custom, null);
  assert.deepEqual(state.overrides, {});
});

test('loadState ignores a malformed or unknown saved value', () => {
  const storage = fakeStorage();
  storage.setItem('telemetry.dashboard', 'not json');
  assert.deepEqual(loadState(storage), { presetId: 'everything', custom: null, overrides: {} });

  storage.setItem('telemetry.dashboard', JSON.stringify({ presetId: 'nonsense', custom: 'also nonsense', overrides: 'nonsense too' }));
  assert.deepEqual(loadState(storage), { presetId: 'everything', custom: null, overrides: {} });
});

test('loadState drops an override for an unknown preset id or a malformed layout, keeping the rest', () => {
  const storage = fakeStorage();
  const driving = [{ widget: 'gear', col: 1, row: 1, w: 2, h: 2 }];
  storage.setItem('telemetry.dashboard', JSON.stringify({
    presetId: 'everything',
    custom: null,
    overrides: { driving, timing: 'not a layout', custom: driving, notAPreset: driving },
  }));
  assert.deepEqual(loadState(storage).overrides, { driving });
});

test('currentLayout returns a built-in preset\'s override if it has one, else its shipped default; Custom is empty until saved', () => {
  assert.equal(currentLayout({ presetId: 'timing', overrides: {} }), PRESET_LAYOUTS.timing);
  const override = [{ widget: 'gear', col: 1, row: 1, w: 2, h: 2 }];
  assert.equal(currentLayout({ presetId: 'timing', overrides: { timing: override } }), override);
  assert.deepEqual(currentLayout({ presetId: 'custom', custom: null, overrides: {} }), []);
  const custom = [{ widget: 'gear', col: 1, row: 1, w: 2, h: 2 }];
  assert.equal(currentLayout({ presetId: 'custom', custom, overrides: {} }), custom);
});

test('switchPreset changes only the active preset, keeping Custom\'s saved layout and overrides untouched', () => {
  const custom = [{ widget: 'gear', col: 1, row: 1, w: 2, h: 2 }];
  const overrides = { timing: custom };
  const state = { presetId: 'everything', custom, overrides };
  const next = switchPreset(state, 'driving');
  assert.equal(next.presetId, 'driving');
  assert.equal(next.custom, custom);
  assert.equal(next.overrides, overrides);
  assert.equal(switchPreset(state, 'not-a-preset').presetId, 'everything');   // unknown id: no-op
});

test('saveAsCustom copies the given layout into Custom and switches to it, keeping overrides', () => {
  const overrides = { driving: [{ widget: 'gear', col: 1, row: 1, w: 2, h: 2 }] };
  const layout = [{ widget: 'speed', col: 1, row: 1, w: 2, h: 2 }];
  const state = saveAsCustom({ presetId: 'driving', custom: null, overrides }, layout);
  assert.equal(state.presetId, 'custom');
  assert.deepEqual(state.custom, layout);
  assert.notEqual(state.custom, layout);   // a copy, not the same array
  assert.equal(state.overrides, overrides);
});

test('savePresetEdit saves the layout as the active built-in preset\'s override, and does nothing for Custom', () => {
  const layout = [{ widget: 'gear', col: 1, row: 1, w: 2, h: 2 }];
  const state = savePresetEdit({ presetId: 'driving', custom: null, overrides: {} }, layout);
  assert.deepEqual(state.overrides, { driving: layout });
  assert.notEqual(state.overrides.driving, layout);   // a copy, not the same array

  const untouched = { presetId: 'custom', custom: null, overrides: {} };
  assert.equal(savePresetEdit(untouched, layout), untouched);
});

test('resetActivePreset clears Custom back to blank, or a built-in preset\'s override back to its default', () => {
  const custom = [{ widget: 'gear', col: 1, row: 1, w: 2, h: 2 }];
  assert.equal(resetActivePreset({ presetId: 'custom', custom, overrides: {} }).custom, null);

  const overrides = { driving: custom };
  const driving = resetActivePreset({ presetId: 'driving', custom: null, overrides });
  assert.deepEqual(driving.overrides, {});

  // No saved override for the active preset: no-op, same reference back.
  const timing = { presetId: 'timing', custom: null, overrides: {} };
  assert.equal(resetActivePreset(timing), timing);
});

test('saveState/loadState round-trip through storage, including overrides', () => {
  const storage = fakeStorage();
  const custom = [{ widget: 'gear', col: 1, row: 1, w: 2, h: 2 }];
  const overrides = { timing: [{ widget: 'speed', col: 1, row: 1, w: 2, h: 2 }] };
  saveState(storage, { presetId: 'custom', custom, overrides });
  assert.deepEqual(loadState(storage), { presetId: 'custom', custom, overrides });
});

test('loadState never throws when storage itself throws (private browsing, quota, etc.)', () => {
  const throwing = { getItem() { throw new Error('nope'); }, setItem() { throw new Error('nope'); } };
  assert.deepEqual(loadState(throwing), { presetId: 'everything', custom: null, overrides: {} });
  assert.doesNotThrow(() => saveState(throwing, { presetId: 'everything', custom: null, overrides: {} }));
});
