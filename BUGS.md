# BUGS.md

A log of confirmed or suspected bugs — things that are **supposed to work** (per existing intent, a decision in [`DECISIONS.md`](DECISIONS.md), or a test) **and don't**. Distinct from [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md)'s "Known issues," which covers missing features and architectural debt, not necessarily broken behaviour.

## Workflow

1. **Log it.** One entry below, in the right domain section. Enough to relocate and reproduce — doesn't need a root cause yet.
2. **Before doing anything about it: re-verify it still reproduces.** Code moves between when a bug is logged and when someone picks it up — don't fix a symptom that's already gone, and don't skip a real one because it "sounds fixed."
3. **Fix it.**
4. **Add a regression test** that would have caught it, then move the entry to Resolved with the fix and test referenced. Don't delete resolved entries — the trail of what broke and how it was caught is worth keeping, same as `DECISIONS.md`'s Decided log.

Status values: **Open**, **Investigating** (root cause being tracked down), **Fixing** (root cause known, fix in progress), **Resolved**, **Won't fix** (triaged and deliberately not worth fixing — say why).

## Entry template

```
### BUG-N — Short title
**Status:** Open
**Found:** YYYY-MM-DD, while <doing what>
**Symptom:** what actually happens
**Repro:** steps or conditions that trigger it
**Root cause:** known cause, or "not yet investigated"
**Suspected fix:** shape of the fix, if known
```

Resolved entries additionally carry `**Fix:**` (commit/PR) and `**Regression test:**` (file/test name — or the reason none could be added).

---

## Open

### BUG-5 — Dense picker-modal previews overlap at phone width
**Status:** Open
**Found:** 2026-09-23, while checking the new widget-picker modal at 375×812 per this repo's "Definition of done"
**Symptom:** In the palette's "choose a design" modal (see `openWidgetPicker`/`renderWidgetPickerModal` in `web/app.js`), Lap Table's `spreadsheet` variant renders with its numeric columns overlapping and illegible at phone width; `table` gets a (probably intended) horizontal scrollbar instead.
**Repro:** At ≤375px width, open edit mode → Custom → click "Lap Table" in the palette → scroll to the Spreadsheet preview.
**Root cause:** not chased down in detail, but very likely just the modal's own sizing: `.modal-card.wide` cans at `92vw`, and a `wide`-flagged option (`addW`/`addH` ratio ≥ 1.8, like Lap Table's 6×3) still only gets one grid column on a screen too narrow for two, so its `aspect-ratio`-derived box ends up narrower than the widget's dense variants need to lay out cleanly. This is preview-only: the real Lap Table widget doesn't use this grid at phone width at all (`.w-lapTable` in the phone breakpoint stacks it near full device width with an explicit height, per `DASHBOARD_PLAN.md` log 11/17), so the cramped look never happens in actual use - only in this modal's preview box.
**Suspected fix:** either let the modal grow closer to full viewport width on narrow screens for `wide` options specifically, or fall back to a fixed/minimum preview width (with horizontal scroll, like `table` already effectively gets) instead of deriving it purely from `aspect-ratio` once the viewport can't fit it.

---

## Resolved

### BUG-4 — Expanding a Timing widget's variant picker in the palette silently broke the rest of the list
**Status:** Resolved
**Found:** 2026-09-23, from a user report: "some [widgets] aren't showing up as options [when selecting variants]. I can't see or select them."
**Symptom:** In edit mode's Add Widget palette, clicking a Timing-group widget that has `variants` (Delta, Sectors, Delta Chart, Last Lap, Best Lap, Predicted, Lap Table) to open its shape picker threw an uncaught `TypeError` and left every widget after it in that palette section (and the clicked widget's own variant row) missing entirely, instead of showing the expected preview buttons. Driving-group widgets with variants (RPM + Gear, Speed, Pedals, Pedal Trace) were unaffected. The edit-chrome `<select>` on a widget already placed on the grid was never affected — only the palette's not-yet-placed picker.
**Repro:** Edit mode → Custom (or any layout with room) → click "Delta" (or any other Timing widget with variants) in the palette to expand its shape picker. Before the fix, the variant row never appeared and every later Timing entry in the list vanished from the DOM; after the fix, all entries and their full variant lists render.
**Root cause:** `buildVariantPreview()` in `web/app.js` built each preview by calling the widget's real `build`/`update` with a stripped-down fake context, `{ frame, theme, mode }` — no `tracker` or `live`. Every Driving widget's `update()` only reads `frame`/`theme`, so it happened to work; every Timing widget with variants destructures `tracker` (and several read `tracker.compareMode`, `tracker.sectorCount()`, etc. without optional-chaining `tracker` itself, since a real `tracker` always exists at runtime) and threw on the first preview build. The throw happened inside `buildPaletteList`'s per-widget `for` loop, so it aborted before appending that widget's variant row or any subsequent widget in the same palette group — not just the widget whose preview crashed.
**Fix:** `buildVariantPreview()` now spreads the same `context()` used everywhere else (`{ ...context(), frame: PREVIEW_FRAME }`, or per-sample for Pedal Trace) instead of hand-building a partial one, so the real `tracker`/`live` are present and every widget's `update()` sees the shape it expects. [web/app.js](web/app.js)
**Regression test:** none added — `web/app.js`/palette rendering is DOM-heavy UI wiring outside `tests/`'s scope (per this repo's convention, only `web/timing.js`, `web/demo-source.js` and `web/format.js` are covered there). Verified in a browser: expanded every Timing- and Driving-group widget with variants from an empty Custom layout and confirmed all variant buttons render and add the widget with the right `data-variant`, with a clean console throughout.

### BUG-3 — Tyres clips on the phone layout instead of getting a taller row
**Status:** Resolved
**Found:** 2026-09-23, while verifying the Driving widgets' right-sizing against the updated design doc
**Symptom:** On the phone single-column stack (`@media (max-width: 700px) and (orientation: portrait)` in `web/style.css`), the Tyres widget's content (two rows of tyre graphics, ~154px tall) is cut off by the card's `overflow: hidden` — the card itself only gets ~96px, the same auto-row height as single-row widgets like Speed or Pedals.
**Repro:** Add Tyres to a layout (e.g. Custom via the palette), view at a phone width (≤700px, portrait). The bottom row of tyres is clipped.
**Root cause:** `.widget` is `container-type: size`, which makes its box size content-independent by spec; on phone, `.grid`'s `grid-auto-rows: minmax(calc(84 * var(--u)), auto)` can't get an intrinsic content height from a `container-type: size` item to feed the `auto` track sizing, so the row collapses toward the `84 * var(--u)` floor regardless of what the widget actually needs. Every other phone-stacked widget's content happens to fit under that floor already, except Tyres (which needs roughly two rows). `.w-lapTable` already works around the same class of problem with an explicit `height: calc(200 * var(--u))` override; Tyres had no equivalent.
**Investigated and ruled out:** a plain explicit height on `.w-tyres` alone (the originally suspected fix, mirroring `.w-lapTable`). `.tyre`'s width is `min(45cqh, 35cqw, 260px)`, and `cqh` is relative to `.w-tyres`'s own height (it's the `container-type: size` box). Raising that height past the point where `45cqh` overtakes the `60px` floor makes the tyres grow too, which needs still more height — measured in a browser, the content never catches up until the box is pushed out to ~350px, which would tower over every other phone-stacked widget. Below that floor-crossover point, the tyres render at a fixed ~154px content height regardless of the box's height, so no height in that range fits either.
**Fix:** pin `.tyre`'s width to its floor value (`60px`) inside the phone breakpoint, so the content height stops depending on `cqh` at all, then give `.w-tyres` a matching explicit height (`calc(180px + 20 * var(--u))`) — same pattern as `.w-lapTable`, just with the self-reference broken first.
**Regression test:** none added — `tests/` covers `web/timing.js`/`demo-source.js`/`format.js` (DOM-free logic per this repo's convention); this was a CSS layout fix with no logic to unit-test. Verified by measuring the rendered widget/content heights in a browser at 320px and 375px phone widths (no overflow) and confirming desktop layout is unaffected.
**Follow-up (2026-09-23, while adding Tyres to the Everything preset):** the explicit-height fix above only avoids *clipping* (content cut off inside Tyres' own box); it doesn't stop Tyres' box from *overlapping the next widget*, since `grid-auto-rows: minmax(84u, auto)`'s leftover-space distribution doesn't reliably stretch a row to match a `container-type: size` item's explicit height once that item isn't the last one in the phone stack — confirmed in a browser: with Tyres placed before Lap Table (Everything preset, order 10 before order 11), Tyres' box visibly overlapped ~40-95px into Lap Table's rows, even after also trying `grid-row: span 3 !important` on `.w-tyres` to force more room (the spanned tracks still floored out short of the ~186px needed). Lap Table's own identical explicit-height pattern only ever worked because it was always the *last* widget in the stack, with nothing after it to overlap into. Re-verified Driving's placement of Tyres (also last there, no Lap Table) was never affected. **Fix:** swapped `.w-lapTable`/`.w-tyres`'s `order` in the phone breakpoint (`web/style.css`) so Tyres is last whenever both are present, restoring the "nothing after it" condition the original fix implicitly depended on. This is a workaround, not a real fix for the underlying auto-row/size-containment interaction — if a future preset or Custom layout puts another widget after Tyres on phone, this will resurface. A proper fix (e.g. dropping `container-type: size` for `.w-tyres` specifically, or moving off implicit auto-rows for the phone stack) is still open.
**Regression test:** none added (same reasoning as above). Verified in a browser at 375×812: Everything preset (Tyres before Lap Table originally) and Driving preset (Tyres last, unaffected either way), both showing all four tyres with no overlap into neighbouring widgets.

### BUG-1 — The bridge kept running silently after its capture failed
**Status:** Resolved
**Found:** 2026-09-22, on the first attempt to run the bridge against a real PS4
**Symptom:** `bridge.py --ps4-ip <ip> --record captures/x.gz` printed a traceback (`FileNotFoundError`) from a background thread, but the bridge carried on serving the page, which would then have shown "waiting for GT7" forever with nothing to say why.
**Repro:** run with `--record` pointing into a folder that doesn't exist (`captures/` is gitignored, so a fresh clone has none). The same silent death would follow any capture failure, such as the telemetry port being taken.
**Root cause:** two faults. `CaptureWriter` didn't create the folder, and the README told users to record into `captures/` without creating it. Separately, an exception in the capture thread only ended that thread; nothing noticed. The failed capture also leaked the socket it had already opened.
**Fix:** `CaptureWriter` creates missing folders; the bridge records a capture failure, prints it and exits non-zero; the capture closes its socket on every failure path; a placeholder or mistyped console address is rejected up front with a message saying where to find the real one; a failed heartbeat send is reported and retried instead of ending the capture; and a capture cut short (process killed) still reads back everything before the cut.
**Regression tests:** `bridge/tests/test_bridge.py` (`BridgeFailureTest`: a failing capture is reported, a missing record folder is created, a placeholder address is rejected, an unreachable console doesn't crash the capture) and `bridge/tests/test_gt7.py` (`CaptureFileTest`: creates missing folders, a cut-short capture is readable; `ConsoleAddressTest`). The suite also runs clean with `-W error::ResourceWarning`.

### BUG-2 — Live delta wobbled by several ms, and lap timings drifted from the game's
**Status:** Resolved
**Found:** 2026-09-22, on the first real PS4 session ("the delta was slightly off, 0.020 s at times")
**Symptom:** the delta jittered by a few ms with occasional spikes, and any value computed from timestamps (elapsed time, sector times, predicted lap) ran slightly off the game's own clock.
**Repro:** run the bridge against a real PS4 and watch the delta while driving. Measured on a recorded session by running the tracker over it: delta noise std 4.3 ms with a 100 ms worst case, and a lap timed from timestamps alone came out 384 ms off the game's lap time.
**Root cause:** frames were stamped with the time each packet arrived on the Mac. That carries Wi-Fi jitter (arrival intervals from 2 to 28 ms, and a 295 ms stall), and it also runs about 0.3% off the game's time, because the console sends slightly fewer than 60 packets a second while its own clock counts exact frames. The delta itself is computed by the page (the game provides none); it compares this lap's time at each point with the comparison lap's time at the same point, so timestamp error goes straight into it.
**Fix:** the bridge stamps frames with the packet's own game clock (`0x80`) when it has been seen to run at real time, and with arrival time otherwise (`GameClock` in `bridge/frames.py`, [O14](DECISIONS.md)). Replaying the same recorded session through it: delta noise 0.3 ms, worst 5.8 ms, lap timed to 9 ms. The trust check holds through the network stall.
**Regression tests:** `bridge/tests/test_clock.py` (trusts a steady clock and removes the jitter, doesn't trust at first, stands still while paused, ignores a network stall, refuses accelerated time of day, falls back when the clock is frozen or missing, withdraws trust on a restart or a jump, never goes backwards under random input) and the end-to-end test in `bridge/tests/test_bridge.py`. A clean multi-lap real capture as a fixture is still to do ([Known issue 5](PROJECT_CONTEXT.md)).

---

## How to use this file

- Number bugs `BUG-N` in the order found; **never renumber**, and don't reuse a number.
- A bug found while doing something else gets logged here before moving on, even if you don't fix it now.
- If a fix changes a design decision or a documented behaviour, update that doc in the same change and link it from the entry.
- If you investigated a mechanism that didn't fix the problem, keep a note of it in the entry: it saves the next person from retrying it.
