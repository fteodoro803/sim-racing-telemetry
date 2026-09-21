"""Convert decoded GT7 packets into the page's frame format (see the top-level README).

The frame format is game-agnostic: the page and its timing logic only ever see frames, so all the
knowledge of GT7's units and quirks stays in this bridge. Another game would get its own decoder
and its own function like `to_frame`.
"""
from gt7 import decode_flags

NO_SUGGESTED_GEAR = 15   # the high nibble of the gear byte is 15 when the game has no suggestion


def to_frame(decoded, t_ms):
    """Turn one decoded type-A packet into a frame, stamped `t_ms` milliseconds after the bridge started.

    Speed goes from m/s to km/h and the pedals from 0-255 to 0-100. Position is x and z, the ground
    plane (y is height). `lastLap` is only included when the game reports one (it is -1 before the
    first lap). The flags become `paused`, `loading` and `onTrack`, which the lap tracker uses to
    hold timing. `totalLaps` is left out for now because its offset in the packet is unconfirmed.

    The timestamp is when the bridge received the packet, not anything from the game; revisit once
    real packets show whether the packet id gives a steadier clock.
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
