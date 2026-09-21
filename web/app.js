// Page wiring: chooses a data source (the demo, or a live bridge), feeds its frames to the LapTracker,
// builds the widget grid, and keeps the widgets and the top bar up to date.
//
// Widgets are defined in widgets.js and arranged by layout.js; all timing logic is in timing.js. This
// file only connects them to a source and to the page.

import { readTheme } from './charts.js';
import { DemoSource } from './demo-source.js';
import { el, setClass, setText } from './dom.js';
import { DEFAULT_LAYOUT } from './layout.js';
import { LiveSource } from './live-source.js';
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

const tracker = new LapTracker();
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
  theme: readTheme(),
  widgets: [],               // { def, refs } for each widget on the grid
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

/** Connect to a bridge at `url` and start a fresh session from its frames. */
function startLive(url) {
  stopLive();
  app.mode = 'live';
  app.address = url;
  resetSession();
  app.connection = 'connecting';
  app.live = new LiveSource(url, { onFrame: ingest, onState: (state) => { app.connection = state; } });
  app.live.connect();
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

/** Create a card for each widget in the layout and let each build its own contents. */
function buildGrid() {
  const grid = $('grid');
  for (const item of DEFAULT_LAYOUT) {
    const def = WIDGETS[item.widget];
    const card = el('section', `widget w-${item.widget}`);
    card.style.gridColumn = `${item.col} / span ${item.w}`;
    card.style.gridRow = `${item.row} / span ${item.h}`;
    if (def.noLabel) card.classList.add('inline');
    else card.append(el('div', 'w-label', def.title));
    const body = el('div', 'w-body');
    card.append(body);
    const refs = def.build(body);
    if (def.onTap) {
      card.classList.add('tappable');
      card.addEventListener('click', () => { def.onTap(context()); render(); });
    }
    grid.append(card);
    app.widgets.push({ def, refs });
  }
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
  setText($('sourceBadge'), app.mode === 'live' ? 'LIVE' : 'DEMO');
  setClass($('sourceBadge'), `badge ${app.mode === 'live' ? 'live' : ''}`);
  $('demoControls').hidden = app.mode !== 'demo';
  setText($('playBtn'), app.demo?.done ? 'Replay' : app.paused ? 'Play' : 'Pause');

  const dim = app.mode === 'live' && (app.connection === 'lost' || app.connection === 'waiting' || !app.frame);
  $('grid').classList.toggle('dim', dim);

  const overlay = describeOverlay();
  $('overlay').hidden = !overlay;
  if (overlay) {
    setText($('overlayTitle'), overlay.title);
    setText($('overlayText'), overlay.text);
  }
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
}

// ---- main loop -------------------------------------------------------------

let lastNow = performance.now();

/** One animation frame: advance the demo by real elapsed time (live frames arrive on their own), then render. */
function tick(now) {
  const dt = Math.min(now - lastNow, 100);   // a backgrounded tab must not fast-forward the demo
  lastNow = now;
  if (app.mode === 'demo' && app.demo && !app.paused && !app.demo.done) {
    app.demo.advance(dt, Number($('speedSel').value), ingest);
  }
  render();
  requestAnimationFrame(tick);
}

/**
 * Find out whether a bridge served this page, build the grid, and start the right source.
 *
 * A bridge answers /bridge.json; the hosted page has no such file. Served by a bridge, the page
 * connects straight to it. Otherwise it starts the demo and leaves the setup panel to the user.
 */
async function main() {
  buildGrid();
  wireControls();
  try {
    const res = await fetch('bridge.json', { cache: 'no-store' });
    if (res.ok) app.servedByBridge = (await res.json()).bridge === true;
  } catch { /* no bridge: this is the hosted page */ }
  $('backLink').hidden = app.servedByBridge;
  if (app.servedByBridge) startLive(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  else await startDemo();
  requestAnimationFrame(tick);
}

main();
