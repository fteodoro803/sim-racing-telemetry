// Page wiring: chooses a data source (the demo, or a live bridge), feeds its frames to the LapTracker,
// builds the widget grid, and keeps the widgets and the top bar up to date.
//
// Widgets are defined in widgets.js and arranged by layout.js; all timing logic is in timing.js. This
// file only connects them to a source and to the page.

import { readTheme } from './charts.js';
import { DemoSource } from './demo-source.js';
import { currentLayout, loadState, resetActivePreset, saveAsCustom, saveState, switchPreset } from './dashboard-state.js';
import { el, setClass, setText } from './dom.js';
import { buildEditChrome, wireEditMode } from './edit.js';
import { PRESET_LAYOUTS, WIDGET_META } from './layout.js';
import { LiveSource } from './live-source.js';
import { clearSession, loadSession, saveSession } from './persistence.js';
import { buildExport, downloadJson, exportFilename, readImport } from './session-file.js';
import { LapTracker } from './timing.js';
import { WIDGETS } from './widgets.js';

const $ = (id) => document.getElementById(id);

const DEMO_HISTORY_LAPS = 3;                       // open the demo with laps 1-2 already driven
const DEFAULT_ADDRESS = 'ws://localhost:8765/ws';  // where the bridge listens when run on this computer
const ADDRESS_KEY = 'telemetry.bridgeAddress';

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
  dashboard: loadState(),    // { presetId, custom } - which preset is showing, and Custom's saved layout
  editing: false,            // edit mode: dragging, resizing, adding and removing widgets
  draftLayout: null,         // the layout being edited, only while `editing`
};

// ---- data sources ----------------------------------------------------------

/** Take one frame from the active source: remember it for the widgets and feed the lap tracker. */
function ingest(frame) {
  app.frame = frame;
  tracker.ingest(frame);
}

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
  app.live = new LiveSource(url, { onFrame: ingest, onState: (state) => { app.connection = state; } });
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
      const { chrome, drag, remove, size, select } = buildEditChrome(item.widget, WIDGET_META[item.widget]?.variants);
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
    item.addEventListener('click', () => editor.addWidget(id));
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

/** Clone a preset's default layout, or Custom's saved one (blank if it has none yet). */
function cloneOfPreset(presetId) {
  return (presetId === 'custom' ? (app.dashboard.custom || []) : PRESET_LAYOUTS[presetId]).map((it) => ({ ...it }));
}

function selectPreset(presetId) {
  if (app.editing) return;
  app.dashboard = switchPreset(app.dashboard, presetId);
  saveState(localStorage, app.dashboard);
  renderGrid(currentLayout(app.dashboard), false);
  renderChrome();
}

function enterEditMode() {
  app.draftLayout = cloneOfPreset(app.dashboard.presetId);
  app.editing = true;
  renderGrid(app.draftLayout, true);
  renderPalette();
  $('palette').hidden = false;
  renderChrome();
}

/** "Done": a Custom edit is kept (and persisted); editing a built-in preset without saving as Custom is discarded. */
function doneEditing() {
  if (app.dashboard.presetId === 'custom') {
    app.dashboard = { ...app.dashboard, custom: app.draftLayout.slice() };
    saveState(localStorage, app.dashboard);
  }
  app.editing = false;
  app.draftLayout = null;
  $('palette').hidden = true;
  renderGrid(currentLayout(app.dashboard), false);
  renderChrome();
}

/** "Reset to preset": Custom goes back to blank; a built-in preset just re-clones its own fixed default. */
function resetEditLayout() {
  app.dashboard = resetActivePreset(app.dashboard);
  if (app.dashboard.presetId === 'custom') saveState(localStorage, app.dashboard);
  app.draftLayout = cloneOfPreset(app.dashboard.presetId);
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
}

/** Update every widget and the top bar from the current state. Cheap enough to run every animation frame. */
function render() {
  const ctx = context();
  for (const { def, refs } of app.widgets) def.update(refs, ctx);
  renderChrome();
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
