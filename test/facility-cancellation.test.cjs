'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs');
const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
async function setup(){const db=fixtureDb(),cli=new FakeCli({db,stock:{천:100,광석:100},autoComplete:true});const e=new Engine(cli,{}, {db,delay:async()=>{await Promise.resolve();}});await e.connect();return {e,cli};}
const work=name=>({DisplayName:name,FacilityName:'시설',State:'Completed',IsCompleted:true,RemainingSeconds:0});
test('removing three unrelated slots keeps the four queued slot owners and their progress',async()=>{
  const {e,cli}=await setup();const job=e.add({kind:'cycle',facility:'시설',pattern:['A','A','A','C'],repeatCount:1});Object.assign(job,{status:'running',nextIndex:4});e.running=true;
  const owned=['A','A','A','C'].map(name=>({name,recipeId:name,owner:job.id}));
  e.ledger.시설=[...Array.from({length:3},()=>({name:'B',owner:null})),...owned];cli.works=owned.map(s=>work(s.name));await e.readWorks();
  const ledger=e.reconcile('시설');assert.deepEqual(ledger,owned);assert.equal(ledger[0],owned[0]);assert.equal(job.completed,0);
  await e.collectFacility('시설',job);assert.equal(job.completed,4);assert.deepEqual(job.productCompleted,{A:3,C:1});assert.equal(e.ledger.시설.length,0);
});
test('partial cancellation of duplicated unrelated slots is harmless even when their identities are ambiguous',async()=>{
  const {e}=await setup();const job=e.add({kind:'materials',name:'A',count:1});const owned={name:'A',owner:job.id,recipeId:'A'};
  e.ledger.시설=[{name:'B',owner:null},{name:'B',owner:'deleted-job'},owned,{name:'C',owner:null}];e.works=[work('B'),work('A')];
  assert.deepEqual(e.reconcile('시설'),[{name:'B',owner:null},owned]);
});
test('an unrelated middle-slot cancellation keeps owners of different current jobs',async()=>{
  const {e}=await setup();const a=e.add({kind:'materials',name:'A',count:1}),c=e.add({kind:'cycle',facility:'시설',pattern:['C'],repeatCount:1});
  const slots=[{name:'A',owner:a.id,recipeId:'A'},{name:'B',owner:null},{name:'C',owner:c.id,recipeId:'C'}];e.ledger.시설=slots;e.works=[work('A'),work('C')];
  assert.deepEqual(e.reconcile('시설'),[slots[0],slots[2]]);
});
test('cancelling an owned slot still stops without replacing the saved ledger',async()=>{
  const {e}=await setup();const job=e.add({kind:'materials',name:'A',count:1});const ledger=[{name:'B',owner:null},{name:'A',owner:job.id}];e.ledger.시설=ledger;e.works=[work('B')];
  assert.throws(()=>e.reconcile('시설'),/구성이 바뀌/);assert.equal(e.ledger.시설,ledger);
});
test('same-name owned/unowned cancellation is not guessed',async()=>{
  const {e}=await setup();const job=e.add({kind:'materials',name:'A',count:1});const ledger=[{name:'A',owner:null},{name:'A',owner:job.id}];e.ledger.시설=ledger;e.works=[work('A')];
  assert.throws(()=>e.reconcile('시설'),/구성이 바뀌/);assert.equal(e.ledger.시설,ledger);assert.equal(job.completed,0);
});
test('reordered or replaced slots alongside an owned slot still stop',async()=>{
  const {e}=await setup();const job=e.add({kind:'materials',name:'A',count:1});e.ledger.시설=[{name:'B',owner:null},{name:'A',owner:job.id}];
  for(const names of [['A','B'],['C','A'],['B','A','C']]){e.works=names.map(work);assert.throws(()=>e.reconcile('시설'),/구성이 바뀌/);}
});
test('a queue resumes after unrelated cancellation and finishes only its remaining owned production',async()=>{
  const {e,cli}=await setup();const job=e.add({kind:'cycle',facility:'시설',pattern:['A'],repeatCount:2});Object.assign(job,{status:'stopped',nextIndex:1});
  e.ledger.시설=[{name:'B',owner:null},{name:'A',owner:job.id,recipeId:'A'}];cli.works=[work('A')];await e.prepareQueue();await e.run();
  assert.equal(e.terminal.type,'done');assert.equal(job.completed,2);assert.equal(job.nextIndex,2);assert.equal(cli.calls.filter(c=>c.command==='execute_altering').length,1);
});
