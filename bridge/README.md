# Bridge

The local program that asks the console for GT7 telemetry, decrypts it and (soon) forwards it to
the web page. Written in Python ([D15](../DECISIONS.md)), one decoder module per game, GT7 first.
This folder is not published to the site.

**Status:** the first slice works against a fake console: `capture.py` sends the heartbeat,
receives, decrypts, decodes type-A packets and records the raw packets. It has not yet been run
against a real PS4. Turning packets into frames and forwarding them over a WebSocket is next.
What GT7 sends, and what is confirmed so far, is in [GT7_TELEMETRY.md](../GT7_TELEMETRY.md).

There is nothing to install: it uses only the Python 3 standard library.

## Capture from your PS4

1. Find the PS4's IP address: **Settings > Network > View Connection Status > IP Address**.
2. Make sure the PS4 and this computer are on the same network (the same router, and not a guest
   network that isolates devices from each other).
3. Start GT7 and get into a race, a time trial or free practice. Menus may send nothing.
4. Run the capture tool:

```bash
python3 bridge/capture.py --ps4-ip 192.168.1.20 --out captures/first.jsonl.gz
```

macOS may ask whether Python may accept incoming network connections. Allow it, or nothing can
arrive. You should see a line of live values a couple of times a second, then a summary when you
press Ctrl-C. If nothing arrives after a few seconds it says so and lists what to check.

`--out` records the raw, still-encrypted packets so they can be replayed later and used as test
data. `captures/` is ignored by git; a capture worth keeping as a test fixture should be copied to
`bridge/tests/fixtures/` on purpose.

Useful captures: a normal few laps; a session where you pause, restart and open a replay (this
settles [Known issue 5](../PROJECT_CONTEXT.md)); and one requesting `--type C`, to see whether
your game version sends the richer packet.

## Try it without a console

The fake console speaks the same protocol, so this exercises the whole path with made-up numbers:

```bash
python3 bridge/fake_console.py
```

```bash
python3 bridge/capture.py --ps4-ip 127.0.0.1
```

## Tests

```bash
npm run test:bridge
```

## Files

| File | What it does |
|---|---|
| `capture.py` | Command-line tool: heartbeat, receive, decode, print, record |
| `gt7.py` | The protocol: decrypting packets and decoding type A, as pure functions |
| `salsa20.py` | Salsa20 cipher in pure Python, checked against a reference implementation |
| `capture_file.py` | Reading and writing recorded packets |
| `fake_console.py` | A stand-in for the PS4, for trying and testing without one |
