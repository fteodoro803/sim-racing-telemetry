# LEARNINGS.md

Notes on the pieces of this project that are new or still being learned. Newest first within each kind.

## Vanilla JS + canvas
*13 October 2026 · Foundation*

- **What it is**: Plain ES modules in the browser, with `<canvas>` for drawing. No framework and no build step.
- **Purpose**: Keeps `web/` static and standalone so the portfolio can copy it as it is.
- **How it's used**: Each widget is a definition with `build` once and `update` on every frame. `drawChart` in `web/charts.js` clears and redraws the whole canvas on each call.
- **Pros / cons**: Nothing to install or bundle and it is easy to publish. You write the "what changed" bookkeeping yourself, which React does for you.
- **Compared to React 19**: Carries over: breaking the UI into components and feeding them one shared state. Works differently: no virtual DOM, so `update` mutates elements directly. New: canvas is immediate-mode, so nothing remembers what was drawn and every frame is redrawn from scratch.
- **Why it fits this project**: A live dashboard redrawing at frame rate is a good match for canvas, and a static folder is what the portfolio needs.

## UDP + WebSockets
*13 October 2026 · Foundation*

- **What it is**: UDP sends packets with no connection and no delivery guarantee. A WebSocket is one long-lived two-way connection over HTTP.
- **Purpose**: Browsers can't receive UDP, so a bridge turns the console's UDP packets into WebSocket messages.
- **How it's used**: `bridge/capture.py` binds a UDP socket and sends the console a heartbeat so it keeps streaming. `bridge/ws_server.py` upgrades `/ws` to a WebSocket and broadcasts each frame. `web/live-source.js` listens in the browser.
- **Pros / cons**: Low delay and simple on the wire. Packets can be dropped or reordered, so the code has to cope with gaps.
- **Compared to Meteor**: Carries over: the server pushes updates and the client reacts. Works differently: no publications or collections, just raw messages you decode yourself. New: the console stops sending unless the heartbeat keeps coming.
- **Why it fits this project**: GT7 only speaks UDP, so there is no alternative to a bridge.

## IndexedDB
*13 October 2026 · Foundation*

- **What it is**: A key-value store built into the browser, which can hold structured objects.
- **Purpose**: Saves the session so a refresh doesn't lose the laps.
- **How it's used**: `web/persistence.js` opens one database with one object store, and `put`s the whole session record under a single key. Every call is wrapped so a failure never breaks the page.
- **Pros / cons**: Survives reloads and holds big objects. The API is callback-based, so `settle` wraps requests as promises, and it can be missing or blocked in private windows.
- **Compared to MongoDB**: Carries over: you store whole objects without a fixed schema. Works differently: you ask for a key, not a query, and there are no collections beyond object stores. New: `onupgradeneeded` is the only place you can create a store, and writes happen inside transactions.
- **Why it fits this project**: One session record per browser is all that is needed, and there is no server to hold it.
