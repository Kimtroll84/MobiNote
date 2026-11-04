'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../lib/model.cjs');
const {Engine}=require('../lib/engine.cjs');
const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
for(const repeatCount of [1,2])test(`weighted 6:1 SET executes exactly ${repeatCount} lap(s), keeping ratio across seven-slot refills`,async()=>{
  const db=fixtureDb(),cli=new FakeCli({db,stock:{천:100},autoComplete:true});let now=0;
  const e=new Engine(cli,{}, {db,now:()=>now,delay:async ms=>{now+=ms;await Promise.resolve();}});await e.connect();
  const pattern=[...Array(6).fill('B'),'C'],job=e.add({kind:'cycle',facility:'시설',pattern,repeatCount,gatherBatches:10});
  const preset=M.presetConfig({name:'6 대 1',tasks:[job]},db);assert.deepEqual(preset.tasks[0].pattern,pattern);
  await e.run();assert.deepEqual(cli.calls.filter(c=>c.command==='execute_altering').map(c=>c.body.displayName),Array.from({length:repeatCount},()=>pattern).flat());
  assert.equal(job.completed,7*repeatCount);assert.equal(job.productCompleted.B,6*repeatCount);assert.equal(job.productCompleted.C,repeatCount);assert.equal(job.status,'done');assert.equal(cli.works.length,0);
  e.resetQueue();assert.deepEqual(e.queue[0].pattern,pattern);assert.equal(e.queue[0].repeatCount,repeatCount);
});
