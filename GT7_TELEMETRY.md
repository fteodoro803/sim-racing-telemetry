# GT7_TELEMETRY.md

What Gran Turismo 7 sends over UDP, its units and quirks, and what this project does with each field. It is the menu we choose from when adding features: the "In this project" column says what is planned for each field.

> **Status: partly confirmed, and now checked against a real PS4.** The transport details and the type-A byte offsets below are confirmed by a working open-source implementation (gt7dashboard), and an 11-minute type-A session recorded from a real PS4 (2026-09-22) confirmed the encryption, the heartbeat, the packet rate, the pause and loading flags, and several fields; see "Confirmed on a real PS4". Everything else is assembled from community parser documentation (see Sources). Companion docs: [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) (known issues, especially 2, 5 and 6), [`DECISIONS.md`](DECISIONS.md), [`FEATURE_MAP.md`](FEATURE_MAP.md).

## Transport

- **Protocol:** UDP, about 60 packets a second.
- **Console setup:** none. No setting on the console is needed; the bridge only needs the console's IP address, and both devices on the same network.
- **Receiving:** bind UDP port **33740** on all interfaces.
- **Heartbeat:** the console only sends telemetry after it receives a heartbeat, and stops if it isn't repeated. The heartbeat is a single character (the packet type, below) sent to the console's IP on UDP port **33739**, from the same socket that listens on 33740, so the console replies to that port. The gt7dashboard implementation re-sends it every 100 packets; the parser docs say the console tolerates about 1000 (roughly 16 s). Re-sending every few seconds satisfies both.
- **Encryption:** Salsa20. The key is the first 32 bytes of the ASCII string `Simulator Interface Packet GT7 ver 0.0`. The 8-byte nonce is built from 4 bytes read out of the packet itself: read the 4 bytes at offset `0x40` as a little-endian integer `iv1`, compute `iv2 = iv1 XOR constant`, and the nonce is `iv2` then `iv1`, each as 4 little-endian bytes. The constant is `0xDEADBEAF` for packet type `A` (confirmed). One source gives `0xDEADBEEF` for `B` and `0x55FABB4F` for `~` and `C` (unconfirmed), so the bridge should try each and see which produces the magic number.
- **Magic number:** a correctly decrypted packet starts with `0x47375330` (little-endian), which is how to tell decryption worked.

### Packet types

| Type | Size | Adds | Availability |
|---|---|---|---|
| `A` | 296 bytes | The base packet | All modes |
| `B` | 316 bytes | Steering rotation, steering angular velocity, and three accelerations | Not in Sport Mode |
| `~` | 344 bytes | Filtered pedals, torque per wheel, energy recovery | Not in replays |
| `C` | 368 bytes | Current lap time, surface type per tyre, steering angle, wheelbase, car category | All modes |

Each type contains everything from the ones before it. **Recommendation: request `C`.** It has the most, it works in every mode, and it is the only one with the current lap time. It is newer (added around game update 1.68), so confirm it is sent on the game version in use, and fall back to `A` if not.

### Confirmed on a real PS4

From a recorded type-A session, about 66,000 packets, in a free run or time trial (a single car, one track), over home Wi-Fi to a Mac.

- **Transport:** the heartbeat `A` to port 33739 works with no console setting. Every packet decrypted with nonce constant `0xDEADBEAF`, each 296 bytes, with consecutive packet ids and no loss.
- **Packet rate is not exactly 60 a second.** It averaged 59.83 and wandered between 59.65 and 59.94, so a packet count is not a clock. Arrival times are jittery (a few ms of spread, with a stall of about 300 ms once).
- **`0x80` is a game clock.** It is the game's time of day in ms (it started at exactly 15:30:00). It advances one game frame (16 or 17 ms) per packet, stands still while the game is paused, and its differences between lap changes match the game's own lap times to within a frame. Because it is simulation time, it runs about 0.3% slower than wall-clock time when the console drops frames, and the game's lap times follow it. The bridge uses it as the frame clock when it is seen to run at real time (`GameClock` in `bridge/frames.py`); time of day can be accelerated in some events, so this is checked rather than assumed.
- **Pause:** flag bit 1 is set while the game is paused, packets keep arriving, and the game clock stands still. So a lap that includes a pause has a wall-clock time longer than the game's.
- **Lap counter and last lap:** the game updates `last_lap` in the same packet that changes the lap counter. After a session restart the counter reads 0 until the first crossing of the line.
- **Flags:** bit 0 (on track) was set for about 99% of packets, bit 2 (loading) for a handful, and bits 3 (in gear) and 5 (rev-limit alert) behaved plausibly. Bit 6, documented as the handbrake, was set for about a third of the session, which doesn't fit, so its meaning is unconfirmed.
- **Gear:** values 0 to 8 were seen; 0 is presumably neutral (a short stretch at the start). The suggested gear is 15 when there is no suggestion (about two thirds of packets), as documented.
- **Rev markers:** for this car the rev warning was 6500 and the limiter 7000; rpm ran from about 640 to 6930. The estimated top speed was 283 (km/h, consistent with a top speed of 250).
- **Position:** `x` and `z` spanned about ±850 m and `y` (height) only ±5 m, so `x, z` is the ground plane.
- **Constants:** water and oil temperature were fixed at 85 and 110, as documented, so they carry no information.
- **Race fields:** `0x76` (laps in race) was 0 in free run, as expected there. The values at `0x84` and `0x86` were mostly `(1, 3)`, sometimes `(1, 1)` or `(-1, -1)`; which interpretation is right is still unclear.
- **Boost:** `0x50` read 0 throughout, and the car had no turbo, so that offset is still unconfirmed.

### Type A byte offsets (confirmed by gt7dashboard)

Offsets into the decrypted packet. All little-endian. Fields not listed here (packet types B, `~` and C, and a few gaps) still need their offsets found, by reading a parser's source or from captured packets.

| Offset | Type | Field |
|---|---|---|
| `0x00` | uint32 | Magic number |
| `0x04`, `0x08`, `0x0C` | float | Position x, y, z |
| `0x10`, `0x14`, `0x18` | float | Velocity x, y, z |
| `0x1C`, `0x20`, `0x24` | float | Rotation pitch, yaw, roll |
| `0x2C`, `0x30`, `0x34` | float | Angular velocity x, y, z |
| `0x38` | float | Ride height (m; gt7dashboard multiplies by 1000) |
| `0x3C` | float | Engine rpm |
| `0x40` | 4 bytes | Nonce seed (`iv1`) |
| `0x44`, `0x48` | float | Fuel level, fuel capacity |
| `0x4C` | float | Speed (m/s; gt7dashboard multiplies by 3.6 for km/h) |
| `0x54`, `0x58`, `0x5C` | float | Oil pressure, water temperature, oil temperature |
| `0x60`, `0x64`, `0x68`, `0x6C` | float | Tyre temperature FL, FR, RL, RR |
| `0x70` | int32 | Packet id |
| `0x74` | int16 | Lap count |
| `0x78`, `0x7C` | int32 | Best lap, last lap (ms) |
| `0x80` | int32 | Game clock: time of day in ms (confirmed on a real PS4; see above) |
| `0x84`, `0x86` | int16 | Race position values; see the note under Timing |
| `0x88`, `0x8A` | uint16 | Rev warning rpm, rev limiter rpm |
| `0x8C` | int16 | Estimated top speed |
| `0x8E` | flags | Bit 0 car on track, bit 1 paused (more under Flags) |
| `0x90` | uint8 | Gear: low 4 bits current, high 4 bits suggested |
| `0x91`, `0x92` | uint8 | Throttle, brake (0–255) |
| `0xA4`–`0xB0` | float | Wheel rotation speed ×4 |
| `0xB4`–`0xC0` | float | Tyre diameter or radius ×4 (gt7dashboard calls it diameter; the parser docs say radius) |
| `0xC4`–`0xD0` | float | Suspension height ×4 |
| `0xF4`, `0xF8`, `0xFC` | float | Clutch, clutch engagement, rpm after clutch |
| `0x104`–`0x120` | float | Gear ratios ×8 |
| `0x124` | int32 | Car id |

Not confirmed by that implementation but in the parser docs: `totalLaps` (probably int16 at `0x76`; it read 0 in a free run, as expected), boost (probably `0x50`; unconfirmed, the test car had no turbo), road plane values (`0x94`–`0xA0`), transmission top speed (probably `0x100`).

## Fields

"In this project" values: **v1** = the first proper version (Driving and Timing, [D13](DECISIONS.md)); **later** = wanted but not yet scheduled; **tyres pass** = waits for the dedicated tyre-colour pass ([D12](DECISIONS.md)); **no** = not planned. Units are as documented by the parsers.

### Driving

| Field | Type / unit | Notes | In this project |
|---|---|---|---|
| `speed` | float, m/s | Convert to km/h | v1 (in the frame) |
| `throttle` | uint8, 0–255 | Scale to 0–100 | v1 (in the frame) |
| `brake` | uint8, 0–255 | Scale to 0–100 | v1 (in the frame) |
| `clutch` | float, 0–1 | | later |
| `clutchEngagement` | float, 0–1 | | later |
| `gears` | uint8 | Low 4 bits: current gear. High 4 bits: suggested gear (15 means none) | v1 (current gear in the frame; suggested gear v1) |
| `engineRPM` | float, rpm | | v1 (in the frame) |
| `minAlertRPM`, `maxAlertRPM` | uint16, rpm | gt7dashboard calls them the rev warning and the rev limiter. Where the game's shift alert shows | v1 |
| `boost` | float | Offset by 1: 1.0 is 0 kPa, 2.0 is 100 kPa. Only meaningful for turbo cars | no (not wanted, [D19](DECISIONS.md)) |
| `wheelRotation` (B) / `wheelSteeringAngle[2]` (C) | float, radians | Steering angle. `C` gives the two front wheels | later, its own session ([D19](DECISIONS.md)) |
| flags: handbrake, TCS active, ASM active, in gear, rev-limit alert, has turbo | bits | See Flags below | no (not wanted, [D19](DECISIONS.md)) |
| `calcMaxSpeed` | int16 | Top speed in the current gearing (units unconfirmed) | later |
| `gearRatios[8]`, `transmissionTopSpeed`, `RPMFromClutchToGearbox` | float | Gearbox detail | later |
| `throttleFiltered`, `brakeFiltered` (`~`) | uint8 | Filtered pedals | no |
| `torqueVectors[4]`, `energyRecovery` (`~`) | float | Torque per wheel; recovery for hybrids and EVs | later |

### Timing

| Field | Type / unit | Notes | In this project |
|---|---|---|---|
| `lapCount` | int16 | The lap counter. A change means the car crossed the line | v1 (in the frame as `lap`) |
| `totalLaps` | int16 | Laps in the race, 0 or unset in free practice | v1 |
| `bestLaptime` | int32, ms | `-1` if none | v1 (the tracker computes its own best) |
| `lastLaptime` | int32, ms | `-1` if none. Used as the lap time when above zero | v1 (in the frame as `lastLap`) |
| `currentLap` (C) | int32, ms | Current lap time. The tracker computes its own from frame timestamps; this can cross-check it | v1 (cross-check) |
| `raceStartPosition`, `preRaceNumCars` (`0x84`, `0x86`) | int16 | One parser documents these as start position and number of cars (`-1` once the race starts); gt7dashboard reads them as current position and total positions. Unclear which is right; check in a real race | later |
| `dayProgression` (`0x80`) | int32, ms | **Confirmed: the game's time of day in ms, ticking one frame per packet and standing still while paused.** Used as the frame clock ([O14](DECISIONS.md)) | v1 (as the clock) |
| *(sector times)* | | **Not provided.** Derived from position ([D5](DECISIONS.md)) | v1 (derived) |

### Position and motion

| Field | Type / unit | Notes | In this project |
|---|---|---|---|
| `position[3]` | float, m | x, y, z. `y` is height, so the ground plane is `x, z` | v1 (`x`, `z` in the frame) |
| `worldVelocity[3]` | float, m/s | | later |
| `rotation[3]` | float, about -1 to 1 | Pitch, yaw, roll | later |
| `angularVelocity[3]` | float, rad/s | | later |
| `orientationRelativeToNorth` | float | 1.0 north, 0.0 south | later |
| `bodyHeight` | float, m | | later |
| `roadPlane[3]`, `roadPlaneDistance` | float | Banking angles; negative distance is a dip, positive a hill | later |
| `sway`, `heave`, `surge` (B) | float | Accelerations along the three axes (G-forces) | later |

### Tyres and suspension

| Field | Type / unit | Notes | In this project |
|---|---|---|---|
| `tyreTemp[4]` | float, degrees C | Surface temperature. Order FL, FR, RL, RR. No ideal range is given | tyres pass: tyre graphics that change colour, no labels ([D12](DECISIONS.md)) |
| `wheelRPS[4]` | float, rad/s | With `tyreRadius` and `speed` gives slip, so lockup and wheelspin | later |
| `tyreRadius[4]` | float, m | | later |
| `suspHeight[4]` | float, m | Suspension travel per corner | later |
| `surfaceType[4]` (C) | chars | T tarmac, C kerb, D dirt or grass, S sand, s snow | later |

### Car, engine and fuel

| Field | Type / unit | Notes | In this project |
|---|---|---|---|
| `fuelLevel`, `fuelCapacity` | float, litres | Capacity is 100 typical, 5 for karts, 0 for electric | later |
| `oilPressure` | float, bar | | later |
| `waterTemp`, `oilTemp` | float | Documented as constant (85 and 110), so not useful | no |
| `carCode` | int32 | Car identifier | later |
| `carCategory[4]` (C) | chars | For example `GR3` | later |
| `wheelBase` (C) | float, m | | no |

## Flags

A 16-bit field. Bits 0–2 also drive the interrupted-lap handling ([D7](DECISIONS.md), Known issue 5), so the bridge must pass them through as `onTrack`, `paused` and `loading`.

| Bit | Meaning | In this project |
|---|---|---|
| 0 | Car on track | v1 (`onTrack`) |
| 1 | Paused | v1 (`paused`) |
| 2 | Loading / processing | v1 (`loading`) |
| 3 | In gear | no |
| 4 | Has turbo | no |
| 5 | Rev-limit alert | no |
| 6 | Handbrake active | no (set for a third of a normal session, so the meaning is unconfirmed) |
| 7 | Lights active | no |
| 8 | High beams | no |
| 9 | Low beams | no |
| 10 | ASM active | no |
| 11 | TCS active | no |

## What GT7 does not provide

None of the parser field lists we checked contain:

- **Sector times.** Derived from position and split points ([D5](DECISIONS.md)).
- **A track or circuit name or ID.** Tracks have to be recognised from position data ([O3](DECISIONS.md)).
- **Distance around the lap.** Derived by projecting position onto a reference line.
- **Tyre wear or tyre pressure.** Only surface temperature.
- **Other cars.** No opponent positions, gaps or race position. Only the start position and the number of cars, before the race.
- **Damage, weather or brake temperature.**

## Sources

- [MacManley/gt7-udp](https://github.com/MacManley/gt7-udp): packet types, sizes, field list, flags, encryption notes.
- [carlos-menezes/gran-turismo-query](https://github.com/carlos-menezes/gran-turismo-query): packet parser fields.
- [snipem/gt7dashboard](https://github.com/snipem/gt7dashboard) (`gt7communication.py`): a working Python implementation for packet type A; source of the confirmed key, nonce, heartbeat and offsets.
- [GTPlanet: Gran Turismo 7 Telemetry UDP support](https://www.gtplanet.net/forum/threads/gran-turismo-7-telemetry-udp-support.405879/): discussion thread.
