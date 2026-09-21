# FEATURE_MAP.md

At-a-glance inventory of the project's features: what a feature is, where it's reachable, and how far along it is.

Read alongside [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md)'s "Future directions" section (where planned-but-unscoped rows below are sourced from) and [`DECISIONS.md`](DECISIONS.md).

## How to use this file

**Update it whenever a feature ships or its state changes.** A row going from `Planned` → `Designed` → `Implemented` is the expected lifecycle; update the row in place rather than leaving stale duplicates.

**Columns:**

| Column | Meaning |
|---|---|
| Feature | Short name |
| Surface | Where it lives: the page, the bridge, or a dev script |
| Status | `Planned` (an intent, not scoped) · `Designed` (a design exists) · `Implemented` · `Partial` (shipped with a known gap — see Notes) |
| Code ref | Module or file backing it |
| Notes | Known gaps, dependencies, related doc sections |

This project has no user roles or paid tiers, so the Role and Gated-by columns are dropped, and there is no design system, so there is no Design-ref column.

---

## Implemented features

| Feature | Surface | Status | Code ref | Notes |
|---|---|---|---|---|
| Demo / replay mode | Page | Implemented | `web/demo-source.js`, `web/demo-laps.json`, `tools/make_demo.py` | Synthetic laps, labelled as such. Opens with two laps of history; speed 1×–10×; Replay at the end. [D2](DECISIONS.md), [O10](DECISIONS.md) |
| Widget grid (fixed layout) | Page | Implemented | `web/layout.js`, `web/widgets.js`, `web/app.js` | The 12×8 grid from the wireframes, scaling to any screen. Layout is fixed until the customisable dashboard. [`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md) |
| Lap timing: current, predicted, last, best | Page | Implemented | `web/timing.js`, `web/widgets.js` | Needs one full lap first (reference line). [O5](DECISIONS.md) |
| Live delta to best or last lap | Page | Implemented | `web/timing.js` (`live`, `deltaSeries`), `web/widgets.js` | Tap the Delta widget to switch between best and last lap |
| Sector times and comparison | Page | Partial | `web/timing.js`, `web/widgets.js` | One delta per sector (versus the best sector). Splits are fixed at thirds until user-defined splits ship ([Known issue 9](PROJECT_CONTEXT.md)) |
| Theoretical best lap | Page | Implemented | `web/timing.js` (`theoreticalBest`) | Sum of the best valid sector times |
| Lap table with sector columns | Page | Implemented | `web/widgets.js` | Game lap numbers; best sectors and best lap highlighted; interrupted laps greyed |
| Delta chart | Page | Implemented | `web/widgets.js`, `web/charts.js` | Green below zero, red above; split markers drawn. The speed chart is not yet a widget (palette-only, later) |
| Driving widgets (speed, gear and suggested gear, rpm with rev markers, pedals) | Page | Implemented | `web/widgets.js` | Confirmed responding to real PS4 data (2026-09-22). Reverse gear and boost unchecked. [Known issue 15](PROJECT_CONTEXT.md) |
| Setup panel and connection states | Page | Implemented | `web/app.js`, `web/live-source.js` | Demo or Live, bridge address, connecting / waiting for GT7 / live / lost. Checked against the fake console |
| Live mode (WebSocket source) | Page | Implemented | `web/live-source.js` | Works with a real PS4 via a Mac browser. iPad untested. [Known issue 15](PROJECT_CONTEXT.md) |
| GT7 bridge (UDP → WebSocket) | Bridge | Partial | `bridge/bridge.py`, `bridge/gt7.py`, `bridge/frames.py` | Works with a real PS4; type A only. Frames use the game's clock when trusted ([O14](DECISIONS.md)). [Known issues 1–2](PROJECT_CONTEXT.md); Python ([D15](DECISIONS.md)) |
| Page served by the bridge over http on the local network (for an iPad) | Bridge | Partial | `bridge/ws_server.py` | Checked from a desktop browser only. [D16](DECISIONS.md) |
| Interrupted-lap handling (paused / loading / off track) | Page | Partial | `web/timing.js` (`ingest`) | Pause behaviour confirmed on a real PS4; restart and replay not yet seen. [D7](DECISIONS.md), [O11](DECISIONS.md), [Known issue 5](PROJECT_CONTEXT.md) |

---

## Planned / not yet built

| Feature | Surface | Status | Code ref | Notes |
|---|---|---|---|---|
| Track map | Page | Planned | | Own pass and plan doc. [D6](DECISIONS.md) |
| User-defined sector splits | Page | Planned | | Placed on the track map. [D5](DECISIONS.md) |
| Track identification and per-track saved splits | Page | Planned | | Method undecided. [O3](DECISIONS.md) |
| Lap recording / persistence | Page | Planned | | [Known issue 7](PROJECT_CONTEXT.md) |
| Session export / import | Page | Planned | | [Known issue 8](PROJECT_CONTEXT.md) |
| Support for other games | Bridge | Planned | | One decoder per game. [Future directions](PROJECT_CONTEXT.md) |
| Export laps to the car log | Page | Planned | | Depends on a separate Lab entry that doesn't exist yet |
| Customisable dashboard (choose widgets and snap them into a grid; basic presets plus a Custom layout) | Page | Planned | | [Known issue 11](PROJECT_CONTEXT.md); [D11](DECISIONS.md); library question [O13](DECISIONS.md) |
| Speed chart widget | Page | Planned | | Palette-only; comes with the customisable dashboard |
| Tyre widget (tyre graphics that change colour with temperature, no numeric labels) | Page | Planned | | Later, on its own pass: the colour ranges need real data. [D12](DECISIONS.md) |
| Steering widget | Page | Planned | | Its own session. [Known issue 14](PROJECT_CONTEXT.md) |
| Fuel widget (level, consumption, laps remaining) | Page | Planned | | Later, not in the first version. Needs fuel channels in the frame format |
| Phone layout | Page | Planned | | A single-column stack in priority order; designed in `design/`, not built |
