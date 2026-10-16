from common import *
# Constant propagation over the straight-line table constructor, not an ARM emulator.
regs={'zr':0,'sp':0}; mem={}
def val(r):return int(r[1:],0) if r.startswith('#') else regs[r.lstrip('xw') if r!='sp' else r]
cs=Cs(CS_ARCH_ARM64,CS_MODE_ARM)
for ins in cs.disasm(read(0x2d2858,0x2d3600-0x2d2858),0x2d2858):
    a=ins.op_str.split(', ')
    if ins.mnemonic in ('adrp','adr','mov'):
        regs[a[0].lstrip('xw')]=val(a[1])
    elif ins.mnemonic=='add':regs[a[0].lstrip('xw')]=val(a[1])+val(a[2])
    elif ins.mnemonic in ('str','strb'):
        m=re.fullmatch(r'(\w+), \[sp(?:, #(0x[0-9a-f]+|\d+))?\]',ins.op_str)
        if not m:raise ValueError(ins.op_str)
        r,o=m.groups(); o=int(o or '0',0)
        size=1 if ins.mnemonic=='strb' else (4 if r.startswith('w') else 8)
        for k,v in enumerate(val(r).to_bytes(size,'little')):mem[o+k]=v
    else:raise ValueError((hex(ins.address),ins.mnemonic,ins.op_str))
def sm(a,n):return bytes(mem.get(a+i,0) for i in range(n))
def sptr(a):return int.from_bytes(sm(a,8),'little')
out={'callbacks':[],'globals':[],'codecs':[]}
for group,start,count in [('callbacks',0x2d0,62),('globals',0x1e0,10)]:
    for i in range(count):
        p=start+i*24
        out[group].append({'name':string(sptr(p)),'address':hex(sptr(p+8)),'flag':sm(p+16,1)[0]})
for i in range(12):
    p=0xc0+i*24; arr=sptr(p+8); count=int.from_bytes(sm(p+16,4),'little')
    out['codecs'].append({'index':i,'prefix':list(sm(p,3)),'fields':[list(sm(arr+k*3,3)) for k in range(count)]})
out['canonical_codecs']=[]
for prefix,off,n in [(88,0x12,3),(89,0x1b,3),(90,0,2),(88,0x2d,4),(89,0x39,4),(90,0x24,3),(88,0x5d,5),(89,0x45,4),(90,6,2),(82,0x6c,6),(73,0x51,4),(74,0xc,2)]:
    out['canonical_codecs'].append({'prefix':[prefix,0,0],'fields':[list(read(0x443e3c+off+k*3,3)) for k in range(n)]})
(root/'http-sign-program-tables.json').write_text(json.dumps(out,indent=2))
print(json.dumps(out['canonical_codecs'],indent=2))
