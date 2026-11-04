'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../lib/model.cjs');
const Preparation=require('../lib/preparation.cjs');
const {Engine}=require('../lib/engine.cjs');
const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
function db(){const data=fixtureDb();data.crafts[0].produced=5;return data;}
async function setup(stock={천:100,광석:100}){const data=db(),cli=new FakeCli({db:data,stock,autoComplete:true});const e=new Engine(cli,{}, {db:data,delay:async()=>{await Promise.resolve();}});await e.connect();return {e,cli,data};}
test('one craft means one CLI craft, with its full multiple-item output',async()=>{
  const {e,cli}=await setup();await e.runImmediate({kind:'craft',name:'키트',count:1});
  assert.equal(cli.stock.키트,5);assert.equal(e.terminal.type,'done');assert.deepEqual(cli.calls.filter(c=>c.command==='execute_crafting').map(c=>c.body.craftCount),[1]);
});
test('queued count and completion use batches, not the five items produced per craft',async()=>{
  const {e,cli}=await setup();const job=e.add({kind:'craft',name:'키트',count:3});await e.run();
  assert.equal(job.completed,3);assert.equal(job.countUnit,'batches');assert.equal(cli.stock.키트,15);assert.equal(cli.stock.천,94);assert.equal(cli.stock.광석,91);
  assert.deepEqual(cli.calls.filter(c=>c.command==='execute_crafting').map(c=>c.body.craftCount),[3]);
});
test('preparation, preview and wing estimates all use ingredient requirements per requested craft',async()=>{
  const {e,data}=await setup({천:4});const config={kind:'craft',name:'키트',count:3};const preview=await e.preview(config);
  assert.equal(preview.quantity,2);assert.equal(preview.batches,2);
  const job=M.newTask(config,data),plan=Preparation.plan([job],{천:4},new Set(['광석']),data);
  assert.deepEqual(Preparation.totals(plan),{천:4,광석:6});assert.equal(M.estimate(job,{천:4},new Set(['광석']),data),10);
});
test('partial direct material capacity produces two crafts rather than two output items',async()=>{
  const {e,cli}=await setup({천:4,광석:100});const job=e.add({kind:'craft',name:'키트',count:3});await e.run();
  assert.equal(job.completed,2);assert.equal(job.reduced,true);assert.equal(cli.stock.키트,10);assert.match(job.message,/2회/);
});
test('CLI craft-count limits and resuming a partially completed multi-output job keep exact batch counts',async()=>{
  const {e,cli}=await setup(),action=cli.action.bind(cli);
  const job=e.add({kind:'craft',name:'키트',count:5});job.completed=2;job.status='stopped';cli.stock.키트=10;
  cli.action=async(command,body)=>{if(command==='execute_crafting'&&body.craftCount>2)throw Object.assign(new Error('limit'),{code:'invalid_count',body:{maxCount:2}});return action(command,body);};
  await e.prepareQueue();await e.run();assert.equal(job.completed,5);assert.equal(cli.stock.키트,25);
  assert.deepEqual(cli.calls.filter(c=>c.command==='execute_crafting').map(c=>c.body.craftCount),[2,1]);
});
test('old output-quantity queues and presets migrate once, preserving IDs, progress and original production targets',()=>{
  const data=db(),old={kind:'craft',name:'키트',recipeId:'kit',count:12,completed:5,status:'stopped',id:'original-job',uncertain:true};
  const e=new Engine(new FakeCli({db:data}),{queue:[old],presets:[{id:'old-preset',name:'기존 계획',tasks:[{kind:'craft',name:'키트',recipeId:'kit',count:12}]}]},{db:data});
  assert.equal(e.queue[0].id,'original-job');assert.equal(e.queue[0].count,3);assert.equal(e.queue[0].completed,1);assert.equal(e.queue[0].uncertain,true);assert.equal(e.preferences.presets[0].tasks[0].count,3);
  const again=new Engine(new FakeCli({db:data}),e.persistent(),{db:data});assert.equal(again.queue[0].count,3);assert.equal(again.queue[0].completed,1);assert.equal(again.preferences.presets[0].tasks[0].count,3);
  assert.equal(old.count,12);assert.equal(old.completed,5);
});
test('new presets, reload and reset preserve craft batches without converting them back to output quantities',async()=>{
  const {e,data}=await setup();const config=M.presetConfig({name:'제작 12회',tasks:[{kind:'craft',name:'키트',count:12}]},data);
  assert.equal(config.tasks[0].count,12);assert.equal(config.tasks[0].countUnit,'batches');
  const reloaded=new Engine(new FakeCli({db:data}),{presets:[config],queue:[{...M.newTask(config.tasks[0],data),completed:4,status:'stopped'}]},{db:data});
  assert.equal(reloaded.queue[0].count,12);assert.equal(reloaded.queue[0].completed,4);reloaded.resetQueue();assert.equal(reloaded.queue[0].count,12);assert.equal(reloaded.queue[0].completed,0);
});
