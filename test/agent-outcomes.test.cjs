'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs');
const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
require('../ui/agent-personality.js');
const D=globalThis.AgentDialogue;
async function setup(stock={},autoComplete=true){
 const db=fixtureDb(),cli=new FakeCli({db,stock,autoComplete});
 const engine=new Engine(cli,{}, {db,delay:async()=>{await Promise.resolve();}});
 await engine.connect();return {engine,cli,db};
}
test('gathered results are accumulated once across actual CLI batches',async()=>{
 const {engine}=await setup();await engine.runImmediate({kind:'gather',name:'광석',count:150});
 assert.equal(engine.terminal.type,'done');
 assert.deepEqual(engine.terminal.results,[{name:'광석',kind:'채집',count:200,unit:'개'}]);
});
test('a skipped resource includes its actionable reason in terminal notices',async()=>{
 const {engine}=await setup();await engine.runImmediate({kind:'materials',name:'B',count:1,recipeId:'B'});
 assert.equal(engine.terminal.skipped,1);assert.equal(engine.terminal.notices[0].name,'B');
 assert.match(engine.terminal.notices[0].reason,/재료/);assert.equal(D.copy(engine.terminal).image,'asking');
});
test('processing completion reports registration while the facility continues',async()=>{
 const {engine}=await setup({광석:10},false);
 await engine.runImmediate({kind:'materials',name:'A',count:1,recipeId:'A'});
 assert.equal(engine.terminal.type,'done');assert.equal(engine.terminal.processingContinues,true);
 assert.match(D.copy(engine.terminal).message,/가공 등록/);
});
test('collect-only and collect-and-reregister use distinct speech without changing commands',async()=>{
 for(const reregister of [false,true]){
  const {engine,cli}=await setup({광석:10});
  cli.works=[{DisplayName:'A',FacilityName:'시설',State:'Completed',IsCompleted:true,RemainingSeconds:0}];
  const stages=[];engine.on('change',snapshot=>{if(['collect','register'].includes(snapshot.stage.type))stages.push({...snapshot.stage});});
  await engine.runImmediate({kind:'collect',facility:'시설',reregister});
  const collect=stages.find(s=>s.type==='collect');assert.equal(collect.reregister,reregister);
  if(reregister){const register=stages.find(s=>s.type==='register');assert.equal(register.reregister,true);assert.equal(D.copy(register).message,D.copy(collect).message);assert.equal(engine.terminal.results.find(r=>r.kind==='가공 등록').count,1);}
  assert.equal(cli.calls.filter(c=>c.command==='execute_altering').length,reregister?1:0);
 }
});
