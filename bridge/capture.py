#!/usr/bin/env python3
"""Ask a PlayStation for GT7 telemetry, show what arrives, and optionally record the raw packets.

This is the first slice of the bridge: it proves the console is sending data, that we can decrypt
it, and gives us real packets to build and test the decoder against. Nothing to install; it uses
only the Python standard library.

    python3 bridge/capture.py --ps4-ip 192.168.1.20 --out session.jsonl.gz

The console must be on the same network as this machine, and GT7 must be running (in a race, a
time trial, or free practice; menus may send nothing). No setting on the console is needed.
"""
import argparse
import socket
import sys
import time
from dataclasses import dataclass, field

from capture_file import CaptureWriter
from gt7 import (HEARTBEAT_PORT, PACKET_SIZES, TELEMETRY_PORT, Decryptor, decode_a, decode_flags,
                 heartbeat)

HEARTBEAT_EVERY_S = 5.0    # the console needs one every ~16 s at most; this is comfortably inside
NO_DATA_HINT_AFTER_S = 3.0
SUMMARY_EVERY_S = 0.5


@dataclass
class Stats:
    """What a capture run saw: how many packets, how many were unreadable, and how many were lost."""
    packets: int = 0
    unreadable: int = 0
    lost: int = 0                     # gaps in the packet id sequence
    seconds: float = 0.0
    sizes: set = field(default_factory=set)
    constant: object = None           # the nonce constant that worked, if any
    last_summary: dict = None         # the last decoded packet


def format_summary(d):
    """One readable line for a decoded packet: lap, speed, gear, rpm, pedals, position, flags."""
    flags = [name for name, on in decode_flags(d["flags"]).items() if on]
    x, _, z = d["position"]
    return (f"#{d['packet_id']:<7} lap {d['lap']:<3} {d['speed_ms'] * 3.6:5.0f} km/h  "
            f"gear {d['gear']}(→{d['suggested_gear']})  {d['rpm']:5.0f} rpm  "
            f"thr {d['throttle'] / 2.55:3.0f}% brk {d['brake'] / 2.55:3.0f}%  "
            f"x={x:8.1f} z={z:8.1f}  last {d['last_lap']}  [{','.join(flags)}]")


def capture(console_ip, *, packet_type="A", send_port=HEARTBEAT_PORT, recv_port=TELEMETRY_PORT,
            seconds=None, out=None, say=print, on_decoded=None, show_values=True, stop=None):
    """Send heartbeats to the console, receive and decode its packets, and return a Stats summary.

    Runs until `seconds` have passed (or forever if None), `stop` (a threading.Event) is set, or the
    user presses Ctrl-C. `out`, if given, is a path to record the raw packets to. `say` receives each
    line of output, so tests can silence or capture it. `on_decoded(decoded, seconds_since_start)` is
    called for every packet that decodes, which is how the bridge gets its data; `show_values=False`
    stops the live value lines for callers that don't want them.
    """
    # 1. Listen for telemetry. The heartbeat goes out from this same socket, so the console
    #    replies to the port we're listening on.
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("0.0.0.0", recv_port))
    sock.settimeout(0.5)

    stats = Stats()
    decrypt = Decryptor()
    writer = CaptureWriter(out, console=console_ip, packet_type=packet_type) if out else None
    started = time.monotonic()
    last_heartbeat = float("-inf")
    last_summary = float("-inf")
    last_id = None
    warned_no_data = False

    try:
        while (seconds is None or time.monotonic() - started < seconds) and not (stop and stop.is_set()):
            now = time.monotonic()

            # 2. Keep the console sending: it stops if the heartbeat lapses
            if now - last_heartbeat >= HEARTBEAT_EVERY_S:
                sock.sendto(heartbeat(packet_type), (console_ip, send_port))
                last_heartbeat = now

            # 3. Receive a packet, and say something helpful if nothing is arriving
            try:
                data, _ = sock.recvfrom(4096)
            except socket.timeout:
                if stats.packets == 0 and not warned_no_data and now - started > NO_DATA_HINT_AFTER_S:
                    say("No packets yet. Check the console's IP address, that both devices are on "
                        "the same network, and that GT7 is running in a race or time trial.")
                    warned_no_data = True
                continue

            stats.packets += 1
            stats.sizes.add(len(data))
            if writer:
                writer.write(time.monotonic() - started, data)

            # 4. Decrypt and decode
            plain = decrypt(data)
            if plain is None:
                stats.unreadable += 1
                if stats.unreadable <= 3:
                    say(f"Received a {len(data)}-byte packet that didn't decrypt to a GT7 packet.")
                continue
            stats.constant = decrypt.constant
            decoded = decode_a(plain)
            stats.last_summary = decoded

            if on_decoded:
                on_decoded(decoded, time.monotonic() - started)

            packet_id = decoded["packet_id"]
            if last_id is not None and packet_id > last_id + 1:
                stats.lost += packet_id - last_id - 1
            last_id = packet_id

            # 5. Show a line a couple of times a second, not one per packet
            if show_values and now - last_summary >= SUMMARY_EVERY_S:
                say(format_summary(decoded))
                last_summary = now
    except KeyboardInterrupt:
        pass
    finally:
        stats.seconds = time.monotonic() - started
        sock.close()
        if writer:
            writer.close()
    return stats


def report(stats, packet_type, out, say=print):
    """Print a short summary of a finished capture, including anything worth investigating."""
    say("")
    rate = stats.packets / stats.seconds if stats.seconds else 0
    say(f"{stats.packets} packets in {stats.seconds:.1f} s ({rate:.0f}/s), "
        f"{stats.unreadable} unreadable, {stats.lost} lost")
    if stats.sizes:
        sizes = ", ".join(str(s) for s in sorted(stats.sizes))
        expected = PACKET_SIZES.get(packet_type)
        say(f"Packet sizes seen: {sizes} bytes (type {packet_type} should be {expected})")
    if stats.constant is not None:
        say(f"Decrypted with nonce constant 0x{stats.constant:08X}")
    if out and stats.packets:
        say(f"Recorded to {out}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--ps4-ip", "--console-ip", dest="ip", required=True,
                        help="the console's IP address (PS4: Settings > Network > View Connection Status)")
    parser.add_argument("--type", dest="packet_type", default="A", choices=list(PACKET_SIZES),
                        help="packet type to request (default A; B, ~ and C carry more fields)")
    parser.add_argument("--out", help="record raw packets to this file (.gz to compress)")
    parser.add_argument("--seconds", type=float, help="stop after this many seconds")
    args = parser.parse_args(argv)

    print(f"Asking {args.ip} for type-{args.packet_type} packets. Press Ctrl-C to stop.")
    stats = capture(args.ip, packet_type=args.packet_type, seconds=args.seconds, out=args.out)
    report(stats, args.packet_type, args.out)
    return 0 if stats.packets > stats.unreadable else 1


if __name__ == "__main__":
    sys.exit(main())
