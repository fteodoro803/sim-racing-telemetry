# Bridge

The local program that asks the console for GT7 telemetry, decodes it, streams it to the web page,
and serves the page too, so an iPad on your network can open it. Written in Python
([D15](../DECISIONS.md)), one decoder module per game, GT7 first. This folder is not published to
the site.

**Status:** works end to end against a fake console. It has not yet been run against a real PS4.
Only type-A packets are decoded. What GT7 sends, and what is confirmed so far, is in
[GT7_TELEMETRY.md](../GT7_TELEMETRY.md).

There is nothing to install: it uses only the Python 3 standard library.

## Run it

1. Find the PS4's IP address: **Settings > Network > View Connection Status > IP Address**.
2. Make sure the PS4 and this computer are on the same network (the same router, and not a guest
   network that isolates devices from each other).
3. Start GT7 and get into a race, a time trial or free practice. Menus may send nothing.
4. Start the bridge:

```bash
python3 bridge/bridge.py --ps4-ip 192.168.1.20
```

It prints two addresses. Open the first in a browser on this computer; open the second on your iPad
(on the same Wi-Fi). The page connects to the bridge by itself.

macOS may ask whether Python may accept incoming network connections. Allow it, or neither the
console's data nor the iPad's page can arrive. Add `--host 127.0.0.1` to keep the page to this
computer only.

To record the raw packets while it runs (useful as test data), add `--record captures/session.jsonl.gz`.
`captures/` is ignored by git; a capture worth keeping as a test fixture should be copied to
`bridge/tests/fixtures/` on purpose.

## Try it without a console

The built-in fake console speaks the same protocol, with made-up numbers:

```bash
python3 bridge/bridge.py --fake-console
```

## Check what the console is sending

`capture.py` is the diagnostic tool: it prints live values and a summary, and can record packets,
without the web page. Use it if nothing arrives, or to capture a session.

```bash
python3 bridge/capture.py --ps4-ip 192.168.1.20 --out captures/first.jsonl.gz
```

Useful captures: a normal few laps; a session where you pause, restart and open a replay (this
settles [Known issue 5](../PROJECT_CONTEXT.md)); and one requesting `--type C`, to see whether your
game version sends the richer packet.

## How the page connects

- Served by the bridge, the page connects to its own address at `/ws`. The bridge also answers
  `/bridge.json`, which is how the page knows it is being served by a bridge.
- The hosted (portfolio) page can connect to a bridge on the same computer by entering
  `ws://localhost:8765/ws` in the setup panel. It can't reach a bridge on another device, because
  a page served over https can't open a plain `ws://` connection to one.
- Messages are JSON: `hello` on connect, `frame` (about 60 a second, the frame format in the
  top-level README), and `status` once a second saying whether packets are still arriving.

## Tests

```bash
npm run test:bridge
```

## Files

| File | What it does |
|---|---|
| `bridge.py` | The bridge: capture, frames, WebSocket, and serving the page |
| `ws_server.py` | HTTP and WebSocket server on one port, standard library only |
| `frames.py` | Converts decoded GT7 packets into the page's frame format |
| `capture.py` | Diagnostic tool: heartbeat, receive, decode, print, record |
| `gt7.py` | The protocol: decrypting packets and decoding type A, as pure functions |
| `salsa20.py` | Salsa20 cipher in pure Python, checked against a reference implementation |
| `capture_file.py` | Reading and writing recorded packets |
| `fake_console.py` | A stand-in for the PS4, for trying and testing without one |
