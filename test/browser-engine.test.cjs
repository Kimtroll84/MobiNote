'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {FakeCli,fixtureDb}=require('./fake-cli.cjs'),{Engine:NodeEngine}=require('../lib/engine.cjs');
const context=vm.createContext({crypto:crypto.webcrypto,structuredClone,setTimeout,clearTimeout});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../build/engine-bundle.js'),'utf8'),context);
const BrowserEngine=context.MobiModules.require('/lib/engine.cjs').Engine;
async function run(Engine){
 const db=fixtureDb(),cli=new FakeCli({db,stock:{천:100,광석:100},autoComplete:true});
 const e=new Engine(cli,{}, {db,delay:async()=>{await Promise.resolve();}});await e.connect();
 e.add({kind:'craft',name:'키트',count:3});e.add({kind:'materials',name:'A',recipeId:'A',count:2});await e.run();
 return JSON.parse(JSON.stringify({results:e.terminal.results,queue:e.queue.map(t=>({kind:t.kind,status:t.status,completed:t.completed})),stock:cli.stock,terminal:e.terminal.type}));
}
test('browser bundle runs the same craft/processing queue and results as the verified Node engine',async()=>assert.deepEqual(await run(BrowserEngine),await run(NodeEngine)));
test('browser CLI decoder preserves interrupted response details',()=>{
 const decode=context.MobiCliDecode;assert.throws(()=>decode(JSON.stringify({status:'accepted',body:{error:'blocked',kind:'unknown_modal',message:'UI blocked'}})),error=>error.code==='blocked'&&error.body.kind==='unknown_modal'&&error.responseStatus==='accepted');
});
test('browser CLI decoder rejects expired requests and parses JSON-string error bodies',()=>{
 assert.throws(()=>context.MobiCliDecode(JSON.stringify({status:'expired',body:{}})),e=>e.code==='expired');
 assert.throws(()=>context.MobiCliDecode(JSON.stringify({status:'rejected',body:JSON.stringify({error:'rate_limited',retryAfterSeconds:3})})),e=>e.body.retryAfterSeconds===3);
});
