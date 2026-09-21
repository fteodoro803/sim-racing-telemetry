"""Pure-Python Salsa20/20 stream cipher, so the bridge's first slice needs no third-party packages.

GT7 encrypts every telemetry packet with Salsa20 (256-bit key, 64-bit nonce). A stream cipher
encrypts and decrypts with the same operation, so `salsa20_xor` does both.

This is deliberately the plain algorithm from the Salsa20 specification, with no optimisation.
A packet is about 300 bytes (five 64-byte blocks) and arrives 60 times a second, which is a
trivial load even in pure Python. It is checked against pycryptodome's implementation in the tests
that ship with it (see tests/test_salsa20.py).
"""
import struct

_MASK = 0xFFFFFFFF
_SIGMA = struct.unpack("<4I", b"expand 32-byte k")


def _rotl(v, n):
    """Rotate a 32-bit word left by n bits."""
    return ((v << n) & _MASK) | (v >> (32 - n))


def _quarter_round(x, a, b, c, d):
    """Mix four words of the state in place, as defined by the Salsa20 specification."""
    x[b] ^= _rotl((x[a] + x[d]) & _MASK, 7)
    x[c] ^= _rotl((x[b] + x[a]) & _MASK, 9)
    x[d] ^= _rotl((x[c] + x[b]) & _MASK, 13)
    x[a] ^= _rotl((x[d] + x[c]) & _MASK, 18)


def _keystream_block(key_words, nonce_words, counter):
    """Produce one 64-byte block of keystream for the given block counter."""
    s = [0] * 16
    s[0], s[5], s[10], s[15] = _SIGMA
    s[1:5] = key_words[0:4]
    s[11:15] = key_words[4:8]
    s[6], s[7] = nonce_words
    s[8], s[9] = counter & _MASK, (counter >> 32) & _MASK

    x = s[:]
    for _ in range(10):  # 20 rounds = 10 double rounds
        # column round
        _quarter_round(x, 0, 4, 8, 12)
        _quarter_round(x, 5, 9, 13, 1)
        _quarter_round(x, 10, 14, 2, 6)
        _quarter_round(x, 15, 3, 7, 11)
        # row round
        _quarter_round(x, 0, 1, 2, 3)
        _quarter_round(x, 5, 6, 7, 4)
        _quarter_round(x, 10, 11, 8, 9)
        _quarter_round(x, 15, 12, 13, 14)
    return struct.pack("<16I", *[(x[i] + s[i]) & _MASK for i in range(16)])


def salsa20_xor(key, nonce, data):
    """Encrypt or decrypt `data` with Salsa20/20 (a stream cipher, so both are the same operation).

    `key` must be 32 bytes and `nonce` 8 bytes. The block counter starts at zero.
    """
    if len(key) != 32:
        raise ValueError("Salsa20 key must be 32 bytes")
    if len(nonce) != 8:
        raise ValueError("Salsa20 nonce must be 8 bytes")
    key_words = struct.unpack("<8I", key)
    nonce_words = struct.unpack("<2I", nonce)
    out = bytearray(len(data))
    for block, start in enumerate(range(0, len(data), 64)):
        stream = _keystream_block(key_words, nonce_words, block)
        chunk = data[start:start + 64]
        for i, byte in enumerate(chunk):
            out[start + i] = byte ^ stream[i]
    return bytes(out)
