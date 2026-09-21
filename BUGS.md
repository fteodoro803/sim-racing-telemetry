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

---

## How to use this file

- Number bugs `BUG-N` in the order found; **never renumber**, and don't reuse a number.
- A bug found while doing something else gets logged here before moving on, even if you don't fix it now.
- If a fix changes a design decision or a documented behaviour, update that doc in the same change and link it from the entry.
- If you investigated a mechanism that didn't fix the problem, keep a note of it in the entry: it saves the next person from retrying it.
