import json,struct,re
from pathlib import Path
from common import root
class Reader:
    def __init__(self,b,p=0):self.b=b;self.p=p
    def byte(self):r=self.b[self.p];self.p+=1;return r
    def leb(self,signed=False):
        n=s=0
        while True:
            v=self.byte();n|=(v&127)<<s;s+=7
            if v<128:return n-(1<<s) if signed and v&64 else n
    def string(self):
        n=self.leb();s=self.b[self.p:self.p+n];self.p+=n;return s.decode()
    def expr(self):
        op=self.byte();n=self.leb(True);assert self.byte()==11;return {'op':op,'value':n}
for path in root.glob('module-*.bin'):
    b=path.read_bytes();r=Reader(b,8);out={'imports':[],'exports':[],'data':[],'globals':[],'types':[]}
    while r.p<len(b):
        sid=r.byte();n=r.leb();end=r.p+n
        if sid==1:
            for _ in range(r.leb()):
                assert r.byte()==96
                params=[r.byte() for _ in range(r.leb())];results=[r.byte() for _ in range(r.leb())]
                out['types'].append({'params':params,'results':results})
        elif sid==2:
            for _ in range(r.leb()):
                m=r.string();name=r.string();kind=r.byte()
                if kind==0:extra={'type':r.leb()}
                elif kind==3:extra={'type':r.byte(),'mutable':r.byte()}
                else:raise ValueError(kind)
                out['imports'].append({'module':m,'name':name,'kind':kind,**extra})
        elif sid==6:
            for _ in range(r.leb()):out['globals'].append({'type':r.byte(),'mutable':r.byte(),'init':r.expr()})
        elif sid==7:
            for _ in range(r.leb()):out['exports'].append({'name':r.string(),'kind':r.byte(),'index':r.leb()})
        elif sid==11:
            for _ in range(r.leb()):
                flags=r.leb();off=None if flags==1 else r.expr();length=r.leb();data=b[r.p:r.p+length];r.p+=length
                out['data'].append({'flags':flags,'offset':off,'length':length,'file_offset':hex(r.p-length),'hex':data.hex()})
        elif sid==3:out['functions']=[r.leb() for _ in range(r.leb())]
        if sid in (1,2,3,6,7,11):assert r.p==end,(path.name,sid,r.p,end)
        r.p=end
    path.with_suffix('.metadata.json').write_text(json.dumps(out,indent=2))
    print(path.stem,'imports',len(out['imports']),'exports',len(out['exports']),'data',[(v['length'],v['offset']) for v in out['data']])
