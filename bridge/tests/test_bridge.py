import base64
import contextlib
import http.client
import io
import json
import math
import os
import socket
import struct
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bridge import Bridge, main
from capture import capture
from fake_console import FakeConsole, build_packet
from frames import to_frame
from gt7 import decode_a
from ws_server import (OP_CLOSE, OP_PING, OP_PONG, OP_TEXT, Hub, accept_key, encode_frame, make_server,
                       read_frame)


class FrameConversionTest(unittest.TestCase):
    def setUp(self):
        self.decoded = decode_a(build_packet(t=25.0, packet_id=7, lap_seconds=20.0))

    def test_units_and_names(self):
        f = to_frame(self.decoded, t_ms=1234.5678)
        self.assertEqual(f["t"], 1234.568)
        self.assertEqual(f["lap"], 2)
        self.assertAlmostEqual(f["speed"], self.decoded["speed_ms"] * 3.6, places=1)   # m/s to km/h
        self.assertEqual(f["gear"], self.decoded["gear"])
        self.assertGreaterEqual(f["suggestedGear"], f["gear"])
        self.assertEqual((f["rpmWarning"], f["rpmLimiter"]), (7000, 8200))
        self.assertLessEqual(f["throttle"], 100)
        self.assertLessEqual(f["brake"], 100)
        self.assertEqual(f["clutch"], 0.0)   # the fake console doesn't model the clutch pedal
        self.assertEqual(f["tyreTemp"], [80.0, 82.0, 78.0, 79.0])   # FL, FR, RL, RR, from the fake console
        self.assertEqual(f["lastLap"], 20000)
        # x and z are the ground plane; y (height) is not part of a frame
        self.assertNotIn("y", f)
        self.assertAlmostEqual(f["x"] ** 2 + f["z"] ** 2, 200.0 ** 2, delta=1.0)

    def test_pedals_scale_to_percent(self):
        d = dict(self.decoded, throttle=255, brake=0, clutch=0.5)
        f = to_frame(d, 0)
        self.assertEqual((f["throttle"], f["brake"], f["clutch"]), (100.0, 0.0, 50.0))

    def test_last_lap_is_left_out_until_there_is_one(self):
        self.assertNotIn("lastLap", to_frame(dict(self.decoded, last_lap=-1), 0))

    def test_no_suggested_gear_means_the_current_gear(self):
        f = to_frame(dict(self.decoded, gear=3, suggested_gear=15), 0)
        self.assertEqual((f["gear"], f["suggestedGear"]), (3, 3))

    def test_reverse_is_inferred_from_velocity_opposing_heading(self):
        # Confirmed on a real PS4 session (2026-09-22, D21): GT7's gear byte reads 0 throughout
        # reverse, same as neutral, so reverse has to come from velocity vs. heading instead.
        moving_against_heading = dict(self.decoded, gear=0, rotation=(0, 0, 0), velocity=(0, 0, 5))
        self.assertEqual(to_frame(moving_against_heading, 0)["gear"], -1)

    def test_reverse_is_not_inferred_below_the_speed_threshold(self):
        barely_creeping = dict(self.decoded, gear=0, rotation=(0, 0, 0), velocity=(0, 0, 0.1))
        self.assertEqual(to_frame(barely_creeping, 0)["gear"], 0)

    def test_reverse_is_not_inferred_from_a_nonzero_gear(self):
        # Forward gears (1-8) are only ever seen driving forward, so only gear 0 is ambiguous.
        moving_against_heading = dict(self.decoded, gear=3, rotation=(0, 0, 0), velocity=(0, 0, 5))
        self.assertEqual(to_frame(moving_against_heading, 0)["gear"], 3)

    def test_forward_motion_does_not_look_like_reverse(self):
        moving_with_heading = dict(self.decoded, gear=0, rotation=(0, 0, 0), velocity=(0, 0, -5))
        self.assertEqual(to_frame(moving_with_heading, 0)["gear"], 0)

    def test_flags_become_hold_signals(self):
        f = to_frame(dict(self.decoded, flags=0b001), 0)
        self.assertEqual((f["onTrack"], f["paused"], f["loading"]), (True, False, False))
        f = to_frame(dict(self.decoded, flags=0b010), 0)
        self.assertEqual((f["onTrack"], f["paused"]), (False, True))
        f = to_frame(dict(self.decoded, flags=0b100), 0)
        self.assertTrue(f["loading"])

    def test_rev_limit_alert_is_bit_5_of_flags(self):
        self.assertFalse(to_frame(dict(self.decoded, flags=0), 0)["revLimitAlert"])
        self.assertTrue(to_frame(dict(self.decoded, flags=1 << 5), 0)["revLimitAlert"])

    def test_the_frame_is_json_serialisable(self):
        json.dumps(to_frame(self.decoded, 0))


class FakeConsoleMotionTest(unittest.TestCase):
    """The fake car should move like a car: varied and self-consistent, not constant numbers."""

    def samples(self, lap_seconds=20.0, radius=200.0, n=2000):
        return [decode_a(build_packet(lap_seconds * i / n, i, lap_seconds=lap_seconds, radius=radius))
                for i in range(n)]

    def test_speed_gear_rpm_and_pedals_all_vary(self):
        s = self.samples()
        speeds = [d["speed_ms"] for d in s]
        self.assertGreater(max(speeds) / min(speeds), 1.5)
        self.assertGreater(len({d["gear"] for d in s}), 2)
        self.assertGreater(max(d["rpm"] for d in s) - min(d["rpm"] for d in s), 2000)
        self.assertTrue(any(d["throttle"] == 255 for d in s))
        self.assertTrue(any(d["brake"] > 0 for d in s))
        suggestions = {d["suggested_gear"] for d in s}
        self.assertIn(15, suggestions)                                   # sometimes no suggestion
        self.assertTrue(any(g != 15 and g > d["gear"] for d in s for g in [d["suggested_gear"]]))

    def test_speed_is_consistent_with_position_and_lap_time(self):
        # Distance covered at the reported speed over one lap is the circumference of the circle.
        lap, radius, n = 20.0, 200.0, 4000
        s = self.samples(lap, radius, n)
        distance = sum(d["speed_ms"] for d in s) * (lap / n)
        self.assertAlmostEqual(distance / (2 * math.pi * radius), 1.0, delta=0.01)

    def test_pedals_never_overlap_hard(self):
        for d in self.samples():
            self.assertFalse(d["throttle"] == 255 and d["brake"] > 0)

    def test_gear_matches_speed(self):
        from fake_console import GEAR_UP
        for d in self.samples():
            kmh = d["speed_ms"] * 3.6
            expected = max(i for i, threshold in enumerate(GEAR_UP) if kmh >= threshold) + 1
            self.assertEqual(d["gear"], expected)


class WebSocketFramingTest(unittest.TestCase):
    def test_accept_key_matches_the_rfc_example(self):
        # The worked example in RFC 6455 section 1.3
        self.assertEqual(accept_key("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")

    def test_frame_lengths(self):
        self.assertEqual(encode_frame(OP_TEXT, b"hi"), b"\x81\x02hi")
        self.assertEqual(encode_frame(OP_TEXT, b"x" * 200)[:4], b"\x81\x7e\x00\xc8")
        big = encode_frame(OP_TEXT, b"x" * 70000)
        self.assertEqual(big[:2], b"\x81\x7f")
        self.assertEqual(struct.unpack(">Q", big[2:10])[0], 70000)
        self.assertEqual(len(big), 10 + 70000)


def handshake(port):
    """Open a WebSocket to the server on `port` as a browser would. Returns (socket, response headers)."""
    sock = socket.create_connection(("127.0.0.1", port), timeout=3)
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall((f"GET /ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
    head = b""
    while not head.endswith(b"\r\n\r\n"):
        head += sock.recv(1)
    return sock, head.decode(), key


def client_frame(opcode, payload=b""):
    """A masked client frame, as browsers send."""
    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    assert len(payload) < 126
    return bytes([0x80 | opcode, 0x80 | len(payload)]) + mask + masked


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.web = tempfile.mkdtemp()
        Path(self.web, "index.html").write_text("<h1>hello</h1>")
        self.hub = Hub()
        info = {"bridge": True, "game": "gt7"}
        self.server = make_server("127.0.0.1", 0, self.web, self.hub, info, {"type": "hello", **info})
        self.port = self.server.server_address[1]
        import threading
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_serves_static_files_and_bridge_json(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        conn.request("GET", "/index.html")
        r = conn.getresponse()
        self.assertEqual((r.status, r.read()), (200, b"<h1>hello</h1>"))
        conn.request("GET", "/bridge.json")
        r = conn.getresponse()
        self.assertEqual(json.loads(r.read())["bridge"], True)
        conn.request("GET", "/missing.txt")
        self.assertEqual(conn.getresponse().status, 404)

    def test_does_not_serve_files_outside_the_web_folder(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        conn.request("GET", "/../../etc/passwd")
        self.assertIn(conn.getresponse().status, (301, 400, 404))

    def test_handshake_hello_broadcast_ping_and_close(self):
        sock, head, key = handshake(self.port)
        self.assertIn("101 Switching Protocols", head)
        self.assertIn(f"Sec-WebSocket-Accept: {accept_key(key)}", head)

        opcode, payload = read_frame(sock)                       # greeted on connect
        self.assertEqual(opcode, OP_TEXT)
        self.assertEqual(json.loads(payload)["type"], "hello")

        deadline = time.time() + 2
        while self.hub.client_count == 0 and time.time() < deadline:
            time.sleep(0.01)
        self.hub.broadcast('{"type":"frame","n":1}')
        opcode, payload = read_frame(sock)
        self.assertEqual(json.loads(payload), {"type": "frame", "n": 1})

        big = json.dumps({"pad": "x" * 70000})                   # exercises the 64-bit length path
        self.hub.broadcast(big)
        opcode, payload = read_frame(sock)
        self.assertEqual(payload.decode(), big)

        sock.sendall(client_frame(OP_PING, b"abc"))
        self.assertEqual(read_frame(sock), (OP_PONG, b"abc"))

        sock.sendall(client_frame(OP_CLOSE, struct.pack(">H", 1000)))
        self.assertEqual(read_frame(sock)[0], OP_CLOSE)
        deadline = time.time() + 2
        while self.hub.client_count and time.time() < deadline:
            time.sleep(0.01)
        self.assertEqual(self.hub.client_count, 0)
        sock.close()

    def test_a_client_that_vanishes_is_dropped_on_the_next_broadcast(self):
        sock, _, _ = handshake(self.port)
        read_frame(sock)
        deadline = time.time() + 2
        while self.hub.client_count == 0 and time.time() < deadline:
            time.sleep(0.01)
        sock.close()
        for _ in range(50):                                       # writes to a closed peer eventually fail
            self.hub.broadcast("x" * 1000)
            if self.hub.client_count == 0:
                break
            time.sleep(0.02)
        self.assertEqual(self.hub.client_count, 0)

    def test_websocket_upgrade_without_a_key_is_rejected(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        conn.request("GET", "/ws", headers={"Upgrade": "websocket", "Connection": "Upgrade"})
        self.assertEqual(conn.getresponse().status, 400)


class BridgeFailureTest(unittest.TestCase):
    """Problems must be reported, not swallowed by a background thread while the page sits waiting."""

    def test_a_capture_that_cannot_start_is_reported(self):
        blocker = tempfile.NamedTemporaryFile(delete=False)          # a file where a folder is needed
        bridge = Bridge("127.0.0.1", heartbeat_port=9, telemetry_port=0, host="127.0.0.1", http_port=0,
                        web_dir=tempfile.mkdtemp(), record=os.path.join(blocker.name, "sub", "x.gz"),
                        say=lambda m: None)
        bridge.start()
        try:
            deadline = time.time() + 3
            while bridge.error is None and time.time() < deadline:
                time.sleep(0.05)
            self.assertIsInstance(bridge.error, OSError)
        finally:
            bridge.stop()

    def test_a_missing_record_folder_is_created(self):
        folder = os.path.join(tempfile.mkdtemp(), "captures")         # doesn't exist yet
        console = FakeConsole(listen_port=0, say=lambda m: None)
        console.start()
        bridge = Bridge("127.0.0.1", heartbeat_port=console.port, telemetry_port=0, host="127.0.0.1",
                        http_port=0, web_dir=tempfile.mkdtemp(), record=os.path.join(folder, "s.jsonl.gz"),
                        say=lambda m: None)
        bridge.start()
        try:
            time.sleep(1.0)
            self.assertIsNone(bridge.error)
        finally:
            bridge.stop()
            console.stop()
        self.assertTrue(os.path.exists(os.path.join(folder, "s.jsonl.gz")))

    def test_a_placeholder_address_is_rejected_before_anything_starts(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as caught:
            main(["--ps4-ip", "YOUR-PS4-IP"])
        self.assertEqual(caught.exception.code, 2)
        self.assertIn("is not an IP address", err.getvalue())

    def test_an_unreachable_console_does_not_crash_the_capture(self):
        # Sending to port 0 fails on most systems; the capture should note it and carry on.
        lines = []
        stats = capture("127.0.0.1", send_port=0, recv_port=0, seconds=1.0, say=lines.append)
        self.assertEqual(stats.packets, 0)

    def test_heartbeat_and_telemetry_port_flags_reach_the_capture_socket(self):
        # A telemetry port already in use should surface as the bridge's error, proving --telemetry-port
        # was threaded through to the capture's bind() rather than the GT7 default being used instead.
        taken = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        taken.bind(("0.0.0.0", 0))
        busy_port = taken.getsockname()[1]
        try:
            err = io.StringIO()
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                code = main(["--fake-console", "--port", "0", "--telemetry-port", str(busy_port)])
            self.assertEqual(code, 1)
            self.assertIn("error", err.getvalue().lower())
        finally:
            taken.close()


class BridgeEndToEndTest(unittest.TestCase):
    """The whole bridge: fake console, capture, frame conversion, and a real WebSocket client."""

    def test_frames_flow_from_the_console_to_a_browser(self):
        web = tempfile.mkdtemp()
        Path(web, "index.html").write_text("ok")
        # Fast 1 s laps on a small circle keep the speeds in a realistic range (about 90-180 km/h)
        console = FakeConsole(listen_port=0, lap_seconds=1.0, radius=6.0, say=lambda m: None)
        console.start()
        bridge = Bridge("127.0.0.1", heartbeat_port=console.port, telemetry_port=0, host="127.0.0.1",
                        http_port=0, web_dir=web, say=lambda m: None)
        bridge.start()
        try:
            sock, head, _ = handshake(bridge.port)
            self.assertIn("101", head)
            sock.settimeout(4)
            messages, frames = [], []
            deadline = time.time() + 5
            while len(frames) < 90 and time.time() < deadline:
                opcode, payload = read_frame(sock)
                msg = json.loads(payload)
                messages.append(msg["type"])
                if msg["type"] == "frame":
                    frames.append(msg)
            self.assertEqual(messages[0], "hello")
            self.assertGreaterEqual(len(frames), 90)
            f = frames[-1]
            speeds = [m["speed"] for m in frames]
            mean = 2 * 3.141592653589793 * 6.0 * 3.6                # circumference over the lap time, in km/h
            self.assertTrue(all(0.6 * mean < s < 1.5 * mean for s in speeds))   # swings about -30% to +44% of the mean
            self.assertGreater(max(speeds) / min(speeds), 1.3)      # speed really varies
            self.assertGreater(len({m["gear"] for m in frames}), 1) # and so does the gear
            self.assertAlmostEqual(f["x"] ** 2 + f["z"] ** 2, 36.0, delta=0.5)
            self.assertTrue(f["onTrack"])
            self.assertFalse(f["paused"])
            ts = [m["t"] for m in frames]
            self.assertEqual(ts, sorted(ts))                      # time only moves forward
            # Once the game clock has earned trust, frames step by exactly the game's ticks (16 or 17 ms)
            steps = [b - a for a, b in zip(ts[-30:], ts[-29:])]
            self.assertTrue(all(abs(s - 16) < 0.01 or abs(s - 17) < 0.01 for s in steps), steps)
            sock.close()

            # The page is served too, and identifies the bridge.
            conn = http.client.HTTPConnection("127.0.0.1", bridge.port, timeout=3)
            conn.request("GET", "/")
            self.assertEqual(conn.getresponse().read(), b"ok")
        finally:
            bridge.stop()
            console.stop()
        self.assertGreater(bridge.stats.packets, 40)

    def test_status_reports_whether_the_console_is_sending(self):
        web = tempfile.mkdtemp()
        # Nothing answers on this port, so the bridge never receives a packet.
        bridge = Bridge("127.0.0.1", heartbeat_port=9, telemetry_port=0, host="127.0.0.1", http_port=0,
                        web_dir=web, say=lambda m: None)
        bridge.start()
        try:
            sock, _, _ = handshake(bridge.port)
            sock.settimeout(4)
            status = None
            deadline = time.time() + 4
            while status is None and time.time() < deadline:
                msg = json.loads(read_frame(sock)[1])
                if msg["type"] == "status":
                    status = msg
            self.assertIsNotNone(status)
            self.assertFalse(status["receiving"])
            sock.close()
        finally:
            bridge.stop()


if __name__ == "__main__":
    unittest.main()
