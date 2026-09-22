"""Replay a real PS4 capture of reversing, to check reverse detection against real data (D21).

Recorded 2026-09-22 on a PS4 over home Wi-Fi: drive forward, brake to a stop, reverse back along
the same path, and stop again. It's what showed that GT7's gear byte reads 0 throughout reverse,
same as neutral (see BUGS.md), which is why `_is_reversing` in frames.py exists at all.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from capture_file import read_capture
from frames import to_frame
from gt7 import Decryptor, decode_a

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "gt7-ps4-reverse.jsonl.gz"


def load_frames():
    """Decode the fixture into frames, exactly as the bridge would."""
    _, packets = read_capture(FIXTURE)
    dec = Decryptor()
    t0 = packets[0][0]
    return [to_frame(decode_a(dec(raw)), (t - t0) * 1000) for t, raw in packets]


class RealReverseTest(unittest.TestCase):
    def test_the_fixture_is_a_clean_recording(self):
        header, packets = read_capture(FIXTURE)
        self.assertEqual(header["packet_type"], "A")
        self.assertFalse(header.get("truncated"))
        self.assertGreater(len(packets), 1000)

    def test_the_drive_has_both_forward_and_reverse_gears(self):
        frames = load_frames()
        gears = {f["gear"] for f in frames}
        self.assertIn(-1, gears, "some part of the recording should read as reverse")
        self.assertTrue(gears & {1, 2, 3}, "some part of the recording should read as forward gears")

    def test_reverse_only_appears_while_the_car_is_actually_moving_backwards(self):
        # The car retraces the same stretch of track it just drove forward, so x should climb while
        # in forward gears and fall while in reverse (matching the live capture used to find this).
        frames = load_frames()
        forward_dx = [b["x"] - a["x"] for a, b in zip(frames, frames[1:]) if a["gear"] in (1, 2, 3)]
        reverse_dx = [b["x"] - a["x"] for a, b in zip(frames, frames[1:]) if a["gear"] == -1]
        self.assertGreater(sum(forward_dx), 0)
        self.assertLess(sum(reverse_dx), 0)


if __name__ == "__main__":
    unittest.main()
