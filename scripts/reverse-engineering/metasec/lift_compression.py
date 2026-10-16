"""Lift the straight-line 64-round compression function to source; never execute VM code."""
import json, re
from pathlib import Path
from common import root
lines=(root/'module-2df808.ir.txt').read_text().split('FUNCTION 7')[1].strip().splitlines()
regs={i:('saved',i) for i in range(32)}
regs.update({0:0,1:('ptr','stack',0),8:('ptr','state',0),9:('ptr','block',0)})
stack={}; nodes=[]; output={}; rotations=[]
def node(op,*args):
    if op in ('or','xor','and','add') and all(isinstance(x,int) for x in args):
        a,b=args
        return {'or':lambda:a|b,'xor':lambda:a^b,'and':lambda:a&b,'add':lambda:(a+b)&0xffffffff}[op]()
    if op in ('shl','ror') and isinstance(args[0],int):
        a,n=args;return ((a<<n) if op=='shl' else ((a&0xffffffff)>>n)|(a<<(32-n)))&0xffffffff
    n=('n',len(nodes));nodes.append((op,*args));return n
def addptr(p,n):
    assert p[0]=='ptr'
    return ('ptr',p[1],p[2]+n)
for line in lines:
    m=re.match(r'(\d+) ([0-9a-f]{8}) IR([0-9a-f]+)',line);assert m,line
    pc,w,ir=int(m[1]),int(m[2],16),int(m[3],16)
    rs,rt,rd,sa=(w>>21)&31,(w>>16)&31,(w>>11)&31,(w>>6)&31
    imm=w&65535;simm=imm if imm<32768 else imm-65536
    if ir==0x316:continue
    if ir==0x17:regs[rt]=addptr(regs[rs],simm)
    elif ir==0x3e:regs[rd]=regs[rs]
    elif ir in (0x2c,0x34):
        p=addptr(regs[rs],simm);size=8 if ir==0x2c else 4
        if p[1]=='stack':stack[(p[2],size)]=regs[rt]
        else:
            assert p[1]=='state' and size==4
            output[(p[2]-8)//4]=regs[rt]
    elif ir in (0x7d,0x4d,0x49):
        p=addptr(regs[rs],simm);size={0x7d:8,0x4d:4,0x49:1}[ir]
        if p[1]=='stack':regs[rt]=stack[(p[2],size)]
        elif p[1]=='state':
            assert size==4 and 8<=p[2]<24
            regs[rt]=node('state',(p[2]-8)//4)
        elif p[1]=='block':
            assert size==1 and 0<=p[2]<64
            regs[rt]=node('byte',p[2])
    elif ir==3:regs[rt]=(imm<<16)&0xffffffff
    elif ir==0x30:regs[rt]=node('or',regs[rs],imm)
    elif ir==9:regs[rd]=node('shl',regs[rt],sa)
    elif ir==0x46:
        regs[rd]=node('ror',regs[rt],sa);rotations.append({'pc':pc,'node':regs[rd][1],'right':sa})
    elif ir in (0x3c,0x1b,0x60,0xab,0xb2):regs[rd]=node({0x3c:'or',0x1b:'xor',0x60:'and',0xab:'add',0xb2:'nor'}[ir],regs[rs],regs[rt])
    elif ir==0xbd:break
    else:raise ValueError((pc,hex(ir)))
assert len(rotations)==64 and set(output)==set(range(4))
out={'source_module':'2df808','function':7,'nodes':nodes,'output':[output[i] for i in range(4)],'rotations':rotations}
(root/'medusa-compression.dag.json').write_text(json.dumps(out,indent=2))
def arg(v):
    if isinstance(v,int):return f'0x{v:08x}'
    assert v[0]=='n',v
    return f'v{v[1]}'
js=['// Static arithmetic translation of official module 0x4420f0, F7.','// Not a complete signature provider.','function compress(state, block) {']
for i,(op,*a) in enumerate(nodes):
    if op=='state':expr=f'state[{a[0]}] | 0'
    elif op=='byte':expr=f'block[{a[0]}]'
    elif op in ('or','xor','and'):expr=f'{arg(a[0])} '+{'or':'|','xor':'^','and':'&'}[op]+f' {arg(a[1])}'
    elif op=='add':expr=f'({arg(a[0])} + {arg(a[1])}) | 0'
    elif op=='nor':expr=f'~({arg(a[0])} | {arg(a[1])})'
    elif op=='shl':expr=f'{arg(a[0])} << {a[1]}'
    elif op=='ror':expr=f'({arg(a[0])} >>> {a[1]}) | ({arg(a[0])} << {32-a[1]})'
    else:raise ValueError(op)
    js.append(f'  const v{i} = {expr}')
js.append('  return ['+', '.join(arg(output[i])+' >>> 0' for i in range(4))+']\n}\nmodule.exports = { compress }\n')
(root/'medusa-compression-lift.cjs').write_text('\n'.join(js))
print('lifted nodes',len(nodes),'rotations',len(rotations),'outputs',out['output'])
print('rotation sequence',[x['right'] for x in rotations])
