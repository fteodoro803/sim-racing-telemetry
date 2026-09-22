#!/usr/bin/env python3
"""Decode the real-session test fixture into frames, cached as JSON for the JS test suite to replay.

Keeps tests/real-session.test.mjs free of a Python dependency at test time: this script is the only
place Python touches the fixture, using the bridge's own gt7.py and frames.py so the replay is exactly
what the bridge would have produced. Run again whenever the fixture or the decoder changes.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bridge"))

from capture_file import read_capture  # noqa: E402
from frames import GameClock, make_frame  # noqa: E402
from gt7 import Decryptor, decode_a  # noqa: E402

FIXTURE = Path(__file__).resolve().parent.parent / "bridge" / "tests" / "fixtures" / "gt7-ps4-session.jsonl.gz"
OUT = FIXTURE.with_suffix("").with_suffix(".frames.json")


def main():
    _, packets = read_capture(FIXTURE)
    dec, clock = Decryptor(), GameClock()
    t0 = packets[0][0]
    frames = [make_frame(decode_a(dec(raw)), clock, (t - t0) * 1000) for t, raw in packets]
    OUT.write_text(json.dumps(frames, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KiB), {len(frames)} frames")


if __name__ == "__main__":
    main()
