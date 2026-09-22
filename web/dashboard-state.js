// Which preset is active, and Custom's saved layout: the model behind the preset switcher and edit
// mode (DASHBOARD_PLAN.md section 8). No DOM here, so it can be tested without a browser; the
// storage backend is passed in, the same pattern as web/persistence.js.
//
// A "state" is { presetId, custom }: `custom` is the saved Custom layout, or null before the user
// has ever added anything to it (D24 in DECISIONS.md - Custom starts blank, not as a copy of a
// preset). Everything, Timing and Driving are fixed (layout.js's PRESET_LAYOUTS); only Custom is
// ever saved.

import { PRESET_IDS, PRESET_LAYOUTS } from './layout.js';

const STORAGE_KEY = 'telemetry.dashboard';

/** localStorage that never throws: it can be unavailable (private windows, blocked site data). */
function readStorage(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStorage(storage, value) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* not remembered */ }
}

/** True if `value` looks like a layout: an array of placed widgets (col/row/w/h/widget). */
export function isLayout(value) {
  return Array.isArray(value) && value.every((it) => it && typeof it.widget === 'string'
    && Number.isFinite(it.col) && Number.isFinite(it.row) && Number.isFinite(it.w) && Number.isFinite(it.h));
}

/** Load the remembered preset choice and Custom layout, or the defaults (Everything, Custom blank). */
export function loadState(storage = globalThis.localStorage) {
  const saved = readStorage(storage);
  const presetId = saved && PRESET_IDS.includes(saved.presetId) ? saved.presetId : 'everything';
  const custom = saved && isLayout(saved.custom) ? saved.custom : null;
  return { presetId, custom };
}

/** Persist the current preset choice and Custom layout. */
export function saveState(storage, state) {
  writeStorage(storage, { presetId: state.presetId, custom: state.custom });
}

/** The layout currently on screen: a built-in preset's fixed arrangement, or Custom's saved one (empty if none). */
export function currentLayout(state) {
  return state.presetId === 'custom' ? (state.custom || []) : PRESET_LAYOUTS[state.presetId];
}

/** Switch which preset is showing. Does not change Custom's saved layout. */
export function switchPreset(state, presetId) {
  return { ...state, presetId: PRESET_IDS.includes(presetId) ? presetId : state.presetId };
}

/** Save `layout` as Custom and switch to it - "Save as Custom" in edit mode. */
export function saveAsCustom(state, layout) {
  return { presetId: 'custom', custom: layout.slice() };
}

/**
 * "Reset to preset" in edit mode: Custom goes back to blank (D24); a built-in preset has nothing to
 * reset (it's always its own default), so this only ever changes state when Custom is active.
 */
export function resetActivePreset(state) {
  return state.presetId === 'custom' ? { ...state, custom: null } : state;
}
