const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
 let buttons=[],rebuilds=0;const events={},calls=[],waiting=[];
 const products={querySelectorAll:()=>buttons,set innerHTML(v){rebuilds++;buttons=[...v.matchAll(/data-id="([^"]+)"/g)].map(m=>({dataset:{id:m[1]},disabled:false,classList:{toggle(){}},querySelector(){return this.small||(this.small={});}}));}};
 const elements={products,facility:{dataset:{}},error:{}};
 const data={facility:'시설',facilities:[{name:'시설'}],products:[{id:'A',name:'A',produced:3,ingredients:[{name:'천',required:2}]}],stock:{천:14},owned:{},gatherables:[],free:7,running:false};
 const native={on:(event,fn)=>events[event]=fn,call:(method,body)=>{if(body?.command==='bootstrap')return Promise.resolve(structuredClone(data));calls.push(body);return new Promise((resolve,reject)=>waiting.push({resolve,reject}));}};
 const context=vm.createContext({document:{getElementById:id=>elements[id],addEventListener(){}},MobiNative:native,structuredClone});vm.runInContext(fs.readFileSync(require.resolve('../ui/picker.js'),'utf8'),context);
 return {context,elements,events,calls,waiting,data,buttons:()=>buttons,rebuilds:()=>rebuilds};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('seven selections update immediately before any native response, preserve buttons and reserve all slots',async()=>{
 const f=fixture();await tick();const button=f.buttons()[0];const start=performance.now();
 for(let i=0;i<7;i++)button.onclick();
 assert.equal(vm.runInContext('data.free',f.context),0);assert.equal(vm.runInContext('data.stock.천',f.context),0);assert.equal(button.disabled,true);assert.equal(f.rebuilds(),1);assert.ok(performance.now()-start<1000);
 await tick();assert.equal(f.calls.length,1);
 for(let i=0;i<7;i++){const snapshot=structuredClone(f.data);snapshot.free=6-i;snapshot.stock.천=12-i*2;f.waiting.shift().resolve(snapshot);await tick();}
 assert.equal(f.calls.length,7);assert.equal(vm.runInContext('pending.length',f.context),0);assert.equal(f.rebuilds(),1);assert.equal(f.buttons()[0],button);
});
test('manual material shortage blocks further selection immediately and rejected selection restores stock',async()=>{
 const f=fixture();await tick();const next=structuredClone(f.data);next.stock.천=2;f.events['picker-state'](next);f.buttons()[0].onclick();assert.equal(f.buttons()[0].disabled,true);await tick();f.waiting.shift().reject(new Error('빈 슬롯이 없어요.'));await tick();assert.equal(f.buttons()[0].disabled,false);assert.equal(vm.runInContext('data.stock.천',f.context),2);assert.equal(f.elements.error.hidden,false);
});
test('pending selections ignore stale external snapshots and preserve material reservations',async()=>{
 const f=fixture();await tick();f.buttons()[0].onclick();f.buttons()[0].onclick();f.events['picker-state'](f.data);assert.equal(vm.runInContext('data.free',f.context),5);await tick();for(let i=0;i<2;i++){const next=structuredClone(f.data);next.free=6-i;next.stock.천=12-i*2;f.waiting.shift().resolve(next);await tick();}assert.equal(vm.runInContext('data.free',f.context),5);
});
