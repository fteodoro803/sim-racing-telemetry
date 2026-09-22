"""Replay a real PS4 session through the whole decode-and-frame path, as a check against real data.

Recorded 2026-09-22 on a PS4 over home Wi-Fi (see PROJECT_CONTEXT.md Known issue 5). It contains a
session restart, three clean unpaused laps and a short pause, so it covers more than any of the
synthetic fake-console tests can: real jitter, a real pause, and real lap-counter behaviour.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from capture_file import read_capture
from frames import GameClock, make_frame
from gt7 import Decryptor, decode_a, decode_flags

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "gt7-ps4-session.jsonl.gz"


def load_frames():
    """Decode the fixture into frames, exactly as the bridge would."""
    _, packets = read_capture(FIXTURE)
    dec, clock = Decryptor(), GameClock()
    t0 = packets[0][0]
    return [make_frame(decode_a(dec(raw)), clock, (t - t0) * 1000) for t, raw in packets]


class RealSessionTest(unittest.TestCase):
    def setUp(self):
        self.header, self.packets = read_capture(FIXTURE)

    def test_the_fixture_is_a_clean_recording(self):
        self.assertEqual(self.header["packet_type"], "A")
        self.assertFalse(self.header.get("truncated"))
        self.assertGreater(len(self.packets), 20000)

    def test_every_packet_decrypts(self):
        dec = Decryptor()
        for _, raw in self.packets:
            self.assertIsNotNone(dec(raw))
        self.assertEqual(dec.constant, 0xDEADBEAF)

    def test_packet_ids_are_consecutive(self):
        dec = Decryptor()
        ids = [decode_a(dec(raw))["packet_id"] for _, raw in self.packets]
        self.assertEqual(ids, list(range(ids[0], ids[0] + len(ids))))

    def test_the_session_restart_and_three_laps_are_where_expected(self):
        dec = Decryptor()
        laps = [decode_a(dec(raw))["lap"] for _, raw in self.packets]
        changes = [(i, laps[i - 1], laps[i]) for i in range(1, len(laps)) if laps[i] != laps[i - 1]]
        # A restart (lap count drops), then 0->1->2->3->4 as the car crosses the line each time.
        self.assertEqual(changes[0][1:], (2, 0))
        self.assertEqual([c[2] for c in changes[1:5]], [1, 2, 3, 4])

    def test_a_pause_is_present_and_the_game_clock_holds_through_it(self):
        dec = Decryptor()
        decoded = [decode_a(dec(raw)) for _, raw in self.packets]
        paused = [d for d in decoded if decode_flags(d["flags"])["paused"]]
        self.assertGreater(len(paused), 0)
        clocks = {d["time_value"] for d in paused}
        self.assertEqual(len(clocks), 1, "the game clock should not move while paused")

    def test_frames_have_a_trusted_game_clock_by_the_end(self):
        frames = load_frames()
        self.assertGreater(len(frames), 20000)
        self.assertTrue(frames[-1]["gameClock"])
        ts = [f["t"] for f in frames]
        self.assertEqual(ts, sorted(ts))   # never goes backwards, even across the pause and the restart

    def test_lap_times_recovered_from_the_frames_match_the_games_own(self):
        # A minimal re-implementation of "does the lap counter change" is enough here; the full
        # LapTracker (position projection, sectors, deltas) is exercised by the JS suite instead,
        # since this fixture is also used there (tests/real-session.test.mjs).
        frames = load_frames()
        game_laps = {}
        for i in range(1, len(frames)):
            if frames[i]["lap"] != frames[i - 1]["lap"] and frames[i].get("lastLap"):
                game_laps[frames[i - 1]["lap"]] = frames[i]["lastLap"]
        self.assertEqual(game_laps, {1: 122352, 2: 126719, 3: 121563})


if __name__ == "__main__":
    unittest.main()
