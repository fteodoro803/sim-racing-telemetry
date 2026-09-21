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
import math
import select
import socket
import struct
import threading
import time

from gt7 import HEARTBEAT_PORT, KEY, MAGIC, PACKET_SIZES
from salsa20 import salsa20_xor

NONCE_CONSTANT = 0xDEADBEAF   # the type-A constant


def build_packet(t, packet_id, *, lap_seconds=20.0, radius=200.0, paused=False):
    """Build a plaintext type-A packet for a car `t` seconds into a drive round a circle.

    The car does one lap of a circle every `lap_seconds`. The lap counter starts at 1 and rises at
    each crossing of the start line; `last_lap` is the previous lap's time in ms, or -1 on lap 1.
    """
    p = bytearray(PACKET_SIZES["A"])
    struct.pack_into("<I", p, 0x00, MAGIC)

    laps_done, into_lap = divmod(t, lap_seconds)
    angle = 2 * math.pi * into_lap / lap_seconds
    speed = 2 * math.pi * radius / lap_seconds                       # m/s
    struct.pack_into("<3f", p, 0x04, radius * math.cos(angle), 0.0, radius * math.sin(angle))
    struct.pack_into("<f", p, 0x3C, 3000 + 5000 * (0.5 + 0.5 * math.sin(t * 2)))  # rpm
    struct.pack_into("<2f", p, 0x44, 60.0 - t * 0.01, 100.0)         # fuel level, capacity
    struct.pack_into("<f", p, 0x4C, speed)
    struct.pack_into("<4f", p, 0x60, 80.0, 82.0, 78.0, 79.0)         # tyre temps
    struct.pack_into("<i", p, 0x70, packet_id)
    struct.pack_into("<h", p, 0x74, 1 + int(laps_done))
    last = round(lap_seconds * 1000) if laps_done >= 1 else -1
    struct.pack_into("<2i", p, 0x78, last, last)                     # best, last lap
    struct.pack_into("<2H", p, 0x88, 7000, 8200)                     # rev warning, limiter
    flags = 0b1 | (0b10 if paused else 0)                            # on track, paused
    struct.pack_into("<H", p, 0x8E, flags)
    p[0x90] = 4 | (5 << 4)                                           # gear 4, suggested 5
    p[0x91] = 200 if math.sin(t * 2) > 0 else 0                      # throttle
    p[0x92] = 0 if math.sin(t * 2) > 0 else 150                      # brake
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
                 lap_seconds=20.0, say=lambda msg: print(msg, flush=True)):
        super().__init__(daemon=True)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind((host, listen_port))
        self.port = self.sock.getsockname()[1]
        self.rate_hz = rate_hz
        self.lap_seconds = lap_seconds
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
                plain = build_packet(t, packet_id, lap_seconds=self.lap_seconds)
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
