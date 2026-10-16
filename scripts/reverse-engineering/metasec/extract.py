"""Reproduce static evidence; no DLL loading, native calls, VM or network access."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--elf', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--dex54', type=Path, help='Also verify SDK initialization constants against the matching classes54.dex')
    parser.add_argument('--check-fixtures', action='store_true', help='Require regenerated research fixtures to match the repository byte for byte')
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'METASEC_RESEARCH_ELF': str(args.elf.resolve()), 'METASEC_RESEARCH_OUTPUT': str(out)}
    here = Path(__file__).resolve().parent

    def stage(name, *extra):
        result = subprocess.run([sys.executable, str(here / name), *extra], env=env, capture_output=True, text=True)
        log_suffix = ('-' + Path(extra[0]).name) if extra else ''
        (out / (name + log_suffix + '.log')).write_text(result.stdout + result.stderr, encoding='utf-8')
        if result.returncode:
            raise RuntimeError(f'{name} failed; inspect its log in {out}')

    for name in ['extract_program.py', 'extract_modules.py', 'registry.py', 'metadata.py']:
        stage(name)
    modules = json.loads((out / 'native-program-modules.json').read_text())
    if len(modules) != 10:
        raise ValueError('Expected all 10 module constructors to be recovered')
    counts = []
    for module in modules:
        key = module['loader_call'][2:]
        stage('decode_program.py', key)
        stage('disassemble.py', key)
        words = json.loads((out / f'module-{key}.words.json').read_text())
        ir_text = (out / f'module-{key}.ir.txt').read_text()
        counts.append({'module': key, 'functions': len(words), 'instructions': sum(len(f['words']) for f in words), 'unresolved_ir': ir_text.count('UNKNOWN')})
    if any(module['unresolved_ir'] for module in counts):
        raise ValueError('Unresolved native IR remains; do not generate desktop arithmetic fixtures')
    stage('lift_compression.py')
    stage('lift_tail.py')
    stage('lift_speck.py')
    stage('recover_parameters.py')
    fixtures = ['medusa-compression-lift.cjs', 'medusa-tail-lift.cjs', 'speck-block-lift.cjs', 'medusa-digest-parameters.json', 'format-vectors.json']
    if args.dex54:
        stage('recover_initialization.py', str(args.dex54.resolve()))
        fixtures.append('initialization-evidence.json')
    if args.check_fixtures:
        for name in fixtures:
            if (out / name).read_bytes() != (here / 'fixtures' / name).read_bytes():
                raise ValueError(f'Regenerated fixture differs: {name}')
        desktop_parameters = here.parents[2] / 'apps/desktop/electron/metasec/digest-parameters.json'
        if (out / 'medusa-digest-parameters.json').read_bytes() != desktop_parameters.read_bytes():
            raise ValueError('Desktop digest parameters differ from the pinned ELF')
    manifest = {
        'elf_sha256': hashlib.sha256(args.elf.read_bytes()).hexdigest(),
        'mode': 'static-analysis-only',
        'official_signature_oracle': False,
        'signature_verified': False,
        'initialization_constants_checked': bool(args.dex54),
        'modules': counts,
        'files_sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.iterdir()) if p.suffix in ('.json', '.cjs', '.bin', '.txt') and p.name != 'manifest.json' and (args.dex54 or p.name != 'initialization-evidence.json')},
    }
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps({key: value for key, value in manifest.items() if key != 'files_sha256'}, indent=2))


if __name__ == '__main__':
    main()
