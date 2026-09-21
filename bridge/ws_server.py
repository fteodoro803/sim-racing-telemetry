"""A small HTTP and WebSocket server on one port, using only the Python standard library.

It serves the web page's static files, answers `/bridge.json` (so the page can tell it is being
served by a bridge), and upgrades `/ws` to a WebSocket that the bridge broadcasts frames on.

The WebSocket side is deliberately minimal: server to client text messages, plus enough of the
client's side (ping, close) to stay well-behaved. It doesn't handle fragmented messages or
extensions, because the page never sends anything. Keeping it in the standard library means the
bridge still has nothing to install.
"""
import base64
import hashlib
import json
import socket
import struct
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"   # fixed by the WebSocket specification
MAX_CLIENT_PAYLOAD = 1 << 20
SEND_TIMEOUT_S = 2.0   # a client that stops reading is dropped, so it can't stall the broadcast

OP_TEXT, OP_CLOSE, OP_PING, OP_PONG = 0x1, 0x8, 0x9, 0xA


def accept_key(client_key):
    """The Sec-WebSocket-Accept value that answers a client's Sec-WebSocket-Key."""
    return base64.b64encode(hashlib.sha1((client_key + WS_GUID).encode()).digest()).decode()


def encode_frame(opcode, payload=b""):
    """Build one unmasked, unfragmented WebSocket frame (server to client frames are never masked)."""
    n = len(payload)
    if n < 126:
        header = bytes([0x80 | opcode, n])
    elif n < 65536:
        header = bytes([0x80 | opcode, 126]) + struct.pack(">H", n)
    else:
        header = bytes([0x80 | opcode, 127]) + struct.pack(">Q", n)
    return header + payload


def _read_exact(sock, n):
    """Read exactly n bytes, or return None if the connection closes first."""
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            return None
        buf.extend(chunk)
    return bytes(buf)


def read_frame(sock):
    """Read one frame from a client. Returns (opcode, payload), or None if the connection closed.

    Client frames are always masked; this unmasks them. Raises socket.timeout if nothing arrives
    within the socket's timeout, and ValueError for a frame that is unreasonably large.
    """
    head = _read_exact(sock, 2)
    if head is None:
        return None
    opcode, length = head[0] & 0x0F, head[1] & 0x7F
    masked = bool(head[1] & 0x80)
    if length == 126:
        ext = _read_exact(sock, 2)
        length = struct.unpack(">H", ext)[0] if ext else -1
    elif length == 127:
        ext = _read_exact(sock, 8)
        length = struct.unpack(">Q", ext)[0] if ext else -1
    if length < 0:
        return None
    if length > MAX_CLIENT_PAYLOAD:
        raise ValueError("WebSocket frame too large")
    mask = _read_exact(sock, 4) if masked else None
    payload = _read_exact(sock, length) if length else b""
    if payload is None or (masked and mask is None):
        return None
    if mask:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return opcode, payload


class WsClient:
    """One connected browser. Sends are serialised, so a pong can't interleave with a broadcast."""

    def __init__(self, sock):
        self.sock = sock
        self._lock = threading.Lock()

    def send(self, opcode, payload=b""):
        with self._lock:
            self.sock.sendall(encode_frame(opcode, payload))

    def send_text(self, text):
        self.send(OP_TEXT, text.encode())


class Hub:
    """The set of connected browsers, and what the bridge has broadcast to them so far."""

    def __init__(self):
        self._clients = set()
        self._lock = threading.Lock()
        self.frames = 0
        self.last_frame_at = None   # time.monotonic() of the latest frame broadcast

    def add(self, client):
        with self._lock:
            self._clients.add(client)

    def remove(self, client):
        with self._lock:
            self._clients.discard(client)

    @property
    def client_count(self):
        with self._lock:
            return len(self._clients)

    def broadcast(self, text):
        """Send a text message to every client, dropping any that have gone away or stopped reading."""
        with self._lock:
            clients = list(self._clients)
        for client in clients:
            try:
                client.send_text(text)
            except OSError:
                self.remove(client)

    def broadcast_frame(self, text):
        """Broadcast a frame message and note that data is flowing."""
        self.frames += 1
        self.last_frame_at = time.monotonic()
        self.broadcast(text)

    def receiving(self, within_s=2.0):
        """True if a frame was broadcast in the last `within_s` seconds."""
        return self.last_frame_at is not None and time.monotonic() - self.last_frame_at < within_s


def make_handler(web_dir, hub, info, hello):
    """Build the request handler class: static files, /bridge.json, and the /ws WebSocket."""

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(web_dir), **kwargs)

        def log_message(self, *args):
            pass   # per-request logging would drown out the bridge's own output

        def end_headers(self):
            # The page is being edited while the bridge runs; never serve a stale copy.
            self.send_header("Cache-Control", "no-cache")
            super().end_headers()

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/ws" and self.headers.get("Upgrade", "").lower() == "websocket":
                return self._websocket()
            if path == "/bridge.json":
                body = json.dumps(info).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            return super().do_GET()

        def _websocket(self):
            key = self.headers.get("Sec-WebSocket-Key")
            if not key:
                self.send_error(400, "Missing Sec-WebSocket-Key")
                return
            # 1. Complete the handshake (written directly, so no cache header is added to the 101)
            self.wfile.write((
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept_key(key)}\r\n\r\n"
            ).encode())
            self.wfile.flush()
            self.close_connection = True

            # 2. Register the client and greet it
            sock = self.connection
            sock.settimeout(SEND_TIMEOUT_S)
            client = WsClient(sock)
            hub.add(client)
            try:
                client.send_text(json.dumps(hello))

                # 3. Stay connected until the client closes, answering pings
                while True:
                    try:
                        frame = read_frame(sock)
                    except socket.timeout:
                        continue
                    if frame is None:
                        break
                    opcode, payload = frame
                    if opcode == OP_CLOSE:
                        client.send(OP_CLOSE, payload[:2])
                        break
                    if opcode == OP_PING:
                        client.send(OP_PONG, payload)
            except (OSError, ValueError):
                pass
            finally:
                hub.remove(client)

    return Handler


def make_server(host, port, web_dir, hub, info, hello):
    """Create (but don't start) the combined HTTP and WebSocket server."""
    server = ThreadingHTTPServer((host, port), make_handler(web_dir, hub, info, hello))
    server.daemon_threads = True
    return server
