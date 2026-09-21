import math
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from capture import capture
from capture_file import CaptureWriter, read_capture
from fake_console import FakeConsole, build_packet, encrypt
from gt7 import (MAGIC, NONCE_CONSTANTS, PACKET_SIZES, Decryptor, check_console_address, decode_a,
                 decode_flags, heartbeat)


class DecodeTest(unittest.TestCase):
    def setUp(self):
        self.plain = build_packet(t=25.0, packet_id=1234, lap_seconds=20.0)

    def test_decodes_the_values_the_packet_was_built_with(self):
        d = decode_a(self.plain)
        self.assertEqual(d["packet_id"], 1234)
        self.assertEqual(d["lap"], 2)                  # 25 s into 20 s laps: on lap 2
        self.assertEqual(d["last_lap"], 20000)
        mean = 2 * math.pi * 200 / 20
        self.assertTrue(0.6 * mean < d["speed_ms"] < 1.5 * mean)
        self.assertTrue(1 <= d["gear"] <= 7)
        self.assertEqual((d["rpm_warning"], d["rpm_limiter"]), (7000, 8200))
        self.assertEqual(d["tyre_temp"], (80.0, 82.0, 78.0, 79.0))
        self.assertEqual(len(d["gear_ratios"]), 8)

    def test_lap_one_has_no_last_lap(self):
        self.assertEqual(decode_a(build_packet(t=5.0, packet_id=1))["last_lap"], -1)

    def test_a_short_packet_is_rejected(self):
        with self.assertRaises(ValueError):
            decode_a(bytes(100))

    def test_flags(self):
        flags = decode_flags(0b11)
        self.assertTrue(flags["car_on_track"] and flags["paused"])
        self.assertFalse(flags["loading"])
        self.assertFalse(decode_flags(0)["paused"])
        self.assertTrue(decode_flags(1 << 11)["tcs_active"])

    def test_heartbeat_is_the_type_character(self):
        self.assertEqual(heartbeat("A"), b"A")
        self.assertEqual(heartbeat("~"), b"~")


class DecryptTest(unittest.TestCase):
    def test_round_trip_recovers_the_plaintext_magic(self):
        plain = build_packet(t=1.0, packet_id=1)
        cipher = encrypt(plain, seed=0x12345678)
        self.assertNotEqual(cipher[:4], plain[:4])
        recovered = Decryptor()(cipher)
        self.assertEqual(int.from_bytes(recovered[:4], "little"), MAGIC)
        # Everything except the 4 nonce-seed bytes (which the console overwrites) survives.
        self.assertEqual(recovered[:0x40], plain[:0x40])
        self.assertEqual(recovered[0x44:], plain[0x44:])

    def test_finds_the_right_constant_and_remembers_it(self):
        plain = build_packet(t=1.0, packet_id=1)
        decrypt = Decryptor()
        for constant in NONCE_CONSTANTS:
            decrypt = Decryptor()
            self.assertIsNotNone(decrypt(encrypt(plain, seed=99, constant=constant)))
            self.assertEqual(decrypt.constant, constant)

    def test_garbage_and_short_packets_are_rejected(self):
        decrypt = Decryptor()
        self.assertIsNone(decrypt(os.urandom(296)))
        self.assertIsNone(decrypt(b"A"))
        self.assertIsNone(decrypt(b""))

    def test_packet_sizes_table(self):
        self.assertEqual(PACKET_SIZES, {"A": 296, "B": 316, "~": 344, "C": 368})


class ConsoleAddressTest(unittest.TestCase):
    def test_accepts_ip_addresses(self):
        for ok in ("192.168.0.42", "10.0.0.5", "127.0.0.1", "255.255.255.255"):
            self.assertEqual(check_console_address(ok), ok)

    def test_rejects_placeholders_and_typos_with_a_helpful_message(self):
        for bad in ("YOUR-PS4-IP", "", "192.168.1", "192.168.1.999", "ps4.local", "192.168.1.20 "):
            with self.assertRaises(ValueError) as caught:
                check_console_address(bad)
            self.assertIn("View Connection Status", str(caught.exception))


class CaptureFileTest(unittest.TestCase):
    def test_creates_missing_folders_for_the_capture(self):
        base = tempfile.mkdtemp()
        for name in ("a/b/session.jsonl", "c/session.jsonl.gz"):
            path = os.path.join(base, name)                        # the folders don't exist yet
            with CaptureWriter(path, console="1.2.3.4", packet_type="A") as w:
                w.write(0.0, b"\x01\x02")
            self.assertEqual(read_capture(path)[1], [(0.0, b"\x01\x02")])

    def test_a_capture_cut_short_still_yields_its_packets(self):
        packets = [encrypt(build_packet(t=i / 60, packet_id=i), seed=i) for i in range(200)]
        for name in ("cut.jsonl.gz", "cut.jsonl"):
            path = os.path.join(tempfile.mkdtemp(), name)
            with CaptureWriter(path, console="1.2.3.4", packet_type="A") as w:
                for i, p in enumerate(packets):
                    w.write(i / 60, p)
            whole = Path(path).read_bytes()
            Path(path).write_bytes(whole[: len(whole) * 2 // 3])      # as if the process was killed mid-write
            header, read = read_capture(path)
            self.assertTrue(header.get("truncated"))
            self.assertGreater(len(read), 20)
            self.assertLess(len(read), 200)
            self.assertEqual([p for _, p in read], packets[: len(read)])   # what survived is intact

    def test_a_complete_capture_is_not_marked_truncated(self):
        path = os.path.join(tempfile.mkdtemp(), "ok.jsonl.gz")
        with CaptureWriter(path, console="1.2.3.4", packet_type="A") as w:
            w.write(0.0, b"\x01")
        self.assertNotIn("truncated", read_capture(path)[0])

    def test_a_bare_filename_needs_no_folder(self):
        cwd = os.getcwd()
        os.chdir(tempfile.mkdtemp())
        try:
            with CaptureWriter("plain.jsonl", console="1.2.3.4", packet_type="A"):
                pass
            self.assertTrue(os.path.exists("plain.jsonl"))
        finally:
            os.chdir(cwd)

    def test_round_trip_plain_and_gzip(self):
        packets = [encrypt(build_packet(t=i / 60, packet_id=i), seed=i) for i in range(5)]
        for name in ("session.jsonl", "session.jsonl.gz"):
            path = os.path.join(tempfile.mkdtemp(), name)
            with CaptureWriter(path, console="1.2.3.4", packet_type="A") as w:
                for i, p in enumerate(packets):
                    w.write(i / 60, p)
            header, read = read_capture(path)
            self.assertEqual(header["console"], "1.2.3.4")
            self.assertEqual([p for _, p in read], packets)

    def test_rejects_a_file_that_is_not_a_capture(self):
        path = os.path.join(tempfile.mkdtemp(), "bad.jsonl")
        Path(path).write_text('{"format": "something-else"}\n')
        with self.assertRaises(ValueError):
            read_capture(path)


class EndToEndTest(unittest.TestCase):
    """The capture tool talking to the fake console over real UDP sockets on localhost."""

    def test_capture_receives_decodes_and_records(self):
        console = FakeConsole(listen_port=0, lap_seconds=1.0)   # 1 s laps so a lap completes quickly
        console.start()
        out = os.path.join(tempfile.mkdtemp(), "session.jsonl")
        lines = []
        try:
            stats = capture("127.0.0.1", send_port=console.port, recv_port=0, seconds=2.5,
                            out=out, say=lines.append)
        finally:
            console.stop()

        self.assertGreater(stats.packets, 110)                   # ~60 Hz for 2.5 s is about 150...
        self.assertLess(stats.packets, 190)                      # ...and not a catch-up burst
        self.assertEqual(stats.lost, 0)
        self.assertEqual(stats.unreadable, 0)
        self.assertEqual(stats.constant, NONCE_CONSTANTS[0])
        self.assertGreaterEqual(stats.last_summary["lap"], 2)    # crossed the line at least once
        self.assertIn(296, stats.sizes)
        self.assertTrue(any("km/h" in line for line in lines))

        header, recorded = read_capture(out)
        self.assertEqual(len(recorded), stats.packets)
        decrypt = Decryptor()
        ids = [decode_a(decrypt(p))["packet_id"] for _, p in recorded]
        self.assertEqual(ids, sorted(ids))

    def test_reports_when_nothing_arrives(self):
        lines = []
        # A port nothing is listening on: no reply will come.
        stats = capture("127.0.0.1", send_port=9, recv_port=0, seconds=3.6, say=lines.append)
        self.assertEqual(stats.packets, 0)
        self.assertTrue(any("No packets yet" in line for line in lines))


if __name__ == "__main__":
    unittest.main()
