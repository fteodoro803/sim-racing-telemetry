#!/usr/bin/env python3
"""A stand-in for a PlayStation running GT7, so the bridge can be tried and tested without one.

It listens for the heartbeat on the console's port, then streams encrypted type-A packets back to
whoever sent it, at 60 Hz, of a car driving laps round a circle. It speaks the same protocol as the
real console, so it exercises the whole path (heartbeat, encryption, decoding), but the numbers are
made up and it is only as accurate as our understanding of the protocol. It can't reveal a mistake
in that understanding; only a real console can.

    python3 bridge/fake_console.py
    python3 bridge/capture.py --ps4-ip 127.0.0.1
"""
import argparse
import bisect
import functools
import math
import select
import socket
import struct
import threading
import time

from gt7 import HEARTBEAT_PORT, KEY, MAGIC, PACKET_SIZES
from salsa20 import salsa20_xor

NONCE_CONSTANT = 0xDEADBEAF   # the type-A constant


SPEED_SWING = 0.35                          # speed varies by this fraction of the mean round the lap
GEAR_UP = [0, 55, 95, 135, 175, 220, 265]   # km/h at which each gear starts
RPM_WARNING, RPM_LIMITER = 7000, 8200
NO_SUGGESTION = 15                          # the high nibble of the gear byte when the game has no suggestion


@functools.lru_cache(maxsize=8)
def _lap_profile(lap_seconds, steps=2000):
    """How long the car takes to reach each angle round the circle, so speed can vary but a lap always takes `lap_seconds`.

    The angular speed is `omega_ref * (1 + SPEED_SWING * sin(2 * angle))`: two fast stretches and two
    slow ones per lap. Integrating the time taken for each small step gives a table of elapsed time
    against angle, and `omega_ref` is chosen so the whole lap adds up to exactly `lap_seconds`.
    """
    step = 2 * math.pi / steps
    times = [0.0]
    for i in range(steps):
        angle = (i + 0.5) * step
        times.append(times[-1] + step / (1 + SPEED_SWING * math.sin(2 * angle)))
    omega_ref = times[-1] / lap_seconds
    return [t / omega_ref for t in times], omega_ref


def _car_state(into_lap, lap_seconds, radius):
    """The car's angle, speed (m/s) and acceleration (m/s^2) `into_lap` seconds into a lap."""
    times, omega_ref = _lap_profile(lap_seconds)
    i = min(bisect.bisect_right(times, into_lap) - 1, len(times) - 2)
    fraction = (into_lap - times[i]) / (times[i + 1] - times[i])
    angle = (i + fraction) * 2 * math.pi / (len(times) - 1)
    omega = omega_ref * (1 + SPEED_SWING * math.sin(2 * angle))
    accel = radius * omega_ref * SPEED_SWING * 2 * math.cos(2 * angle) * omega
    return angle, radius * omega, accel


def _gear_and_rpm(kmh):
    """A gear for this speed, and a plausible rpm within it (illustrative, not a real gearbox)."""
    gear = max(i for i, threshold in enumerate(GEAR_UP) if kmh >= threshold) + 1
    low = GEAR_UP[gear - 1]
    high = GEAR_UP[gear] if gear < len(GEAR_UP) else 320
    return gear, 4500 + 3700 * min(1.0, (kmh - low) / (high - low))


def build_packet(t, packet_id, *, lap_seconds=20.0, radius=200.0, paused=False):
    """Build a plaintext type-A packet for a car `t` seconds into a drive round a circle.

    The car does one lap every `lap_seconds`, speeding up and slowing down as it goes, so speed, gear,
    rpm and the pedals all move. The lap counter starts at 1 and rises at each crossing of the start
    line; `last_lap` is the previous lap's time in ms, or -1 on lap 1. Speed is consistent with
    position, so the mean speed is the circumference over the lap time.
    """
    p = bytearray(PACKET_SIZES["A"])
    struct.pack_into("<I", p, 0x00, MAGIC)

    laps_done, into_lap = divmod(t, lap_seconds)
    angle, speed, accel = _car_state(into_lap, lap_seconds, radius)
    gear, rpm = _gear_and_rpm(speed * 3.6)
    struct.pack_into("<3f", p, 0x04, radius * math.cos(angle), 0.0, radius * math.sin(angle))
    struct.pack_into("<f", p, 0x3C, rpm)
    struct.pack_into("<2f", p, 0x44, 60.0 - t * 0.01, 100.0)         # fuel level, capacity
    struct.pack_into("<f", p, 0x4C, speed)
    struct.pack_into("<4f", p, 0x60, 80.0, 82.0, 78.0, 79.0)         # tyre temps
    struct.pack_into("<i", p, 0x70, packet_id)
    struct.pack_into("<h", p, 0x74, 1 + int(laps_done))
    last = round(lap_seconds * 1000) if laps_done >= 1 else -1
    struct.pack_into("<2i", p, 0x78, last, last)                     # best, last lap
    struct.pack_into("<2H", p, 0x88, RPM_WARNING, RPM_LIMITER)
    flags = 0b1 | (0b10 if paused else 0)                            # on track, paused
    struct.pack_into("<H", p, 0x8E, flags)
    suggested = min(gear + 1, len(GEAR_UP)) if rpm > RPM_WARNING else NO_SUGGESTION
    p[0x90] = gear | (suggested << 4)
    p[0x91] = 255 if accel > 0.5 else 100 if accel > -1.5 else 0     # throttle: full, cruising, off
    p[0x92] = min(255, int(-accel * 20)) if accel < -1.5 else 0      # brake, harder the harder it slows
    return bytes(p)


def encrypt(plain, seed, constant=NONCE_CONSTANT):
    """Encrypt a plaintext packet the way the console does, embedding the nonce seed at 0x40."""
    nonce = ((seed ^ constant) & 0xFFFFFFFF).to_bytes(4, "little") + seed.to_bytes(4, "little")
    cipher = bytearray(salsa20_xor(KEY, nonce, plain))
    cipher[0x40:0x44] = seed.to_bytes(4, "little")
    return bytes(cipher)


class FakeConsole(threading.Thread):
    """Waits for a heartbeat, then streams packets back to its sender until stopped."""

    def __init__(self, *, listen_port=HEARTBEAT_PORT, host="127.0.0.1", rate_hz=60,
                 lap_seconds=20.0, radius=200.0, say=lambda msg: print(msg, flush=True)):
        super().__init__(daemon=True)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind((host, listen_port))
        self.port = self.sock.getsockname()[1]
        self.rate_hz = rate_hz
        self.lap_seconds = lap_seconds
        self.radius = radius
        self.say = say
        self._stopped = threading.Event()

    def stop(self):
        self._stopped.set()

    def run(self):
        target = None
        packet_id = 0
        t = 0.0
        next_send = time.monotonic()
        while not self._stopped.is_set():
            # Sleep until the next packet is due, waking early if a heartbeat arrives. Blocking on
            # a fixed receive timeout instead would cap the send rate well below 60 Hz.
            wait = max(0.0, next_send - time.monotonic()) if target else 0.05
            ready, _, _ = select.select([self.sock], [], [], min(wait, 0.05))
            if ready:
                data, addr = self.sock.recvfrom(64)
                if target != addr:
                    self.say(f"Heartbeat {data!r} from {addr[0]}:{addr[1]}, streaming to it")
                    next_send = time.monotonic()   # start the clock now, not at launch, or we'd burst
                target = addr
            if target and time.monotonic() >= next_send:
                plain = build_packet(t, packet_id, lap_seconds=self.lap_seconds, radius=self.radius)
                self.sock.sendto(encrypt(plain, seed=(packet_id * 2654435761) & 0xFFFFFFFF), target)
                packet_id += 1
                t += 1 / self.rate_hz
                next_send += 1 / self.rate_hz
        self.sock.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--port", type=int, default=HEARTBEAT_PORT, help="heartbeat port to listen on")
    parser.add_argument("--host", default="127.0.0.1",
                        help="address to listen on (use 0.0.0.0 to serve other machines)")
    args = parser.parse_args()
    console = FakeConsole(listen_port=args.port, host=args.host)
    console.start()
    print(f"Fake console listening for a heartbeat on {args.host}:{console.port}. Ctrl-C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        console.stop()


if __name__ == "__main__":
    main()
