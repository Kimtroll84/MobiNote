'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs');
const {decode}=require('../lib/transport.cjs');
const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
async function setup(){const db=fixtureDb(),cli=new FakeCli({db,stock:{천:100,광석:100},autoComplete:true});let clock=0;const waits=[];
  const advance=async ms=>{clock+=ms;waits.push(ms);await Promise.resolve();};const e=new Engine(cli,{}, {db,now:()=>clock,delay:advance});await e.connect();waits.length=0;return {e,cli,advance,waits};}
const rejected=(code,status='rejected')=>decode(JSON.stringify({status,body:{error:code}}));
test('obsolete unrelated facility records resynchronize and never credit an old job to the new task',async()=>{
  const {e}=await setup();e.ledger.시설=Array.from({length:7},()=>({name:'B',owner:'deleted-job'}));
  const job=e.add({kind:'materials',name:'A',count:2}),next=e.add({kind:'craft',name:'키트',count:1});await e.run();
  assert.equal(e.terminal.type,'done');assert.equal(job.completed,2);assert.equal(next.completed,1);assert.equal(e.ledger.시설.length,0);
});
test('unexpected disappearance of a slot belonging to a current queue job still stops execution',async()=>{
  const {e,cli}=await setup();const job=e.add({kind:'materials',name:'A',count:1});e.ledger.시설=[{name:'B',owner:job.id}];await e.run();
  assert.equal(e.terminal.type,'done');assert.equal(job.status,'held');assert.equal(cli.calls.some(c=>c.command==='execute_altering'),false);
});
for(const includeNewCompletion of [false,true])test(`collection accepts another work completing in transit (collected together=${includeNewCompletion})`,async()=>{
  const {e,cli}=await setup();const job=e.add({kind:'cycle',facility:'시설',pattern:['A','B'],repeatCount:1});job.status='running';e.running=true;
  cli.works=[{DisplayName:'A',FacilityName:'시설',State:'Completed',IsCompleted:true,RemainingSeconds:0},{DisplayName:'B',FacilityName:'시설',State:'InProgress',IsCompleted:false,RemainingSeconds:1}];
  e.ledger.시설=[{name:'A',owner:job.id,recipeId:'A'},{name:'B',owner:job.id,recipeId:'B'}];await e.readWorks();const action=cli.action.bind(cli);
  cli.action=async(command,body)=>{if(command==='complete_altering_work'&&includeNewCompletion)Object.assign(cli.works[1],{State:'Completed',IsCompleted:true,RemainingSeconds:0});const result=await action(command,body);if(command==='complete_altering_work'&&!includeNewCompletion)Object.assign(cli.works[0],{State:'Completed',IsCompleted:true,RemainingSeconds:0});return result;};
  await e.collectFacility('시설',job);assert.equal(job.uncertain,false);assert.equal(job.completed,includeNewCompletion?2:1);assert.equal(e.ledger.시설.length,includeNewCompletion?0:1);
  if(!includeNewCompletion){cli.action=action;await e.collectFacility('시설',job);assert.equal(job.completed,2);}
  assert.deepEqual(job.productCompleted,{A:1,B:1});
});
test('unexpected extra slot removal without collection acknowledgement still remains uncertain',async()=>{
  const {e,cli}=await setup();const job=e.add({kind:'materials',name:'A',count:1});e.running=true;
  cli.works=[{DisplayName:'A',FacilityName:'시설',State:'Completed',IsCompleted:true},{DisplayName:'B',FacilityName:'시설',State:'InProgress',RemainingSeconds:100}];
  e.ledger.시설=[{name:'A',owner:job.id},{name:'B',owner:job.id}];await e.readWorks();cli.action=async()=>{cli.works=[];return {};};
  assert.equal(await e.collectFacility('시설',job),null);assert.equal(job.status,'held');assert.equal(job.uncertain,true);assert.equal(job.completed,0);
});
for(const failures of [1,2,3])test(`read timeout retries are bounded: ${failures} failure(s)`,async()=>{
  const {e,cli,waits}=await setup(),read=cli.read.bind(cli);let attempts=0;
  cli.read=async(command,...args)=>{if(command==='get_items'&&++attempts<=failures)throw Object.assign(new Error('read timeout'),{code:'timeout'});return read(command,...args);};
  e.add({kind:'craft',name:'키트',count:1});await e.run();assert.equal(e.terminal.type,'done');
  assert.equal(waits.filter(n=>n===1000).length,failures);
});
for(const kind of ['craft','materials'])test(`unavailable ${kind} skips only that job and continues the queue`,async()=>{
  const {e,cli}=await setup(),read=cli.read.bind(cli),command=kind==='craft'?'get_craftable_items':'get_alterable_items';
  cli.stock.광석=0;
  cli.read=async(cmd,...args)=>{const data=await read(cmd,...args);if(cmd===command)for(const r of data.items){r[kind==='craft'?'Craftable':'Alterable']=false;r.Reason='insufficient_facility_level';}return data;};
  const job=e.add({kind,name:kind==='craft'?'키트':'A',count:1}),next=e.add({kind:'gather',name:'광석',count:1});await e.run();
  assert.equal(job.status,'skipped');assert.equal(job.uncertain||false,false);assert.match(job.skipReason,/건너뛰/);assert.equal(next.status,'done');assert.equal(e.terminal.type,'done');
  assert.equal(cli.calls.filter(c=>c.command==='execute_gathering').length,1);
});
test('a recipe missing during initial preparation skips its job rather than stopping the queue',async()=>{
  const {e,cli}=await setup(),read=cli.read.bind(cli);cli.read=async(command,...args)=>command==='get_craftable_items'?{items:[]}:read(command,...args);
  const job=e.add({kind:'craft',name:'키트',count:1}),next=e.add({kind:'gather',name:'광석',count:1});await e.run();assert.equal(job.status,'skipped');assert.equal(next.status,'done');
});
test('explicit ingredient rejection rechecks and reduces the craft quantity once, without repeating the failed amount',async()=>{
  const {e,cli}=await setup(),action=cli.action.bind(cli);const counts=[];
  cli.action=async(command,body)=>{if(command==='execute_crafting'){counts.push(body.craftCount);if(counts.length===1){cli.stock.천=2;return rejected('not_enough_ingredient');}}return action(command,body);};
  const job=e.add({kind:'craft',name:'키트',count:3}),next=e.add({kind:'gather',name:'광석',count:1});await e.run();
  assert.deepEqual(counts,[3,1]);assert.equal(job.completed,1);assert.equal(job.reduced,true);assert.equal(job.uncertain,false);assert.equal(next.status,'done');
});
test('explicit ingredient rejection at zero capacity skips the job and permits restart rather than unsafe resume',async()=>{
  const {e,cli}=await setup(),action=cli.action.bind(cli);cli.action=async(command,body)=>{if(command==='execute_crafting'){cli.stock.천=0;return rejected('not_enough_ingredient');}return action(command,body);};
  const job=e.add({kind:'craft',name:'키트',count:1}),next=e.add({kind:'gather',name:'광석',count:1});await e.run();assert.equal(job.status,'skipped');assert.equal(job.uncertain,false);assert.equal(next.status,'done');assert.equal(e.queueMode(),'restart');
});
test('an explicit recipe rejection stops SET registration but drains its confirmed work and permits other jobs',async()=>{
  const {e,cli}=await setup(),action=cli.action.bind(cli);let calls=0;cli.action=async(command,body)=>{if(command==='execute_altering'&&++calls===2)return rejected('insufficient_facility_level');return action(command,body);};
  const job=e.add({kind:'cycle',facility:'시설',pattern:['B'],repeatCount:2}),next=e.add({kind:'gather',name:'광석',count:1});await e.run();
  assert.equal(job.completed,1);assert.equal(job.status,'skipped');assert.equal(job.uncertain,false);assert.equal(cli.works.length,0);assert.equal(next.status,'done');
});
for(const status of ['accepted',undefined])test(`unconfirmed paid action failure remains stopped (response=${status})`,async()=>{
  const {e,cli}=await setup(),action=cli.action.bind(cli);let attempts=0;cli.action=async(command,body)=>{if(command==='execute_crafting'){attempts++;return rejected('not_enough_ingredient',status??null);}return action(command,body);};
  const job=e.add({kind:'craft',name:'키트',count:1}),next=e.add({kind:'gather',name:'광석',count:1});await e.run();assert.equal(e.terminal.type,'error');assert.equal(job.uncertain,true);assert.equal(next.status,'waiting');assert.equal(attempts,1);
});
for(const travelling of [false,true])test(`busy character waits for idle without issuing a stop (auto travel=${travelling})`,async()=>{
  const {e,cli}=await setup(),read=cli.read.bind(cli);let queries=0;const busyCount=travelling?45:8;
  cli.read=async(command,...args)=>command==='get_activity'?{autoTravel:{IsAutoTraveling:travelling&&queries<busyCount},Mode:{MainButtonState:++queries<=busyCount?'Stop':'Compass'}}:read(command,...args);
  e.add({kind:'craft',name:'키트',count:1});await e.run();assert.equal(e.terminal.type,'done');assert.equal(cli.calls.some(c=>c.command==='stop_action'),false);
});
test('ongoing activity longer than 30 seconds resumes when idle',async()=>{
  const {e,cli,waits}=await setup(),read=cli.read.bind(cli);let n=0;cli.read=async(command,...args)=>command==='get_activity'?{Mode:{MainButtonState:++n<=40?'Stop':'Compass'}}:read(command,...args);
  e.add({kind:'craft',name:'키트',count:1});await e.run();assert.equal(e.terminal.type,'done');assert.equal(waits.filter(n=>n===1000).length,40);
});
test('user stop remains responsive while waiting for automatic travel to finish',async()=>{
  const {e,cli,advance}=await setup(),read=cli.read.bind(cli);let waits=0;cli.read=async(command,...args)=>command==='get_activity'?{autoTravel:{IsAutoTraveling:true}}:read(command,...args);
  e.delay=async ms=>{await advance(ms);if(++waits===2)e.stop();};e.add({kind:'craft',name:'키트',count:1});await e.run();assert.equal(e.terminal.type,'stopped');assert.equal(waits,2);
});
test('a rejected blocked command retries after waiting and completes once',async()=>{
  const {e,cli}=await setup(),action=cli.action.bind(cli);let attempts=0;cli.action=async(command,body)=>command==='execute_crafting'&&++attempts<=3?rejected('blocked'):action(command,body);
  const job=e.add({kind:'craft',name:'키트',count:1});await e.run();assert.equal(e.terminal.type,'done');assert.equal(job.uncertain,false);assert.equal(job.completed,1);assert.equal(attempts,4);
});
