"""Static decoding of the custom container, not a WASM/Android interpreter."""
import struct


class Reader:
    def __init__(self, data, position=0, end=None):
        self.data, self.position = data, position
        self.end = len(data) if end is None else end
        if not 0 <= position <= self.end <= len(data):
            raise ValueError('Invalid reader bounds')

    def take(self, length):
        if length < 0 or self.position + length > self.end:
            raise ValueError('Truncated container')
        start = self.position
        self.position += length
        return self.data[start:self.position]

    def uleb(self):
        value = 0
        for shift in range(0, 35, 7):
            byte = self.take(1)[0]
            value |= (byte & 127) << shift
            if byte < 128:
                if value > 0xffffffff:
                    raise ValueError('LEB integer overflow')
                return value
        raise ValueError('Overlong LEB integer')


def sections(data):
    reader = Reader(data, 8)
    while reader.position < reader.end:
        section_id = reader.take(1)[0]
        size = reader.uleb()
        start = reader.position
        reader.take(size)
        yield section_id, start, reader.position


def mask(width):
    return (1 << width) - 1


def decode_word(word, source, canonical):
    """0x39f06c: rotate the packed region, then copy fields by canonical ID."""
    target_fields = canonical['fields']
    width = sum(field[2] for field in target_fields)
    start = next(field[1] for field in target_fields if field[0] == 0)
    if not 0 < width <= 32 or start + width > 32:
        raise ValueError('Invalid bit region')
    rotation = source['prefix'][1]
    rotation = (rotation if rotation < 128 else rotation - 256) % width
    value = (word >> start) & mask(width)
    value = ((value << rotation) | (value >> (width - rotation))) & mask(width)
    rotated = (word & ~(mask(width) << start)) | (value << start)
    result = rotated
    targets = {field[0]: field[1:] for field in target_fields}
    for field_id, offset, bits in source['fields']:
        target, expected_width = targets[field_id]
        if bits != expected_width or offset + bits > 32:
            raise ValueError('Inconsistent bit field')
        result = (result & ~(mask(bits) << target)) | (((rotated >> offset) & mask(bits)) << target)
    return result & 0xffffffff


def decode_functions(data, codecs, canonical):
    if len(codecs) != len(canonical) or not codecs:
        raise ValueError('Codec count mismatch')
    functions = None
    for section_id, start, end in sections(data):
        if section_id != 10:
            continue
        if functions is not None:
            raise ValueError('Duplicate code section')
        reader = Reader(data, start, end)
        functions = []
        for index in range(reader.uleb()):
            size = reader.uleb()
            body_start = reader.position
            reader.take(size)
            body = Reader(data, body_start, reader.position)
            frame_bytes = body.uleb()  # Extra field absent from standard WASM.
            for _ in range(body.uleb()):
                body.uleb()  # local count
                body.uleb()  # local type
            if (body.end - body.position) % 4:
                raise ValueError('Instruction stream is not aligned to 32 bits')
            words, descriptor = [], 0
            while body.position < body.end:
                raw = struct.unpack('<I', body.take(4))[0]
                decoded = decode_word(raw, codecs[descriptor], canonical[descriptor])
                words.append(decoded)
                descriptor = decoded % len(codecs)
            functions.append({'index': index, 'extra': frame_bytes, 'code_offset': hex(body_start), 'words': words})
        if reader.position != end:
            raise ValueError('Trailing bytes in code section')
    if functions is None:
        raise ValueError('Missing code section')
    return functions
