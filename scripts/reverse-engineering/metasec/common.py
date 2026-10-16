"""Read-only, version-pinned ELF access. This module never loads native code."""
import hashlib
import json
import os
import re
import struct
import sys
from pathlib import Path

from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
from elftools.elf.elffile import ELFFile

EXPECTED_SHA256 = '1fe03703b1f3a806b220271ba2ec1dbed049d8b5f0216b70c0c724d5c5bc027c'
path = Path(os.environ['METASEC_RESEARCH_ELF'])
root = Path(os.environ['METASEC_RESEARCH_OUTPUT'])
if hashlib.sha256(path.read_bytes()).hexdigest() != EXPECTED_SHA256:
    raise ValueError('Unsupported ELF: offsets apply only to the documented Douyin 40.7 sample')
root.mkdir(parents=True, exist_ok=True)
with path.open('rb') as f:
    elf = ELFFile(f)
    if elf['e_machine'] != 'EM_AARCH64':
        raise ValueError('Expected AArch64 ELF')
    segs = [(s['p_vaddr'], s.data()) for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']
    reloc = {
        r['r_offset']: r['r_addend']
        for section in elf.iter_sections() if section['sh_type'] == 'SHT_RELA'
        for r in section.iter_relocations() if r['r_info_type'] == 1027
    }


def read(address, length):
    if length < 0:
        raise ValueError('Negative read length')
    for base, data in segs:
        if base <= address and address + length <= base + len(data):
            return data[address - base:address - base + length]
    raise ValueError(f'Address outside ELF file segments: {address:#x}+{length}')


def ptr(address):
    return reloc[address] if address in reloc else int.from_bytes(read(address, 8), 'little')


def string(address):
    return read(address, 64).split(b'\0', 1)[0].decode('utf-8')
