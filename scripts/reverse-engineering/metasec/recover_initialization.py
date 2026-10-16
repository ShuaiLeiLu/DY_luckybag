"""Read the pinned DEX/ELF to recover the SDK version in initialization slot 4.

This is constant decoding only. It does not reproduce the native environment
checks, allocate an SDK handle, or assert that an SDK instance is ready.
"""
import hashlib
import json
from pathlib import Path
import struct
import sys

from common import EXPECTED_SHA256, ptr, read, root

DEX_SHA256 = '778e2caf2558eedb1c2cd02b972749f89f866af921fa7803c7ab7c09cce5f070'
dex = Path(sys.argv[1]).read_bytes()
if hashlib.sha256(dex).hexdigest() != DEX_SHA256:
    raise ValueError('Unsupported classes54.dex: initialization offsets are version-specific')

# k3.a(0x01000001, ...) dispatch: program 0x6efb0, path 0x6f24c..0x6f28c.
native_decoder = ptr(0x3f3a80 + 0x20)
if native_decoder != 0x18dbd8:
    raise ValueError('Unexpected initialization string decoder')

# Constants and arithmetic at 0x18dc00..0x18dc7c resolve the encoded table.
mask64 = (1 << 64) - 1
combined = (((0x00a060400a021040 | (~native_decoder & mask64)) & 0x00a061440a061440)
            + (native_decoder & 0x0000010400040400)) & mask64
table_bias = (combined | 0x01010104) ^ 0xff5f9ebbf48ef1ec
key_address = (ptr(0x3f3e20 + 0x10) + table_bias) & mask64
base_key = read(key_address, 10)

# s4.<clinit> @ 0x7690c4: fill-array-data @ 0x7690dc -> payload 0x769104.
payload_address = 0x769104
tag, element_size, count = struct.unpack_from('<HHI', dex, payload_address)
if (tag, element_size, count) != (0x300, 1, 19):
    raise ValueError('Unexpected s4.LIZ byte-array payload')
encrypted = dex[payload_address + 8:payload_address + 8 + count]
# const-string index 0x0ee2 at 0x7690ee; read through DEX string_ids.
string_count, string_table = struct.unpack_from('<II', dex, 0x38)
if string_count <= 0xee2:
    raise ValueError('Missing initialization decoder key')
key_data_offset = struct.unpack_from('<I', dex, string_table + 0xee2 * 4)[0]
if dex[key_data_offset] != 6:
    raise ValueError('Unexpected initialization key length')
key = dex[key_data_offset + 1:key_data_offset + 7]
if key != b'443549' or dex[key_data_offset + 7] != 0:
    raise ValueError('Unexpected initialization decoder key')

# 0x18e13c..0x18e160: combine a 10-byte ELF constant with the repeating key.
# 0x18e194..0x18e230: XOR the DEX payload with that 10-byte combined key.
combined_key = bytes(value ^ key[index % len(key)] for index, value in enumerate(base_key))
decoded = bytes(value ^ combined_key[index % 10] for index, value in enumerate(encrypted))
version = decoded.decode('ascii')
if version != 'v04.10.04.01-bugfix':
    raise ValueError('Unexpected decoded SDK version')

report = {
    'elf_sha256': EXPECTED_SHA256,
    'classes54_dex_sha256': DEX_SHA256,
    'config_method': 'ms.bd.c.u2.LIZ @ 0x424c44',
    'config_array_items': 17,
    'sdk_version': version,
    'sdk_version_slot': 4,
    'native_decoder': hex(native_decoder),
    'decoder_key_va': hex(key_address),
    'decoder_key_hex': base_key.hex(),
    'dex_string_index': '0x0ee2',
    'dex_payload_va': hex(payload_address),
    'dex_payload_hex': encrypted.hex(),
    'configuration_opcode': '0x04000001',
    'handle_lookup_opcode': '0x04000002',
    'http_signature_opcode': '0x03000001',
    'readiness_path': {
        'signature_object_constructor': '0x2905a8',
        'constructor_clear_ready': '0x29065c: byte at object+0x30 = 0',
        'context_attachment': '0x2e3f50..0x2e3f60 -> vtable+0x58 -> 0x2d1038 -> 0x1b7100',
        'context_storage': 'object+0x38',
        'mark_ready_call': '0x2e3f70 -> 0x2e4a4c -> vtable+0x38 -> 0x2907fc',
        'mark_ready_store': '0x290800: byte at object+0x30 = 1',
        'signature_ready_check': '0x2e3b64..0x2e3b6c: handle+0x10 -> object+0x30',
        'not_ready_behavior': '0x2e3c00..0x2e3c14: empty header map',
        'context_initialization_reproduced': False,
    },
    'scope': 'constant decoding and static readiness path; native environment-dependent alternate branch and SDK context initialization not reproduced',
    'official_signature_oracle': False,
    'signature_verified': False,
}
(root / 'initialization-evidence.json').write_text(json.dumps(report, indent=2))
print(json.dumps({'sdk_version': version, 'config_array_items': 17, 'signature_verified': False}))
