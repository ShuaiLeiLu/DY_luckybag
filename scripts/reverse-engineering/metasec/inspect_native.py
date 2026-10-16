"""Dump pinned ARM64 instructions without loading or executing the library."""
import argparse
from common import read, Cs, CS_ARCH_ARM64, CS_MODE_ARM


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('spans', nargs='+', help='VA:length, both Python integer literals')
    args = parser.parse_args()
    decoder = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
    for span in args.spans:
        address, length = (int(part, 0) for part in span.split(':'))
        if address % 4 or length <= 0 or length > 0x10000:
            raise ValueError('Expected aligned address and bounded span')
        print(f'\nSPAN {address:#x}:{length:#x}')
        for instruction in decoder.disasm(read(address, length), address):
            print(f'{instruction.address:08x} {instruction.mnemonic:8} {instruction.op_str}')


if __name__ == '__main__':
    main()
