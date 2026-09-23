// Which preset is active, Custom's saved layout, and any edits saved onto a built-in preset: the
// model behind the preset switcher and edit mode (DASHBOARD_PLAN.md section 8). No DOM here, so it
// can be tested without a browser; the storage backend is passed in, the same pattern as
// web/persistence.js.
//
// A "state" is { presetId, custom, overrides }: `custom` is the saved Custom layout, or null before
// the user has ever added anything to it (D24 in DECISIONS.md - Custom starts blank, not as a copy
// of a preset). `overrides` is a { [presetId]: layout } map of user edits saved onto a built-in
// preset (Everything, Timing or Driving) - each key is optional, and a preset with no override still
// falls back to layout.js's PRESET_LAYOUTS (D32 in DECISIONS.md - presets are directly editable, with
// "Reset to default" clearing the override back to that shipped layout).

import { PRESET_IDS, PRESET_LAYOUTS } from './layout.js';

const STORAGE_KEY = 'telemetry.dashboard';
const BUILT_IN_IDS = PRESET_IDS.filter((id) => id !== 'custom');

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

/** The saved `overrides` object with anything malformed - a bad key or a non-layout value - dropped. */
function sanitizeOverrides(value) {
  const overrides = {};
  if (!value || typeof value !== 'object') return overrides;
  for (const id of BUILT_IN_IDS) {
    if (isLayout(value[id])) overrides[id] = value[id];
  }
  return overrides;
}

/** Load the remembered preset choice, Custom layout and preset overrides, or the defaults. */
export function loadState(storage = globalThis.localStorage) {
  const saved = readStorage(storage);
  const presetId = saved && PRESET_IDS.includes(saved.presetId) ? saved.presetId : 'everything';
  const custom = saved && isLayout(saved.custom) ? saved.custom : null;
  const overrides = sanitizeOverrides(saved?.overrides);
  return { presetId, custom, overrides };
}

/** Persist the current preset choice, Custom layout and preset overrides. */
export function saveState(storage, state) {
  writeStorage(storage, { presetId: state.presetId, custom: state.custom, overrides: state.overrides });
}

/** The layout currently on screen: a built-in preset's saved override (its shipped default if none), or Custom's saved one (empty if none). */
export function currentLayout(state) {
  if (state.presetId === 'custom') return state.custom || [];
  return state.overrides?.[state.presetId] || PRESET_LAYOUTS[state.presetId];
}

/** Switch which preset is showing. Does not change Custom's saved layout or any preset's override. */
export function switchPreset(state, presetId) {
  return { ...state, presetId: PRESET_IDS.includes(presetId) ? presetId : state.presetId };
}

/** Save `layout` as Custom and switch to it - "Save as Custom" in edit mode. */
export function saveAsCustom(state, layout) {
  return { ...state, presetId: 'custom', custom: layout.slice() };
}

/** Save `layout` as the active built-in preset's own override - "Done" after editing it directly. */
export function savePresetEdit(state, layout) {
  if (state.presetId === 'custom') return state;
  return { ...state, overrides: { ...state.overrides, [state.presetId]: layout.slice() } };
}

/**
 * "Reset to default" in edit mode: Custom goes back to blank (D24); a built-in preset drops its
 * saved override, if any, back to its shipped default (D32).
 */
export function resetActivePreset(state) {
  if (state.presetId === 'custom') return { ...state, custom: null };
  if (!(state.presetId in (state.overrides || {}))) return state;
  const overrides = { ...state.overrides };
  delete overrides[state.presetId];
  return { ...state, overrides };
}
