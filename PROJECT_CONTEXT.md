# PROJECT_CONTEXT.md

> Background context for this project. Read this before making changes — it explains what the project is, how it evolved, and what's known to be inconsistent or incomplete. Update this file as things get fixed or scope changes.

## What this is

A web page that shows live racing-game telemetry (Gran Turismo 7 first): lap and sector times and live deltas, fed by a small local bridge, with a demo mode for visitors without a game. It is shown in the "Lab" section of the author's portfolio.

- **Browsers can't receive UDP.** A local bridge (on the player's machine or network) decodes the game's packets and forwards them over a WebSocket to `ws://localhost:<port>` ([D1](DECISIONS.md)).
- **GT7 gives position, not timing structure.** It sends no sector times, no distance around the lap and no track identity, so sectors, progress and deltas are derived from position ([D5](DECISIONS.md)).
- **Static hosting.** The portfolio is a static site on GitHub Pages, built by `build.py`. At build time it clones this repo, runs its build command (this repo needs none), and copies `web/` into `dist/lab/<id>/`. Only `web/` is published, so its paths are relative and it depends on nothing from the portfolio ([D3](DECISIONS.md)).
- **The portfolio doesn't rebuild on its own.** After pushing here, run the "Build and deploy portfolio site" workflow in the portfolio repo.
- **Development setup:** GT7 on a PS4, with the bridge running on a Mac on the same network. The bridge needs the console's IP address; no setting on the console is needed ([`GT7_TELEMETRY.md`](GT7_TELEMETRY.md)).
- **Demo data is synthetic** (`tools/make_demo.py`), not recorded from any game.

**Stack:** vanilla JavaScript ES modules and canvas (no framework, no build step); Python for the demo-data generator and the bridge; Node 20's built-in test runner (`node --test`, no dependencies).

## Origin and current scope

The project began as a planning chat about adding a telemetry tool to the portfolio's Lab section. The scope so far is the web page with demo data, the timing logic, and its tests. The bridge, live mode and recording are not built yet ([Known issues](#known-issues--incomplete-areas)). The next milestone ([D13](DECISIONS.md)) is a first proper version with all the Driving and Timing details, fed by a real GT7 session so it can be tested on the author's own console: Known issues 1–6, 12 and 13. The customisable layout (Known issue 11) comes after that ([D13 follow-up](DECISIONS.md)).

Terminology: **bridge** is the local UDP-to-WebSocket program; a **frame** is one normalised telemetry sample (format in the [README](README.md)); the **reference line** is the first complete lap's path, used to measure progress around the track.

A separate Lab entry, a personal log of modified GT7 cars and their times on specific tracks, is a related idea for later; see Future directions.

## Known issues / incomplete areas

> These are things where what we want is settled and it simply isn't built or is broken. Where the *goal itself* is still an open question, it lives in `DECISIONS.md` instead. **New bugs found in passing go in `BUGS.md`, not here** — this list is missing features and architectural debt. Numbers that moved elsewhere leave a gap rather than being renumbered, since other docs cross-reference these issue numbers.

1. **The bridge isn't written.** `bridge/` is a stub. Done = receive UDP on 33740 (sending the heartbeat to 33739), decrypt and decode GT7 packets, and forward normalised frames over a WebSocket, with one decoder module per game so others can be added. Language: Python ([D15](DECISIONS.md)).
2. **GT7 protocol details are unverified.** Ports, the heartbeat (a packet-type byte, needed roughly every 1000 packets or about 16 s), Salsa20 key and nonce derivation (the nonce constant varies by game version), field offsets and units (speed in m/s, pedals 0–255, current gear in the low nibble) are only summarised from community docs. Check against a parser's source before relying on them. The current understanding, field by field, is in [`GT7_TELEMETRY.md`](GT7_TELEMETRY.md).
3. **No live source in `web/`.** Needs a WebSocket client that emits the same frames as `DemoSource`, plus a Demo/Live switch and connection status. Blocked by 1.
4. **Browser localhost behaviour is untested.** Check an https page connecting to `ws://localhost` in Chrome, Firefox and Safari early (Safari has been stricter; Chrome is adding a local-network-access prompt).
5. **Interrupted-lap handling is a first pass.** Frames flagged paused, loading or off-track are dropped and the lap invalidated ([D7](DECISIONS.md), [O11](DECISIONS.md)). Done = capture a real session with a pause, a restart and a replay, confirm what the flags do and whether the game's lap timer includes a pause, fix the rules, and turn the capture into test fixtures. Also open: [O2](DECISIONS.md).
6. **The decoder must pass `paused`, `loading` and `onTrack` through on each frame** (GT7 flag bits 1, 2 and 0). Packet type C also carries `currentLap`, which could cross-check the tracker's own elapsed time.
7. **Laps aren't persisted.** A refresh loses the session. Done = completed laps survive a reload (IndexedDB).
8. **No session export/import.** Done = a session's laps (`timeMs`, time and progress samples, channels) round-trip through a JSON file.
9. **Track map and user-defined sector splits** ([D5](DECISIONS.md), [D6](DECISIONS.md)). Sectors are currently fixed thirds of the lap. Done = draw the reference line as a map, click to add a split at the nearest point on the line (stored as a fraction of the lap), drag or delete splits, persist them per track. Groundwork exists: sector times are derived from stored samples ([O6](DECISIONS.md)) and split markers already draw on the charts. Needs a way to identify tracks ([O3](DECISIONS.md)) and will get its own `TRACK_MAP_PLAN.md`. Check whether GT7's axes need a flip so the map isn't mirrored.
10. **Portfolio side (outside this repo).** Replace the placeholder `lap-sim` entry in the portfolio's `lab-tools.json` with the entry in the [README](README.md), then run the deploy workflow.
11. **No customisable dashboard.** The page is one fixed layout. Wanted ([D11](DECISIONS.md)): users choose which widgets are on screen and snap them into a grid, with a few basic presets and a "Custom" layout they build themselves, since not everyone wants the same things. Done = a widget registry (each widget declares the channels it needs), an edit mode with an add-widget palette and drag/resize on a snapping grid, layouts saved locally, the presets, and the existing panels (readouts, sector cards, charts, lap table) rebuilt as widgets whose default layout looks as the page does today. The phone layout collapses to a single column. Library or hand-rolled: [O13](DECISIONS.md).
12. **The frame format lacks most Driving channels.** Frames carry speed, throttle, brake, gear, rpm and position, and the page displays only speed. For the first proper version ([D13](DECISIONS.md)) the frame gains the rest of the Driving channels (clutch, suggested gear, rev-limit thresholds and alert, boost, steering angle, and the handbrake, TCS and ASM flags) plus the current lap time and total laps for Timing. The full field list, and what is planned for each, is in [`GT7_TELEMETRY.md`](GT7_TELEMETRY.md). Done = the decoder and the demo generator both produce them. Tyre, fuel and other channels come later ([D12](DECISIONS.md)); a widget whose channel is missing shows "no data" instead of breaking.
13. **No Driving widgets.** Nothing displays pedals, gear, rpm, boost or steering. Done = widgets for speed, throttle and brake (and clutch), gear with suggested gear, rpm with a rev-limit indicator, boost, steering angle and the driver-aid indicators (handbrake, TCS, ASM), each usable in any layout (Known issue 11). Part of the first proper version ([D13](DECISIONS.md)).

<!-- Resolved items are struck through and annotated, not deleted:
     1. ~~**Title.**~~ **Resolved** (`DECISIONS.md` D#). What changed, in a line or two. -->

## Future directions (deferred — not scoped, not started)

Ideas that are wanted or plausible but have no design and no owner yet. Promote one to Known issues (settled and planned) or to `DECISIONS.md` (needs a call) when it becomes real.

### More games

Forza, F1, ACC, Assetto Corsa, iRacing and others mostly broadcast UDP. Each needs one decoder that maps to the frame format; the page and `timing.js` shouldn't change. Deferred until the GT7 bridge works.

### Export laps to a car log

A separate Lab entry for a personal log of modified GT7 cars and their times on specific tracks. The telemetry tool could export laps into it. No design yet; depends on export (Known issue 8) and track identification (O3).

### Map colouring and shared split presets

Colour the track map by delta or speed for a chosen lap; share per-track split sets as JSON. Only after the track-map pass, and only if it stays simple.

### Tyre colours

Tyres drawn as graphics that change colour with temperature, with no numeric labels ([D12](DECISIONS.md)). GT7 gives a surface temperature per tyre but no ideal window ([`GT7_TELEMETRY.md`](GT7_TELEMETRY.md)), so the colour ranges need real data and their own dedicated pass. Deferred until the first proper version is working on real data.

### Analysis features other GT7 tools offer

Other GT7 telemetry tools, such as [gt7-datalogger](https://github.com/jbhoorasingh/gt7-datalogger) and [gt7-telemetry-analyzer](https://github.com/MoebiusX/gt7-telemetry-analyzer), go beyond timing. Candidates for later, none scoped: multi-lap overlays with a synced cursor; throttle, brake and coast zones and speed peaks drawn on the track map; a ghost-lap overlay comparing racing lines; lockup, wheelspin and kerb-strike detection from wheel speed against car speed; micro-sector heatmaps showing where time is lost; fuel strategy (fuel to empty, pit window); CSV or MoTeC-compatible export; audio coaching. Most need the track map and recording first.

### Re-basing the reference line

If a messy first lap makes the reference line poor ([O5](DECISIONS.md)), re-project stored laps onto the best lap's line. Laps keep their `x, z` samples and splits are stored as fractions, so this is possible without losing data.

## How to use this file

- Treat this as background, not a task list. When asked to explore, map, or document the repo, use this file to understand intent — don't treat it as a prompt to start fixing things.
- When an item above gets resolved, update this file so it stays accurate (strike it through and annotate; don't delete or renumber).
- Companion docs: [`DECISIONS.md`](DECISIONS.md) (open questions + decision log), [`CLAUDE.md`](CLAUDE.md) (conventions and standing rules), [`BUGS.md`](BUGS.md) (confirmed/suspected bugs, separate from the incomplete-feature list above), [`FEATURE_MAP.md`](FEATURE_MAP.md) (features and their status), [`GT7_TELEMETRY.md`](GT7_TELEMETRY.md) (what the GT7 packet provides). A `TRACK_MAP_PLAN.md` will be added when the track-map pass starts.
