# PROJECT_CONTEXT.md

> Background context for this project. Read this before making changes — it explains what the project is, how it evolved, and what's known to be inconsistent or incomplete. Update this file as things get fixed or scope changes.

## What this is

A web page that shows live racing-game telemetry (Gran Turismo 7 first): lap and sector times and live deltas, fed by a small local bridge, with a demo mode for visitors without a game. It is shown in the "Lab" section of the author's portfolio.

- **Browsers can't receive UDP.** A local bridge (on the player's machine or network) decodes the game's packets and forwards them over a WebSocket to `ws://localhost:<port>` ([D1](DECISIONS.md)).
- **GT7 gives position, not timing structure.** It sends no sector times, no distance around the lap and no track identity, so sectors, progress and deltas are derived from position ([D5](DECISIONS.md)).
- **Static hosting.** The portfolio is a static site on GitHub Pages, built by `build.py`. At build time it clones this repo, runs its build command (this repo needs none), and copies `web/` into `dist/lab/<id>/`. Only `web/` is published, so its paths are relative and it depends on nothing from the portfolio ([D3](DECISIONS.md)).
- **The portfolio doesn't rebuild on its own.** After pushing here, run the "Build and deploy portfolio site" workflow in the portfolio repo.
- **Development setup:** GT7 on a PS4, with the bridge running on a Mac on the same network. The bridge needs the console's IP address; no setting on the console is needed ([`GT7_TELEMETRY.md`](GT7_TELEMETRY.md)).
- **Target device:** an iPad in landscape beside the sim ([D17](DECISIONS.md)). A page hosted on https can't reach a bridge on another device, so the bridge also serves the page over http on the local network ([D16](DECISIONS.md)); the portfolio-hosted page stays as the demo, and works with a bridge on the same computer.
- **Demo data is synthetic** (`tools/make_demo.py`), not recorded from any game.

**Stack:** vanilla JavaScript ES modules and canvas (no framework, no build step); Python for the demo-data generator and the bridge; Node 20's built-in test runner (`node --test`, no dependencies).

## Origin and current scope

The project began as a planning chat about adding a telemetry tool to the portfolio's Lab section. The scope so far is the web page with demo data, the timing logic, and its tests. The bridge, live mode and recording are not built yet ([Known issues](#known-issues--incomplete-areas)). The next milestone ([D13](DECISIONS.md)) is a first proper version with all the Driving and Timing details, fed by a real GT7 session so it can be tested on the author's own console: Known issues 1–6, 12 and 13. The customisable layout (Known issue 11) comes after that ([D13 follow-up](DECISIONS.md)).

Terminology: **bridge** is the local UDP-to-WebSocket program; a **frame** is one normalised telemetry sample (format in the [README](README.md)); the **reference line** is the first complete lap's path, used to measure progress around the track.

A separate Lab entry, a personal log of modified GT7 cars and their times on specific tracks, is a related idea for later; see Future directions.

## Known issues / incomplete areas

> These are things where what we want is settled and it simply isn't built or is broken. Where the *goal itself* is still an open question, it lives in `DECISIONS.md` instead. **New bugs found in passing go in `BUGS.md`, not here** — this list is missing features and architectural debt. Numbers that moved elsewhere leave a gap rather than being renumbered, since other docs cross-reference these issue numbers.

1. **The bridge has not been run against a real console.** `bridge/bridge.py` sends the heartbeat, receives, decrypts, decodes type-A packets, converts them to frames, broadcasts them over a WebSocket and serves `web/` ([D16](DECISIONS.md)); it passes its tests and works end to end against a fake console. Still to do: run it on a real PS4 (Known issue 15), handle the other packet types, and add one decoder module per game so others can be added. Language: Python ([D15](DECISIONS.md)).
2. **GT7 protocol details are only partly verified.** Confirmed on a real PS4 (type A, 2026-09-22): the heartbeat, the encryption and nonce constant, the packet size and rate, the offsets read so far, the pause and loading flags, that `last_lap` updates with the lap counter, that the game's time value (`0x80`) is a usable clock, and that the gear byte gives no signal for reverse (it reads 0, same as neutral — see [D21](DECISIONS.md)). Still unconfirmed: packet types B, `~` and C (offsets and nonce constants), boost, laps in a race (`0x76`), the flag bits beyond 0–5, and what `0x84` and `0x86` hold. The detail, field by field, is in [`GT7_TELEMETRY.md`](GT7_TELEMETRY.md).
3. ~~**No live source in `web/`.**~~ **Resolved** (built; see [`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md) log 3–5). Needs a WebSocket client that emits the same frames as `DemoSource`, plus a Demo/Live switch, connection status and the setup panel from the wireframes ([`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md) §4). When the page is served by the bridge it connects to its own origin; the hosted page uses a bridge-address setting. Blocked by 1.
4. **Browser localhost behaviour is untested.** Check an https page connecting to `ws://localhost` in Chrome, Firefox and Safari early (Safari has been stricter; Chrome is adding a local-network-access prompt).
5. **Interrupted-lap handling is partly confirmed.** Frames flagged paused, loading or off-track are dropped and the lap invalidated ([D7](DECISIONS.md), [O11](DECISIONS.md)). Two real sessions confirmed that the pause flag is set while the game is paused, that packets keep arriving with the game clock standing still, that laps containing a pause are correctly excluded, and (from a clean second session) that consecutive unpaused laps track the game's own lap times closely (within about 20 ms) with normal delta noise around 0.7 ms. Still to do: record a restart and a replay to see what those look like, fix the rules if needed, and turn a clean capture into a committed test fixture. Done: `bridge/tests/fixtures/gt7-ps4-session.jsonl.gz`, a real PS4 recording with a session restart, three clean unpaused laps and a pause, replayed by both suites (`bridge/tests/test_real_session.py`, `tests/real-session.test.mjs`). Also open: [O2](DECISIONS.md).
6. **The decoder must pass `paused`, `loading` and `onTrack` through on each frame** (GT7 flag bits 1, 2 and 0). Packet type C also carries `currentLap`, which could cross-check the tracker's own elapsed time.
7. ~~**Laps aren't persisted.**~~ **Resolved** ([D20](DECISIONS.md)). A refresh or a dropped connection used to lose the session. Completed laps are now saved to IndexedDB as each one finishes (`web/persistence.js`) and restored on the next live connection (`LapTracker#restoreSession`). Live sessions only; the demo builds its own every time. If the restored laps turn out to be for a different track, the tracker notices on its own (persistently off the reference line) and starts over, clearing the stale save too.
8. ~~**No session export/import.**~~ **Resolved** ([D20](DECISIONS.md)). Export and Import buttons in the top bar (`web/session-file.js`) save a session's laps to a JSON file and load one back, for review; importing pauses whatever source is running and shows the file's laps in the same dashboard. There's no dedicated Review view yet (Future directions), so an imported session looks like a live one with no new frames arriving.
9. **Track map and user-defined sector splits** ([D5](DECISIONS.md), [D6](DECISIONS.md)). Sectors are currently fixed thirds of the lap. Done = draw the reference line as a map, click to add a split at the nearest point on the line (stored as a fraction of the lap), drag or delete splits, persist them per track. Groundwork exists: sector times are derived from stored samples ([O6](DECISIONS.md)) and split markers already draw on the charts. Needs a way to identify tracks ([O3](DECISIONS.md)) and will get its own `TRACK_MAP_PLAN.md`. Check whether GT7's axes need a flip so the map isn't mirrored.
10. **Portfolio side (outside this repo).** Replace the placeholder `lap-sim` entry in the portfolio's `lab-tools.json` with the entry in the [README](README.md), then run the deploy workflow.
11. ~~**No customisable dashboard.**~~ **Resolved** ([D11](DECISIONS.md); log 11 in [`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md)). Timing, Driving, Everything and Custom presets, a widget registry (`web/layout.js`), edit mode (drag, resize, an add-widget palette, remove) and a phone layout that collapses to a single column. Only Custom persists (`localStorage`, `web/dashboard-state.js`); the built-in presets are always their own fixed default. Checked against the fake console at desktop, 375×812 and 844×390; not yet on a real iPad or phone (Known issue 15).
12. ~~**The frame format lacks some Driving channels.**~~ **Resolved** (log 1 in [`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md)); `totalLaps` is in the format but the bridge doesn't fill it yet, because its offset is unconfirmed. Frames carry speed, throttle, brake, gear, rpm and position, and the page displays only speed. For the first proper version ([D13](DECISIONS.md), [D19](DECISIONS.md)) the frame gains the suggested gear, the rev-warning and rev-limiter rpm, and total laps. The full field list, and what is planned for each, is in [`GT7_TELEMETRY.md`](GT7_TELEMETRY.md). Done = the decoder and the demo generator both produce them. Tyre, fuel and other channels come later ([D12](DECISIONS.md)); a widget whose channel is missing shows "no data" instead of breaking.
13. ~~**No Driving widgets.**~~ **Resolved** (log 4; untested on real data, Known issue 15). Nothing displays pedals, gear or rpm. Done = widgets for speed, gear with suggested gear, rpm with rev markers, and pedals (throttle and brake), each usable in any layout (Known issue 11). Part of the first proper version ([D13](DECISIONS.md)). Wireframes are in `design/`, and specified, with the changes made to them, in [`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md). Driver aids and boost aren't wanted ([D19](DECISIONS.md)).
14. **No steering widget.** Deferred to its own session ([D19](DECISIONS.md)). Needs the steering angle from packet type B or C, whose offsets aren't confirmed, so it starts with a capture from a real console.
15. **The iPad path is untested; the PS4 and phone paths work.** The bridge has run against a real PS4, and the dashboard responded with live values both from a Mac browser and (per the user) a phone browser (2026-09-22): see [`GT7_TELEMETRY.md`](GT7_TELEMETRY.md) "Confirmed on a real PS4". A second, clean multi-lap session confirmed the live delta tracks the game's own delta closely (the user measured about 4 ms). Still to do: open the page from the iPad specifically over the local network (with the Mac's firewall and the iPad's Auto-Lock in mind), run a full race for `laps_in_race`, and record a restart and a replay.

<!-- Resolved items are struck through and annotated, not deleted:
     1. ~~**Title.**~~ **Resolved** (`DECISIONS.md` D#). What changed, in a line or two. -->

## Data model note

Two `LapTracker` methods now build a session from outside a live stream of frames, both used by
persistence and import/export: `reset(reason)` clears everything and says why (`'manual'` or
`'lost-reference'`); `restoreSession({ laps, splits, compareMode })` rebuilds the reference line from
the first restored lap and continues from there, exactly as importing a mid-session reconnect. An
`onEvent(type, payload)` callback (`'lap'`, `'reset'`, `'restore'`) lets a caller react without
polling every frame.

## Future directions (deferred — not scoped, not started)

Ideas that are wanted or plausible but have no design and no owner yet. Promote one to Known issues (settled and planned) or to `DECISIONS.md` (needs a call) when it becomes real.

### More games

Forza, F1, ACC, Assetto Corsa, iRacing and others mostly broadcast UDP. Each needs one decoder that maps to the frame format; the page and `timing.js` shouldn't change. Deferred until the GT7 bridge works.

### Export laps to a car log

A separate Lab entry for a personal log of modified GT7 cars and their times on specific tracks. The telemetry tool could export laps into it. No design yet; depends on export (Known issue 8) and track identification (O3).

### Map colouring and shared split presets

Colour the track map by delta or speed for a chosen lap; share per-track split sets as JSON. Only after the track-map pass, and only if it stays simple.

### Analysis features other GT7 tools offer

Other GT7 telemetry tools, such as [gt7-datalogger](https://github.com/jbhoorasingh/gt7-datalogger) and [gt7-telemetry-analyzer](https://github.com/MoebiusX/gt7-telemetry-analyzer), go beyond timing. Candidates for later, none scoped: multi-lap overlays with a synced cursor; throttle, brake and coast zones and speed peaks drawn on the track map; a ghost-lap overlay comparing racing lines; lockup, wheelspin and kerb-strike detection from wheel speed against car speed; micro-sector heatmaps showing where time is lost; fuel strategy (fuel to empty, pit window); CSV or MoTeC-compatible export; audio coaching. Most need the track map and recording first.

### Re-basing the reference line

If a messy first lap makes the reference line poor ([O5](DECISIONS.md)), re-project stored laps onto the best lap's line. Laps keep their `x, z` samples and splits are stored as fractions, so this is possible without losing data.

## How to use this file

- Treat this as background, not a task list. When asked to explore, map, or document the repo, use this file to understand intent — don't treat it as a prompt to start fixing things.
- When an item above gets resolved, update this file so it stays accurate (strike it through and annotate; don't delete or renumber).
- Companion docs: [`DECISIONS.md`](DECISIONS.md) (open questions + decision log), [`CLAUDE.md`](CLAUDE.md) (conventions and standing rules), [`BUGS.md`](BUGS.md) (confirmed/suspected bugs, separate from the incomplete-feature list above), [`FEATURE_MAP.md`](FEATURE_MAP.md) (features and their status), [`GT7_TELEMETRY.md`](GT7_TELEMETRY.md) (what the GT7 packet provides), [`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md) (the dashboard design and build plan). A `TRACK_MAP_PLAN.md` will be added when the track-map pass starts.
