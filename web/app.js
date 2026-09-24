// Page wiring: chooses a data source (the demo, or a live bridge), feeds its frames to the LapTracker,
// builds the widget grid, and keeps the widgets and the top bar up to date.
//
// Widgets are defined in widgets.js and arranged by layout.js; all timing logic is in timing.js. This
// file only connects them to a source and to the page.

import { readTheme } from './charts.js';
import { DemoSource } from './demo-source.js';
import {
  currentLayout, loadState, resetActivePreset, saveAsCustom, savePresetEdit, saveState, switchPreset,
} from './dashboard-state.js';
import { el, setClass, setText } from './dom.js';
import { buildEditChrome, wireEditMode } from './edit.js';
import { WIDGET_META } from './layout.js';
import { JitterBuffer } from './jitter-buffer.js';
import { LiveSource } from './live-source.js';
import { clearSession, loadSession, saveSession } from './persistence.js';
import { buildExport, downloadJson, exportFilename, readImport } from './session-file.js';
import { LapTracker } from './timing.js';
import { WIDGETS } from './widgets.js';

const $ = (id) => document.getElementById(id);

const DEMO_HISTORY_LAPS = 3;                       // open the demo with laps 1-2 already driven
const DEFAULT_ADDRESS = 'ws://localhost:8765/ws';  // where the bridge listens when run on this computer
const ADDRESS_KEY = 'telemetry.bridgeAddress';
const JITTER_KEY = 'telemetry.jitterDelayMs';
const JITTER_MAX_MS = 300;

/** localStorage that never throws: it can be unavailable (private windows, blocked site data). */
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* not remembered */ } },
};

/**
 * Persist completed laps as they happen, and only while live: the demo builds its own session
 * every time, and saving its laps over a real one (or vice versa) would just be confusing. An
 * auto-reset because the car doesn't match a restored session's track clears the save too, so a
 * stale session for the wrong track isn't offered again next time.
 */
function onTrackerEvent(type, payload) {
  if (app.mode !== 'live') return;
  if (type === 'lap') saveSession(tracker);
  else if (type === 'reset' && payload.reason === 'lost-reference') clearSession();
}

const tracker = new LapTracker({ onEvent: onTrackerEvent });

/** The saved smoothing delay, clamped to the slider's range; 0 (off) if nothing sensible is saved. */
function savedJitterDelay() {
  const value = Number(storage.get(JITTER_KEY));
  return Number.isFinite(value) ? Math.max(0, Math.min(JITTER_MAX_MS, value)) : 0;
}

const app = {
  mode: 'demo',              // 'demo' or 'live'
  servedByBridge: false,     // true when this page came from the bridge, so it can connect to itself
  demoData: null,
  demo: null,                // the DemoSource, in demo mode
  live: null,                // the LiveSource, in live mode
  connection: 'idle',        // the live source's state
  address: null,             // the bridge address in use
  frame: null,               // the latest frame from whichever source is active
  paused: false,             // demo only
  imported: null,            // { source, exportedAt } of an imported file, while reviewing one
  theme: readTheme(),
  widgets: [],               // { def, refs } for each widget on the grid
  dashboard: loadState(),    // { presetId, custom, overrides } - which preset is showing, Custom's saved layout, and any built-in preset's saved edits
  editing: false,            // edit mode: dragging, resizing, adding and removing widgets
  draftLayout: null,         // the layout being edited, only while `editing`
};

// ---- data sources ----------------------------------------------------------

/** Take one frame from the active source: remember it for the widgets and feed the lap tracker. */
function ingest(frame) {
  app.frame = frame;
  tracker.ingest(frame);
}

/** Live frames wait here so a burst after a network stall is replayed evenly (D33); `tick` releases them. */
const jitter = new JitterBuffer({ emit: ingest, delayMs: savedJitterDelay() });

function resetSession() {
  tracker.reset();
  app.frame = null;
}

/** Fetch the demo laps once. */
async function loadDemoData() {
  if (!app.demoData) {
    const res = await fetch('demo-laps.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    app.demoData = await res.json();
  }
  return app.demoData;
}

function stopLive() {
  app.live?.close();
  jitter.reset();
  app.live = null;
  app.connection = 'idle';
}

/**
 * Start (or restart) the demo, with the first laps already driven so deltas show at once.
 *
 * Replays the opening laps instantly rather than in real time. Stops any live connection first.
 */
async function startDemo() {
  stopLive();
  app.mode = 'demo';
  app.imported = null;
  try {
    app.demo = new DemoSource(await loadDemoData());
  } catch (err) {
    setText($('statusText'), `Could not load the demo data (${err.message}). If you opened index.html directly, serve the folder over http instead.`);
    return;
  }
  resetSession();
  app.demo.feedUntilLap(DEMO_HISTORY_LAPS, ingest);
  app.paused = false;
}

/**
 * Connect to a bridge at `url`, restoring a previously saved session if there is one.
 *
 * A restored session that turns out to be for a different track corrects itself: `tracker`'s own
 * `onEvent` (below) clears the save once the car has stayed off the restored reference too long.
 */
async function startLive(url) {
  stopLive();
  app.mode = 'live';
  app.imported = null;
  app.address = url;
  const saved = await loadSession();
  if (saved) tracker.restoreSession(saved);
  else tracker.reset();
  app.frame = null;
  app.connection = 'connecting';
  app.live = new LiveSource(url, { onFrame: (frame) => jitter.push(frame), onState: (state) => { app.connection = state; } });
  app.live.connect();
}

/**
 * Load a session from an exported file for review: stops whatever source is running, so its frames
 * can't mix with the imported laps, which otherwise sit in the tracker exactly like a live one's.
 */
function importSession(text) {
  const session = readImport(text);   // throws a user-facing message if the file doesn't look right
  const { source, exportedAt } = JSON.parse(text);
  stopLive();
  app.paused = true;
  app.mode = 'imported';
  app.imported = { source, exportedAt };
  tracker.restoreSession(session);
  app.frame = null;
}

function exportSession() {
  downloadJson(buildExport(tracker, { source: app.mode === 'imported' ? app.imported?.source ?? 'live' : app.mode }), exportFilename());
}

// ---- grid ------------------------------------------------------------------

/** The state every widget reads on each render. */
function context() {
  return {
    tracker,
    live: tracker.live,
    frame: app.frame,
    theme: app.theme,
    mode: app.mode,
    hideLiveRow: app.mode === 'demo' && !!app.demo?.done,   // the demo's closing frame opens a lap that never runs
  };
}

/**
 * Rebuild the grid's widget cards from a layout, letting each widget build its own contents. Called
 * whenever the layout itself changes: switching presets, entering or leaving edit mode, and every
 * commit within it (move, resize, add, remove). Frame-by-frame updates go through `render` instead.
 */
function renderGrid(layout, editing) {
  const grid = $('grid');
  grid.replaceChildren(ghostEl);   // the drag/resize ghost lives in the grid too, but survives a rebuild
  app.widgets = [];
  for (const item of layout) {
    const def = WIDGETS[item.widget];
    if (!def) continue;   // a saved Custom layout naming a widget that no longer exists
    const card = el('section', `widget w-${item.widget}`);
    card.dataset.widget = item.widget;
    card.dataset.variant = item.variant || WIDGET_META[item.widget]?.variants?.[0]?.id || '';
    card.dataset.window = String(item.window ?? WIDGET_META[item.widget]?.windows?.[0] ?? '');
    card.style.gridColumn = `${item.col} / span ${item.w}`;
    card.style.gridRow = `${item.row} / span ${item.h}`;
    if (def.noLabel) card.classList.add('inline');
    else card.append(el('div', 'w-label', def.title));
    const body = el('div', 'w-body');
    card.append(body);
    const refs = def.build(body);
    if (def.onTap) {
      card.classList.add('tappable');
      card.addEventListener('click', () => { if (app.editing) return; def.onTap(context()); render(); });
    }
    if (editing) {
      card.classList.add('editable');
      const { chrome, drag, remove, size, select, windowSelect } = buildEditChrome(item.widget, WIDGET_META[item.widget]?.variants, WIDGET_META[item.widget]?.windows);
      setText(size, `${item.w}×${item.h}`);
      card.append(chrome);
      drag.addEventListener('pointerdown', (event) => { event.preventDefault(); editor.startMove(card, item.widget, event.pointerId); });
      remove.addEventListener('click', () => editor.removeWidget(item.widget));
      for (const handle of chrome.querySelectorAll('.resize-handle')) {
        const corner = handle.classList[1];
        handle.addEventListener('pointerdown', (event) => { event.preventDefault(); editor.startResize(card, item.widget, corner, event.pointerId); });
      }
      if (select) {
        select.value = card.dataset.variant;
        select.addEventListener('pointerdown', (event) => event.stopPropagation());
        select.addEventListener('change', () => editor.setVariant(item.widget, select.value));
      }
      if (windowSelect) {
        windowSelect.value = card.dataset.window;
        windowSelect.addEventListener('pointerdown', (event) => event.stopPropagation());
        windowSelect.addEventListener('change', () => editor.setWindow(item.widget, windowSelect.value));
      }
    }
    grid.append(card);
    app.widgets.push({ def, refs });
  }
  grid.classList.toggle('editing', editing);
  $('emptyState').hidden = !(editing && layout.length === 0);
}

// ---- presets and edit mode --------------------------------------------------

const ghostEl = el('div', 'ghost');
ghostEl.hidden = true;

/** Widgets already in the palette's Timing or Driving group (every widget in the registry), grouped. */
function paletteEntries(group) {
  return Object.entries(WIDGET_META).filter(([, meta]) => meta.group === group);
}

/** Plausible values for a variant preview - not live data, just enough for the widget to draw something believable. */
const PREVIEW_FRAME = {
  gear: 4, suggestedGear: 0, rpm: 5200, rpmWarning: 6200, rpmLimiter: 7000, revLimitAlert: false,
  throttle: 70, brake: 0, clutch: 0, speed: 226,
  tyreTemp: [84, 83, 78, 77],   // FL, FR, RL, RR - mid-optimal, front slightly hotter (as demo-source.js models)
};

/**
 * A believable throttle-lift-into-brake trace for Pedal Trace's preview (a trail-braking shape, with
 * a brief throttle/brake overlap partway through) - it needs several points over time rather than one
 * static frame, unlike every other widget's `PREVIEW_FRAME`.
 */
const PEDAL_TRACE_PREVIEW = [
  { throttle: 15, brake: 0 }, { throttle: 45, brake: 0 }, { throttle: 75, brake: 0 }, { throttle: 92, brake: 0 },
  { throttle: 55, brake: 25 }, { throttle: 15, brake: 65 }, { throttle: 0, brake: 88 }, { throttle: 0, brake: 42 },
  { throttle: 20, brake: 0 }, { throttle: 50, brake: 0 },
];

let previewFixture = null;          // { tracker, frame } snapshot the palette's previews render from, once loaded
let previewFixtureLoading = null;   // in-flight load, so concurrent triggers (several widgets expanding) share it

const PREVIEW_LAP_ADVANCE_MS = 25000;   // ~42% into the live lap - enough samples for a chart, short of finishing it

/**
 * A fixed, idle-state snapshot for the palette's variant previews: the demo data's opening laps
 * (already labelled synthetic, same as a real demo start - `DEMO_HISTORY_LAPS`) run through a
 * throwaway `LapTracker`, so a widget's real `update()` sees a real tracker with real
 * lastLap/bestLap/sectors/delta history instead of a hand-faked stand-in whose API would have to be
 * kept in sync with timing.js by hand (BUG-4 in BUGS.md). Deliberately its own tracker, never the
 * session's live one, so the preview stays the same regardless of what's actually running or how far
 * into it the user has scrubbed. Built once, lazily, the first time a palette picker needs it.
 *
 * `feedUntilLap` alone stops at the live lap's very first sample, which leaves `deltaSeries()`/
 * `speedSeries()` (Delta Chart, Speed Chart) with nothing to plot - they read off the in-progress
 * lap's own accumulated samples, not the completed laps `feedUntilLap` already guarantees. Advancing
 * a further `PREVIEW_LAP_ADVANCE_MS` into that lap gives every widget real data, not just the ones
 * that only need a completed lap.
 */
async function loadPreviewFixture() {
  if (previewFixture) return previewFixture;
  if (!previewFixtureLoading) {
    previewFixtureLoading = (async () => {
      const source = new DemoSource(await loadDemoData());
      const tracker = new LapTracker();
      let frame = null;
      const emit = (f) => { tracker.ingest(f); frame = f; };
      source.feedUntilLap(DEMO_HISTORY_LAPS, emit);
      source.advance(PREVIEW_LAP_ADVANCE_MS, 1, emit);
      previewFixture = { tracker, frame };
      return previewFixture;
    })();
  }
  return previewFixtureLoading;
}

/**
 * A snapshot of the widget itself, at the given variant, for the picker modal - built and drawn with
 * the widget's own `build`/`update` (same as `renderGrid`) so what you pick is exactly what you get,
 * not a hand-drawn stand-in. `.widget` sizes itself from `--variant-ratio` (set by the caller) rather
 * than a fixed box, so it renders close to the widget's real grid-cell proportions instead of squashed
 * into an arbitrary strip. Only `frame` is faked, from `PREVIEW_FRAME` - except Pedal Trace, whose
 * rolling buffer needs `PEDAL_TRACE_PREVIEW`'s several points fed in over several calls rather than
 * one - everything else comes from `loadPreviewFixture()`'s idle snapshot. While that's still loading
 * (first use only - it's cached after), this renders a placeholder and re-renders the open modal once
 * it resolves.
 *
 * Builds the DOM only - doesn't call `update()` yet. A canvas-drawing widget (Delta Chart, Speed
 * Chart, Pedal Trace) reads its own `canvas.clientWidth`/`clientHeight` during `update()`, which are
 * both 0 before the card is actually attached to the document; `renderWidgetPickerModal` builds every
 * option's DOM, attaches the whole modal, and only then calls `updatePreview` on each one, the same
 * order `renderGrid`/the main render loop already use for the real grid (build while detached, update
 * only once on-screen).
 */
function buildVariantPreview(widgetId, variantId) {
  const def = WIDGETS[widgetId];
  const card = el('div', 'widget vi-preview');
  card.dataset.variant = variantId;
  if (!def.noLabel) card.append(el('div', 'w-label', def.title));
  const body = el('div', 'w-body');
  card.append(body);
  if (!previewFixture) {
    body.append(el('div', 'vi-preview-loading', 'Loading preview…'));
    loadPreviewFixture().then(() => { if (openPickerWidgetId) renderWidgetPickerModal(); });
    return { card };
  }
  const refs = def.build(body);
  return { card, def, refs, widgetId };
}

/** Runs a preview's first `update()`, once its card is actually attached to the document (see above). */
function updatePreview({ def, refs, widgetId }) {
  const previewCtx = { tracker: previewFixture.tracker, live: previewFixture.tracker.live, theme: app.theme, mode: 'demo' };
  if (widgetId === 'pedalTrace') {
    PEDAL_TRACE_PREVIEW.forEach((s, i) => def.update(refs, { ...previewCtx, frame: { t: i * 300, ...s } }));
  } else {
    def.update(refs, { ...previewCtx, frame: PREVIEW_FRAME });
  }
}

let openPickerWidgetId = null;   // id of the widget whose "choose a design" modal is open, if any
let pickerModalEl = null;        // that modal's DOM node, so it can be torn down again

function onPickerKeydown(event) {
  if (event.key === 'Escape') closeWidgetPicker();
}

function closeWidgetPicker() {
  openPickerWidgetId = null;
  pickerModalEl?.remove();
  pickerModalEl = null;
  document.removeEventListener('keydown', onPickerKeydown);
}

/**
 * The "choose a design" modal: every design a widget offers, shown at once as full-size previews, so
 * picking one doesn't mean clicking through them first. A widget without `variants` still opens it,
 * with its one design as the only option - clicking a palette entry always previews before it lands on
 * the grid, whether or not there's a choice to make (D27's intent, now applied uniformly). Rebuilt
 * from scratch on every call (including the preview-fixture's load callback above) rather than patched
 * in place, same as the rest of this file's render functions.
 */
function renderWidgetPickerModal() {
  pickerModalEl?.remove();
  pickerModalEl = null;
  if (!openPickerWidgetId) return;
  const id = openPickerWidgetId;
  const meta = WIDGET_META[id];
  const options = meta.variants && meta.variants.length > 1 ? meta.variants : [{ id: '', title: null }];

  const modal = el('div', 'modal');
  const card = el('div', 'modal-card wide');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');

  const head = el('div', 'modal-head');
  head.append(el('h2', '', meta.title));
  const closeBtn = el('button', 'btn', '✕');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', closeWidgetPicker);
  head.append(closeBtn);

  // A widget noticeably wider than tall (Sectors, Delta Chart, Lap Table, Pedal Trace) gets two grid
  // columns' width instead of being squeezed to the same column as a roughly-square one (RPM + Gear,
  // Best Lap, ...), which otherwise shrinks its content past legible.
  const wide = meta.addW / meta.addH >= 1.8;

  const grid = el('div', 'variant-modal-grid');
  const previews = [];   // {def, refs, widgetId} for each option that built successfully - updated below, once attached
  for (const v of options) {
    const option = el('button', `variant-modal-option${wide ? ' wide' : ''}`);
    option.type = 'button';
    option.style.setProperty('--variant-ratio', `${meta.addW} / ${meta.addH}`);
    const preview = buildVariantPreview(id, v.id);
    option.append(preview.card);
    if (preview.def) previews.push(preview);
    if (v.title) option.append(el('span', 'variant-modal-label', v.title));
    option.addEventListener('click', () => {
      closeWidgetPicker();
      editor.addWidget(id, v.id || undefined);
    });
    grid.append(option);
  }

  card.append(head, grid);
  modal.append(card);
  modal.addEventListener('click', (event) => { if (event.target === modal) closeWidgetPicker(); });
  document.body.append(modal);
  pickerModalEl = modal;
  for (const preview of previews) updatePreview(preview);
  document.addEventListener('keydown', onPickerKeydown);
}

function openWidgetPicker(widgetId) {
  openPickerWidgetId = widgetId;
  renderWidgetPickerModal();
}

function buildPaletteList(containerId, group) {
  const list = $(containerId);
  list.replaceChildren();
  for (const [id, meta] of paletteEntries(group)) {
    const item = el('button', 'palette-item');
    item.type = 'button';
    const swatch = el('span', 'palette-swatch');
    const name = el('span', 'palette-name', meta.title);
    const size = el('span', 'palette-size', `${meta.addW}×${meta.addH}`);
    item.append(swatch, name, size);
    const already = app.draftLayout.some((it) => it.widget === id);
    item.disabled = already;
    item.classList.toggle('added', already);
    // Preview before placing (D27): every entry opens the picker modal, even with just one design.
    item.addEventListener('click', () => openWidgetPicker(id));
    list.append(item);
  }
}

function renderPalette() {
  buildPaletteList('paletteTiming', 'timing');
  buildPaletteList('paletteDriving', 'driving');
}

const editor = wireEditMode($('grid'), {
  ghostEl,
  getLayout: () => app.draftLayout,
  onChange: (next) => {
    app.draftLayout = next;
    renderGrid(app.draftLayout, true);
    renderPalette();
  },
  onTintCollisions: (ids) => {
    for (const card of $('grid').querySelectorAll('.widget')) card.classList.toggle('collide', ids.includes(card.dataset.widget));
  },
});

/** Clone whatever's currently on screen for the active preset: its saved override or default, or Custom's saved layout. */
function cloneOfPreset() {
  return currentLayout(app.dashboard).map((it) => ({ ...it }));
}

function selectPreset(presetId) {
  if (app.editing) return;
  app.dashboard = switchPreset(app.dashboard, presetId);
  saveState(localStorage, app.dashboard);
  renderGrid(currentLayout(app.dashboard), false);
  renderChrome();
}

function enterEditMode() {
  app.draftLayout = cloneOfPreset();
  app.editing = true;
  closeWidgetPicker();
  renderGrid(app.draftLayout, true);
  renderPalette();
  $('palette').hidden = false;
  renderChrome();
}

/** "Done": the edit is kept and persisted, onto Custom or onto the built-in preset's own saved override (D32). */
function doneEditing() {
  app.dashboard = app.dashboard.presetId === 'custom'
    ? { ...app.dashboard, custom: app.draftLayout.slice() }
    : savePresetEdit(app.dashboard, app.draftLayout);
  saveState(localStorage, app.dashboard);
  app.editing = false;
  app.draftLayout = null;
  closeWidgetPicker();
  $('palette').hidden = true;
  renderGrid(currentLayout(app.dashboard), false);
  renderChrome();
}

/** "Reset to default": Custom goes back to blank; a built-in preset drops its saved override back to its shipped default. */
function resetEditLayout() {
  app.dashboard = resetActivePreset(app.dashboard);
  saveState(localStorage, app.dashboard);
  app.draftLayout = cloneOfPreset();
  renderGrid(app.draftLayout, true);
  renderPalette();
}

/** "Save as Custom": copies the current draft into Custom and switches to it, still editing. */
function saveDraftAsCustom() {
  app.dashboard = saveAsCustom(app.dashboard, app.draftLayout);
  saveState(localStorage, app.dashboard);
  renderChrome();
}

// ---- top bar and overlay ---------------------------------------------------

/** What to say in the top bar right now, and how worried to look. */
function describeStatus() {
  const live = tracker.live;
  const held = tracker.hold ? `Timing held (${tracker.hold}). This lap won't count towards best times.` : null;
  if (app.mode === 'demo') {
    if (app.demo?.done) return { text: 'Demo finished. Press Replay to watch it again.', tone: 'muted' };
    return { text: 'Simulated data', tone: 'muted' };
  }
  if (app.mode === 'imported') {
    const when = app.imported?.exportedAt ? new Date(app.imported.exportedAt).toLocaleString() : '';
    return { text: `Imported session (${tracker.laps.length} laps)${when ? ` · exported ${when}` : ''}`, tone: 'muted' };
  }
  switch (app.connection) {
    case 'connecting': return { text: 'Connecting to bridge…', tone: 'muted' };
    case 'waiting': return { text: 'Connected. Waiting for GT7. Start a race or time trial.', tone: 'warn' };
    case 'lost': return { text: 'Lost connection. Retrying…', tone: 'bad' };
    case 'live': {
      if (held) return { text: `Connected · ${held}`, tone: 'warn' };
      const note = !live ? '' : !live.recording ? 'waiting for the start line'
        : live.referenceLap ? `lap ${live.n}: recording the reference lap` : `lap ${live.n}`;
      return { text: note ? `Connected · ${note}` : 'Connected', tone: 'ok' };
    }
    default: return { text: 'Not connected', tone: 'muted' };
  }
}

/** The message shown over the grid until the first live frame arrives, or null when there isn't one. */
function describeOverlay() {
  if (app.mode !== 'live' || app.frame) return null;
  switch (app.connection) {
    case 'connecting': return { title: 'Connecting to bridge…', text: app.address || '' };
    case 'waiting': return { title: 'Waiting for GT7', text: 'Start a race or time trial.' };
    case 'lost': return { title: 'Lost connection', text: 'Retrying…' };
    default: return null;
  }
}

function renderChrome() {
  const status = describeStatus();
  setText($('statusText'), status.text);
  setClass($('statusText'), `status ${status.tone === 'warn' || status.tone === 'bad' ? status.tone : ''}`);
  setClass($('statusDot'), `dot ${status.tone}`);
  setText($('sourceBadge'), app.mode === 'live' ? 'LIVE' : app.mode === 'imported' ? 'IMPORTED' : 'DEMO');
  setClass($('sourceBadge'), `badge ${app.mode === 'live' ? 'live' : ''}`);
  setText($('exportBtn'), app.mode === 'imported' ? 'Re-export' : 'Export');
  $('exportBtn').disabled = tracker.laps.length === 0;
  $('demoControls').hidden = app.mode !== 'demo';
  setText($('playBtn'), app.demo?.done ? 'Replay' : app.paused ? 'Play' : 'Pause');

  const dim = app.mode === 'live' && (app.connection === 'lost' || app.connection === 'waiting' || !app.frame);
  $('grid').classList.toggle('dim', dim && !app.editing);

  const overlay = describeOverlay();
  $('overlay').hidden = !overlay || app.editing;
  if (overlay) {
    setText($('overlayTitle'), overlay.title);
    setText($('overlayText'), overlay.text);
  }

  $('chromeLeft').hidden = app.editing;
  $('editLeft').hidden = !app.editing;
  $('chromeRight').hidden = app.editing;
  $('editRight').hidden = !app.editing;
  for (const tab of document.querySelectorAll('.preset-tab')) {
    const active = tab.dataset.preset === app.dashboard.presetId;
    tab.setAttribute('aria-selected', String(active));
    setClass(tab, `preset-tab ${active ? 'active' : ''}`);
  }
  $('customDot').hidden = !app.dashboard.custom;
  $('timingDot').hidden = !app.dashboard.overrides?.timing;
  $('drivingDot').hidden = !app.dashboard.overrides?.driving;
  $('everythingDot').hidden = !app.dashboard.overrides?.everything;
}

/** Update every widget and the top bar from the current state. Cheap enough to run every animation frame. */
function render() {
  const ctx = context();
  for (const { def, refs } of app.widgets) def.update(refs, ctx);
  renderChrome();
  if (!$('setup').hidden) renderJitter();
}

// ---- setup panel -----------------------------------------------------------

function setupTab(tab) {
  for (const button of document.querySelectorAll('.tab')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  $('tabDemo').hidden = tab !== 'demo';
  $('tabLive').hidden = tab !== 'live';
}

/** Explain any problem with the entered bridge address; returns true if it looks usable. */
function checkAddress() {
  const value = $('address').value.trim();
  const hint = $('addressHint');
  let text = '';
  let ok = true;
  if (!/^wss?:\/\//i.test(value)) {
    text = 'The address should start with ws:// (for example ws://localhost:8765/ws).';
    ok = false;
  } else if (location.protocol === 'https:' && /^ws:\/\//i.test(value) && !/^ws:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(value)) {
    text = 'This page is served over https, so the browser only allows a bridge on this computer (ws://localhost…). To use an iPad, open the page from the bridge instead.';
    ok = false;
  } else if (app.servedByBridge) {
    text = 'This page is served by the bridge, so this address is already right.';
  }
  hint.textContent = text;
  setClass(hint, `modal-hint ${ok ? '' : 'warn'}`);
  return ok;
}

/** Show the smoothing delay, and how many frames in the last few seconds still arrived too late for it. */
function renderJitter() {
  const ms = jitter.delayMs;
  setText($('jitterValue'), ms === 0 ? 'off' : `${ms} ms`);
  const late = jitter.lateRecently;
  const stalls = late === 0 ? 'No late frames in the last 10 s.' : `${late} late frame${late === 1 ? '' : 's'} in the last 10 s${ms === 0 ? ' (that is the stutter smoothing would hide).' : ': raise the delay to hide them.'}`;
  setText($('jitterHint'), `Holds live frames back briefly so bursts after a network stall look smooth. Lower it until the stutter returns. ${stalls}`);
}

function openSetup() {
  const remembered = storage.get(ADDRESS_KEY);
  const own = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  $('address').value = app.address || (app.servedByBridge ? own : remembered || DEFAULT_ADDRESS);
  checkAddress();
  setupTab(app.mode);
  $('setup').hidden = false;
}

function closeSetup() {
  $('setup').hidden = true;
}

function wireControls() {
  for (const tab of document.querySelectorAll('.preset-tab')) tab.addEventListener('click', () => selectPreset(tab.dataset.preset));
  $('editBtn').addEventListener('click', enterEditMode);
  $('resetPresetBtn').addEventListener('click', resetEditLayout);
  $('saveCustomBtn').addEventListener('click', saveDraftAsCustom);
  $('doneBtn').addEventListener('click', doneEditing);

  $('sourceBadge').addEventListener('click', openSetup);
  $('setupClose').addEventListener('click', closeSetup);
  $('setup').addEventListener('click', (event) => { if (event.target === $('setup')) closeSetup(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSetup(); });
  for (const button of document.querySelectorAll('.tab')) button.addEventListener('click', () => setupTab(button.dataset.tab));
  $('address').addEventListener('input', checkAddress);
  $('jitterDelay').value = String(jitter.delayMs);
  $('jitterDelay').addEventListener('input', () => {
    jitter.setDelay(Number($('jitterDelay').value));
    storage.set(JITTER_KEY, String(jitter.delayMs));
  });
  $('useDemo').addEventListener('click', () => { closeSetup(); startDemo(); });
  $('connectBtn').addEventListener('click', () => {
    if (!checkAddress()) return;
    const url = $('address').value.trim();
    storage.set(ADDRESS_KEY, url);
    closeSetup();
    startLive(url);
  });
  $('playBtn').addEventListener('click', () => {
    if (app.demo?.done) startDemo(); else app.paused = !app.paused;
  });
  $('restartBtn').addEventListener('click', () => startDemo());

  $('exportBtn').addEventListener('click', () => exportSession());
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async () => {
    const [file] = $('importFile').files;
    $('importFile').value = '';   // so choosing the same file again still fires 'change'
    if (!file) return;
    try {
      importSession(await file.text());
    } catch (err) {
      alert(err.message);   // rare and user-caused (wrong file); a modal is fine, no dedicated UI for it
    }
  });
}

// ---- main loop -------------------------------------------------------------

let lastNow = performance.now();

/** One animation frame: advance the demo by real elapsed time (live frames arrive on their own), then render. */
function tick(now) {
  const dt = Math.min(now - lastNow, 100);   // a backgrounded tab must not fast-forward the demo
  lastNow = now;
  if (app.mode === 'demo' && app.demo && !app.paused && !app.demo.done) {
    app.demo.advance(dt, 1, ingest);
  }
  jitter.poll();
  render();
  requestAnimationFrame(tick);
}

/**
 * Find out whether a bridge served this page, build the grid, and start the right source.
 *
 * A bridge answers /bridge.json; the hosted page has no such file. Served by a bridge, the page
 * connects straight to it. Otherwise it opens the setup panel and lets the user choose a source,
 * rather than autoplaying the demo before they've asked for it.
 */
async function main() {
  renderGrid(currentLayout(app.dashboard), false);
  wireControls();
  try {
    const res = await fetch('bridge.json', { cache: 'no-store' });
    if (res.ok) app.servedByBridge = (await res.json()).bridge === true;
  } catch { /* no bridge: this is the hosted page */ }
  $('backLink').hidden = app.servedByBridge;
  if (app.servedByBridge) startLive(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  else openSetup();
  requestAnimationFrame(tick);
}

main();
