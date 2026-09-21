# Bridge

Not written yet. This will receive the game's UDP telemetry, decode it into the frame format
described in the top-level README, and forward it over a WebSocket to the web page.

Language is not decided yet (leaning Python; see O1 in [DECISIONS.md](../DECISIONS.md)). Planned: one decoder module per game, GT7 first. This folder is not published to the site.
