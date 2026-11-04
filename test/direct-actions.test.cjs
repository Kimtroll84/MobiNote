'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../lib/engine.cjs');
const { FakeCli, fixtureDb } = require('./fake-cli.cjs');
async function setup(autoComplete = true) {
  const db = fixtureDb(), cli = new FakeCli({ db, stock:{ 천:100, 광석:100 }, autoComplete });let now=0;
  const e = new Engine(cli, {}, { db, now:()=>now, delay:async ms=>{now+=ms;await Promise.resolve();} });await e.connect();return {e,cli,db};
}
for (const [kind,name,count] of [['gather','광석',3],['craft','키트',2],['materials','A',2]]) test(`direct ${kind} runs only its requested amount without changing the saved queue`,async()=>{
  const {e,cli}=await setup();const queued=e.add({kind:'craft',name:'키트',count:10});const snapshots=[];e.on('change',s=>snapshots.push(s.queue));
  await e.runImmediate({kind,name,count});
  assert.equal(e.queue.length,1);assert.equal(queued.status,'waiting');assert.equal(queued.completed,0);
  assert.ok(snapshots.every(q=>q.length===1&&q[0].id===queued.id));assert.equal(e.persistent().queue.length,1);
  assert.equal(e.immediateTask,null);assert.equal(e.terminal.completed,1);assert.equal(e.terminal.total,1);
  if(kind==='craft')assert.equal(cli.calls.find(c=>c.command==='execute_crafting').body.craftCount,2);
  if(kind==='materials'){assert.equal(cli.calls.filter(c=>c.command==='execute_altering').length,2);assert.equal(cli.works.length,0);}
});
for (const reregister of [false,true]) test(`direct collection (reregister=${reregister}) never enters or runs the queue`,async()=>{
  const {e,cli}=await setup(false);cli.works=[{DisplayName:'B',FacilityName:'시설',State:'Completed',IsCompleted:true}];
  e.add({kind:'craft',name:'키트',count:10});await e.runImmediate({kind:'collect',facility:'시설',reregister});
  assert.equal(e.queue.length,1);assert.equal(e.queue[0].status,'waiting');assert.equal(cli.works.length,reregister?1:0);
  assert.equal(cli.calls.some(c=>c.command==='execute_crafting'),false);assert.equal(e.terminal.type,'done');
});
test('direct slot additions allow duplicate products, fill only selected slots, and do not auto-collect',async()=>{
  const {e,cli}=await setup(false);cli.works=[{DisplayName:'C',FacilityName:'시설',State:'InProgress',IsCompleted:false}];
  assert.equal(await e.availableSlots('시설'),6);
  await e.runImmediate({kind:'register',facility:'시설',pattern:['B','B','B']});
  assert.equal(cli.works.length,4);assert.equal(e.queue.length,0);assert.equal(e.terminal.type,'done');
  assert.equal(cli.calls.filter(c=>c.command==='execute_altering').length,3);
  assert.equal(cli.calls.some(c=>c.command==='complete_altering_work'),false);
});
for(const queued of [false,true])test(`completed slots are collected before registration and finish without waiting (queued=${queued})`,async()=>{
  const {e,cli}=await setup(false);
  cli.works=Array.from({length:7},(_,i)=>({DisplayName:'B',FacilityName:'시설',State:i<3?'Completed':'InProgress',IsCompleted:i<3}));
  assert.equal(await e.availableSlots('시설'),3);
  const config={kind:'register',facility:'시설',pattern:['B','B','B']};
  if(queued){const job=e.add(config);await e.run();assert.equal(job.status,'done');assert.equal(job.completed,3);}else await e.runImmediate(config);
  assert.equal(e.terminal.type,'done');assert.equal(cli.works.length,7);
  const actions=cli.calls.filter(c=>['complete_altering_work','execute_altering'].includes(c.command));
  assert.deepEqual(actions.map(c=>c.command),['complete_altering_work','execute_altering','execute_altering','execute_altering']);
  assert.ok(cli.works.every(w=>!w.IsCompleted));
});

test('slot count is rechecked before any paid registration when another game action filled it',async()=>{
  const {e,cli}=await setup(false);assert.equal(await e.availableSlots('시설'),7);
  cli.works=Array.from({length:6},()=>({DisplayName:'C',FacilityName:'시설',State:'InProgress',IsCompleted:false}));
  await e.runImmediate({kind:'register',facility:'시설',pattern:['B','B']});
  assert.equal(e.terminal.type,'error');assert.match(e.terminal.text,/빈 가공 슬롯/);
  assert.equal(cli.calls.some(c=>c.command==='execute_altering'),false);assert.equal(e.queue.length,0);
});
test('manual missing materials skip just the selected registration, while gatherable shortages are replenished',async()=>{
  const {e,cli}=await setup(false);cli.stock={};
  await e.runImmediate({kind:'register',facility:'시설',pattern:['B','A']});
  assert.equal(e.terminal.type,'done');assert.deepEqual(cli.works.map(w=>w.DisplayName),['A']);
  assert.equal(cli.calls.filter(c=>c.command==='execute_gathering').length,1);assert.equal(e.queue.length,0);
});

for (const direct of [true,false]) test(`selected recipe 2 supplies its own ingredients and executes (${direct?'direct':'queue'})`,async()=>{
  const db=fixtureDb();db.materials=[
    { ...db.materials[0],id:'short',durationSeconds:100,ingredients:[{name:'짧은 전용재료',required:1},{name:'광석',required:2}] },
    { ...db.materials[0],id:'long',durationSeconds:200,ingredients:[{name:'긴 전용재료',required:1},{name:'광석',required:4}] }
  ];
  const cli=new FakeCli({db,stock:{'긴 전용재료':2},autoComplete:true});let now=0;
  const e=new Engine(cli,{}, {db,now:()=>now,delay:async ms=>{now+=ms;await Promise.resolve();}});await e.connect();
  const input={kind:'materials',name:'A',recipeId:'long',count:2};
  assert.equal(require('../lib/model.cjs').estimate(input,cli.stock,new Set(['광석']),db),15);
  if(direct)await e.runImmediate(input);else{const task=e.add(input);assert.equal(task.recipeId,'long');assert.equal(e.snapshot().queue[0].possible,2);await e.run();assert.equal(task.status,'done');}
  assert.equal(e.terminal.type,'done');assert.equal(cli.stock['긴 전용재료'],0);
  assert.equal(cli.calls.filter(c=>c.command==='execute_altering').length,2);
  assert.equal(cli.calls.filter(c=>c.command==='execute_gathering').length,1);
  assert.equal(cli.stock['짧은 전용재료'],undefined);
});
