# AUDIT_PLAN.md

A checklist for a dedicated audit pass on a higher-effort model, once there's budget for it. Not an
audit itself — nothing here has been investigated yet, only flagged as worth investigating. Written
2026-09-22, after the bridge, dashboard and persistence were first built and run against two real PS4
sessions.

## How to use this

Each item names what to check and why it matters, with pointers into the code and the docs that
already carry related context. Treat a finding the same way any other bug or decision would be
handled: a confirmed defect goes in `BUGS.md`; an unsettled tradeoff goes in `DECISIONS.md`; missing
but wanted work goes in `PROJECT_CONTEXT.md`. This file doesn't need to stay in sync with those as
work happens — check items off or annotate them once the audit runs, rather than editing this
list pre-emptively.

Good candidate for `/code-review ultra` or a dedicated high-effort session reading the whole repo,
rather than a quick pass on one file at a time — several of these are cross-cutting.

## 1. Security surface

The bridge binds `0.0.0.0` by default with no authentication ([D16](DECISIONS.md)). Anyone on the
same network can read live telemetry, or open the WebSocket themselves.

- Is that acceptable for a home-network hobby tool, or does it need at least a shared token? `--host
  127.0.0.1` already restricts it to one machine; is that enough, or should it be the default?
- `ws_server.py`'s use of `SimpleHTTPRequestHandler` for static files: path traversal was spot-checked
  manually (`test_does_not_serve_files_outside_the_web_folder`), not exhaustively.
- `salsa20.py`: correctness was checked against a reference implementation and one known-answer
  test (`tests/test_salsa20.py`), not against the full official test vector set.
- The WebSocket server (`ws_server.py`) is hand-written to avoid a dependency. Re-check it against
  the WebSocket spec more thoroughly than the current handshake/frame tests do — especially
  handling of malformed or adversarial client frames (oversized lengths, bad UTF-8, fragmented
  messages, which aren't implemented at all since the page never sends any).

## 2. Unconfirmed GT7 protocol fields

Tracked field by field in [`GT7_TELEMETRY.md`](GT7_TELEMETRY.md); worth a dedicated capture-and-check
pass rather than folding into a general audit:

- Gear encoding for neutral and reverse (currently: 0 assumed neutral, unverified).
- `boost` (`0x50`), unconfirmed offset and units; needs a turbocharged car to check.
- Flag bits beyond 5 (lights, high/low beams, ASM, TCS) — bit 6 (handbrake) is already known not to
  behave as documented (set for about a third of a normal session).
- Packet types B, `~` and C entirely undecoded: unknown offsets, and the nonce constants for them
  are an unconfirmed guess from a single source.
- `laps_in_race` (`0x76`) confirmed only as 0 in free run; untested in an actual race.
- `position_values` (`0x84`/`0x86`): two sources disagree on what these are.

## 3. Timing correctness under conditions not yet seen

`web/timing.js` has been checked against two real sessions, both single-car free-run/time-trial. Not
yet exercised:

- `GameClock`'s trust/distrust bands (`bridge/frames.py`) under heavier packet loss or jitter than
  either real session had, and under the game's `time_value` wrapping (it's `int32`, ms since some
  epoch — does it ever roll over mid-session, and if so, does `GameClock` misread that as an
  implausible jump and lose trust unnecessarily?).
- The lap-boundary pinning logic (`_closeLap`) and the off-reference watchdog
  (`LOST_REFERENCE_RESET_MS = 5000`): both thresholds are chosen by judgement, not derived or tuned
  against a range of real data.
- Sector math at the edges: splits very close together, or right at 0 or 1 (`setSplits` clamps to
  `0 < f < 1`, but two splits within one frame's worth of distance haven't been tested).
- A race with multiple cars: `laps_in_race`/other race-only fields, and whether anything assumes a
  single car on track.

## 4. Concurrency

- `persistence.js` writing IndexedDB from two browser tabs (or two devices) connected to the same
  bridge isn't guarded against a race — last write wins, silently.
- Shared mutable state across `ThreadingHTTPServer` threads: `GameClock` (one instance, updated from
  the capture thread, read when building frames — currently the same thread, but worth confirming
  that stays true) and `Hub.frames`/`Hub.last_frame_at` (accessed from the capture thread and read
  from the status-broadcast thread without a lock).

## 5. Data model and migrations

- No version-bump or migration path for the IndexedDB schema (`DB_VERSION = 1` in `persistence.js`)
  or the export format (`FORMAT = 'telemetry-session-1'` in `session-file.js`). If either needs a
  breaking change later, what happens to old saved sessions or old export files?
- How permissive `isSessionRecord`/`readImport` are: a malformed-but-plausible file (right shape,
  wrong values) isn't rejected. Worth deciding how much validation is warranted for a
  user-supplied file versus trusting it.

## 6. Frontend architecture, ahead of the customisable dashboard

The next big piece of work ([D11](DECISIONS.md), Known issue 11) is user-editable widget placement.
Worth checking now, before more is built on top:

- Whether `app.js`'s single-module design holds up once it also owns edit mode, the widget palette
  and drag/resize.
- Whether `layout.js`'s hardcoded grid array is the right shape once layouts are user-authored and
  saved (it's currently just a fixed list; a saved custom layout will need the same shape but
  per-user).
- Consistency of error handling: `alert()` for a bad import file (`app.js`) is a placeholder, not a
  considered UX decision — worth a pass over every user-facing error path at once rather than
  each ad hoc.

## 7. Test coverage gaps

- Packet types B, `~` and C: no tests, since nothing decodes them yet (tracked above too).
- No automated browser testing (Playwright or similar). Every UI check so far has been manual,
  in-session verification with the browser pane; nothing re-runs those checks automatically.
- `bridge.py`'s CLI entry point (`main()`, argument parsing, `--fake-console` wiring) and
  `lan_address()` aren't unit tested directly, only exercised indirectly through `Bridge`.
- `charts.js`'s rendering logic has no automated test at all (canvas output isn't easily assertable
  in Node); only checked visually.

## 8. Performance on real hardware

- Lap arrays grow unbounded in memory and in IndexedDB over a long session (no cap, no pruning).
  Worth checking what a multi-hour endurance session looks like.
- `render()` runs on every `requestAnimationFrame`, updating every widget. Fine on a desktop browser
  in testing; not yet profiled on an actual iPad, which is the intended primary device ([D17](DECISIONS.md)).

## 9. Documentation consistency

- A sweep of `GT7_TELEMETRY.md`, `DECISIONS.md` and `PROJECT_CONTEXT.md` for "unconfirmed"/"untested"
  markers that are now stale, since two real sessions have landed since some of them were written.
- Whether every `D#`/`O#`/`BUG-#` cross-reference still points at something that exists (the doc
  link checker only checks file links, not these in-file reference IDs).
