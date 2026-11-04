'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs'),{FakeCli,fixtureDb}=require('./fake-cli.cjs'),{decode}=require('../lib/transport.cjs');
async function setup(enabled=true){
 const db=fixtureDb(),cli=new FakeCli({db,stock:{천:100,광석:100},autoComplete:true}),waits=[];
 const e=new Engine(cli,{retryInterrupted:enabled},{db,delay:async ms=>{waits.push(ms);await Promise.resolve();}});await e.connect();return {e,cli,waits};
}
function blocked(){try{decode(JSON.stringify({error:'blocked',kind:'unknown_modal',gained:1}));}catch(e){return e;}}
test('retry defaults off and its preference survives persistence and snapshot',()=>{
 const e=new Engine(new FakeCli());assert.equal(e.snapshot().preferences.retryInterrupted,false);
 e.preferences.retryInterrupted=true;assert.equal(new Engine(new FakeCli(),e.persistent()).snapshot().preferences.retryInterrupted,true);
});
for(const enabled of [false,true])test(`game-stopped crafting retries only when enabled=${enabled}`,async()=>{
 const {e,cli,waits}=await setup(enabled),action=cli.action.bind(cli);let starts=0;
 cli.action=async(cmd,body)=>{if(cmd==='execute_crafting'&&++starts===1)return {result:'stopped_by_user'};return action(cmd,body);};
 const task=e.add({kind:'craft',name:'키트',count:2});await e.run();
 assert.equal(starts,enabled?2:1);assert.equal(task.completed,enabled?2:0);if(enabled)assert.ok(waits.reduce((a,b)=>a+b,0)>=5000);
});
test('bare blocked gathering response preserves gains and resumes only the remainder',async()=>{
 const {e,cli}=await setup(),action=cli.action.bind(cli);let starts=0;
 cli.action=async(cmd,body)=>{if(cmd==='execute_gathering'&&++starts===1){cli.stock.광석++;throw blocked();}return action(cmd,body);};
 const task=e.add({kind:'gather',name:'광석',count:2});await e.run();
 assert.equal(starts,2);assert.equal(task.completed,2);assert.equal(e.terminal.type,'done');
});
test('interrupted gathering at the target does not spend wings on another request',async()=>{
 const {e,cli}=await setup();let starts=0;
 cli.action=async cmd=>{if(cmd==='execute_gathering'){starts++;cli.stock.광석++;throw blocked();}return {};};
 const task=e.add({kind:'gather',name:'광석',count:1});await e.run();assert.equal(starts,1);assert.equal(task.completed,1);assert.equal(e.terminal.type,'done');
});
test('app stop during retry wait prevents any new paid command',async()=>{
 const {e,cli}=await setup();let starts=0;
 cli.action=async cmd=>{if(cmd==='execute_crafting'){starts++;return {result:'stopped_by_user'};}return {};};
 e.delay=async()=>{if(e.stage.type==='action-retry')await e.stop();};
 e.add({kind:'craft',name:'키트',count:1});await e.run();assert.equal(starts,1);assert.equal(e.terminal.type,'stopped');
});
test('timeout remains uncertain even with the retry option on',async()=>{
 const {e,cli}=await setup();let starts=0;
 cli.action=async cmd=>{if(cmd==='execute_crafting'){starts++;throw Object.assign(new Error('timeout'),{code:'timeout'});}return {};};
 const task=e.add({kind:'craft',name:'키트',count:1});await e.run();assert.equal(starts,1);assert.equal(task.uncertain,true);
});
for(const changed of [false,true])test(`processing interruption checks facility outcome before replay (changed=${changed})`,async()=>{
 const {e,cli}=await setup(),action=cli.action.bind(cli);let starts=0;
 cli.action=async(cmd,body)=>{if(cmd==='execute_altering'&&++starts===1){if(changed)await action(cmd,body);throw blocked();}return action(cmd,body);};
 e.add({kind:'materials',name:'A',count:1});await e.run();assert.equal(starts,changed?1:2);
 if(!changed)assert.equal(e.terminal.type,'done');
});
test('both agent voices explain automatic retry in Korean',()=>{
 require('../ui/agent-personality.js');
 for(const voice of ['A','B'])assert.match(globalThis.AgentDialogue.copy({type:'action-retry'},voice).message,/다시/);
});
