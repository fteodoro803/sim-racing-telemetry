import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from salsa20 import salsa20_xor


class Salsa20Test(unittest.TestCase):
    def test_ecrypt_known_answer(self):
        """The ECRYPT Salsa20/20 256-bit Set 1 vector 0: key 0x80 then zeros, nonce zero."""
        keystream = salsa20_xor(bytes([0x80]) + bytes(31), bytes(8), bytes(64))
        self.assertEqual(
            keystream.hex().upper(),
            "E3BE8FDD8BECA2E3EA8EF9475B29A6E7003951E1097A5C38D23B7A5FAD9F6844"
            "B22C97559E2723C7CBBD3FE4FC8D9A0744652A83E72A9C461876AF4D7EF1A117",
        )

    def test_encrypting_twice_restores_the_data(self):
        key, nonce = bytes(range(32)), bytes(range(8))
        data = bytes(range(256)) * 2
        self.assertEqual(salsa20_xor(key, nonce, salsa20_xor(key, nonce, data)), data)

    def test_lengths_that_are_not_a_multiple_of_the_block_size(self):
        key, nonce = bytes(32), bytes(8)
        for n in (0, 1, 63, 64, 65, 296, 368):
            self.assertEqual(len(salsa20_xor(key, nonce, bytes(n))), n)

    def test_rejects_bad_key_and_nonce_sizes(self):
        with self.assertRaises(ValueError):
            salsa20_xor(bytes(16), bytes(8), b"x")
        with self.assertRaises(ValueError):
            salsa20_xor(bytes(32), bytes(4), b"x")


if __name__ == "__main__":
    unittest.main()
