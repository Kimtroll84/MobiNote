"""Bundle the unchanged CommonJS queue engine for a standard browser, with two platform shims."""
from pathlib import Path
import json

def bundle(root):
    factories={}
    for file in (root/'lib').glob('*.cjs'):
        if file.name in {'transport.cjs','storage-paths.cjs'}:continue
        factories['/'+file.relative_to(root).as_posix()]=file.read_text(encoding='utf-8-sig')
    factories['/ui/work-time.js']=(root/'ui/work-time.js').read_text(encoding='utf-8-sig')
    for file in (root/'data').glob('*.json'):
        factories['/'+file.relative_to(root).as_posix()]='module.exports='+file.read_text(encoding='utf-8-sig')+';'
    factories['node:crypto']='module.exports={randomUUID:()=>globalThis.crypto.randomUUID()};'
    factories['node:events']='''class EventEmitter{
      constructor(){this.events=new Map();}
      on(name,fn){if(!this.events.has(name))this.events.set(name,[]);this.events.get(name).push(fn);return this;}
      off(name,fn){this.events.set(name,(this.events.get(name)||[]).filter(x=>x!==fn));return this;}
      once(name,fn){const wrapper=(...args)=>{this.off(name,wrapper);fn(...args);};return this.on(name,wrapper);}
      emit(name,...args){for(const fn of [...(this.events.get(name)||[])])fn(...args);return (this.events.get(name)||[]).length>0;}
    }module.exports={EventEmitter};'''
    source="'use strict';\n(()=>{const factories={\n"+','.join(json.dumps(k)+':function(module,exports,require){\n'+v+'\n}' for k,v in factories.items())+'''
    },cache=new Map();
    function load(id,parent='/'){
      if(id.startsWith('.')){const parts=parent.split('/');parts.pop();for(const part of id.split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part);}id=parts.join('/');}
      if(cache.has(id))return cache.get(id).exports;
      if(!factories[id])throw new Error('Unsupported engine module: '+id);
      const module={exports:{}};cache.set(id,module);factories[id](module,module.exports,next=>load(next,id));return module.exports;
    }globalThis.MobiModules={require:load};})();'''
    # Reuse the exact error/status decoder, not the Node-only process transport.
    transport=(root/'lib/transport.cjs').read_text(encoding='utf-8-sig')
    source+='\n(()=>{'+transport[transport.index('const messages ='):transport.index('class Transport')]+'globalThis.MobiCliDecode=decode;})();\n'
    return source

if __name__=='__main__':
    root=Path(__file__).resolve().parents[1]
    dest=root/'build/engine-bundle.js';dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(bundle(root),encoding='utf-8')
    print(dest.name,dest.stat().st_size)
