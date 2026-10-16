"""Generate a straight-line arithmetic reference for the SDK's Helios block."""
import re
from common import root, read, Cs, CS_ARCH_ARM64, CS_MODE_ARM

# Verify the native key schedule's rotations and bound, not just its similarity
# to an algorithm name. Its final unused extra key is not consumed by F1.
schedule = {ins.address: (ins.mnemonic, ins.op_str) for ins in Cs(CS_ARCH_ARM64, CS_MODE_ARM).disasm(read(0x2dc830, 0x4c), 0x2dc830)}
for address, expected in {
    0x2dc838: ('cmp', 'x20, #0x22'),
    0x2dc854: ('ror', 'x8, x8, #8'),
    0x2dc85c: ('add', 'x8, x8, x9'),
    0x2dc860: ('eor', 'x8, x8, x20'),
    0x2dc864: ('eor', 'x9, x8, x9, ror #61'),
}.items():
    if schedule.get(address) != expected:
        raise ValueError(f'Unexpected key schedule at {address:#x}')

section = (root / 'module-2dd318.ir.txt').read_text().split('FUNCTION 1\n')[1]
instructions = {}
for line in section.strip().splitlines():
    match = re.fullmatch(r'(\d+) ([0-9a-f]{8}) IR([0-9a-f]+) .*', line)
    if not match:
        raise ValueError(line)
    instructions[int(match[1])] = (int(match[2], 16), int(match[3], 16))
if instructions[4][0] & 65535 != 272:
    raise ValueError('Unexpected block round bound')
source = ['// Generated from official module 0x43eb90/F1, 34 rounds.',
          'function encrypt(block, keys) {', '  const mask = (1n << 64n) - 1n',
          '  let y = block.readBigUInt64LE(0)', '  let x = block.readBigUInt64LE(8)']
serial = 0
for index in range(34):
    registers = {6: 'y', 11: 'x'}
    for pc in (7, 11, 13, 14, 15, 16):
        raw, ir = instructions[pc]
        rs, rt, rd, shift = (raw >> 21) & 31, (raw >> 16) & 31, (raw >> 11) & 31, (raw >> 6) & 31
        if ir == 0x7d:
            expression, target = f'keys[{index}]', rt
        elif ir in (0x7a, 0x84):
            amount = shift + (32 if ir == 0x84 else 0)
            value = registers[rt]
            expression, target = f'(({value} >> {amount}n) | ({value} << {64 - amount}n)) & mask', rd
        elif ir in (0x3a, 0x1b):
            expression = f'({registers[rs]} {"+" if ir == 0x3a else "^"} {registers[rt]}) & mask'
            target = rd
        else:
            raise ValueError(f'Unexpected block arithmetic: {pc}/{ir:#x}')
        variable = f'v{serial}'
        source.append(f'  const {variable} = {expression}')
        registers[target] = variable
        serial += 1
    source += [f'  y = {registers[6]}', f'  x = {registers[11]}']
source += ['  const result = Buffer.alloc(16)', '  result.writeBigUInt64LE(y, 0)',
           '  result.writeBigUInt64LE(x, 8)', '  return result', '}', 'module.exports = { encrypt }\n']
(root / 'speck-block-lift.cjs').write_text('\n'.join(source))
print('Recovered 34-round block encryption and native key schedule parameters')
