from common import *
cs=Cs(CS_ARCH_ARM64,CS_MODE_ARM);cs.skipdata=True
calls=[0x2d3600,0x2d64c8,0x2d8864,0x2d9a18,0x2db93c,0x2dd318,0x2dea44,0x2df808,0x32fd08,0x36df58]
allout=[]
for call in calls:
    instructions=list(cs.disasm(read(call-0x5000,0x5000),call-0x5000))
    lastret=max(i for i,ins in enumerate(instructions) if ins.mnemonic=='ret')
    regs={'zr':0,'sp':0};mem={}
    def val(r):
        if r.startswith('#'):return int(r[1:],0)
        return regs.get(r.lstrip('xw') if r!='sp' else r)
    def sm(a,n):return bytes(mem[a+i] for i in range(n))
    def sptr(a):return int.from_bytes(sm(a,8),'little')
    for ins in instructions[lastret+1:]:
        a=ins.op_str.split(', ')
        if ins.mnemonic in ('adrp','adr','mov'):
            regs[a[0].lstrip('xw')]=val(a[1])
        elif ins.mnemonic in ('add','sub'):
            if a[0]=='sp':continue
            v1,v2=val(a[1]),val(a[2])
            regs[a[0].lstrip('xw')]=None if v1 is None or v2 is None else (v1+v2 if ins.mnemonic=='add' else v1-v2)
        elif ins.mnemonic=='movk':
            dest=a[0].lstrip('xw');old=regs.get(dest)
            shift=int(a[2].split('#')[1],0) if len(a)>2 else 0
            regs[dest]=None if old is None else (old&~(65535<<shift))|(val(a[1])<<shift)
        elif ins.mnemonic in ('str','strb','strh'):
            m=re.fullmatch(r'(\w+), \[sp(?:, #(0x[0-9a-f]+|\d+))?\]',ins.op_str)
            if not m:continue
            r,o=m.groups();o=int(o or '0',0);v=val(r)
            size={'strb':1,'strh':2}.get(ins.mnemonic,4 if r.startswith('w') else 8)
            if v is not None:
                for k,z in enumerate((v&((1<<(size*8))-1)).to_bytes(size,'little')):mem[o+k]=z
        elif ins.mnemonic in ('bl','blr'):
            for i in range(19):regs[str(i)]=None
    try:
        program=val('x0');length=val('x1');codecs=sptr(0);count=sptr(8) if all(8+k in mem for k in range(8)) else int.from_bytes(sm(8,4),'little')
        out={'loader_call':hex(call),'blob':hex(program),'length':length,'callbacks':[],'globals':[],'codecs':[]}
        for i in range(count):
            p=codecs+i*24;arr=sptr(p+8);n=int.from_bytes(sm(p+16,4),'little')
            out['codecs'].append({'prefix':list(sm(p,3)),'fields':[list(sm(arr+k*3,3)) for k in range(n)]})
        for group,addr,n in [('callbacks',val('x4'),val('x5')),('globals',val('x6'),val('x7'))]:
            for i in range(n):
                p=addr+i*24
                out[group].append({'name':string(sptr(p)),'address':hex(sptr(p+8))})
        key=out['codecs'][length%count]['prefix'][2]
        data=bytes(v^key for v in read(program,length))
        out['xor']=key
        out['strings']=[v.decode() for v in re.findall(rb'[ -~]{5,}',data) if any(t.lower() in v.lower() for t in [b'argus',b'gorgon',b'ladon',b'http',b'sign',b'init',b'token',b'stub',b'client'])]
        name=f'module-{call:x}'
        (root/(name+'.bin')).write_bytes(data)
        (root/(name+'.json')).write_text(json.dumps(out,indent=2))
        allout.append(out)
        print(hex(call),hex(program),length,'xor',key,'hosts',len(out['callbacks']),out['strings'])
    except (KeyError,TypeError,ValueError) as e:print('INCOMPLETE',hex(call),repr(e),'start',hex(instructions[lastret+1].address))
(root/'native-program-modules.json').write_text(json.dumps(allout,indent=2))
