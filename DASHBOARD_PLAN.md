# Dashboard: layout, widgets and live mode

<!-- File name: DASHBOARD_PLAN.md. One plan doc per large change. -->

## Context

Today the page is one fixed layout of panels (readouts, sector cards, two charts, a lap table) that plays the demo. The goal is a dashboard usable on an iPad in landscape beside the sim ([D17](DECISIONS.md)), showing all the Driving and Timing details from a real GT7 session ([D13](DECISIONS.md)), so it can be tested on the author's own console. Later it becomes a customisable grid of widgets with presets and a Custom layout ([D11](DECISIONS.md)); that comes after the first testable version.

To reach an iPad, the bridge also serves the page over plain http on the local network, because a page hosted on https can't connect to a bridge on another device ([D16](DECISIONS.md)). The portfolio-hosted page stays as the demo.

Low-fidelity wireframes were made in Claude Design from prompts and saved in `design/` (five `.dc.html` screens plus the `support.js` runtime that renders them; open them in a browser). The first version follows them as they are, to test live data; a redesign comes later ([D18](DECISIONS.md)). This doc records what the wireframes specify, where they need correcting for what GT7 actually sends, and the order to build in.

## Implementation Log

Tracks what's actually been built, in order, as this plan is implemented.

**Scope of the first pass:** the "Everything" layout as a fixed grid, with the Timing widgets plus speed, gear, rpm and pedals; frames extended to carry those channels; the bridge forwarding frames over a WebSocket and serving `web/`; a live source with the setup panel and connection states. **Not in it:** presets switching, edit mode and the Custom layout, steering (its own session), driver aids and boost (not wanted, [D19](DECISIONS.md)), tyres, fuel, track map, the Review view, the phone layout.

**Status:** steps 1–5 complete; step 6 half done: it has run against a real PS4 from a Mac browser and (per the user) a phone browser, and works well; the iPad specifically is still to try. `npm test` (54) and `npm run test:bridge` (69) pass.

1. **Frame format and demo data** (step 1). Added `suggestedGear`, `rpmWarning`, `rpmLimiter` and `totalLaps` (optional) to the frame format, the demo generator and `DemoSource`; documented in the README. The generator now compares the stored (rounded) rpm against the warning level, after a test caught them disagreeing.
2. **Bridge** (step 2). `bridge/bridge.py` runs the console capture, converts each packet to a frame (`frames.py`), and broadcasts it over a WebSocket. `ws_server.py` is a standard-library HTTP and WebSocket server on one port: it serves `web/`, answers `/bridge.json`, and upgrades `/ws`. `--fake-console` tries the whole path with no PS4. Diverged from the plan: the WebSocket server is hand-written rather than a `websockets` dependency, so the bridge still needs nothing installed.
3. **Live source** (step 3). `web/live-source.js`: a WebSocket client with connecting, waiting, live and lost states and a backoff reconnect; unit-tested with a fake socket. The setup panel and the connection states are in `app.js`.
4. **Dashboard** (step 4). `web/layout.js`, `web/widgets.js`, `web/dom.js` and a rewritten `index.html`, `style.css` and `app.js`: the 12×8 grid of widgets from section 1, styled with section 2, scaled with one `--u` unit so it fits any screen. The delta chart draws green below zero and red above. Widgets: current lap, delta (tap to switch best/last), sectors, delta chart, last, best, predicted, lap table, rpm, gear, speed and pedals.
5. **Checked in a browser against the fake console** (step 5), at 1180×820 and 1024×768: live values, laps and sectors accumulating; the lost-connection state (dims, reconnects by itself and starts a fresh session); the waiting-for-GT7 state; the hosted page starting in the demo and connecting to a bridge from the setup panel.
6. **Extra robustness.** The tracker ignores a game lap time that hasn't been updated yet (the lap counter can change a frame before `last_lap`) or is far from its own estimate, falling back to its own timing. Tests fail without it.
7. **Lap numbers.** The lap table uses the game's lap numbers, which differ from the tracker's own count when joining mid-session.
8. **Second real PS4 session: three clean unpaused laps.** Confirmed the live delta tracks the game's own lap-time differences closely (the user measured about 4 ms) and that consecutive laps' own times matched the game's within about 20 ms. Found and fixed a subtler issue: the sample marking a lap boundary was placed by interpolating position, which is unreliable right at the start/finish line where the car's path can cross itself; when both sides of the boundary are on the trusted game clock, it is now pinned to the exact game lap time instead ([O14](DECISIONS.md) follow-up). Committed that second session as a test fixture (`bridge/tests/fixtures/gt7-ps4-session.jsonl.gz`), replayed by both test suites; it turned out to also contain a session restart and a pause, so it covers more of Known issue 5 than expected. Added `GT7_TELEMETRY.md`'s "At a glance" table (every field the decoder gives, and whether the dashboard uses it yet), linked from the README.
9. **First real PS4 session (step 6, in part).** Everything responded. A recorded session showed that arrival-time timestamps made the delta wobble (std 4.3 ms, spikes to 100 ms) and drift from the game's time (a lap timed 384 ms off). The bridge now stamps frames with the game's own clock when it can be trusted (`GameClock`, [O14](DECISIONS.md)): delta noise 0.3 ms, spikes under 6 ms, lap timed to 9 ms. Also fixed after the first attempt failed: a crash when the record folder didn't exist, which the bridge had swallowed ([BUG-1](BUGS.md)).
10. **Reverse gear** ([D21](DECISIONS.md)). The user noticed the Gear widget never showed reverse. A dedicated real-PS4 capture (drive, stop, reverse back the same way, stop) showed the gear byte reads 0 throughout reverse, identical to neutral — GT7 gives no separate signal for it. The bridge now infers reverse from `velocity` opposing the heading derived from `rotation`'s yaw (`_is_reversing` in `bridge/frames.py`); the frame's `gear` is -1 and the widget shows "R". Committed the capture as a test fixture (`bridge/tests/fixtures/gt7-ps4-reverse.jsonl.gz`, replayed by `bridge/tests/test_real_reverse.py`).

## 1. Grid and layout

From `Live Dashboard.dc.html`. iPad landscape, 1180×820 CSS px.

| Item | Value |
|---|---|
| Top bar | 48px tall, dark panel with a bottom border |
| Grid margin | 16px, so the grid area is 1148×740 |
| Grid | 12 columns × 8 rows, 12px gutters |
| Row height | 82px; columns share the width equally (about 84.7px) |
| Widget | A whole number of cells, a card with a 6px radius and a 1px border |

The wireframe's "Everything" arrangement (columns × rows, position is column/row, starting at 1), as adjusted for the first version:

| Widget | Size | Position |
|---|---|---|
| Current lap | 3×2 | col 1–3, row 1–2 |
| Delta | 3×2 | col 4–6, row 1–2 |
| Sectors | 6×2 | col 1–6, row 3–4 |
| Delta chart | 6×2 | col 1–6, row 5–6 |
| Last lap / Best lap / Predicted | 2×2 each | row 7–8, col 1–2 / 3–4 / 5–6 |
| RPM | 6×1 | col 7–12, row 1 |
| Gear | 2×3 | col 7–8, row 2–4 |
| Speed | 4×3 | col 9–12, row 2–4 |
| Pedals | 2×4 | col 7–8, row 5–8 (the wireframe had 2×3) |
| Lap table | 4×4 | col 9–12, row 5–8 (fills the space left by the removed steering, driver-aids and boost widgets) |

The speed chart is a palette-only widget for later. On screens other than 1180×820 the grid fills the viewport under the top bar and everything scales in proportion.

## 2. Visual tokens

The wireframes reuse the colour tokens already in `web/style.css`. Page and cards:

| Token | Value |
|---|---|
| Page background | `#101216`; top bar and cards `#171a20` |
| Border | `#2b3038` (stronger `#3a414c`) |
| Text | `#e8eaee`; muted `#8c929d`, dimmer `#6d7481` |
| Live / current | `#5aa7ff` |
| Faster (negative delta) | `#4cc38a` |
| Slower (positive delta) | `#ff6b6b` |
| Best time | `#b98cf0` |
| Neutral / static | `#5b6472` |

Type is a monospaced stack with tabular numerals: a 42px semibold value for the two big timing readouts, 22px for secondary times, 78px bold for gear and speed, and 11px uppercase labels with a little letter-spacing.

## 3. Widgets and their data

Availability is against what GT7's type-A packet gives ([`GT7_TELEMETRY.md`](GT7_TELEMETRY.md)).

| Widget | Data | Availability |
|---|---|---|
| Current lap, Delta, Predicted, Last, Best, Sectors, Delta chart, Lap table | The lap tracker (`web/timing.js`) | Works from position and lap counter |
| Speed | `speed` | Type A |
| Gear | `gear`, `suggested_gear` | Type A. Reverse is inferred, not decoded directly ([D21](DECISIONS.md)) |
| RPM | `rpm`, `rpm_warning`, `rpm_limiter` | Type A |
| Pedals | `throttle`, `brake` | Type A |

Not in the first version: **Steering** (needs packet type B or C, whose offsets aren't confirmed; its own session), and **Driver aids** and **Boost** (not wanted).

## 4. Screens and states from the wireframes

- **Top bar:** app name, a source badge (DEMO or LIVE) with a status dot and text, the preset switcher (Timing, Driving, Everything, Custom), an Edit button and a fullscreen button.
- **Setup panel** (modal over the dashboard): choose Demo or Live; Live has a bridge-address field (the wireframe shows `ws://localhost:9010` as an example), a Connect button, three steps ("Start the bridge on your computer", "Start GT7", "Connect") and a "Download the bridge" link.
- **Connection states:** connecting; connected but waiting for the game ("Waiting for GT7. Start a race or time trial."); live and healthy; timing held ("Timing held (paused). This lap won't count towards best times.", with a "not counted" tag on the current lap); connection lost (values dimmed, "Lost connection. Retrying…").
- **Widget no-data state:** a dash with a subtle "no data" note.
- **Presets** (later): Timing, Driving, Everything, and a Custom that starts as a copy of the active preset, with an "edited" state and a blank state.
- **Edit mode** (later): drag handles, four resize handles and a remove button per widget, a palette drawer (Timing, Driving, and "coming later" entries for Tyres, Fuel and Track map), a red invalid-drop state, and Done / Reset to preset / Save as Custom.
- **Phone** (later): a single-column stack in priority order (Delta, Current lap, Gear/Speed/RPM, Sectors, Last/Best, then the rest), portrait plus a simplified landscape; no edit mode.

## 5. Changes from the wireframes

1. **Driver aids and Boost are removed**, and **Steering is deferred** ([D19](DECISIONS.md)). The driver-aids wireframe also showed ABS, which GT7 doesn't send.
2. **The freed space is used** for a taller Pedals widget (2×4) and a Lap table (4×4), so lap and sector times can be checked while testing live.
3. **Sector cards show one delta each**, versus the best sector, as drawn ([D18](DECISIONS.md) follow-up). The tracker can supply a second (versus the last lap); it isn't shown yet.
4. **The preset switcher and Edit button are hidden** in the first pass. Only the "Everything" layout exists.
5. **Brake colour:** the wireframe draws the brake bar grey. In use it needs a colour when pressed; the first version uses amber (`#e5a64a`), distinct from the delta's red and green.
6. **Delta on the Delta widget** switches between "vs best lap" and "vs last lap" when the widget is tapped, replacing the wireframe-less "Compare to" control, so it works by touch.
7. **Dark only** for now: the wireframes are dark, and the page previously followed the system light/dark setting.

## 6. Data path

```
PS4 --UDP--> bridge --WebSocket--> page (served by the bridge over http, or the hosted demo)
```

- The bridge decodes packets into the frame format and sends frames over a WebSocket, and serves the `web/` folder over http, so an iPad opens `http://<mac-ip>:<port>`.
- When served by the bridge, the page connects to its own origin. The hosted page uses the bridge-address field from the setup panel.
- The frame format gains suggested gear, rev-warning and rev-limiter rpm, and total laps. `paused`, `loading` and `onTrack` come from the flags ([Known issue 6](PROJECT_CONTEXT.md)). The bridge stamps each frame with the game's own clock when it can be trusted, and with arrival time otherwise ([O14](DECISIONS.md)).
- The bridge serves the page and the WebSocket on one port, at `/ws`, and answers `/bridge.json` so the page can tell it is being served by a bridge and connect to its own origin. With no bridge (the hosted page) that file doesn't exist, and the page starts in Demo.
- Because http on a network address isn't a secure context, the browser's screen wake lock isn't available on the iPad. Set Auto-Lock to Never on the iPad, or use Guided Access. Untested on a real iPad.

## 7. Build order

1. Extend the frame format and the demo generator with the Driving channels, and update the README and tests.
2. Bridge: turn decoded packets into frames, add the WebSocket, and serve `web/`. Test against the fake console.
3. Web: a live source with the Demo/Live switch, the setup panel and the connection states.
4. Web: rebuild the page as the 12×8 grid of widgets in section 1, in the wireframe's styling, with corrections from section 5.
5. Run it in a browser against the fake console, end to end.
6. Try it on the real PS4 and iPad, then fix what the real packets show (offsets, gear encoding, boost, pause flags).
7. After that: presets, edit mode, the Custom layout, then the tyre and track-map passes.

## Verification

- `npm test` and `npm run test:bridge` pass.
- With the fake console and the bridge running, open the served page in a browser and confirm every widget shows live values and the lap tracker produces laps.
- At 1180×820, confirm nothing overflows and the grid matches section 1.
- Real console (pending, step 6): run the capture tool and the full bridge on the PS4, then open the page on the iPad over the local network. Expect to correct: byte offsets, gear encoding, the meaning of `onTrack`, and whether the game updates `last_lap` when the lap counter changes.

## Flagged open questions

- ~~How does GT7 encode neutral and reverse in the gear field? The wireframe shows "N".~~ **Resolved** ([D21](DECISIONS.md)): it doesn't — the gear byte reads 0 (neutral) throughout reverse too. The frame's `gear` is -1 in reverse, inferred from velocity opposing heading; the widget shows "R".
- Pedal colours: throttle blue and brake amber. Check they read well next to the delta's green and red once seen on the iPad.
- Whether `onTrack` (flag bit 0) really means what the parser docs say. If GT7 clears it in some modes, timing would be held throughout; the page shows why, so it will be visible on first contact.
- Hand-rolled or library grid for edit mode: [O13](DECISIONS.md).
- Whether to serve over http only, or also offer a way to reach it by name (for example the Mac's `.local` hostname).
