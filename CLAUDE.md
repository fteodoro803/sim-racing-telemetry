## Project docs

Working conventions for keeping this repo's documentation current. Read alongside:
- [`DECISIONS.md`](DECISIONS.md) — open questions needing a human call, and the log of ones already made. **If you hit an unsettled convention or product question, add it there rather than picking one silently.**
- [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) — what the project is, its origin, what's settled-but-unbuilt, and what's deferred.
- [`BUGS.md`](BUGS.md) — confirmed/suspected bugs, organised by domain. **If you find a bug that isn't the task you're doing, log it there before moving on** — don't just mention it in conversation. Before fixing an entry, re-verify it still reproduces; once fixed, add a regression test and move it to the Resolved log.
- [`FEATURE_MAP.md`](FEATURE_MAP.md) — what features exist and how far along they are. Update it whenever a feature ships, changes surface, or moves between `Planned`/`Designed`/`Implemented`.
- [`GT7_TELEMETRY.md`](GT7_TELEMETRY.md) — what GT7's telemetry packet provides, its units and quirks, and what this project does with each field. Update it when something about the packet is verified or turns out to be wrong, and when a field starts being used.
- [`DASHBOARD_PLAN.md`](DASHBOARD_PLAN.md) — the dashboard's grid spec, widget list, wireframe corrections and build order, with an Implementation Log. Keep the log current as the dashboard is built.
- `TRACK_MAP_PLAN.md` — will hold the design for the track map, split editor and track identification, plus an Implementation Log of what's actually been built. Create it when that pass starts.
- [`AUDIT_PLAN.md`](AUDIT_PLAN.md) — a checklist for a dedicated higher-effort audit pass, not yet run. Findings from it go into `BUGS.md`/`DECISIONS.md`/`PROJECT_CONTEXT.md` as usual, not back into this file.

There is deliberately no design-system doc or architecture-map doc (see D10 in `DECISIONS.md`); the README covers layout and the frame format.

**Where things go** (three different questions, three different files):
- What we want isn't settled → `DECISIONS.md` (Open).
- What we want is settled, but it isn't built or is incomplete → `PROJECT_CONTEXT.md` (Known issues).
- Something that's supposed to work doesn't → `BUGS.md`.

**When something is decided:** move the item to the Decided log with a one-line rationale, and fold the rule itself into this file (if it's a convention) or `PROJECT_CONTEXT.md` (if it creates work). Don't leave the answer only in `DECISIONS.md`.

**Habits that keep the docs trustworthy:**
- Resolve in place — strike through or move to a Resolved log; never delete an entry.
- Never renumber — other docs cross-reference `D12`, `BUG-7`, issue numbers. Gaps are fine.
- When behaviour, setup, or commands change, update the affected doc in the same change.

## Conventions

How code is written in this project. A decision in `DECISIONS.md` that creates a convention gets folded in here once it's decided.

**Comments:** use the `outline-style-comments` skill whenever writing or reviewing code comments or docstrings, including existing code (D9). In short: explain why, not what; the first line is a self-contained summary so folded code still reads clearly, with detail beneath it; number ordered steps; give distinct JSX/markup blocks banner comments.

**Published folder:** only `web/` is published to the portfolio (D3). Keep it static and standalone: relative paths only (`app.js`, never `/app.js`), no dependency on the portfolio's CSS or JS, no build step, no runtime dependencies, and a `<a href="../">Back to Lab</a>` link. Keep everything else (bridge, tools, tests, docs) outside it.

**Frame format is the contract.** Every source (demo, and each game's bridge decoder) produces the normalised frame described in the README, and `web/timing.js` only ever sees that. Game-specific knowledge belongs in a decoder, never in the timing or UI code.

**Timing logic stays DOM-free and tested.** `web/timing.js`, `web/demo-source.js` and `web/format.js` must run under Node so `tests/` can cover them. Units: times in milliseconds, progress in metres, speed in km/h, pedals 0–100.

**Bridge:** Python, one decoder module per game (D15). Keep the first slice standard-library only; anything added goes in `bridge/requirements.txt`. Decoders are pure functions from bytes to frames, so they can be tested from recorded packets without a console.

**Dashboard elements are widgets.** A new panel is a definition in `web/widgets.js` (`build` once, `update` from the shared context, optional `onTap`) placed by `web/layout.js`; widgets read only the context they are given, never the data source or each other. Size everything in the `--u` unit so it scales with the screen. See `DASHBOARD_PLAN.md`.

**A widget's shape is chosen explicitly, never picked from its size.** A widget with more than one look (RPM+Gear, Pedals, the Timing widgets) lists `variants` in its `WIDGET_META` entry; a layout item can name one, chosen from a `<select>` in edit-mode chrome, defaulting to the first (`defaultVariant`). A widget can also have a numeric setting that isn't a shape (Pedal Trace's trace-window length) - the same mechanism applies (`windows`, `item.window`, `defaultWindow`, a second `<select>`), since it's the same "chosen explicitly, not inferred" idea, not a different one. [D27](DECISIONS.md), [D31](DECISIONS.md).

**Widget designs must be right-sized.** A widget's (or variant's) `WIDGET_META` size (`minW`/`minH`/`addW`/`addH`) must match the grid-cell dimensions the design mockup actually draws it at — not a rounder or more generous guess. And within that box, content should fill it (per the mockup's own padding), not sit inside extra margin the mockup doesn't have. When building or revising a widget against `design/Widget Responsive Behavior.dc.html`, check both before calling it done: the registry size against the mockup's own `N×M` tag, and the rendered fill (measured in a browser, not just read off the CSS) against the mockup's padding. [D30](DECISIONS.md).

**Sector times are derived, never stored per lap** (O6): compute them from a lap's samples and the current split fractions, so changing splits recomputes everything.

**Session persistence and export.** `web/persistence.js` (IndexedDB) and `web/session-file.js` (JSON export/import) build on `LapTracker#restoreSession` and its `onEvent` callback; keep both DOM-free of the tracker itself (they take a tracker instance, they don't reach into `app.js`'s state). See D20/O15 in `DECISIONS.md`.

**Real-session fixture.** `bridge/tests/fixtures/gt7-ps4-session.jsonl.gz` is a real PS4 recording, replayed by `bridge/tests/test_real_session.py` and (via a cached decode, `npm run decode-fixture`) `tests/real-session.test.mjs`. Regenerate the cache after changing the decoder or the frame format.

**Demo data is synthetic** and must stay labelled as such on the page. Regenerate `web/demo-laps.json` with `npm run demo-data`; commit the result.

**Definition of done:**
- `npm test` passes (Node 20+, no dependencies), and `npm run test:bridge` passes for any bridge change.
- For UI changes: `npm run serve`, load http://localhost:8000, check the browser console is clean, and check a phone-width viewport for horizontal overflow.
- Logic changes come with a test; a bug fix comes with a regression test (see `BUGS.md`).
- Affected docs are updated in the same change.
