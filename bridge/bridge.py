#!/usr/bin/env python3
"""Relay GT7 telemetry from a PlayStation to the web page, and serve the page too.

    python3 bridge/bridge.py --ps4-ip YOUR-PS4-IP

It asks the console for telemetry, decodes each packet into a frame, and broadcasts the frames over
a WebSocket. It also serves the `web/` folder over http on the same port, so a tablet on your
network can open the page directly (a page hosted on https can't connect to a bridge on another
device). Nothing to install: it uses only the Python standard library.

To try it without a console:

    python3 bridge/bridge.py --fake-console
"""
import argparse
import json
import socket
import sys
import threading
import time
from pathlib import Path

from capture import capture, report
from fake_console import FakeConsole
from frames import GameClock, make_frame
from gt7 import HEARTBEAT_PORT, PACKET_SIZES, TELEMETRY_PORT, check_console_address
from ws_server import Hub, make_server

DEFAULT_WEB_DIR = Path(__file__).resolve().parent.parent / "web"
DEFAULT_PORT = 8765
STATUS_EVERY_S = 1.0


class GapLog:
    """Reports stalls between packets arriving and how long each broadcast takes, to find where a stutter starts.

    A long gap between packets means the delay is upstream of the bridge (network or console); a long
    broadcast means the bridge or the browser connection is the slow part.
    """

    def __init__(self, say, gap_ms=50, send_ms=20):
        self.say = say
        self.gap_ms = gap_ms
        self.send_ms = send_ms
        self._last = None

    def arrived(self, now):
        """Note a packet arriving at `now` (a time.monotonic() value); report it if the gap was long."""
        if self._last is not None and (now - self._last) * 1000 >= self.gap_ms:
            self.say(f"[gap] no packet for {(now - self._last) * 1000:.0f} ms before this one")
        self._last = now

    def sent(self, started, finished):
        """Report a broadcast that took long to hand to the browsers."""
        if (finished - started) * 1000 >= self.send_ms:
            self.say(f"[slow send] broadcast took {(finished - started) * 1000:.0f} ms")


class Bridge:
    """The running bridge: the console capture, the HTTP/WebSocket server, and the broadcast between them."""

    def __init__(self, console_ip, *, packet_type="A", heartbeat_port=HEARTBEAT_PORT,
                 telemetry_port=TELEMETRY_PORT, host="0.0.0.0", http_port=DEFAULT_PORT,
                 web_dir=DEFAULT_WEB_DIR, record=None, say=print, log_gaps=False):
        self.console_ip = console_ip
        self.packet_type = packet_type
        self.heartbeat_port = heartbeat_port
        self.telemetry_port = telemetry_port
        self.record = record
        self.gap_log = GapLog(say) if log_gaps else None
        self.say = say
        self.hub = Hub()
        info = {"bridge": True, "game": "gt7", "packetType": packet_type}
        hello = {"type": "hello", **info}
        self.server = make_server(host, http_port, web_dir, self.hub, info, hello)
        self.port = self.server.server_address[1]
        self.stats = None
        self.clock = GameClock()
        self.error = None     # set if the capture stops because of an error, so the bridge can say so and exit
        self._stop = threading.Event()
        self._threads = []

    def _on_decoded(self, decoded, seconds):
        """Convert a decoded packet to a frame and broadcast it to every connected browser."""
        started = time.monotonic()
        if self.gap_log:
            self.gap_log.arrived(started)
        frame = make_frame(decoded, self.clock, seconds * 1000)
        self.hub.broadcast_frame(json.dumps({"type": "frame", **frame}, separators=(",", ":")))
        if self.gap_log:
            self.gap_log.sent(started, time.monotonic())

    def _status_loop(self):
        """Once a second, tell the browsers whether packets are still arriving from the console."""
        while not self._stop.wait(STATUS_EVERY_S):
            self.hub.broadcast(json.dumps({"type": "status", "receiving": self.hub.receiving(),
                                           "frames": self.hub.frames}))

    def _capture_loop(self):
        """Run the console capture. If it fails (say the record folder can't be created, or a port is
        taken), remember the error so the bridge can report it and stop, instead of carrying on serving
        a page that will never receive anything."""
        try:
            self.stats = capture(
                self.console_ip, packet_type=self.packet_type, send_port=self.heartbeat_port,
                recv_port=self.telemetry_port, out=self.record, say=self.say,
                on_decoded=self._on_decoded, show_values=False, stop=self._stop)
        except Exception as err:   # noqa: BLE001 - any failure here should stop the bridge with a message
            self.error = err

    def start(self):
        """Start serving, broadcasting and capturing in background threads."""
        for target in (self.server.serve_forever, self._status_loop, self._capture_loop):
            thread = threading.Thread(target=target, daemon=True)
            thread.start()
            self._threads.append(thread)
        return self

    def stop(self):
        self._stop.set()
        self.server.shutdown()
        self.server.server_close()
        for thread in self._threads:
            thread.join(timeout=3)


def lan_address():
    """This machine's address on the local network, or None. Doesn't send any traffic."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--ps4-ip", "--console-ip", dest="ip",
                        help="the console's IP address (PS4: Settings > Network > View Connection Status)")
    parser.add_argument("--fake-console", action="store_true",
                        help="use a built-in fake console instead of a real one, to try the page")
    parser.add_argument("--type", dest="packet_type", default="A", choices=list(PACKET_SIZES),
                        help="packet type to request (default A; only A is decoded so far)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"web port (default {DEFAULT_PORT})")
    parser.add_argument("--host", default="0.0.0.0",
                        help="address to serve on; 127.0.0.1 keeps it to this computer (default: all)")
    parser.add_argument("--heartbeat-port", type=int, default=HEARTBEAT_PORT,
                        help=f"port to send the console heartbeat to (default {HEARTBEAT_PORT})")
    parser.add_argument("--telemetry-port", type=int, default=TELEMETRY_PORT,
                        help=f"local port to receive telemetry on (default {TELEMETRY_PORT})")
    parser.add_argument("--web-dir", type=Path, default=DEFAULT_WEB_DIR, help="folder to serve")
    parser.add_argument("--record", help="also record raw packets to this file (.gz to compress)")
    parser.add_argument("--log-gaps", action="store_true",
                        help="print stalls between packets and slow broadcasts, to diagnose stuttering")
    args = parser.parse_args(argv)
    if not args.ip and not args.fake_console:
        parser.error("give --ps4-ip, or --fake-console to try it without a console")
    if args.ip:
        try:
            check_console_address(args.ip)
        except ValueError as err:
            parser.error(str(err))

    fake = None
    ip = args.ip
    if args.fake_console:
        fake = FakeConsole(listen_port=args.heartbeat_port, host="127.0.0.1", say=lambda msg: None)
        fake.start()
        ip = "127.0.0.1"
        print("Using the built-in fake console (made-up numbers).", flush=True)

    bridge = Bridge(ip, packet_type=args.packet_type, host=args.host, http_port=args.port,
                    heartbeat_port=args.heartbeat_port, telemetry_port=args.telemetry_port,
                    web_dir=args.web_dir, record=args.record, log_gaps=args.log_gaps)
    bridge.start()
    print(f"Asking {ip} for type-{args.packet_type} packets.", flush=True)
    print(f"Open on this computer:  http://localhost:{bridge.port}", flush=True)
    lan = lan_address()
    if lan and args.host in ("0.0.0.0", lan):
        print(f"Open on your iPad:      http://{lan}:{bridge.port}   (same Wi-Fi network)", flush=True)
    print("Press Ctrl-C to stop.", flush=True)
    try:
        while bridge.error is None:
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        bridge.stop()
        if fake:
            fake.stop()
        if bridge.stats:
            report(bridge.stats, args.packet_type, args.record)
    if bridge.error is not None:
        print(f"\nThe bridge stopped because of an error: {bridge.error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
