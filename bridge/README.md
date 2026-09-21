# Bridge

Not finished yet. This will receive the game's UDP telemetry, decode it into the frame format
described in the top-level README, and forward it over a WebSocket to the web page.

Written in Python ([D15](../DECISIONS.md)), one decoder module per game, GT7 first. This folder is
not published to the site. What GT7 sends, and what is confirmed so far, is in
[GT7_TELEMETRY.md](../GT7_TELEMETRY.md).
