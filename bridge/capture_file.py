"""Read and write recorded raw GT7 packets, so a session can be replayed and used as test data.

A capture is a JSON-lines file (gzip-compressed if the name ends in `.gz`). The first line is a
header describing the recording; every later line is one packet as it arrived, still encrypted:

    {"format": "gt7-capture-1", "started": "...", "console": "192.168.1.20", "packet_type": "A"}
    {"t": 0.0172, "hex": "..."}

Packets are stored raw, not decoded, so a capture stays useful after the decoder improves.
"""
import gzip
import json
from datetime import datetime, timezone

FORMAT = "gt7-capture-1"


def _open(path, mode):
    """Open a capture for text reading or writing, gzipped when the name ends in .gz."""
    if str(path).endswith(".gz"):
        return gzip.open(path, mode + "t", encoding="utf-8")
    return open(path, mode, encoding="utf-8")


class CaptureWriter:
    """Writes packets to a capture file as they arrive. Use as a context manager."""

    def __init__(self, path, *, console, packet_type):
        self._file = _open(path, "w")
        header = {
            "format": FORMAT,
            "started": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "console": console,
            "packet_type": packet_type,
        }
        self._file.write(json.dumps(header) + "\n")

    def write(self, t, packet):
        """Record one raw packet received `t` seconds after the capture began."""
        self._file.write(json.dumps({"t": round(t, 6), "hex": packet.hex()}) + "\n")

    def close(self):
        self._file.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def read_capture(path):
    """Read a capture file. Returns (header, list of (t, packet bytes))."""
    with _open(path, "r") as f:
        header = json.loads(f.readline())
        if header.get("format") != FORMAT:
            raise ValueError(f"not a {FORMAT} file: {path}")
        packets = []
        for line in f:
            row = json.loads(line)
            packets.append((row["t"], bytes.fromhex(row["hex"])))
    return header, packets
