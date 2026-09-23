# DECISIONS.md

Open questions that need a human call, and a log of the ones already made.

## What belongs here

- **This file** — things where *what we want* isn't settled. Answering them is a decision, not work.
- **[`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) § Known issues** — things where what we want *is* settled and it simply isn't built or is broken. Answering them is work, not a decision.

Some entries here unblock an issue there; those are cross-referenced rather than duplicated.

When an open item is decided: move it to the Decided log with a one-line rationale, and fold the rule itself into [`CLAUDE.md`](CLAUDE.md) (if it's a convention) or [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) (if it creates work). Don't leave the answer only here.

---

## Decided

| # | Decision | Documented in |
|---|---|---|
| D1 | **A small local bridge relays the game's UDP to the page over a WebSocket; no cloud relay.** Browsers can't receive UDP, and the game sends to the local network, so a cloud relay can't help. | [README](README.md) "How it fits together"; [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) Known issue 1 |
| D2 | **The page ships with a demo/replay mode.** Visitors with no game or bridge must still be able to try it. | [README](README.md); [`FEATURE_MAP.md`](FEATURE_MAP.md) |
| D3 | **Only `web/` is published; `bridge/` lives in the same repo but outside it.** `web/` uses relative paths, works standalone (no dependency on the portfolio's CSS/JS) and links back with `<a href="../">Back to Lab</a>`. | [README](README.md) "Layout"; [`CLAUDE.md`](CLAUDE.md) Conventions |
| D4 | **The repo is `sim-racing-telemetry`.** The planning chat suggested `telemetry-viz`, but this repo already existed under the chosen name. | [README](README.md); [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) Known issue 10 |
| D5 | **Sectors come from user-defined split points on the track.** GT7 reports no sector times, only position, so meaningful sectors (corner complexes, straights) need splits the user places, not fixed thirds. | [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) Known issue 9; [`FEATURE_MAP.md`](FEATURE_MAP.md) |
| D6 | **The track map and split editor are deferred to their own dedicated pass**, with their own plan doc (`TRACK_MAP_PLAN.md`) when it starts. | [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) Known issue 9 |
| D7 | **Pause/loading/off-track handling starts simple, and its specifics wait for real packets.** First pass: drop flagged frames, skip the clock gap, mark the lap invalid. | [README](README.md) "Interrupted laps"; [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) Known issue 5; `web/timing.js` |
| D8 | **Laps driven through the pit lane are not handled.** Not worth the complexity; a slow pit lap simply counts as a slow lap. No work created. | This file only |
| D9 | **The `outline-style-comments` convention applies to all code in the repo, including code written before the convention was adopted.** | [`CLAUDE.md`](CLAUDE.md) Conventions |
| D10 | **Docs in use: `DECISIONS`, `BUGS`, `PROJECT_CONTEXT`, `FEATURE_MAP`.** A design-system doc and an architecture-map doc are skipped (the tool is small; the README covers layout). A `TRACK_MAP_PLAN.md` will be added when the track-map pass starts. | [`CLAUDE.md`](CLAUDE.md) "Project docs" |
| D20 | **Completed laps persist to IndexedDB in live mode, and a session can be exported to and imported from a JSON file.** Resolves Known issues 7 and 8. Mechanism details: [O15](DECISIONS.md). | [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) Known issues 7-8; `web/persistence.js`, `web/session-file.js` |
| D11 | **The dashboard is snap-to-grid: widgets snap into place, with a few basic presets plus a "Custom" layout the user builds.** Not everyone wants the same things on screen. Free-form pixel placement was rejected because layouts break on other screen sizes. (was O12) | [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) Known issue 11; [`FEATURE_MAP.md`](FEATURE_MAP.md) |
| D12 | ~~**Tyres are shown as graphics that change colour with temperature, with no numeric labels.**~~ **Superseded by D26**: the design that came back from Claude Design paired a number with the colour, and the user chose to build it that way rather than strip the number. | [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) Future directions; [`GT7_TELEMETRY.md`](GT7_TELEMETRY.md) |
| D13 | **The first proper version covers all the Driving and Timing details, fed by real GT7 data so it can be tested on the author's own console.** Tyres, fuel and analysis features come later. | [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) Known issues 1–6, 12–13; [`GT7_TELEMETRY.md`](GT7_TELEMETRY.md) |
| D14 | **What GT7 provides is kept in `GT7_TELEMETRY.md`, and new features are chosen from it.** | [`GT7_TELEMETRY.md`](GT7_TELEMETRY.md); [`CLAUDE.md`](CLAUDE.md) |
| D13 (follow-up) | **The customisable layout (D11) comes after the first testable version.** The first version keeps the fixed layout, with the Driving and Timing widgets added to it. | [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) "Origin and current scope" |
| D15 | **The bridge is written in Python.** It's already in the author's toolchain. The first slice (heartbeat, receive, decrypt, record) uses only the standard library; anything added later, such as a WebSocket library, goes in `bridge/requirements.txt`, which is fine because `bridge/` isn't published. (was O1) | [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) Known issue 1; [`CLAUDE.md`](CLAUDE.md) Conventions; [`bridge/README.md`](bridge/README.md) |
| D16 | **The bridge also serves the page over plain http on the local network, so a tablet can use it.** A page hosted on https can't open a connection to a bridge on another device (mixed content). The page connects to its own origin by default; the portfolio-hosted page stays as the demo and uses a bridge-address setting. | [`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md) §6; [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) Known issues 1 and 3 |
| D17 | **The primary device is an iPad in landscape (about 1180×820), touch first.** A phone layout is a fallback. Layout and edit-mode interactions target touch. | [`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md) §1; [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) "What this is" |
| D18 | **The first version uses the Claude Design wireframes in `design/` as they are, to test live data; a redesign comes later.** They are low-fidelity, so visual polish isn't the goal. The grid spec, widget list and corrections are in a plan doc. | [`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md); [`CLAUDE.md`](CLAUDE.md) |
| D18 (follow-up) | **The wireframes in `design/` are committed, and sector cards start with one delta (versus the best sector).** | [`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md) §5 |
| D19 | **The first version's Driving widgets are speed, gear (with suggested gear), rpm and pedals.** Driver aids (TCS, ASM, ABS, handbrake) and boost aren't wanted. Steering is deferred to its own session. | [`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md) §3, §5; [`GT7_TELEMETRY.md`](GT7_TELEMETRY.md); [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) Known issues 12–14 |
| D21 | **GT7 doesn't encode reverse in the gear byte — it reads 0, the same as neutral, throughout.** Confirmed with a dedicated real-PS4 capture. The frame's `gear` is instead inferred as -1 when `velocity` opposes the heading derived from `rotation`'s yaw, below a small speed threshold it stays neutral (direction is meaningless near a stop). | [`GT7_TELEMETRY.md`](GT7_TELEMETRY.md); `bridge/frames.py` (`_is_reversing`); `bridge/tests/fixtures/gt7-ps4-reverse.jsonl.gz`; [`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md) log 10 |
| D22 | **A non-technical user starts the bridge with a double-click launcher (`start.command` / `start.bat`), not a terminal command.** It asks for the PS4's IP once and remembers it locally. Cheapest option that removes the "type a command" step without taking on installer/packaging work (was O16, option 1); options 2-4 (packaged executable, URL-scheme installer, do nothing) stay open if this isn't enough. | [`bridge/README.md`](bridge/README.md); `bridge/start.command`, `bridge/start.bat` |
| D23 | **The customisable dashboard's grid (drag, resize, snap, collision detection) is hand-rolled, not a library.** Keeps the no-dependency stance ([O9](DECISIONS.md)); the grid model is small enough (widget id, position, size) to write directly, and a vendored MIT library would still be a dependency inside `web/`. Revisit if touch dragging proves too fiddly to hand-roll. (was O13) | [`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md) §8 |
| D24 | **Custom starts blank, not as a copy of the active preset.** The `design/Presets.dc.html` wireframes showed both (one frame captioned "started as a copy of Driving", the dedicated empty-state frame captioned "Custom starts blank"); blank matches the dedicated empty-state screen and needs no fork-tracking logic. | [`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md) §8 |
| D25 | **A widget's own content (value, label, bars) is sized with CSS container query units, relative to that widget's own box — not the page-level `--u` unit.** Resizing a widget in edit mode used to leave its font size unchanged, so a shrunk widget could overflow (a 78px digit doesn't fit a 2×2 minimum) and a grown one just left the extra space empty. `.widget` is now a size container (`container-type: size`); each content rule is `max(floor, min(height-based, width-based, ceiling))` so it fills whichever axis is tighter without overflowing either, between hand-picked px bounds. `.sector` and `.pedal` are nested containers too, so a 3-up Sectors row or a 2-up Pedals pair size against their own column, not the whole card. Chart axis text (canvas-drawn, not CSS) scales the same way off the canvas's own rendered size in `charts.js`. Prerequisite for genuinely resizable widgets and for future small-size variants, rather than one fixed size that merely clips less. | `web/style.css`, `web/charts.js` |
| D26 | **Tyres are shown as colour-per-corner graphics with a temperature number inside each** (was D12: colour only, no labels). The `design/Widget Responsive Behavior.dc.html` wireframe paired a number with the colour despite being told not to; the user chose to build it as designed rather than strip the number, since GT7 gives no ideal range for tyre temperature and the number gives context the colour alone can't. Colour thresholds (cold/optimal/hot/overheating) are still a placeholder, unconfirmed against real data — see `web/tyre-color.js`. | `web/widgets.js`, `web/tyre-color.js`; [`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md) log 13 |
| D27 | **A widget with more than one shape (RPM, Pedals) has its shape chosen explicitly in edit mode, not picked automatically from the widget's size.** D25's size-responsive scaling reshaped RPM and Pedals at CSS breakpoints (a narrow RPM lost its bar; a short Pedals flipped to horizontal), which meant resizing a widget could unpredictably change its structure, not just its scale. The user wanted the two decoupled: pick a shape, then resize freely within it. Each such widget's registry entry (`WIDGET_META`) now lists `variants`; a layout item can name one (`{widget, variant, ...}`, defaulting to the first); a select in the widget's edit-mode chrome switches it. The `@container` breakpoints that used to switch shapes by size became `[data-variant=…]` CSS rules instead; the fluid cqh/cqw content scaling from D25 is unchanged within whichever shape is picked. | `web/layout.js` (`variants`, `defaultVariant`), `web/edit.js` (`setVariant`), `web/app.js`, `web/style.css` |
| D28 | **RPM and Gear become one combined widget (`rpmGear`) instead of two separate ones.** The standalone Gear and RPM widgets are retired from the registry/palette/presets. Built with three variants, chosen explicitly per D27: `stacked` (default - gear + hint above a "RPM 1234" row and the 12-segment shift-light bar; concept "B"/"5" from the mockup rounds, the one the user picked), `column` (edge-to-edge gear digit beside a vertical shift-light column) and `ring` (gear digit over a circular shift-light arc). Gear stays the dominant, fastest-to-read element in all three; the lights/ring give rev-zone feedback without needing the rpm number read. | `web/widgets.js` (`rpmGear`), `web/layout.js` (`WIDGET_META`), `web/style.css`, `web/dom.js` (`svgEl`); [`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md) log 16 |
| D29 | **The seven Timing widgets that had more than one design in the mockups (Delta, Sectors, Delta Chart, Last Lap, Best Lap, Predicted, Lap Table) gained explicit `variants`, the same D27 mechanism as RPM+Gear/Pedals** - a select in edit-mode chrome, one shape per widget at a time, unrelated to its size. Current Lap wasn't touched: the mockup only gave it one design, which already matched what was built. None of the new variants repeat the widget's own title inside its body (the card header already shows it), which is why they read a little sparser than the standalone mockup previews. Best Lap's `minimal` variant is the only one that still shows the theoretical-best sub-line (`FEATURE_MAP.md`'s "Theoretical best lap" row) - none of the new mockup options had room for it, and dropping it everywhere would have silently regressed a documented feature. Predicted's `range` variant needed a `worstLap` getter on `LapTracker` (mirrors the existing `bestLap`); Delta Chart's `area`/`areaReadout` variants needed `charts.js`'s `drawChart` to optionally fill the signed area under a line, additive and unused by the Speed chart. | `web/widgets.js`, `web/layout.js` (`WIDGET_META`), `web/style.css`, `web/timing.js` (`worstLap`), `web/charts.js` (`fill`); `design/Widget Responsive Behavior.dc.html` |
| D31 | **A new Pedal Trace widget shows throttle and brake as a rolling last-few-seconds trace, both plotted as positive 0-100% areas on one shared axis** rather than a signed delta-style chart, so their overlap (trail-braking, or a mistake) is visible directly - drawn with canvas `globalCompositeOperation: 'screen'` so the two translucent fills blend to a lighter colour where they overlap, with no separate overlap polygon to compute. Built with four shapes chosen the D27 way (`filled` default, `lines`, `compact`, `gridlines` - a faint vertical line every second). Its trace window (3-10 seconds, in 1s steps) is a *new* kind of per-widget setting - a small numeric choice, not a shape - so it reuses D27's exact mechanism (a `windows` list on the registry entry, `item.window` in the layout, a second `<select>` in edit-mode chrome, `defaultWindow` mirroring `defaultVariant`) rather than inventing a different one; a free-form slider was considered and rejected as more UI than this project has anywhere else. The widget's own JS (not just CSS) needs to know its current variant/window to draw the canvas correctly, so `update()` reads them off its own card's `dataset` (`body.closest('.widget')`, the same trick `deltaChart` already used for its `.has-chart` class) rather than through `ctx`, which is shared unchanged across every widget on the grid. Its sample buffer lives in the widget's own refs, not the lap tracker, since it's real-time rather than lap-relative and must never reset on a lap boundary. | `web/widgets.js` (`pedalTrace`), `web/charts.js` (`drawPedalTrace`, `pushTraceSample`), `web/layout.js` (`WIDGET_META`, `defaultWindow`), `web/edit.js` (`setWindow`, `buildEditChrome`), `web/app.js`, `web/style.css`; `design/Widget Responsive Behavior.dc.html` |
| D32 | **Everything, Timing and Driving are directly editable, not fixed** (revises part of [D11](DECISIONS.md)): entering edit mode on a built-in preset and clicking "Done" now saves that edit as the preset's own override, persisted the same way Custom is, instead of discarding it unless separately saved as Custom. "Reset to preset" is relabelled "Reset to default" and now actually does something for a built-in preset - it drops the saved override, falling back to `layout.js`'s shipped `PRESET_LAYOUTS` again. Each preset tab gets the same "edited" dot Custom already had, so it's visible at a glance which presets have been changed from their defaults. "Save as Custom" is unchanged and still exists alongside this - forking a preset into Custom, rather than overwriting the preset itself, is still sometimes what's wanted. `dashboard-state.js`'s state gained an `overrides` map (`{ [presetId]: layout }`, built-in preset ids only); `currentLayout` checks it before falling back to the shipped default. | `web/dashboard-state.js` (`overrides`, `savePresetEdit`, `resetActivePreset`), `web/app.js`, `web/index.html`, `web/style.css` |
| D30 | **The Driving widgets (Tyres, RPM+Gear, Speed, Pedals) had drifted out of "right-sized" against a re-issued `design/Widget Responsive Behavior.dc.html`** - the user tightened every box in that doc to its actual grid-cell size and padding, and a registry/CSS audit (measured live in a browser, not just read off the CSS) found: `rpmGear`'s add-size was 3×2 against a 2×2 mockup for all three shapes (the user's specific "Ring should be 2×2" report); `tyres` was 3×3 against a 2×2 mockup; `pedals`' add-size (2×3) matched neither shape's floor, and its track only reached 54% of its column's width at the correct size; `speed` had no shape choice at all, though the doc now draws two ("inline" 2×1, "stacked" 2×2). Fixed: `WIDGET_META` sizes corrected for all four; `speed` gained an `inline`/`stacked` `variants` pair (D27 pattern, `inline` default, matching current behaviour); `.pedal-track`'s width ceiling raised (`55cqw`/`40px` → `90cqw`/`90px`), verified live to reach ~77% of column width, up from 54%; `.tyre`'s width ceiling loosened as headroom for above-floor sizes (not broken at the floor, so lower-risk). The doc's own tyre markup goes further (a plain `flex:1`/`height:100%` rectangle, no `aspect-ratio`) - not adopted, since that changes the tyre's shape, not just its size, and wasn't flagged as broken. Verifying right-sizing (registry size against the mockup's own tag, fill measured live) is now a standing convention in `CLAUDE.md`, not a one-off. Surfaced [BUG-3](BUGS.md): Tyres clips on the phone single-column layout (`container-type: size` can't feed `grid-auto-rows: auto` an intrinsic height) - logged, not fixed here, since it's a phone-breakpoint issue unrelated to the desktop-grid sizes this pass covered. | `web/layout.js` (`WIDGET_META`, `PRESET_LAYOUTS`), `web/style.css`, `CLAUDE.md`; `design/Widget Responsive Behavior.dc.html` |

---

## Open — judgement calls awaiting ratification

Things Claude decided on the spot because the work couldn't wait, and wrote into the code and README as if settled. They were judgement calls, not observed consensus. Ratify or overturn each one; ratified items move to Decided.

**O5. The first complete lap becomes the fixed reference line.**
Every later lap is projected onto it to get progress in metres, which is what makes sectors and deltas possible without a distance channel. Tradeoff: sectors and deltas only appear from the second lap, and a messy first lap (a spin, cutting a corner) bends the line for the whole session. Laps keep their `x, z` samples, so the reference could later be re-based onto the best lap.

**O6. Sector times are derived from stored samples, not stored per lap.**
Each lap keeps `(time, progress)` samples; sector times are computed from those and the current split fractions. Editing splits (D5) then recomputes every lap for free. Tradeoff: sector times are recomputed on demand (cached), and split positions are fractions of the reference length rather than absolute distances.

**O7. A lap joined part-way through isn't timed.**
If the page starts mid-lap, that partial lap is ignored and timing begins at the next line crossing. Tradeoff: you lose the rest of that lap, but a partial lap can't produce a valid time.

**O8. The line crossing is placed between frames, and the game's `lastLap` is used for the lap time when present.**
The crossing time is interpolated from progress on either side of the line, so sector times aren't quantised to the frame rate. Lap time comes from the game's `lastLap` when it is above zero; the last sector absorbs the difference (under one frame).

**O9. No framework, no charting library, no build step.**
Plain ES modules, two hand-drawn canvas charts, and a pure-Python demo generator. Tradeoff: charts are hand-rolled and will need care if they grow, but the published folder stays a handful of static files that need no toolchain.

**O10. The demo data is synthetic, labelled as such, and opens with two laps already driven.**
Made-up circuit from `tools/make_demo.py`; the page says "Demo · simulated data". It skips the first two laps so deltas show at once, plays at 5× by default, and ends after lap 8 with a Replay button.

**O11. The specifics of interrupted-lap handling.**
D7 settled the principle. These details were Claude's: frames flagged `paused`, `loading` or `onTrack: false` are dropped; the timing clock skips the gap (assuming the game clock stands still, which a real PS4 session confirmed on 2026-09-22); an interrupted lap is kept in the table but excluded from best lap, best sectors, theoretical best, the "last lap" comparison and the reference lap. Revisit with real packets ([`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) Known issue 5).

**O14. Frame timestamps come from the game's own clock when it can be trusted, and from arrival time otherwise.**
The bridge first stamped frames with the time the packet arrived. On a real session that carried Wi-Fi jitter (delta wobbled by several ms, with a 100 ms spike) and ran about 0.3% off the game's time, so a lap timed from timestamps alone came out 384 ms off the game's own lap time. The packet carries a game clock (`0x80`, time of day in ms) that matched the game's lap times to a frame, cutting delta noise from 4.3 ms to 0.3 ms and the lap-time error to 9 ms. Tradeoff: time of day can be accelerated in some events, so the bridge uses the clock only after seeing it run at about real time (95–105% over roughly 10 s of packets), and falls back to arrival time otherwise, so `t` is always continuous and never goes backwards. Packet ids were rejected as a clock because the packet rate wanders between 59.65 and 59.94 a second.

*Follow-up:* even trusting the game clock, the crossing sample at a lap boundary was still placed by interpolating position, which is unreliable exactly where it matters most: right at the start/finish line, where the car's path can cross itself. When both frames either side of a lap change are on the trusted game clock, the boundary is now pinned to exactly `startT + timeMs` instead (`LapTracker._closeLap` in `web/timing.js`). This only affects where the *next* lap starts counting from (and so every sample in it), not the closing lap's own stored time, which was already set from the trusted lap time regardless.

---

## Open — bridge

~~**O1. Should the bridge be Python or Node?**~~ **Decided as D15**: Python.

**O2. Should a "loading" state reset the session?**
Loading frames are currently dropped and the interrupted lap is invalidated, but completed laps and the reference line are kept. A load might mean a new track or car (so old laps are meaningless), or it might be a brief blip mid-session (so a reset would wipe good data). We don't yet know what the game does.
*Options:* keep laps and drop frames only (current); reset on any load; reset only on a load that ends with a different lap counter or a car far from the reference line.
*Recommendation:* keep the current behaviour until real packets show what a load looks like ([`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) Known issue 5), then decide.

~~**O16. How should a non-technical user start the bridge, without downloading files and typing terminal commands?**~~ **Decided as D22**: a double-click launcher script. Packaging it as an executable, or a `gt7bridge://` URL-scheme installer, were considered and rejected for now as more packaging work than the problem currently warrants; revisit if the launcher script isn't enough.

---

## Open — tracks

**O3. How do we identify a track, so we can save its splits and reuse them?**
GT7 doesn't broadcast a track or circuit name, so any identification has to come from position data. It blocks saving splits per track (D5) and the track-map pass (D6).
*Findings so far* (from the project pages only; none examined in depth yet):
- [vthinsel/GT7Tracks](https://github.com/vthinsel/GT7Tracks) (MIT code) captures positions to CSV and trains a TensorFlow model to guess the track from live coordinates. The code is reusable; whether its coordinate data can be redistributed is unclear, since it derives from the game.
- [snipem/gt7dashboard](https://github.com/snipem/gt7dashboard) draws a race-line map from telemetry; its track identification, if any, isn't documented on the project page.
- Commercial GT7 apps describe the same approach: record each track once, then match live position against the stored layouts.

*Options:*
1. Fingerprint it ourselves: after the first lap, compare the reference line (start point, length, a coarse shape signature) against tracks the user has already saved locally. Needs no external data or ML, fits a static site.
2. Ship a pre-built library of track coordinates (from GT7Tracks or by collecting them). Instant recognition, but there are many tracks and layouts, and the data's provenance and licence need checking.
3. Ask the user to name the track once and remember it (the fallback for options 1 and 2).
4. A trained classifier as in GT7Tracks. Heavy, needs Python and TensorFlow, doesn't fit a static page.

*Recommendation:* option 1 with option 3 as the fallback, and let the user export and import saved tracks so a shared library can grow later. Before committing, check with real packets whether GT7 coordinates are stable per track across sessions and cars, and whether reverse or variant layouts share a coordinate frame. Both are unknown.

**O4. What should happen when the track or car changes mid-session?**
The only signal today is the lap counter or clock going backwards, which resets the session. Switching to another track without that would compare laps against the wrong reference line.
*Options:* detect a mismatch (the car far from the reference line for several seconds) and reset; ask the user; do nothing.
*Recommendation:* mismatch detection with a reset, once we know how the coordinates behave (O3).

---

## Open — dashboard

~~**O12. How should users lay out the dashboard?**~~ **Decided as D11**: snap-to-grid, with basic presets and a "Custom" layout. The remaining question, whether to use a library, is O13.

~~**O13. Should the snap-to-grid layout use a library, or be hand-rolled?**~~ **Decided as D23**: hand-rolled.

---

## Open — judgement calls awaiting ratification (session persistence and export)

**O15. Persist to IndexedDB, live sessions only, save-per-lap, and auto-recover from a stale reference.**
Known issues 7 and 8 asked for persistence and export/import without specifying the mechanism.
Judgement calls made building them:
- **IndexedDB, not localStorage.** A session's samples can run to a few hundred KB per lap; IndexedDB's
  quota is much larger and it stores structured data directly rather than JSON text.
- **Persisted only in live mode, on each completed lap.** The demo builds its own deterministic session
  every time, so saving its laps (or restoring old ones into it) would be confusing; only completed
  laps are saved, not the one in progress, so a crash loses at most the current lap.
- **A restored session for the wrong track is dropped automatically.** If the car stays more than
  `LOST_REFERENCE_RESET_MS` (5000 ms) off the restored reference line while a lap is recording, the
  tracker clears itself and the stale save, rather than silently mistiming a different track. This
  reuses the existing off-reference tolerance (`LOST_DISTANCE_M`), not real track identification
  (which is still O3, deliberately not tackled here).
- **Import pauses the current source and reuses the live dashboard**, rather than a dedicated Review
  view (not built yet; see Future directions in `PROJECT_CONTEXT.md`).

Ratify or overturn each; ratified items move to Decided.

## How to use this file

- **Add** an unsettled question as the next `O#` under the fitting area, with Options and a Recommendation. Don't pick a convention silently — if you had to choose to make progress, log the choice under "awaiting ratification" so the user can overturn it.
- **Decide** by moving the item to the Decided table as the next `D#`, noting "(was O#)" if it came from here. Bold the one-line decision; put the rationale after it; fill "Documented in" with the file(s) where the rule now lives.
- **Never renumber.** `D#` and `O#` are separate counters, and other docs cross-reference them. Gaps are fine. (O5–O11 were numbered after O1–O4 because O1–O4 were already referenced in conversation.)
- **Follow-ups** to a decision get their own row, labelled `D# (follow-up)`, rather than an edit that changes what the original said.
