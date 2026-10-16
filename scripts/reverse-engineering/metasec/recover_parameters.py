"""Recover digest constants/message schedule from the lifted arithmetic DAG."""
from common import root, json, read, EXPECTED_SHA256

dag = json.loads((root / 'medusa-compression.dag.json').read_text())
nodes = dag['nodes']


def byte_parts(value, shift=0):
    if isinstance(value, int):
        return None
    op, *args = nodes[value[1]]
    if op == 'byte':
        return [(args[0], shift)]
    if op == 'shl':
        return byte_parts(args[0], shift + args[1])
    if op == 'or':
        left, right = byte_parts(args[0], shift), byte_parts(args[1], shift)
        return left + right if left is not None and right is not None else None
    return None


def add_terms(value):
    if not isinstance(value, int) and nodes[value[1]][0] == 'add':
        return [term for child in nodes[value[1]][1:] for term in add_terms(child)]
    return [value]


words = {}
for index in range(len(nodes)):
    parts = byte_parts(['n', index])
    if parts and len(parts) == 4:
        parts.sort()
        base = parts[0][0]
        if base % 4 == 0 and parts == [(base + i, i * 8) for i in range(4)]:
            words[index] = base // 4
constants, schedule, shifts = [], [], []
for step in dag['rotations']:
    terms = add_terms(nodes[step['node']][1])
    constant = [v for v in terms if isinstance(v, int)]
    word = [words[v[1]] for v in terms if not isinstance(v, int) and v[1] in words]
    if len(constant) != 1 or len(word) != 1:
        raise ValueError('Round no longer has exactly one constant and message word')
    constants.extend(constant)
    schedule.extend(word)
    shifts.append(32 - step['right'])
if len(constants) != 64:
    raise ValueError('Expected 64 rounds')

functions = json.loads((root / 'module-2df808.words.json').read_text())


def constant_stores(words):
    """Only fold LUI/ORI and collect known stores in the F2 initializer."""
    registers = {0: 0}
    stores = {}
    for w in words:
        rs, rt = (w >> 21) & 31, (w >> 16) & 31
        opcode, immediate = w >> 26, w & 65535
        # These encodings are confirmed by the extracted official decoder registry.
        if opcode == 15 and rs in range(6):
            registers[rt] = immediate << 16
        elif opcode in (13, 38) and rs in registers:
            registers[rt] = registers[rs] | immediate
        elif opcode in (21, 23, 43) and rs == 8:
            stores[immediate] = registers[rt]
    return stores


initial = constant_stores(functions[2]['words'])
if set(initial) != {0, 4, 8, 12, 16, 20}:
    raise ValueError('Incomplete digest initializer')
f4 = functions[4]['words']
# F4 PCs 34..43 construct the four final XOR constants; pair each LUI with ORI.
registers = {}
for w in f4[34:44]:
    rs, rt = (w >> 21) & 31, (w >> 16) & 31
    if w >> 26 == 15:
        registers[rt] = (w & 65535) << 16
    elif w >> 26 in (13, 38):
        registers[rt] = registers[rs] | (w & 65535)
data = bytes.fromhex(json.loads((root / 'module-2df808.metadata.json').read_text())['data'][0]['hex'])
parameters = {
    'elf_sha256': EXPECTED_SHA256,
    'module_blob': '0x4420f0',
    'functions': {'initialize': 2, 'update': 3, 'finalize': 4, 'compress': 7},
    'initial_state': [initial[i] for i in (8, 12, 16, 20)],
    'final_xor': [registers[i] for i in (8, 7, 6, 5)],
    'padding_hex': data[33:97].hex(),
    'round_constants': constants,
    'message_schedule': schedule,
    'left_rotations': shifts,
    'status': 'static-reconstruction; no official runtime output comparison',
}
(root / 'medusa-digest-parameters.json').write_text(json.dumps(parameters, indent=2))

header_data = bytes.fromhex(json.loads((root / 'module-2d8864.metadata.json').read_text())['data'][0]['hex'])
header_words = json.loads((root / 'module-2d8864.words.json').read_text())[0]['words']


def signed16(word):
    value = word & 65535
    return value if value < 32768 else value - 65536


# The name is assembled as an immediate before the XOR helper is called.
value = (header_words[166] & 65535) << 16
value += signed16(header_words[169])
value = (value << ((header_words[171] >> 6) & 31)) + signed16(header_words[172])
value = (value << ((header_words[174] >> 6) & 31)) + signed16(header_words[175])
encoded_name = (value & ((1 << 64) - 1)).to_bytes(8, 'little')
key = read(0x66d18, 8)
argus_name = bytes(a ^ b for a, b in zip(encoded_name, key))
if argus_name != b'X-Argus\0':
    raise ValueError('Unexpected header name')
headers = [{'name': argus_name[:-1].decode(), 'name_pc': [166, 179], 'value_pc': [187, 198], 'observed_value': 'base64(little_endian_u32(request_context[8]))', 'scope': 'this static header assembly path only'}]
for offset, length, key_address in [(33, 10, 0x66d80), (43, 9, 0x66d48), (52, 9, 0x66d78), (61, 9, 0x66d80), (70, 10, 0x66d48)]:
    key = read(key_address, 8)
    name = bytes(value ^ key[i % 8] for i, value in enumerate(header_data[offset:offset + length]))
    headers.append({'name': name.rstrip(b'\0').decode(), 'data_offset': offset, 'xor_key_va': hex(key_address)})
(root / 'header-paths.json').write_text(json.dumps(headers, indent=2))

# Keep one raw/decoded word from each rolling descriptor for format regression.
from program_format import Reader, sections, decode_word
module = json.loads((root / 'module-2df808.json').read_text())
canonical = json.loads((root / 'http-sign-program-tables.json').read_text())['canonical_codecs']
blob = (root / 'module-2df808.bin').read_bytes()
vectors, sequence = [], []
for section_id, start, end in sections(blob):
    if section_id != 10:
        continue
    reader = Reader(blob, start, end)
    for function_index in range(reader.uleb()):
        body = Reader(reader.take(reader.uleb()))
        body.uleb()
        for _ in range(body.uleb()):
            body.uleb()
            body.uleb()
        descriptor, pc = 0, 0
        while body.position < body.end:
            raw = int.from_bytes(body.take(4), 'little')
            decoded = decode_word(raw, module['codecs'][descriptor], canonical[descriptor])
            if function_index == 0 and pc < 32:
                sequence.append({'encoded': raw, 'decoded': decoded})
            if not any(vector['codec'] == descriptor for vector in vectors):
                vectors.append({'body': function_index, 'pc': pc, 'codec': descriptor, 'encoded': raw, 'decoded': decoded})
            descriptor = decoded % 12
            pc += 1
if len(vectors) != 12:
    raise ValueError('Missing descriptor vector')
(root / 'format-vectors.json').write_text(json.dumps({'source_elf': EXPECTED_SHA256, 'codecs': module['codecs'], 'canonical': canonical, 'vectors': vectors, 'sequence': sequence}, indent=2))
print('Recovered 64 rounds, digest initialization/finalization constants, and header names')
