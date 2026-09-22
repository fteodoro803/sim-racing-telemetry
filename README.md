# sim-racing-telemetry

A dashboard that shows live racing-game telemetry: lap and sector times, deltas against your best
or last lap, speed, gear, rpm and pedals. Built for Gran Turismo 7 first, and for an iPad in landscape
beside the sim; other games later.

Status: **the demo, the bridge and the live dashboard work end to end, against a fake console and a
real PS4 (checked from a Mac browser). The iPad is not yet tested.**
Known issues and open questions live in [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) and [DECISIONS.md](DECISIONS.md); features and their status in [FEATURE_MAP.md](FEATURE_MAP.md).

## How it fits together

```
PS4 --UDP--> bridge --WebSocket--> dashboard page (in a browser, on any device on your network)
```

Browsers can't receive UDP, so a small program, the bridge, runs on a computer on your network. It
asks the console for telemetry, decodes each packet into a frame, and streams the frames to the page
over a WebSocket. It also serves the page itself over http, so an iPad on the same Wi-Fi opens
`http://<computer's address>:8765`. (A page hosted on https can't connect to a bridge on another
device, which is why the bridge serves the page.) The page also has a demo mode that replays
simulated laps, so the portfolio-hosted copy works with no game and no bridge.

## Layout

```
web/      published to the portfolio, and served by the bridge: the dashboard
bridge/   NOT published: the program that talks to the console (Python, standard library only)
design/   the dashboard wireframes (open the .dc.html files in a browser)
tools/    dev scripts, e.g. make_demo.py
tests/    node --test tests/  (the web side)
```

`web/` is plain static files with relative paths and no build step, so it can be served from
`/lab/<id>/`. Only `web/` is published. Its main pieces: `layout.js` (the 12×8 grid, the widget
registry and the Timing/Driving/Everything presets), `dashboard-state.js` (which preset is active
and Custom's saved layout), `edit.js` (edit mode's drag, resize and palette interactions),
`widgets.js` (one definition per widget), `timing.js` (the lap tracker), the two data sources
`demo-source.js` and `live-source.js`, `persistence.js` and `session-file.js` (saving, restoring,
exporting and importing a session), and `app.js`, which wires them together.

A live session's completed laps are saved to the browser's IndexedDB as each one finishes, and
restored the next time you connect, so a refresh or a dropped connection doesn't lose them. If the
restored laps turn out to be for a different track, the tracker notices on its own and starts fresh.
Export and Import in the top bar save a session to a JSON file and load one back, for either the
demo or a live session.

## Run it

To see the demo, serve the page and open http://localhost:8000:

```bash
npm run serve
```

To try the whole live path with no console (a built-in fake console sends made-up data):

```bash
python3 bridge/bridge.py --fake-console
```

To use a real PS4, replace `YOUR-PS4-IP` with its own IP address (on the PS4: Settings > Network > View
Connection Status), start GT7, and open the address the bridge prints, on this computer or on your iPad.
More in [bridge/README.md](bridge/README.md):

```bash
python3 bridge/bridge.py --ps4-ip YOUR-PS4-IP
```

Tests:

```bash
npm test
```

```bash
npm run test:bridge
```

```bash
npm run demo-data    # regenerate web/demo-laps.json (pure Python)
```

Opening `index.html` straight from disk won't work (ES modules and `fetch` need http).

## Frame format

Every source (demo, and each game's bridge decoder) produces the same normalised frame.
`timing.js` only ever sees this, so it knows nothing about any particular game. This is the small
slice the dashboard actually uses; what GT7's packet gives beyond it, and what each field is or isn't
used for yet, is in [GT7_TELEMETRY.md](GT7_TELEMETRY.md#at-a-glance-every-field-the-decoder-gives-and-what-we-do-with-it).

| field | unit | notes |
|---|---|---|
| `t` | ms | monotonic timestamp of the frame. The bridge uses the game's own clock when it can be trusted, and arrival time otherwise |
| `lap` | int | the game's lap counter. A change means the car crossed the line |
| `x`, `z` | m | position on the ground plane |
| `speed` | km/h | |
| `throttle`, `brake`, `clutch` | 0-100 | |
| `gear` | int | 0 is neutral, -1 is reverse (inferred from velocity vs. heading — GT7's gear byte doesn't signal it, see D21) |
| `suggestedGear` | int, optional | the gear the game suggests; equal to `gear` when there is no suggestion |
| `rpm` | rpm | |
| `rpmWarning`, `rpmLimiter` | rpm, optional | where the game's shift alert starts, and the limiter. Used for the rev markers |
| `tyreTemp` | °C, array of 4 (FL, FR, RL, RR), optional | surface temperature. No ideal range is given, so the Tyres widget's colour thresholds are a placeholder |
| `totalLaps` | int, optional | laps in the race; 0 or absent in free practice |
| `lastLap` | ms, optional | game-reported time of the lap just completed. Used when > 0 |
| `paused`, `loading`, `onTrack` | bool, optional | Absent means normal driving. See "Interrupted laps" below. |

Over the WebSocket each frame is a JSON object with `"type": "frame"`. The bridge also sends a
`hello` on connect and a `status` message once a second saying whether packets are still arriving.

## Design decisions

Each of these is tracked, with its tradeoffs and whether it has been ratified, in
[DECISIONS.md](DECISIONS.md) (O5–O11).

- **Sectors are derived, not stored.** GT7 sends position but no sector times or track distance.
  The first complete lap becomes a reference line; each later lap is projected onto it to get
  progress in metres. Every lap keeps `(time, progress)` samples, and sector times are computed
  from those and the current split points. Change the splits and every lap recomputes.
  Tradeoff: needs one full lap before sectors and deltas appear.
- **Laps that start mid-lap aren't timed.** If you join a session mid-lap, that partial lap is
  ignored; timing starts at the next line crossing.
- **Line crossing is placed between frames** using progress on either side, so sector times
  are accurate to well under one frame rather than quantised to the frame rate.
  Lap time itself uses the game's `lastLap` when it looks fresh and plausible; if the game hasn't yet
  updated it, or it is far from the tracker's own estimate, the estimate is used.
- **Interrupted laps.** Frames flagged `paused`, `loading` or `onTrack: false` are dropped, the
  timing clock skips the gap, and the lap they interrupted is marked invalid: it stays in the
  table but never counts towards best lap, best sectors, theoretical best or the "last lap"
  comparison, and can't become the reference lap. This is deliberately simple. How GT7 actually
  reports these states isn't known yet, so the rules will be revisited against real packets.
- **The dashboard is a grid of widgets.** Each widget is a definition in `widgets.js` that builds its own
  DOM and updates from shared state, placed by `layout.js`. Users choose and move widgets: presets
  (Timing/Driving/Everything), edit mode (drag, resize, an add-widget palette) and a Custom layout
  that persists locally ([D11](DECISIONS.md), [D23](DECISIONS.md), [D24](DECISIONS.md)).
- **No framework, no charting library.** Two canvas charts and a few DOM updates don't justify one.
- **Demo data is synthetic** (made-up circuit, generated by `tools/make_demo.py`), and the page says so.

## Try it: what a real packet looks like

```
position                 (39.26, -4.90, 96.92)
speed_ms                 52.82        # 190 km/h
gear                     6
suggested_gear           3
rpm                      5963
throttle                 255
brake                    0
lap                      3
last_lap                 124907       # ms
tyre_temp                (79.9, 78.7, 71.6, 70.8)
flags                    9            # car_on_track, in_gear
...
```

One PS4 packet decodes into about 40 values like these (`decode_a()` in `bridge/gt7.py`); see
[GT7_TELEMETRY.md](GT7_TELEMETRY.md) for the full field-by-field reference.

## Adding it to the portfolio

In the portfolio repo's `lab-tools.json`, replace the placeholder `lap-sim` entry:

```json
{ "id": "telemetry", "title": "Sim Racing Telemetry",
  "tags": "Web, Python, Gran Turismo 7",
  "description": "Live lap, sector and delta timing from racing-game telemetry, with a demo mode.",
  "repo": "fteodoro803/sim-racing-telemetry", "output": "web", "enabled": true }
```

Then run the "Build and deploy portfolio site" workflow. The portfolio doesn't rebuild on its own.
