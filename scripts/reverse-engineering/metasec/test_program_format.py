import json
from pathlib import Path
import unittest

from program_format import Reader, decode_functions, decode_word, sections


class ProgramFormatTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = json.loads((Path(__file__).parent / 'fixtures/format-vectors.json').read_text())

    def test_all_twelve_descriptors_match_pinned_elf_vectors(self):
        self.assertEqual(set(range(12)), {v['codec'] for v in self.fixture['vectors']})
        for vector in self.fixture['vectors']:
            index = vector['codec']
            with self.subTest(index=index):
                self.assertEqual(vector['decoded'], decode_word(vector['encoded'], self.fixture['codecs'][index], self.fixture['canonical'][index]))

    def test_leb_and_container_truncation_are_rejected(self):
        for value in [b'\x80', b'\xff\xff\xff\xff\x10', b'\x80' * 6]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                Reader(value).uleb()
        for value in [b'', b'12345678\x0a', b'12345678\x0a\x7f\x00']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                list(sections(value))

    def test_custom_frame_field_is_not_treated_as_wasm_local_count(self):
        # One function, frame size 64, zero local groups, one encoded word.
        first = next(v for v in self.fixture['vectors'] if v['codec'] == 0)
        body = bytes([64, 0]) + first['encoded'].to_bytes(4, 'little')
        code = bytes([1, len(body)]) + body
        container = b'12345678' + bytes([10, len(code)]) + code
        result = decode_functions(container, self.fixture['codecs'], self.fixture['canonical'])
        self.assertEqual(result[0]['extra'], 64)
        self.assertEqual(result[0]['words'], [first['decoded']])
        with self.assertRaises(ValueError):
            decode_functions(container + bytes([10, len(code)]) + code, self.fixture['codecs'], self.fixture['canonical'])

    def test_unaligned_instruction_body_is_rejected(self):
        code = bytes([1, 3, 64, 0, 1])
        with self.assertRaises(ValueError):
            decode_functions(b'12345678' + bytes([10, len(code)]) + code, self.fixture['codecs'], self.fixture['canonical'])

    def test_descriptor_selection_uses_previous_decoded_word(self):
        def uleb(value):
            result = bytearray()
            while value >= 128:
                result.append((value & 127) | 128)
                value >>= 7
            return bytes(result + bytes([value]))
        sequence = self.fixture['sequence']
        body = uleb(144) + b'\0' + b''.join(v['encoded'].to_bytes(4, 'little') for v in sequence)
        code = b'\x01' + uleb(len(body)) + body
        functions = decode_functions(b'12345678\x0a' + uleb(len(code)) + code, self.fixture['codecs'], self.fixture['canonical'])
        self.assertEqual(functions[0]['words'], [v['decoded'] for v in sequence])


if __name__ == '__main__':
    unittest.main()
