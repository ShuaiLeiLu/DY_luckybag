from common import *
from collections import Counter
cs=Cs(CS_ARCH_ARM64,CS_MODE_ARM)
registry=json.loads((root/'native-instruction-registry.json').read_text())
mem={int(k):v for k,v in json.loads((root/'native-instruction-registry-memory.json').read_text()).items()}
def load(p):return int.from_bytes(bytes(mem[p+i] for i in range(8)),'little')
def select(obj,w):
    selector_fn=ptr(load(obj)+8)
    shift={0x37cbb0:16,0x379cb4:21,0x379cc0:6,0x379700:0}.get(selector_fn)
    if shift is None:raise ValueError(('unknown selector',hex(selector_fn),hex(w)))
    selector=(w>>shift)&(63 if shift==0 else 31)
    return load(obj+16+selector*8)
def resolve(w):
    obj=int(registry[w>>26]['object_offset'],16)
    for _ in range(8):
        vt=load(obj);dec=ptr(vt)
        if dec==0x3794ec:
            if w==0:return (dec,0,None)
            obj+=0x20;selector=w&63
        elif dec==0x37ac48:obj+=0x10;selector=w&63
        elif dec==0x379c40:
            obj=select(obj,w)-0x100000000
            continue
        elif dec==0x37b0cc:
            # This decoder first tries its table at +0x220, then falls back
            # to +0x10 when that slot is empty (native 0x37b10c/0x37b154).
            target=select(obj+0x220,w) or select(obj+0x10,w)
            if not target:raise ValueError(('empty compound decoder',hex(w)))
            obj=target-0x100000000
            continue
        else:return (dec,*leaf(dec))
        obj=load(obj+16+selector*8)-0x100000000
        if obj<0:raise ValueError(('missing decoder',hex(w),hex(dec),selector))
    raise ValueError(hex(w))
cache={}
def leaf(a):
    if a in cache:return cache[a]
    regs={};ir=None;fmt=None
    for ins in cs.disasm(read(a,700),a):
        if ins.mnemonic=='ret':break
        if ins.mnemonic=='mov':
            m=re.fullmatch(r'(w\d+), #([^,]+)',ins.op_str)
            if m:regs[m[1]]=int(m[2],0)
        if ins.mnemonic=='strh':
            r=ins.op_str.split(',')[0]
            if r in regs:ir=regs[r]
        if ins.mnemonic=='ldr':
            m=re.fullmatch(r'x8, \[x8, #(0x[0-9a-f]+)\]',ins.op_str)
            if m and int(m[1],16) in (0x20,0x28,0x30,0x38,0x40,0x50):fmt=int(m[1],16)
    if ir is None:raise ValueError(('no IR',hex(a)))
    cache[a]=(ir,fmt);return cache[a]
module=sys.argv[1] if len(sys.argv)>1 else '2d3600'
fs=json.loads((root/f'module-{module}.words.json').read_text())
meta=json.loads((root/f'module-{module}.metadata.json').read_text())
imports=[v['name'] for v in meta['imports'] if v['kind']==0]
export_names={v['index']:v['name'] for v in meta['exports'] if v['kind']==0}
callbacks={v['name']:v['address'] for v in json.loads((root/f'module-{module}.json').read_text())['callbacks']}
lines=[];seen=Counter()
for f in fs:
    lines.append('\nFUNCTION '+str(f['index']))
    for i,w in enumerate(f['words']):
        try:dec,ir,fmt=resolve(w)
        except (ValueError,KeyError) as error:
            lines.append(f'{i:04d} {w:08x} UNKNOWN {error}')
            continue
        seen[ir]+=1
        rs,rt,rd=(w>>21)&31,(w>>16)&31,(w>>11)&31
        imm=w&65535;imm=imm if imm<32768 else imm-65536
        args=f'r{rs},r{rt},r{rd}' if fmt==0x20 else f'r{(w>>16)&31},r{(w>>11)&31},r{(w>>6)&31}' if fmt in (0x28,0x30) else str(w&0x3ffffff) if fmt==0x50 else f'r{rs},r{rt},{imm}'
        if ir==0x16:
            idx=w&0x3ffffff
            name=imports[idx] if idx<len(imports) else export_names.get(idx, f'body#{idx-len(imports)}')
            args=f'CALL {name} {callbacks.get(name, "")} (index {idx})'
        lines.append(f'{i:04d} {w:08x} IR{ir:03x} {args}')
(root/f'module-{module}.ir.txt').write_text('\n'.join(lines))
print('IR histogram',seen)
out=[]
for ir in sorted(seen):
    a=ptr(0x3e2dd8+ir*8);out.append('\nIR '+hex(ir)+' HANDLER '+hex(a))
    for ins in cs.disasm(read(a,360),a):
        out.append(f'{ins.address:08x} {ins.mnemonic:8} {ins.op_str}')
        if ins.mnemonic in ('br','ret'):break
(root/f'module-{module}.ir-handlers.txt').write_text('\n'.join(out))
