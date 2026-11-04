'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../lib/model.cjs');
const {Engine}=require('../lib/engine.cjs');
const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
async function setup(stock={}){
  const db=fixtureDb();db.gather.push({id:'herb',name:'허브',kind:'gather',path:['약초 채집']});
  db.materials[0].ingredients=[{name:'광석',required:2},{name:'허브',required:3}];
  const cli=new FakeCli({db,stock,autoComplete:true});let clock=0;const events=[];
  const e=new Engine(cli,{}, {db,now:()=>clock,delay:async ms=>{clock+=ms;await Promise.resolve();}});await e.connect();
  e.gather=async(name,amount)=>{events.push({type:'gather',name,amount});cli.stock[name]=(cli.stock[name]||0)+amount;};
  cli.onAction=command=>{if(command==='execute_altering')events.push({type:'register'});};return {e,cli,events,db};
}
test('refill X gathers all ingredients for X productions before resuming; final refill is capped to remaining target',async()=>{
  const {e,events}=await setup();const job=e.add({kind:'cycle',facility:'시설',pattern:['A'],repeatCount:5,gatherBatches:2});await e.run();
  assert.equal(job.status,'done');assert.equal(job.completed,5);
  assert.deepEqual(events,[
    {type:'gather',name:'광석',amount:4},{type:'gather',name:'허브',amount:6},{type:'register'},{type:'register'},
    {type:'gather',name:'광석',amount:4},{type:'gather',name:'허브',amount:6},{type:'register'},{type:'register'},
    {type:'gather',name:'광석',amount:2},{type:'gather',name:'허브',amount:3},{type:'register'}
  ]);
});
test('10 targets register the available 3 then prepare only the remaining 7',async()=>{
  const {e,events}=await setup({광석:6,허브:9});const job=e.add({kind:'cycle',facility:'시설',pattern:['A'],repeatCount:10});await e.run();
  assert.equal(job.gatherBatches,10);assert.equal(job.completed,10);
  assert.deepEqual(events.slice(0,5),[{type:'register'},{type:'register'},{type:'register'},{type:'gather',name:'광석',amount:14},{type:'gather',name:'허브',amount:21}]);
});
test('a mixed SET refills only the missing product for its remaining appearances',async()=>{
  const {e,events}=await setup({천:100});const job=e.add({kind:'cycle',facility:'시설',pattern:['A','B'],repeatCount:2,gatherBatches:10});await e.run();
  assert.equal(job.completed,4);assert.deepEqual(events.filter(x=>x.type==='gather'),[{type:'gather',name:'광석',amount:4},{type:'gather',name:'허브',amount:6}]);
});
test('zero refill stops a SET when stock runs out, collects its registered work, and remains red/restartable',async()=>{
  const {e,cli,events}=await setup({광석:2,허브:3});const job=e.add({kind:'cycle',facility:'시설',pattern:['A'],repeatCount:3,gatherBatches:0});await e.run();
  assert.equal(job.status,'skipped');assert.equal(job.completed,1);assert.equal(cli.works.length,0);assert.equal(events.some(x=>x.type==='gather'),false);
  assert.equal(e.snapshot().queue[0].insufficient,true);assert.equal(e.queueMode(),'restart');
});
test('non-gatherable shortages finish the SET instead of waiting forever and other queue work continues',async()=>{
  const db=fixtureDb(),cli=new FakeCli({db,stock:{},autoComplete:true});let clock=0;
  const e=new Engine(cli,{}, {db,now:()=>clock,delay:async ms=>{clock+=ms;await Promise.resolve();}});await e.connect();
  const set=e.add({kind:'cycle',facility:'시설',pattern:['B'],repeatCount:0}),other=e.add({kind:'gather',name:'광석',count:1});await e.run();
  assert.equal(set.repeatCount,null);assert.equal(set.status,'skipped');assert.equal(other.status,'done');assert.equal(e.terminal.type,'done');
});
test('refill is capped by direct-material capacity and the SET stops after that stock is used',async()=>{
  const {e,db,events}=await setup({천:1});db.materials[0].ingredients.push({name:'천',required:1});
  const job=e.add({kind:'cycle',facility:'시설',pattern:['A'],repeatCount:4,gatherBatches:10});await e.run();
  assert.equal(job.status,'skipped');assert.equal(job.completed,1);assert.deepEqual(events.filter(x=>x.type==='gather'),[{type:'gather',name:'광석',amount:2},{type:'gather',name:'허브',amount:3}]);
});
test('refill defaults, zero and custom values survive preset config and reset; invalid values are rejected',async()=>{
  const {e,db}=await setup();const task=e.add({kind:'cycle',facility:'시설',pattern:['A'],repeatCount:0,gatherBatches:7});
  assert.equal(task.repeatCount,null);assert.equal(M.presetConfig({name:'수급',tasks:[task]},db).tasks[0].gatherBatches,7);e.resetQueue();assert.equal(e.queue[0].gatherBatches,7);
  assert.equal(M.taskConfig({kind:'cycle',facility:'시설',pattern:['A']},db).gatherBatches,10);
  assert.throws(()=>M.taskConfig({kind:'cycle',facility:'시설',pattern:['A'],gatherBatches:-1},db));
});
