from common import root, json, sys
from program_format import decode_functions

module = sys.argv[1]
codecs = json.loads((root / f'module-{module}.json').read_text())['codecs']
canonical = json.loads((root / 'http-sign-program-tables.json').read_text())['canonical_codecs']
functions = decode_functions((root / f'module-{module}.bin').read_bytes(), codecs, canonical)
(root / f'module-{module}.words.json').write_text(json.dumps(functions, indent=2))
print(module, 'functions', len(functions), 'instructions', sum(len(f['words']) for f in functions))
