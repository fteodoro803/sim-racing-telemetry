"""Convert decoded GT7 packets into the page's frame format (see the top-level README).

The frame format is game-agnostic: the page and its timing logic only ever see frames, so all the
knowledge of GT7's units and quirks stays in this bridge. Another game would get its own decoder
and its own function like `to_frame`.
"""
import collections

from gt7 import decode_flags

NO_SUGGESTED_GEAR = 15   # the high nibble of the gear byte is 15 when the game has no suggestion


class GameClock:
    """Timestamps frames from the game's own clock when that can be trusted, and from arrival times otherwise.

    Stamping a frame with the moment its packet arrived carries Wi-Fi jitter (a few ms, with spikes of
    a hundred), and it drifts from the game's time, because the console sends slightly fewer than 60
    packets a second while its own clock counts exact frames. Measured on a real session, that made the
    live delta wobble by several ms and a lap's time come out hundreds of ms off the game's.

    GT7 packets carry a time value (documented as time of day, in ms) that advances one frame per
    packet and stands still while the game is paused. This class uses it when it has been seen to run
    at real time. It might not: time of day can be accelerated in some events, so the clock has to
    earn its trust. Trust is granted once the game clock has advanced at close to the pace of the
    arrival clock over recent packets, and withdrawn if it stops doing so, or jumps (a restart).
    Until then, and whenever it isn't trusted, time follows the arrival clock, so `t` is always
    continuous and never goes backwards.

    Call `update(game_ms, arrival_ms)` for every packet; it returns the timestamp in ms.
    """

    WINDOW = 600            # packets (about 10 s) of history used to judge the game clock. Long enough that a
                            # network stall, and the burst of packets after it, average out
    MIN_SAMPLES = 60        # packets (about 1 s) seen before it can be trusted
    MAX_STEP_MS = 100       # a bigger jump than this in one packet isn't ordinary ticking
    TRUST_BAND = (0.95, 1.05)     # game time per arrival time needed to start trusting
    DISTRUST_BAND = (0.90, 1.10)  # ...and to keep trusting (a little slack, so it doesn't flap)

    def __init__(self):
        self.t = None
        self.trusted = False
        self._prev = None                                   # (game_ms, arrival_ms) of the last packet
        self._steps = collections.deque(maxlen=self.WINDOW)  # (game step, arrival step) when the game clock moved

    def _ratio(self):
        game = sum(g for g, _ in self._steps)
        arrival = sum(a for _, a in self._steps)
        return game / arrival if arrival > 0 else None

    def update(self, game_ms, arrival_ms):
        """Return the timestamp (ms) for a packet with this game time and arrival time."""
        if self._prev is None:
            self._prev = (game_ms, arrival_ms)
            self.t = arrival_ms
            return self.t
        step = game_ms - self._prev[0]
        arrival_step = max(0.0, arrival_ms - self._prev[1])
        self._prev = (game_ms, arrival_ms)

        if 0 < step <= self.MAX_STEP_MS:
            self._steps.append((step, arrival_step))
            ratio = self._ratio()
            band = self.DISTRUST_BAND if self.trusted else self.TRUST_BAND
            self.trusted = ratio is not None and len(self._steps) >= self.MIN_SAMPLES and band[0] <= ratio <= band[1]
        elif step != 0:
            self._steps.clear()      # went backwards or jumped: start again from arrival time
            self.trusted = False

        if self.trusted and 0 <= step <= self.MAX_STEP_MS:
            self.t += step           # 0 while the game is paused: time stands still with it
        else:
            self.t += arrival_step
        return self.t


def make_frame(decoded, clock, arrival_ms):
    """Build the frame for a decoded packet: stamp it with `clock`, and say whether `t` is the game's clock.

    `gameClock` is true when `t` comes from the game's own clock. The page uses that to know that the
    game's lap times are in the same time base as `t`, so lap boundaries can be pinned to them exactly.
    """
    frame = to_frame(decoded, clock.update(decoded["time_value"], arrival_ms))
    frame["gameClock"] = clock.trusted
    return frame


def to_frame(decoded, t_ms):
    """Turn one decoded type-A packet into a frame, stamped `t_ms` milliseconds after the bridge started.

    Speed goes from m/s to km/h and the pedals from 0-255 to 0-100. Position is x and z, the ground
    plane (y is height). `lastLap` is only included when the game reports one (it is -1 before the
    first lap). The flags become `paused`, `loading` and `onTrack`, which the lap tracker uses to
    hold timing. `totalLaps` is left out for now because its offset in the packet is unconfirmed.

    `t_ms` comes from a `GameClock`, which prefers the game's own clock to arrival times.
    """
    flags = decode_flags(decoded["flags"])
    gear = decoded["gear"]
    suggested = decoded["suggested_gear"]
    frame = {
        "t": round(t_ms, 3),
        "lap": decoded["lap"],
        "x": round(decoded["position"][0], 2),
        "z": round(decoded["position"][2], 2),
        "speed": round(decoded["speed_ms"] * 3.6, 2),
        "throttle": round(decoded["throttle"] / 2.55, 1),
        "brake": round(decoded["brake"] / 2.55, 1),
        "gear": gear,
        "suggestedGear": gear if suggested == NO_SUGGESTED_GEAR else suggested,
        "rpm": round(decoded["rpm"]),
        "rpmWarning": decoded["rpm_warning"],
        "rpmLimiter": decoded["rpm_limiter"],
        "paused": flags["paused"],
        "loading": flags["loading"],
        "onTrack": flags["car_on_track"],
    }
    if decoded["last_lap"] > 0:
        frame["lastLap"] = decoded["last_lap"]
    return frame
