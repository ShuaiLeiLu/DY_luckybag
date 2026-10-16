"""Lift the two digest-tail arithmetic paths directly to unrolled JavaScript."""
import json
import re
from common import root

text = (root / 'module-2df808.ir.txt').read_text()
source = ['// Generated from module 0x4420f0 F5/F6. Arithmetic only; no SDK oracle.']
for body, name in [(5, 'tail12'), (6, 'tail8')]:
    section = text.split(f'FUNCTION {body}\n')[1].split('\nFUNCTION ')[0]
    instructions = {}
    for line in section.strip().splitlines():
        match = re.fullmatch(r'(\d+) ([0-9a-f]{8}) IR([0-9a-f]+) .*', line)
        if not match:
            raise ValueError(f'Unresolved instruction: {line}')
        instructions[int(match[1])] = (int(match[2], 16), int(match[3], 16))
    bound = instructions[9][0] & 65535
    seed = ((instructions[1][0] & 65535) << 16) | (instructions[11][0] & 65535)
    if bound not in (8, 12) or seed != 0x20220420:
        raise ValueError('Unexpected tail initializer')
    source.append(f'function {name}(digest) {{')
    source.append(f'  let checksum = 0x{seed:08x}')
    serial = 0
    for index in range(bound):
        registers = {0: '0', 8: 'checksum'}
        for pc in (range(24, 33) if index & 1 else range(16, 23)):
            word, ir = instructions[pc]
            rs, rt, rd, shift = (word >> 21) & 31, (word >> 16) & 31, (word >> 11) & 31, (word >> 6) & 31
            if ir == 0x316:
                continue
            if ir == 0x49:
                if rs != 9 or word & 65535:
                    raise ValueError('Unexpected tail input load')
                expression, target = f'digest[{index}]', rt
            elif ir in (0x9, 0x42):
                expression = f'{registers[rt]} {"<<" if ir == 9 else ">>>"} {shift}'
                target = rd
            elif ir in (0x1b, 0x3c, 0xb2):
                operator = '^' if ir == 0x1b else '|'
                expression = f'({registers[rs]} {operator} {registers[rt]})'
                if ir == 0xb2:
                    expression = '~' + expression
                target = rd
            else:
                raise ValueError(f'Unexpected tail operation {pc}: {ir:#x}')
            variable = f'v{serial}'
            source.append(f'  const {variable} = {expression}')
            registers[target] = variable
            serial += 1
        source.append(f'  checksum = {registers[8]}')
    flag_pc = 43 if body == 5 else 44
    flag_word, flag_ir = instructions[flag_pc]
    if flag_ir != (0x30 if body == 5 else 0x73):
        raise ValueError('Unexpected branch marker')
    source += ['  const result = Buffer.alloc(20)', '  digest.copy(result)',
               '  result.writeUInt32LE(checksum >>> 0, 16)',
               f'  result[16] {"|=" if body == 5 else "&="} {flag_word & 65535}',
               '  return result', '}']
source.append('module.exports = { tail8, tail12 }\n')
(root / 'medusa-tail-lift.cjs').write_text('\n'.join(source))
print('Recovered both 8-byte and 12-byte tail paths')
