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

*None yet.*

<!-- Group entries under domain headings (e.g. Timing, Bridge, UI). Entry headings use #### under a ### domain. -->

---

## Resolved

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
