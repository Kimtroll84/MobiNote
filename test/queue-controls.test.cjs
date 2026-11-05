'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs');
const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
async function setup(){const db=fixtureDb(),cli=new FakeCli({db,stock:{천:100,광석:100},autoComplete:true});let now=0;const e=new Engine(cli,{}, {db,now:()=>now,delay:async ms=>{now+=ms;await Promise.resolve();}});await e.connect();return {e,cli};}
test('running queue rejects every new job kind without changing saved jobs',async()=>{
 const {e}=await setup();const existing=e.add({kind:'craft',name:'키트',count:1});e.running=true;
 for(const input of [{kind:'gather',name:'광석',count:1},{kind:'craft',name:'키트',count:1},{kind:'materials',name:'A',count:1},{kind:'cycle',facility:'시설',pattern:['B']}])assert.throws(()=>e.add(input),/중단한 뒤/);
 assert.deepEqual(e.queue,[existing]);e.running=false;e.add({kind:'gather',name:'광석',count:1});assert.equal(e.queue.length,2);
});
test('uncertain collection resumes intact slots and preserves completed tasks and counters',async()=>{
 const {e,cli}=await setup();const done=e.add({kind:'craft',name:'키트',count:1});Object.assign(done,{status:'done',completed:1});
 const job=e.add({kind:'materials',name:'A',count:4});Object.assign(job,{status:'stopped',uncertain:true,registered:3,completed:1});
 cli.works=Array.from({length:2},()=>({DisplayName:'A',FacilityName:'시설',State:'Completed',IsCompleted:true}));
 e.ledger.시설=cli.works.map(()=>({name:'A',recipeId:'A',owner:job.id}));
 await e.prepareQueue();assert.equal(job.uncertain,false);assert.equal(job.completed,1);assert.equal(job.registered,3);assert.equal(done.status,'done');
 await e.run();assert.equal(job.completed,4);assert.equal(cli.calls.filter(c=>c.command==='execute_altering').length,1);assert.equal(cli.calls.filter(c=>c.command==='execute_crafting').length,0);
});
test('uncertain registration with extra game slots cannot silently resume',async()=>{
 const {e,cli}=await setup();const job=e.add({kind:'materials',name:'A',count:4});Object.assign(job,{status:'stopped',uncertain:true,registered:1,completed:0});
 e.ledger.시설=[{name:'A',owner:job.id}];cli.works=Array.from({length:2},()=>({DisplayName:'A',FacilityName:'시설',State:'Completed',IsCompleted:true}));
 await assert.rejects(e.prepareQueue(),/실행 결과/);assert.equal(job.uncertain,true);assert.equal(job.status,'stopped');
});
test('whole-queue resume preserves completed work and resumes only remaining amounts',async()=>{
  const {e,cli}=await setup();const done=e.add({kind:'craft',name:'키트',count:1});done.status='done';done.completed=1;
  const stopped=e.add({kind:'craft',name:'키트',count:3});stopped.status='stopped';stopped.completed=1;
  const waiting=e.add({kind:'craft',name:'키트',count:2});assert.equal(e.queueMode(),'resume');
  await e.prepareQueue();assert.equal(done.status,'done');assert.equal(stopped.completed,1);await e.run();
  assert.deepEqual(cli.calls.filter(c=>c.command==='execute_crafting').map(c=>c.body.craftCount),[2,2]);
  assert.equal(stopped.completed,3);assert.equal(waiting.completed,2);assert.equal(e.queueMode(),'restart');
});
test('successful whole queue restarts with original configs and IDs instead of duplicating cards',async()=>{
  const {e,cli}=await setup();const task=e.add({kind:'craft',name:'키트',count:2}),id=task.id;await e.run();
  assert.equal(e.queueMode(),'restart');await e.prepareQueue();assert.equal(e.queue[0].count,2);assert.equal(e.queue[0].completed,0);assert.equal(e.queue[0].id,id);
  await e.run();assert.equal(e.queue.length,1);assert.equal(e.queue[0].completed,2);
  assert.deepEqual(cli.calls.filter(c=>c.command==='execute_crafting').map(c=>c.body.craftCount),[2,2]);
});
test('reset preserves quantity, recipe, order and IDs, but clears counters without game actions',async()=>{
  const {e,cli}=await setup();const a=e.add({kind:'craft',name:'키트',count:24}),b=e.add({kind:'cycle',facility:'시설',pattern:['B','C'],repeatCount:4});
  Object.assign(a,{status:'stopped',completed:6,reduced:true});Object.assign(b,{status:'done',completed:8,nextIndex:8,cycleElapsedMs:5000});const before=cli.calls.length;
  e.resetQueue();assert.equal(cli.calls.length,before);assert.deepEqual(e.queue.map(t=>t.id),[a.id,b.id]);
  assert.equal(e.queue[0].count,24);assert.equal(e.queue[0].recipeId,'kit');assert.equal(e.queue[0].completed,0);
  assert.deepEqual(e.queue[1].pattern,['B','C']);assert.equal(e.queue[1].repeatCount,4);assert.equal(e.queue[1].completed,0);assert.equal(e.queue[1].nextIndex,undefined);
  assert.ok(e.queue.every(t=>t.status==='waiting'));assert.equal(e.queueMode(),'start');
});
for(const kind of ['materials','cycle'])test(`reset excludes already registered game work from new ${kind} counters`,async()=>{
  const {e,cli}=await setup();const task=e.add(kind==='materials'?{kind,name:'B',count:10}:{kind,facility:'시설',pattern:['B','C'],repeatCount:1});
  const oldNames=kind==='materials'?['B','B','B']:['C'];
  cli.works=oldNames.map(DisplayName=>({DisplayName,FacilityName:'시설',State:'Completed',IsCompleted:true,RemainingSeconds:0}));
  e.ledger.시설=oldNames.map(name=>({name,recipeId:name,owner:task.id}));Object.assign(task,{status:'stopped',completed:2,registered:5,nextIndex:5});
  e.resetQueue();assert.ok(e.ledger.시설.every(s=>s.owner===null));await e.run();
  const expected=kind==='materials'?10:2;assert.equal(e.queue[0].completed,expected);
  const registered=cli.calls.filter(c=>c.command==='execute_altering').map(c=>c.body.displayName);assert.equal(registered.length,expected);
  if(kind==='cycle')assert.deepEqual(registered,['B','C']);assert.equal(cli.works.length,kind==='materials'?3:0);
});
test('whole resume rejects uncertain execution but explicit reset clears it without game actions',async()=>{
  const {e,cli}=await setup();const a=e.add({kind:'craft',name:'키트',count:2}),b=e.add({kind:'craft',name:'키트',count:2});a.status='stopped';a.completed=1;b.status='stopped';b.uncertain=true;
  const before=cli.calls.length;await assert.rejects(e.prepareQueue(),/리셋/);
  assert.equal(a.status,'stopped');assert.equal(a.completed,1);assert.equal(cli.calls.length,before);
  e.resetQueue();assert.equal(cli.calls.length,before);assert.equal(e.queueMode(),'start');
  assert.ok(e.queue.every(t=>t.status==='waiting'&&!t.uncertain&&t.completed===0));
  await e.run();assert.deepEqual(cli.calls.filter(c=>c.command==='execute_crafting').map(c=>c.body.craftCount),[2,2]);
});

for(const status of ['held','stopped'])test(`explicit reset recovers ${status} uncertain SET with changed game slots`,async()=>{
  const {e,cli}=await setup();const task=e.add({kind:'cycle',facility:'시설',pattern:['B','C'],repeatCount:1});
  Object.assign(task,{status,uncertain:true,blocked:true,completed:2,nextIndex:4,skipReason:'수령 미확인'});
  e.ledger.시설=['B','B','C'].map(name=>({name,recipeId:name,owner:task.id}));
  cli.works=[{DisplayName:'C',FacilityName:'시설',State:'Completed',IsCompleted:true,RemainingSeconds:0}];
  const before=cli.calls.length;e.resetQueue();assert.equal(cli.calls.length,before);
  assert.ok(e.ledger.시설.every(s=>s.owner===null));assert.equal(e.queue[0].blocked,undefined);assert.equal(e.queue[0].skipReason,undefined);
  await e.run();assert.equal(e.queue[0].status,'done');assert.equal(e.queue[0].completed,2);
  assert.deepEqual(cli.calls.filter(c=>c.command==='execute_altering').map(c=>c.body.displayName),['B','C']);
});
test('material-shortage-only queues offer restart and recheck materials on a fresh run',async()=>{
  const {e,cli}=await setup();cli.stock.천=0;await e.inventory();const task=e.add({kind:'craft',name:'키트',count:2});await e.run();assert.equal(task.status,'skipped');assert.equal(e.queueMode(),'restart');
  cli.stock.천=4;await e.prepareQueue();await e.run();assert.equal(e.queue[0].completed,2);assert.equal(e.queueMode(),'restart');
});
test('queues with unavailable materials can repeatedly restart the available jobs without rearming only the shortage',async()=>{
  const {e,cli}=await setup();cli.stock.천=0;await e.inventory();e.add({kind:'craft',name:'키트',count:2});e.add({kind:'gather',name:'광석',count:1});
  for(let run=0;run<3;run++){if(run)await e.prepareQueue();await e.run();assert.equal(e.queue[0].status,'skipped');assert.equal(e.queue[1].status,'done');assert.equal(e.queueMode(),'restart');}
  assert.equal(cli.calls.filter(c=>c.command==='execute_gathering').length,3);assert.equal(cli.calls.filter(c=>c.command==='execute_crafting').length,0);assert.equal(e.queue.length,2);
});
test('a real stopped task still resumes remaining work while a shortage task stays skipped',async()=>{
  const {e,cli}=await setup();const skipped=e.add({kind:'craft',name:'키트',count:2}),stopped=e.add({kind:'craft',name:'키트',count:3});
  skipped.status='skipped';stopped.status='stopped';stopped.completed=1;assert.equal(e.queueMode(),'resume');
  await e.prepareQueue();assert.equal(skipped.status,'skipped');assert.equal(stopped.completed,1);await e.run();
  assert.deepEqual(cli.calls.filter(c=>c.command==='execute_crafting').map(c=>c.body.craftCount),[2]);assert.equal(e.queueMode(),'restart');
});
