"""The GT7 telemetry protocol: decrypting packets and decoding them into named values.

Everything here is a pure function of bytes, with no sockets, so it can be tested from recorded
packets without a console. What is known about the protocol, and how well it is confirmed, is
written up in GT7_TELEMETRY.md at the repo root; offsets and constants below come from there.

Only the type-A packet layout is decoded so far. Types B, `~` and C carry the same base layout
plus extra fields at higher offsets that have not been confirmed yet.
"""
import struct

from salsa20 import salsa20_xor

KEY = b"Simulator Interface Packet GT7 ver 0.0"[:32]
MAGIC = 0x47375330             # first four bytes of a correctly decrypted packet, little-endian
HEARTBEAT_PORT = 33739         # the console listens here for the heartbeat
TELEMETRY_PORT = 33740         # the console sends telemetry to this port on the heartbeat's sender

# Packet type: size in bytes. The heartbeat character chooses which type the console sends.
PACKET_SIZES = {"A": 296, "B": 316, "~": 344, "C": 368}

# XORed into the nonce seed. 0xDEADBEAF is confirmed for type A; the other two are unconfirmed
# (from one source), so decryption tries each and keeps the one that produces the magic number.
NONCE_CONSTANTS = (0xDEADBEAF, 0xDEADBEEF, 0x55FABB4F)

# Bit positions in the 16-bit flags field at offset 0x8E. Bits 0-1 are confirmed by gt7dashboard;
# the rest are from the parser docs.
FLAG_NAMES = (
    "car_on_track", "paused", "loading", "in_gear", "has_turbo", "rev_limit_alert",
    "handbrake", "lights", "high_beams", "low_beams", "asm_active", "tcs_active",
)


def heartbeat(packet_type="A"):
    """The datagram to send to the console's heartbeat port to start (or keep) telemetry flowing."""
    return packet_type.encode()


def nonce_for(packet, constant):
    """Build the 8-byte Salsa20 nonce for a packet from its plaintext seed at 0x40 and a constant."""
    iv1 = int.from_bytes(packet[0x40:0x44], "little")
    iv2 = iv1 ^ constant
    return iv2.to_bytes(4, "little") + iv1.to_bytes(4, "little")


class Decryptor:
    """Decrypts GT7 packets, remembering which nonce constant worked so later packets are fast.

    Call it with a received datagram. It returns the decrypted bytes, or None if the packet is
    too short or none of the known constants gives the magic number (which means it is not a GT7
    telemetry packet, or it uses a constant we don't know). `constant` is the one that last worked.
    """

    def __init__(self):
        self.constant = None

    def __call__(self, packet):
        if len(packet) < 0x44:
            return None
        candidates = list(NONCE_CONSTANTS)
        if self.constant in candidates:
            candidates.remove(self.constant)
            candidates.insert(0, self.constant)
        for constant in candidates:
            plain = salsa20_xor(KEY, nonce_for(packet, constant), packet)
            if int.from_bytes(plain[0:4], "little") == MAGIC:
                self.constant = constant
                return plain
        return None


def decode_flags(value):
    """Turn the 16-bit flags field into a dict of named booleans."""
    return {name: bool(value & (1 << bit)) for bit, name in enumerate(FLAG_NAMES)}


def decode_a(p):
    """Decode a decrypted type-A packet (or the base part of B, `~`, C) into named raw values.

    Values are in the game's own units (speed in m/s, pedals 0-255, times in ms); converting to the
    frame format is a separate step. Raises ValueError if the packet is shorter than a type-A packet.
    Fields marked "unconfirmed" use offsets from the parser docs that gt7dashboard doesn't read.
    """
    if len(p) < PACKET_SIZES["A"]:
        raise ValueError(f"packet too short for type A: {len(p)} bytes")

    def floats(offset, n):
        return struct.unpack_from(f"<{n}f", p, offset)

    def one(fmt, offset):
        return struct.unpack_from("<" + fmt, p, offset)[0]

    gear_byte = p[0x90]
    return {
        "position": floats(0x04, 3),
        "velocity": floats(0x10, 3),
        "rotation": floats(0x1C, 3),                    # pitch, yaw, roll
        "angular_velocity": floats(0x2C, 3),
        "body_height": one("f", 0x38),                  # metres
        "rpm": one("f", 0x3C),
        "fuel_level": one("f", 0x44),
        "fuel_capacity": one("f", 0x48),
        "speed_ms": one("f", 0x4C),
        "boost": one("f", 0x50),                        # unconfirmed offset
        "oil_pressure": one("f", 0x54),
        "water_temp": one("f", 0x58),
        "oil_temp": one("f", 0x5C),
        "tyre_temp": floats(0x60, 4),                   # FL, FR, RL, RR
        "packet_id": one("i", 0x70),
        "lap": one("h", 0x74),
        "laps_in_race": one("h", 0x76),                 # unconfirmed offset
        "best_lap": one("i", 0x78),                     # ms, -1 if none
        "last_lap": one("i", 0x7C),                     # ms, -1 if none
        "time_value": one("i", 0x80),                   # ms; meaning unclear (see GT7_TELEMETRY.md)
        "position_values": (one("h", 0x84), one("h", 0x86)),  # meaning unclear
        "rpm_warning": one("H", 0x88),
        "rpm_limiter": one("H", 0x8A),
        "estimated_top_speed": one("h", 0x8C),
        "flags": one("H", 0x8E),
        "gear": gear_byte & 0x0F,
        "suggested_gear": gear_byte >> 4,               # 15 means none
        "throttle": p[0x91],                            # 0-255
        "brake": p[0x92],                               # 0-255
        "road_plane": floats(0x94, 3),                  # unconfirmed
        "road_plane_distance": one("f", 0xA0),          # unconfirmed
        "wheel_rps": floats(0xA4, 4),
        "tyre_radius": floats(0xB4, 4),
        "suspension_height": floats(0xC4, 4),
        "clutch": one("f", 0xF4),
        "clutch_engagement": one("f", 0xF8),
        "rpm_after_clutch": one("f", 0xFC),
        "transmission_top_speed": one("f", 0x100),      # unconfirmed
        "gear_ratios": floats(0x104, 8),
        "car_code": one("i", 0x124),
    }
