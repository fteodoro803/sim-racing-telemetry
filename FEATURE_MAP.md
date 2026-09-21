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
| Lap timing: current, predicted, last, best | Page | Implemented | `web/timing.js`, `web/app.js` | Needs one full lap first (reference line). [O5](DECISIONS.md) |
| Live delta to best or last lap | Page | Implemented | `web/timing.js` (`live`, `deltaSeries`) | "Compare to" switch chooses the reference lap |
| Sector times and comparison (per sector: vs best sector, vs last lap, best) | Page | Partial | `web/timing.js`, `web/app.js` | Splits are fixed at thirds until user-defined splits ship ([PROJECT_CONTEXT](PROJECT_CONTEXT.md) Known issue 9) |
| Theoretical best lap | Page | Implemented | `web/timing.js` (`theoreticalBest`) | Sum of the best valid sector times |
| Lap table with sector columns | Page | Implemented | `web/app.js` | Best sectors and best lap highlighted; interrupted laps greyed |
| Speed and delta charts | Page | Implemented | `web/charts.js` | Hand-drawn canvas; split markers drawn |
| Interrupted-lap handling (paused / loading / off track) | Page | Partial | `web/timing.js` (`ingest`) | First pass, untested against real packets. [D7](DECISIONS.md), [O11](DECISIONS.md), [Known issue 5](PROJECT_CONTEXT.md) |

---

## Planned / not yet built

| Feature | Surface | Status | Code ref | Notes |
|---|---|---|---|---|
| GT7 bridge (UDP → WebSocket) | Bridge | Planned | `bridge/` (stub) | [Known issues 1–2](PROJECT_CONTEXT.md); language: Python ([D15](DECISIONS.md)) |
| Live mode (WebSocket source) | Page | Planned | | Blocked by the bridge. [Known issues 3–4](PROJECT_CONTEXT.md) |
| Track map | Page | Planned | | Own pass and plan doc. [D6](DECISIONS.md) |
| User-defined sector splits | Page | Planned | | Placed on the track map. [D5](DECISIONS.md) |
| Track identification and per-track saved splits | Page | Planned | | Method undecided. [O3](DECISIONS.md) |
| Lap recording / persistence | Page | Planned | | [Known issue 7](PROJECT_CONTEXT.md) |
| Session export / import | Page | Planned | | [Known issue 8](PROJECT_CONTEXT.md) |
| Support for other games | Bridge | Planned | | One decoder per game. [Future directions](PROJECT_CONTEXT.md) |
| Export laps to the car log | Page | Planned | | Depends on a separate Lab entry that doesn't exist yet |
| Customisable dashboard (choose widgets and snap them into a grid; basic presets plus a Custom layout) | Page | Planned | | [Known issue 11](PROJECT_CONTEXT.md); [D11](DECISIONS.md); library question [O13](DECISIONS.md) |
| Tyre widget (tyre graphics that change colour with temperature, no numeric labels) | Page | Planned | | Later, on its own pass: the colour ranges need real data. [D12](DECISIONS.md) |
| Driving widgets (speed, pedals and clutch, gear and suggested gear, rpm and rev-limit indicator, boost, steering, driver-aid indicators) | Page | Planned | | First proper version. [Known issues 12–13](PROJECT_CONTEXT.md); fields in [`GT7_TELEMETRY.md`](GT7_TELEMETRY.md) |
| Fuel widget (level, consumption, laps remaining) | Page | Planned | | Later, not in the first version. Needs fuel channels in the frame format |
