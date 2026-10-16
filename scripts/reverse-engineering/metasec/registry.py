from common import *
from capstone.arm64 import ARM64_OP_REG,ARM64_OP_IMM,ARM64_OP_MEM
cs=Cs(CS_ARCH_ARM64,CS_MODE_ARM);cs.detail=True
base=0x100000000;regs={'x0':base,'sp':0x200000000,'xzr':0,'v0':0};mem={}
def name(r):
    n=cs.reg_name(r)
    return 'x'+n[1:] if n.startswith('w') else ('v'+n[1:] if n[0:1] in ('q','d') else n)
def width(r):
    n=cs.reg_name(r)
    return 16 if n.startswith('q') else 4 if n.startswith('w') else 8
def get(op):
    if op.type==ARM64_OP_IMM:return op.imm
    if op.type==ARM64_OP_REG:return regs.get(name(op.reg))
    raise ValueError(op.type)
def adr(op):
    p=regs.get(name(op.mem.base));i=regs.get(name(op.mem.index),0) if op.mem.index else 0
    return None if p is None or i is None else p+op.mem.disp+(i<<op.shift.value)
def put(p,v,n):
    if p is None:return
    for i in range(n):
        if v is None:mem.pop(p+i,None)
        else:mem[p+i]=(v>>(i*8))&255
def load(p,n,signed=False):
    if p is None:return None
    try:return int.from_bytes(bytes(mem[p+i] for i in range(n)),'little',signed=signed)
    except KeyError:
        if p<0x500000:
            return ptr(p) if n==8 else int.from_bytes(read(p,n),'little',signed=signed)
        return None
for ins in cs.disasm(read(0x373944,0x379270-0x373944),0x373944):
    o=ins.operands;m=ins.mnemonic
    if m in ('mov','adrp','adr'):regs[name(o[0].reg)]=get(o[1])
    elif m=='movi':regs[name(o[0].reg)]=0
    elif m in ('add','sub'):
        a,b=get(o[1]),get(o[2])
        # AArch64 ADD immediates may be shifted by 12. Treating '#4, lsl #12'
        # as four bytes makes nested decoder pointers alias the registry header.
        if b is not None:b <<= o[2].shift.value
        regs[name(o[0].reg)]=None if a is None or b is None else a+(b if m=='add' else -b)
    elif m=='str':put(adr(o[1]),get(o[0]),width(o[0].reg))
    elif m=='stp':
        p=adr(o[2]);n=width(o[0].reg);put(p,get(o[0]),n);put(None if p is None else p+n,get(o[1]),n)
    elif m in ('ldr','ldrsw'):regs[name(o[0].reg)]=load(adr(o[1]),4 if m=='ldrsw' else width(o[0].reg),m=='ldrsw')
    elif m=='ldp':
        p=adr(o[2]);n=width(o[0].reg);regs[name(o[0].reg)]=load(p,n);regs[name(o[1].reg)]=load(None if p is None else p+n,n)
    elif m=='bl':
        for i in range(19):regs['x'+str(i)]=None
    else:raise ValueError((hex(ins.address),m))
out=[]
for opcode in range(64):
    obj=load(base+opcode*8,8)
    if not obj:continue
    vt=load(obj,8)
    out.append({'opcode':opcode,'object_offset':hex(obj-base),'vtable':hex(vt),'decode':hex(ptr(vt)),'object_data':{hex(i):hex(load(obj+i,8) or 0) for i in range(8,40,8)}})
(root/'native-instruction-registry.json').write_text(json.dumps(out,indent=2))
(root/'native-instruction-registry-memory.json').write_text(json.dumps({str(k-base):v for k,v in mem.items() if base<=k<base+0x9000}))
print(json.dumps(out,indent=2))
