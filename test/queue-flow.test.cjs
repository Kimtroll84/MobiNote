'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs');
const M=require('../lib/model.cjs');
const Time=require('../ui/work-time.js');
const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
async function setup(autoComplete=true){
  const db=fixtureDb(),cli=new FakeCli({db,stock:{천:100,광석:100},autoComplete});let clock=0;
  const e=new Engine(cli,{}, {db,now:()=>clock,delay:async ms=>{clock+=ms;await Promise.resolve();}});await e.connect();return {e,cli,db};
}

test('startup fills SET and another processing facility before gathering for crafting',async()=>{
  const {e,cli,db}=await setup();cli.stock.광석=0;
  db.materials.find(r=>r.id==='C').facility='다른 시설';db.facilities.push({name:'다른 시설'});
  const set=e.add({kind:'cycle',facility:'시설',pattern:['B'],repeatCount:7});
  const material=e.add({kind:'materials',name:'C',count:10});e.add({kind:'craft',name:'키트',count:1});
  cli.works=[{DisplayName:'C',FacilityName:'다른 시설',State:'Completed',IsCompleted:true,RemainingSeconds:0}];
  await e.run();const actions=cli.calls.filter(c=>/^execute_|complete_altering/.test(c.command));
  const firstGather=actions.findIndex(c=>c.command==='execute_gathering');
  assert.equal(actions.slice(0,firstGather).filter(c=>c.command==='execute_altering'&&c.body.displayName==='B').length,7);
  assert.equal(actions.slice(0,firstGather).filter(c=>c.command==='execute_altering'&&c.body.displayName==='C').length,7);
  assert.equal(set.completed,7);assert.equal(material.completed,10);
  assert.equal(actions.filter(c=>c.command==='execute_altering'&&c.body.displayName==='C').length,10);
});
test('SET registers first; a full facility defers ordinary processing until after the next ordinary bubble',async()=>{
  const {e,cli}=await setup();const set=e.add({kind:'cycle',facility:'시설',pattern:['B'],repeatCount:14});
  const material=e.add({kind:'materials',name:'A',count:2}),craft=e.add({kind:'craft',name:'키트',count:1});
  await e.run();const actions=cli.calls.filter(c=>['execute_altering','execute_crafting','complete_altering_work'].includes(c.command));
  assert.deepEqual(actions.slice(0,7).map(c=>c.body.displayName),Array(7).fill('B'));
  assert.equal(actions[7].command,'execute_crafting');assert.equal(actions[8].command,'complete_altering_work');
  assert.deepEqual(actions.slice(9,11).map(c=>c.body.displayName),['A','A']);
  assert.equal(set.completed,14);assert.equal(material.completed,2);assert.equal(craft.completed,1);assert.equal(e.terminal.type,'done');
});
test('waiting processing keeps the queue active and retries without repeating completed ordinary work',async()=>{
  const {e,cli}=await setup(false);const material=e.add({kind:'materials',name:'A',count:1}),craft=e.add({kind:'craft',name:'키트',count:1});let waits=0;
  e.delay=async ms=>{if(ms!==5000){await Promise.resolve();return;}assert.equal(e.running,true);if(++waits===2)for(const w of cli.works)Object.assign(w,{State:'Completed',IsCompleted:true,RemainingSeconds:0});};
  await e.run();assert.equal(waits,2);assert.equal(material.completed,1);assert.equal(craft.completed,1);
  assert.equal(cli.calls.filter(c=>c.command==='execute_crafting').length,1);assert.equal(cli.calls.filter(c=>c.command==='execute_altering').length,1);assert.equal(e.terminal.type,'done');
});
test('a multi-batch ordinary craft finishes before any SET collection or refill',async()=>{
  const {e,cli}=await setup();const original=cli.action.bind(cli);
  cli.action=async(command,body)=>{if(command==='execute_crafting'&&body.craftCount>1){const err=new Error('count');err.code='invalid_count';err.body={maxCount:1};throw err;}return original(command,body);};
  e.add({kind:'cycle',facility:'시설',pattern:['B'],repeatCount:10});e.add({kind:'craft',name:'키트',count:3});await e.run();
  const calls=cli.calls;const craftIndices=calls.flatMap((c,i)=>c.command==='execute_crafting'?[i]:[]);assert.equal(craftIndices.length,3);
  const firstCollect=calls.findIndex(c=>c.command==='complete_altering_work');assert.ok(firstCollect>craftIndices.at(-1));
});
test('running queues reject remove and reorder for every task state, then allow editing after stop',async()=>{
  const {e}=await setup();const a=e.add({kind:'craft',name:'키트',count:1}),b=e.add({kind:'materials',name:'A',count:1});
  e.running=true;a.status='running';assert.throws(()=>e.remove(a.id),/중단/);assert.throws(()=>e.remove(b.id),/중단/);assert.throws(()=>e.reorder([b.id,a.id]),/중단/);
  assert.deepEqual(e.queue.map(t=>t.id),[a.id,b.id]);assert.notEqual(a.cancelled,true);
  e.running=false;a.status='stopped';e.reorder([b.id,a.id]);e.remove(a.id);assert.deepEqual(e.queue.map(t=>t.id),[b.id]);
});
test('finite SET wing estimates include weighted registrations and shared gathering, without affecting infinity',()=>{
  const db=fixtureDb(),task={kind:'cycle',pattern:['A','A','B'],repeatCount:3,gatherBatches:10};
  assert.equal(M.estimate(task,{천:3,광석:0},new Set(['광석']),db),50);
  assert.equal(M.estimate({...task,repeatCount:null},{},new Set(),db),null);
  assert.equal(M.estimate({...task,gatherBatches:0},{천:3,광석:4},new Set(['광석']),db),25);
});
test('display countdown advances each second without mutating server work or assuming completion',()=>{
  const work={DisplayName:'A',RemainingSeconds:3,State:'InProgress'};
  assert.equal(Time.remainingAt(work,1000,2999),2);assert.equal(Time.remainingAt(work,1000,4000),0);assert.equal(work.RemainingSeconds,3);
  assert.equal(Time.progress({...work,RemainingSeconds:0},[{name:'A',durationSeconds:3}]),99);
  assert.equal(Time.remainingAt({...work,State:'NotStarted'},1000,9000),3);assert.equal(Time.remainingAt(work,undefined,9000),3);
  assert.equal(Time.remainingAt(work,1000,500),3);assert.equal(Time.remainingAt({...work,IsCompleted:true},1000,1000),0);
});
