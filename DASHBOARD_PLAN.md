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
11. **Customisable dashboard** (section 8; D11, D23, D24), built ahead of the original order (step 7) since the first-pass real-console testing was already in good shape. `web/layout.js` gained the widget registry (`WIDGET_META`) and the Timing/Driving preset layouts, plus pure/tested grid geometry (`itemsOverlap`, `hasCollision`, `firstFreeSpot`, `resizeFromCorner`). `web/dashboard-state.js` (new, DOM-free, tested) holds which preset is active and Custom's saved layout, persisted to `localStorage`. `web/edit.js` (new) wires the pointer drag/resize/collision interactions from section 8.2 on top of that geometry. `web/app.js` now rebuilds the grid from whichever layout is active (`renderGrid`) instead of a single hard-coded one, and wires the preset switcher, Edit button, palette drawer and the edit-mode top bar. Added the Speed Chart widget (`web/widgets.js`), which needed `LapTracker#speedSeries` in `web/timing.js` (same shape and caching as `deltaSeries`; `timeAt` was refactored onto a shared `valueAt` interpolator so the two share code). Checked end to end in a browser against the fake console: switching presets, entering edit mode, dragging, resizing, adding from the palette (including the "nothing fits" no-op), removing, Save as Custom, Reset to preset, Done, persistence across a reload, the Custom empty state, and both phone breakpoints. `npm test` (73, up from 54) passes.
    - **Correction while writing section 8**: the wireframe's Driving preset also drew Steering, driver aids and Boost, which would contradict D19 ("aren't wanted") and need undecoded data; none of the three were built (see section 8.1's note). Driving's own layout leaves that space empty instead.
    - **Not built yet**: the palette's drag-and-drop-from-drawer motion is click-to-add (drops at the first free spot) rather than a drag with a live ghost preview from the drawer itself; dragging an already-placed widget does have the full ghost/collision preview. Good enough for a functioning palette; revisit if it feels wrong in use.
12. **Widgets are now size-responsive** ([D25](DECISIONS.md)), found necessary while testing 11: resizing a widget in edit mode left its font size fixed (driven by the page-level `--u` unit), so a shrunk widget could overflow and a grown one just left extra space empty. `web/style.css` makes `.widget` a CSS size container; every content rule that used to read `calc(N * var(--u))` now reads `max(floor, min(Hcqh, Wcqw, ceiling))`, scaling off the widget's own box. `.sector` and `.pedal` are nested containers so a 3-up Sectors row or a 2-up Pedals pair size against their own column. `web/charts.js`'s axis text (canvas-drawn) scales the same way off the canvas's rendered size. Verified in a browser: Gear shrunk to its 2×2 floor, Speed grown to 4×7, Delta Chart shrunk to 4×2 - no overflow, no dead space, `npm test` (73) unaffected (pure CSS/canvas, no logic touched).
13. **RPM and Pedals gained real structural breakpoints, from `design/Widget Responsive Behavior.dc.html`** (committed to `design/`). RPM: a `grid-template-areas` layout in `.rpm-row` switches between three shapes by container size - label-over-value only (too narrow for a bar), label+value+bar inline once ≥300px wide (chosen for bar+tick legibility, not tied to a specific column count, since a widget's actual pixel width also depends on the screen's `--u`), and label+value / a shift-light row / a thicker bar once also ≥230px tall. The shift lights (`rpm-lights`, 12 segments) light up per-segment in the same normal/warn/limit zones as the bar, computed from the frame's own `rpm`/`rpmWarning`/`rpmLimiter` in `widgets.js`. Pedals: gained a third bar, Clutch (`CLU`), and flips from vertical bars to stacked horizontal ones under `@container (max-height: 120px)` via the same DOM/CSS-`order` trick, using a `--fill` custom property so one JS write drives either a bar's height or its width depending on orientation. Required lowering `pedals.minH` from 2 to 1 in `WIDGET_META` - the vertical floor (2×2) and the horizontal shape (down to 1 row tall) are different minimums, and the old registry only had the first. Also added the `clutch` channel end to end (`bridge/gt7.py` already decoded it; `bridge/frames.py` now scales it into the frame like throttle and brake; updated `GT7_TELEMETRY.md`, the README frame format, and `web/demo-source.js`, which reports a constant 0, matching the fake console, since neither models the clutch pedal). Clutch was never part of D19's "not wanted" list (that's driver aids and boost only) - it just hadn't been surfaced yet. The same wireframe also designed the Tyres widget, previously deferred (D12): four tyre+caliper pairs (`web/widgets.js`'s `tyres`), coloured by temperature zone (`web/tyre-color.js`, tested) with a right-side mirror via a CSS class rather than different DOM order, matching the design's calipers-face-the-centreline layout. The design paired the colour with a number despite being told not to; the user chose to build it that way, overturning D12 as [D26](DECISIONS.md). Colour thresholds are a placeholder (GT7 gives no ideal range). Needed `tyreTemp` added to the frame format end to end, the same way `clutch` was (`bridge/frames.py`, `GT7_TELEMETRY.md`, the README, and a speed-derived synthetic value in `web/demo-source.js`, since the fake console's tyre temps are static). `npm test` (75) and `npm run test:bridge` (69) pass.
    - **Testing note**: verifying the resize interactions in a browser kept hitting a stale-module-cache wall (the served file was correct, confirmed by `curl` and by direct pure-function tests, but the running page's imports wouldn't update even across full reloads and a fresh tab). Re-serving on a different port (a new origin, no cache history) was what finally worked - not a code issue, but worth remembering next time a browser check of a hand-edited `.js` file "won't update".
14. **RPM and Pedals' shape is now an explicit choice, not picked from size** ([D27](DECISIONS.md)). Log 13's `@container` breakpoints meant resizing could silently restructure a widget (a narrow RPM lost its bar without being asked to); the user wanted the two separated. `WIDGET_META` entries gained a `variants` list; a layout item can carry `variant` (`web/layout.js`'s `defaultVariant` picks the first when it doesn't); a `<select>` in the widget's edit-mode chrome (`buildEditChrome` in `web/edit.js`, wired to a new `editor.setVariant`) switches it, setting `data-variant` on the card. `style.css`'s breakpoints became `[data-variant="…"]` rules; the D25 fluid cqh/cqw scaling inside each shape didn't need to change. Checked in a browser: switching RPM to "Shift Lights" then shrinking it to 3×1 keeps the lights (cramped, but not broken) instead of reverting to the bar-less shape; Pedals' "Horizontal" choice round-trips through Save as Custom and a reload. `npm test` (76) passes.
15. **Adjustments from an updated `design/Widget Responsive Behavior.dc.html`** (overwritten in place; same session as logs 13-14). Three changes:
    - **Pedals layout shift, fixed.** `.pedal-pct` had no fixed width, so "100%" (three digits) was wider than "0%"/"78%", nudging the whole row's `justify-content: space-around` spacing whenever a pedal hit full. Gave it a fixed, cqh/cqw-scaled width in the vertical layout too (the horizontal one already had this).
    - **Tyres, resized.** The user's adjusted design fills more of the box (~60%) with tighter gaps between the four corners; updated the `.tyre`/`.caliper`/`.tyre-temp` clamp() formulas and `.tyre-grid`'s gap to match.
    - **RPM gained two more variants**, `segmented` (2e: number + a lit-segment bar in one row, instead of a continuous fill) and `barOnly` (2f: the segmented bar alone, no number) - both reuse the existing `.rpm-lights` markup already built for the `lights` variant, just placed inline instead of in its own row. Five RPM variants now: Compact, Bar, Segmented, Bar Only, Shift Lights. `npm test` (76) passes.
16. **RPM and Gear merged into one widget, `rpmGear`** ([D28](DECISIONS.md)), from the "RPM + Gear (combined)" section added to `design/Widget Responsive Behavior.dc.html`. The standalone RPM and Gear entries are gone from `WIDGET_META`, the palette and both built-in presets that used them (Everything, Driving); `rpmGear` takes three variants (D27-style, chosen explicitly, not by size):
    - **stacked** (default): the gear digit + suggested-gear hint, a "RPM 1234" label row, and the 12-segment shift-light bar, stacked top to bottom. This is the shape the user picked from the first round of mockups.
    - **column**: an edge-to-edge gear digit beside a vertical 12-segment shift-light column, no numeric rpm readout - for a small/square slot where the digit should dominate.
    - **ring**: the gear digit centred over a circular shift-light "ring" (an SVG arc, 270° sweep open at the bottom) that fills clockwise as rpm rises, coloured by zone the same as the bar/lights; no numeric rpm readout either. The arc's dash length comes from the live path's own `getTotalLength()` rather than a hand-computed constant.
    All three reuse the same built DOM (`web/widgets.js`'s `rpmGear`), shown/hidden and rearranged per `[data-variant]` in `web/style.css`, matching the D27 pattern. `web/dom.js` gained a small `svgEl` helper for the ring's namespaced SVG elements (and a reminder that SVG elements don't support plain `.className =` assignment - the ring's class updates go through `setAttribute('class', …)` instead). `minW`/`minH` are 2×2 for all three variants; the Everything and Driving presets were reshaped to give the merged widget the combined footprint the old RPM bar + Gear card used between them. Checked in a browser: all three variants render and update live against the demo source, the variant `<select>` in edit-mode chrome switches between them, and the phone/tablet layout (`.w-rpmGear` replacing `.w-gear/.w-rpm`) shows no overflow at 375×812. `npm test` (76) passes.
17. **The Timing widgets gained explicit variants** ([D29](DECISIONS.md)), from a "Timing widgets" section added to `design/Widget Responsive Behavior.dc.html`. Seven widgets gained a `variants` list (D27's mechanism, unchanged): Delta (`minimal`/`gauge`), Sectors (`segments`/`list`/`chips`/`fill`), Delta Chart (`area`/`areaReadout`), Last Lap (`stacked`/`row`/`dual`/`trend`), Best Lap (`minimal`/`lapNumber`/`sectorSplit`/`wideStrip`), Predicted (`stacked`/`basisNote`/`range`/`compact`) and Lap Table (`table`/`compactList`/`rowCards`/`spreadsheet`); Current Lap wasn't touched, since the mockup only gave it one design and it already matched what was built. Each widget follows the same pattern as `rpmGear`/`pedals`: `build()` constructs every variant's DOM once, `update()` populates all of them every cycle, and `web/style.css`'s `[data-variant=…]` rules pick which one shows. New data needed: `LapTracker#worstLap` (`web/timing.js`, mirrors `bestLap`, for Predicted's `range` variant plotting the estimate between the session's best and worst lap) and an optional `fill` on a signed series in `charts.js`'s `drawChart`/`strokeSigned` (split into `signedRuns` + a new `fillSigned`, for Delta Chart's `area`/`areaReadout`), unused by the Speed chart. None of the new variants repeat the widget's own title text inside the body, since the card header already shows it - the standalone mockup previews do, so the built widgets read a little sparser than the mockups by design. Best Lap's `minimal` variant is the only one keeping the theoretical-best sub-line ([D29](DECISIONS.md)); none of the new mockup options had room for it. `WIDGET_META`'s `minW`/`minH` weren't changed - D25's fluid cqh/cqw clamps already shrink a variant's content gracefully at whatever size the widget's existing floor allows. Preset layouts (`PRESET_LAYOUTS`) now name each of these widgets' default variant explicitly, matching the existing `rpmGear`/`pedals` entries; `tests/layout.test.mjs`'s preset-consistency check requires it once a widget has `variants`. Added `worstLap` coverage to `tests/timing.test.mjs`. `npm test` (77) passes.
18. **The Driving widgets were right-sized against a re-issued design doc** ([D30](DECISIONS.md)). The user tightened `design/Widget Responsive Behavior.dc.html`'s Tyres/RPM+Gear/Speed/Pedals boxes to their real grid-cell sizes and padding; an audit (registry sizes read from `WIDGET_META`, fill measured live in a browser rather than guessed from CSS) found `rpmGear`'s add-size was 3×2 against a 2×2 mockup (the user's "Ring should be 2×2" report, which turned out to apply to all three shapes), `tyres` was 3×3 against 2×2, `pedals`' add-size (2×3) matched neither shape, and `speed` had no shape choice despite the doc now drawing two. Fixed in `web/layout.js`: `rpmGear` add-size → 2×2; `tyres` min/add-size → 2×2; `pedals` add-size → 2×2 (matches `vertical`, the default); `speed` gained an `inline`/`stacked` `variants` pair (D27 pattern, `inline` default - same DOM, just `.speed-row`'s flex direction switches per `[data-variant]`), with `minH` dropped to 1 so `inline`'s true 2×1 floor is reachable (same reasoning as Pedals' `minH` drop in log 13). `PRESET_LAYOUTS`'s two `speed` entries now name `variant: 'inline'` explicitly, required once a widget has `variants` (`tests/layout.test.mjs`'s preset-consistency check). In `web/style.css`: `.pedal-track`'s width ceiling raised (`min(14cqh, 55cqw, 40px)` → `min(20cqh, 90cqw, 90px)`) - measured live at the true 2×2 floor, the track went from 54% to 77% of its column's width; `.tyre`'s width ceiling loosened as headroom (`170px`/`27cqw`/`35cqh` → `260px`/`35cqw`/`45cqh`) for when Tyres is resized above its floor - not broken at the floor itself (measured ~97% fill there already), so lower priority. Checked in a browser: all four widgets land at their corrected size when added from the palette, RPM+Gear's Ring variant renders as a proper square gauge at 2×2, Speed's variant select switches between inline and stacked. Surfaced but did not fix [BUG-3](BUGS.md) (Tyres clips on the phone single-column layout - a `container-type: size`/`grid-auto-rows: auto` interaction unrelated to these desktop-grid sizes). Right-sizing (registry size against the mockup's tag, fill checked live) is now a standing convention, folded into `CLAUDE.md`. `npm test` (77) passes.

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
- **Presets, edit mode and phone** (later, not in the first pass): full spec in section 8, from `Presets.dc.html`, `Edit Mode.dc.html` and `Phone Dashboard.dc.html`.

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

## 8. Presets, edit mode and phone (customisable dashboard, [D11](DECISIONS.md))

Comes after the first testable version (step 7 above). From `Presets.dc.html`, `Edit Mode.dc.html` and `Phone Dashboard.dc.html`. The grid is hand-rolled, not a library ([D23](DECISIONS.md)).

### 8.1 Preset layouts

Same grid as section 1 (12×8, 82px rows, 12px gutters). "Everything" is the fixed layout already built (section 1). The other two presets rearrange the same widgets:

| Widget | Timing | Driving |
|---|---|---|
| Current lap | 6×2, col 1–6, row 1–2 | 2×2, col 11–12, row 2–3 |
| Delta | 6×2, col 7–12, row 1–2 | 2×2, col 11–12, row 4–5 |
| Sectors | 12×2, col 1–12, row 3–4 | — |
| Speed chart | 6×2, col 1–6, row 5–6 | — |
| Delta chart | 6×2, col 7–12, row 5–6 | — |
| Last lap / Best lap / Predicted | 2×2 each, row 7–8, col 1–2 / 3–4 / 5–6 | — |
| Lap table | 6×2, col 7–12, row 7–8 | — |
| RPM | — | 12×1, col 1–12, row 1 |
| Gear | — | 4×4, col 1–4, row 2–5 |
| Speed | — | 6×4, col 5–10, row 2–5 |
| Pedals | — | 2×3, col 1–2, row 6–8 |

Notes:
- Timing's Speed chart is the palette-only widget from section 1; it ships with the customisable dashboard, not before.
- **The wireframe's Driving preset also shows Steering, driver aids and Boost; none of the three are built.** Checked against [D19](DECISIONS.md) while writing this spec: driver aids and boost "aren't wanted" (not "later" — a firm no), and steering needs packet type B or C, which the bridge doesn't decode ([Known issue 14](PROJECT_CONTEXT.md)). So Driving's own space (col 3–12, row 6–8 in the wireframe) stays empty in the built preset for now; the palette has no Driving-only entries beyond what section 1 already has (Gear, Speed, RPM, Pedals) until one of those changes. If steering ships later (its own session, [D19](DECISIONS.md)), it joins the palette then; driver aids and boost would need D19 revisited first.
- **Custom starts blank** ([D24](DECISIONS.md)): no widgets, a centred "No widgets yet — Add widgets from the palette and arrange them on the grid" message and an "Add widgets" button that opens the palette. Once the user adds anything, Custom holds whatever they built; there is no "reset to copy of X" — only "Reset to preset" in edit mode, which for Custom means "back to blank" (see 8.2).

### 8.2 Edit mode

Entered from the top bar's Edit button on any preset (including Custom). Top bar swaps to: "Editing layout" label, and three actions — **Reset to preset** (Custom: back to blank; Timing/Driving/Everything: back to that preset's default arrangement, discarding edits), **Save as Custom** (copies the current, possibly-edited arrangement into Custom and switches to it), **Done** (exits edit mode, keeping the edits in place for Custom; Timing/Driving/Everything edits are not persisted — only Custom is saved, so editing a built-in preset is really a way to seed Custom via "Save as Custom").

Per-widget chrome while editing:
- **Drag handle** (top-left, `⠿`), press-and-hold to drag.
- **Remove button** (top-right, ×, red-tinted).
- **Four corner resize handles**, dashed squares just outside each corner.
- **Size tag** (bottom-left), e.g. "3×2", showing the widget's current cell span.
- **Variant select** (top-centre), only for widgets with more than one shape (RPM + Gear, Pedals): switches the widget's shape explicitly, independent of its size ([D27](DECISIONS.md); §8 note below).
- Non-dragged widgets get a dashed border instead of the normal solid one, to read as "editable" without competing with the dragged widget.

Drag interaction:
1. Press and hold the drag handle; the widget lifts (shadow, slight rotation, "DRAGGING" label, `pointer-events:none` on the grid beneath) and follows the pointer.
2. A ghost outline shows the cell(s) the drop would snap to, snapping to whole cells only.
3. If the ghost overlaps another widget, the ghost turns red-dashed and the overlapped widget(s) tint red — invalid drop, releasing there snaps back to the widget's last valid position.
4. On a valid release, the widget snaps into the new cells; other widgets do not auto-rearrange to make room (no auto-flow) — an invalid drop is just rejected, not resolved by pushing anything else.

Resize interaction: dragging a corner handle grows/shrinks the widget by whole cells from that corner, with the same collision check as drag (red ghost/tint, snaps back if invalid). Each widget declares a minimum size in its registry entry (the widget registry is `CLAUDE.md`'s "Dashboard elements are widgets" convention); resize can't go below it.

Palette drawer: opens over the right edge of the grid (300px wide, on top — widgets underneath are still visible/dimmed, not reflowed) when adding a widget, grouped **Timing** (Current lap, Delta, Sectors, Delta chart, Speed chart, Last/Best/Predicted, Lap table) and **Driving** (RPM + Gear, Speed, Pedals) — every widget built in section 1, plus Speed chart, with RPM and Gear now the one merged widget ([D28](DECISIONS.md), log 16). A disabled **Coming later** group (Tyres, Fuel, Track map, greyed at 45% opacity with a "SOON" pill, not draggable) covers widgets that don't exist yet; Steering, driver aids and Boost belong there too once any of them ships, per the 8.1 note above, not before. Each entry shows a size swatch, name and cell-size tag (e.g. "6×3" for Lap Table — larger than its 4×4 default in the fixed grid, room for more rows). Dragging an entry from the palette onto the grid works like moving an existing widget: ghost preview, red invalid-drop state, snap on release.

### 8.3 Phone layout

No edit mode on phone — presets and Custom (as built on a wider screen) collapse automatically; there's nothing to rearrange. Portrait is the primary phone layout: a single-column stack in this priority order, each widget going full-width:

1. Delta
2. Current lap
3. RPM + Gear / Speed cluster, side by side, ~half-width each (the merged widget absorbed the old "RPM full-width below" row, [D28](DECISIONS.md))
4. Sectors (three columns in one card, same as desktop's per-sector layout)
5. Last lap / Best lap (side by side)
6. Predicted
7. Delta over lap (chart)
8. Pedals (bars flip to horizontal, label + bar + percentage per row instead of vertical bars)

The wireframe continues with Steering, driver aids and Boost below Pedals; dropped here for the same reason as 8.1 — they aren't built. Add them to the end of this order if any of them ships.

At 390×844, items 1–5 fit above the fold; the rest needs a scroll. Landscape phone (844×390) is a simplified fallback, not the full stack: just the top-priority cluster (Delta, Current lap, Sectors in a row; RPM + Gear, Speed in a second row) — the rest is reachable by rotating back to portrait, not by scrolling landscape.

This mapping is a fixed, hard-coded phone layout, not a fourth breakpoint of the grid — the widget registry doesn't need per-widget phone positions, only this priority order, since the grid's column/row spans stop applying below the grid's minimum usable width.

## Verification

- `npm test` and `npm run test:bridge` pass.
- With the fake console and the bridge running, open the served page in a browser and confirm every widget shows live values and the lap tracker produces laps.
- At 1180×820, confirm nothing overflows and the grid matches section 1.
- Real console (pending, step 6): run the capture tool and the full bridge on the PS4, then open the page on the iPad over the local network. Expect to correct: byte offsets, gear encoding, the meaning of `onTrack`, and whether the game updates `last_lap` when the lap counter changes.

## Flagged open questions

- ~~How does GT7 encode neutral and reverse in the gear field? The wireframe shows "N".~~ **Resolved** ([D21](DECISIONS.md)): it doesn't — the gear byte reads 0 (neutral) throughout reverse too. The frame's `gear` is -1 in reverse, inferred from velocity opposing heading; the widget shows "R".
- Pedal colours: throttle blue and brake amber. Check they read well next to the delta's green and red once seen on the iPad.
- Whether `onTrack` (flag bit 0) really means what the parser docs say. If GT7 clears it in some modes, timing would be held throughout; the page shows why, so it will be visible on first contact.
- ~~Hand-rolled or library grid for edit mode.~~ **Resolved** ([D23](DECISIONS.md)): hand-rolled.
- Whether to serve over http only, or also offer a way to reach it by name (for example the Mac's `.local` hostname).
