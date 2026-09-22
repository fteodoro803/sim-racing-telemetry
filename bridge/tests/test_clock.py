import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from frames import GameClock

TICKS = [17, 17, 16]   # the game clock advances 16.667 ms a frame, so its steps alternate like this
START = 55_800_000     # a time of day, in ms


def feed(clock, n, *, game_step=None, jitter=8.0, arrival_step=16.7, seed=1, game0=START, arrival0=0.0):
    """Feed `n` packets. Returns the timestamps, plus the game and arrival times used."""
    rng = random.Random(seed)
    game, out, games, arrivals = game0, [], [], []
    for i in range(n):
        game += TICKS[i % 3] if game_step is None else game_step
        arrival = arrival0 + (i + 1) * arrival_step + rng.uniform(-jitter, jitter)
        out.append(clock.update(game, arrival))
        games.append(game)
        arrivals.append(arrival)
    return out, games, arrivals


class GameClockTest(unittest.TestCase):
    def test_a_steady_game_clock_is_trusted_and_removes_the_jitter(self):
        clock = GameClock()
        ts, games, _ = feed(clock, 600)
        self.assertTrue(clock.trusted)
        steps = [b - a for a, b in zip(ts[200:], ts[201:])]
        self.assertTrue(all(abs(s - 16) < 1e-6 or abs(s - 17) < 1e-6 for s in steps))   # exactly the game's ticks
        self.assertAlmostEqual(ts[-1] - ts[300], games[-1] - games[300], places=6)       # elapsed = game elapsed

    def test_it_does_not_trust_the_game_clock_at_first(self):
        clock = GameClock()
        ts, _, arrivals = feed(clock, GameClock.MIN_SAMPLES - 5)
        self.assertFalse(clock.trusted)
        self.assertAlmostEqual(ts[-1] - ts[0], arrivals[-1] - arrivals[0], places=6)      # following arrival time

    def test_time_stands_still_while_the_game_is_paused(self):
        clock = GameClock()
        ts, games, _ = feed(clock, 300)
        held = ts[-1]
        for i in range(100):                                    # packets keep arriving, game clock frozen
            self.assertEqual(clock.update(games[-1], 5000 + i * 16.7), held)
        after = clock.update(games[-1] + 17, 5000 + 100 * 16.7)
        self.assertAlmostEqual(after - held, 17)                # and resumes from where it stopped
        self.assertTrue(clock.trusted)

    def test_a_network_stall_does_not_move_a_trusted_clock(self):
        clock = GameClock()
        ts, games, arrivals = feed(clock, 300)
        stalled = clock.update(games[-1] + 17, arrivals[-1] + 300)      # this packet arrived 300 ms late
        self.assertAlmostEqual(stalled - ts[-1], 17)

    def test_accelerated_time_of_day_is_not_trusted(self):
        for step in (33, 50, 90):                               # 2x, 3x and 5x time of day
            clock = GameClock()
            ts, _, arrivals = feed(clock, 400, game_step=step, jitter=0)
            self.assertFalse(clock.trusted, f"step {step}")
            self.assertAlmostEqual(ts[-1] - ts[0], arrivals[-1] - arrivals[0], places=6)

    def test_a_frozen_or_missing_game_clock_falls_back_to_arrival_time(self):
        clock = GameClock()
        ts, _, arrivals = feed(clock, 400, game_step=0)
        self.assertFalse(clock.trusted)
        self.assertAlmostEqual(ts[-1] - ts[0], arrivals[-1] - arrivals[0], places=6)

    def test_a_restart_withdraws_trust_and_time_never_goes_backwards(self):
        clock = GameClock()
        ts, games, arrivals = feed(clock, 300)
        self.assertTrue(clock.trusted)
        last = ts[-1]
        after = clock.update(START - 50_000_000, arrivals[-1] + 16.7)      # the game clock jumps backwards
        self.assertFalse(clock.trusted)
        self.assertGreaterEqual(after, last)
        # trust is earned again once the new clock behaves
        more, _, _ = feed(clock, 200, game0=START - 50_000_000, arrival0=arrivals[-1] + 16.7)
        self.assertTrue(clock.trusted)
        self.assertTrue(all(b >= a for a, b in zip(more, more[1:])))

    def test_a_huge_jump_forward_is_not_ordinary_ticking(self):
        clock = GameClock()
        ts, games, arrivals = feed(clock, 300)
        after = clock.update(games[-1] + 5_000_000, arrivals[-1] + 16.7)   # for example a time-of-day skip
        self.assertFalse(clock.trusted)
        self.assertAlmostEqual(after - ts[-1], 16.7, places=6)             # time itself doesn't jump

    def test_time_never_goes_backwards_whatever_arrives(self):
        rng = random.Random(7)
        clock = GameClock()
        game, arrival, last = START, 0.0, None
        for _ in range(5000):
            game += rng.choice([0, 0, 16, 17, 17, 33, 250, -1000, 5_000_000])
            arrival += rng.choice([0.0, 2.0, 16.7, 30.0, 300.0, -5.0])     # even a clock that steps back
            t = clock.update(game, arrival)
            if last is not None:
                self.assertGreaterEqual(t, last)
            last = t


if __name__ == "__main__":
    unittest.main()
