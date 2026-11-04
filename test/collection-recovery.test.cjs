'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs');const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
async function setup(){const db=fixtureDb(),cli=new FakeCli({db,stock:{천:100,광석:100},autoComplete:true});const e=new Engine(cli,{}, {db,delay:async()=>{await Promise.resolve();}});await e.connect();return {e,cli};}
for(const code of ['no_completed_work_at_facility','no_completed_work','not_completed_yet','no_altering'])test(`collection ${code} waits without changing production counters`,async()=>{
 const {e,cli}=await setup();let clock=10000;e.now=()=>clock;
 const job=e.add({kind:'materials',name:'A',count:1});e.running=true;Object.assign(job,{status:'running',registered:1});
 cli.works=[{DisplayName:'A',FacilityName:'시설',State:'Completed',IsCompleted:true}];e.ledger.시설=[{name:'A',owner:job.id,recipeId:'A'}];await e.readWorks();
 const action=cli.action.bind(cli);let attempts=0;cli.action=async(command,body)=>{if(++attempts===1)throw Object.assign(new Error('not ready'),{code});return action(command,body);};
 assert.deepEqual(await e.collectFacility('시설',job),[]);assert.equal(job.uncertain,false);assert.equal(job.status,'running');assert.equal(job.completed,0);assert.equal(job.registered,1);
 await e.collectFacility('시설',job);assert.equal(attempts,1);
 clock+=5000;await e.collectFacility('시설',job);assert.equal(attempts,2);assert.equal(job.completed,1);assert.equal(job.registered,1);
});
test('no completed work with missing slots is held rather than credited as success',async()=>{
 const {e,cli}=await setup();const job=e.add({kind:'materials',name:'A',count:1});e.running=true;job.status='running';
 cli.works=[{DisplayName:'A',FacilityName:'시설',State:'Completed',IsCompleted:true}];e.ledger.시설=[{name:'A',owner:job.id,recipeId:'A'}];await e.readWorks();
 cli.action=async()=>{cli.works=[];throw Object.assign(new Error('none'),{code:'no_completed_work_at_facility'});};
 assert.equal(await e.collectFacility('시설',job),null);assert.equal(job.status,'held');assert.equal(job.completed,0);
});
for(const collected of [9,[{name:'A',count:9}]])test(`extra completions are counted by slots, not collected payload (${typeof collected})`,async()=>{
 const {e,cli}=await setup();const job=e.add({kind:'materials',name:'A',count:4});Object.assign(job,{status:'running',registered:4});e.running=true;
 cli.works=Array.from({length:4},(_,i)=>({DisplayName:'A',FacilityName:'시설',State:i===0?'Completed':'InProgress',IsCompleted:i===0,RemainingSeconds:i===0?0:30}));e.ledger.시설=cli.works.map(()=>({name:'A',owner:job.id,recipeId:'A'}));await e.readWorks();
 cli.action=async()=>{cli.works=cli.works.slice(3);return {collected};};await e.collectFacility('시설',job);
 assert.equal(job.completed,3);assert.equal(job.registered,4);assert.equal(e.ledger.시설.length,1);assert.equal(job.uncertain,false);
});
test('stale post-collection read is retried without sending the collect command again',async()=>{
 const {e,cli}=await setup();const job=e.add({kind:'materials',name:'A',count:1});const before=[{DisplayName:'A',FacilityName:'시설',State:'Completed',IsCompleted:true}];cli.works=before;e.ledger.시설=[{name:'A',owner:job.id,recipeId:'A'}];await e.readWorks();e.running=true;
 let actions=0,reads=0;cli.action=async()=>{actions++;return {collected:3};};const read=cli.read.bind(cli);cli.read=async(cmd,...args)=>cmd==='get_altering_works'?{works:++reads===1?before:[]}:read(cmd,...args);
 await e.collectFacility('시설',job);assert.equal(actions,1);assert.equal(reads,2);assert.equal(job.completed,1);
});
test('unexplained collection holds only that facility while another queue job finishes',async()=>{
 const {e,cli}=await setup();const job=e.add({kind:'materials',name:'A',count:1}),next=e.add({kind:'craft',name:'키트',count:1});const action=cli.action.bind(cli);
 cli.action=async(cmd,body)=>{if(cmd==='complete_altering_work'){cli.works=[{DisplayName:'unknown',FacilityName:'시설',State:'InProgress',RemainingSeconds:30}];return {collected:1};}return action(cmd,body);};
 await e.run();assert.equal(job.status,'held');assert.equal(next.status,'done');assert.equal(job.registered,1);assert.equal(job.completed,0);assert.equal(e.terminal.type,'done');assert.equal(e.terminal.held,1);assert.match(e.terminal.text,/보류/);
 assert.equal(cli.calls.filter(c=>c.command==='execute_altering').length,1);
});
test('finite registrations never exceed target when extra works are collected in transit',async()=>{
 const {e,cli}=await setup();const job=e.add({kind:'materials',name:'A',count:10}),action=cli.action.bind(cli);
 cli.action=async(cmd,body)=>{const r=await action(cmd,body);if(cmd==='complete_altering_work')return {...r,collected:r.collected*3};return r;};
 await e.run();assert.equal(job.registered,10);assert.equal(job.completed,10);assert.equal(cli.calls.filter(c=>c.command==='execute_altering').length,10);assert.equal(job.status,'done');
});
test('collection timeout is checked against actual remaining slots without reissuing collection',async()=>{
 const {e,cli}=await setup();const job=e.add({kind:'materials',name:'A',count:1});e.running=true;cli.works=[{DisplayName:'A',FacilityName:'시설',State:'Completed',IsCompleted:true}];e.ledger.시설=[{name:'A',owner:job.id,recipeId:'A'}];await e.readWorks();let actions=0;
 cli.action=async()=>{actions++;cli.works=[];throw Object.assign(new Error('timeout'),{code:'timeout',responseStatus:'accepted'});};
 await e.collectFacility('시설',job);assert.equal(actions,1);assert.equal(job.completed,1);assert.equal(job.uncertain,false);
});

for(const voice of ['A','B'])test(`manual collection reports all received slots only in final summary (${voice})`,async()=>{
 require('../ui/agent-personality.js');const D=globalThis.AgentDialogue;
 const {e,cli}=await setup();
 cli.works=['A','A','B'].map(DisplayName=>({DisplayName,FacilityName:'시설',State:'Completed',IsCompleted:true}));
 const messages=[];e.on('change',s=>{if(s.stage.type==='collect')messages.push(D.copy(s.stage,voice));});
 await e.runImmediate({kind:'collect',facility:'시설'});
 assert.equal(e.terminal.type,'done');
 assert.deepEqual(e.terminal.results,[{name:'A',kind:'가공 수령',count:2},{name:'B',kind:'가공 수령',count:1}]);
 assert.ok(messages.length);for(const m of messages){assert.doesNotMatch(m.message,/A|B/);assert.doesNotMatch(m.detail,/가공 수령/);}
 const report=D.copy(e.terminal,voice);assert.match(report.detail,/A · 가공 수령 2회/);assert.match(report.detail,/B · 가공 수령 1회/);
 await e.collectFacility('시설');assert.equal(e.results[0].count,2);
});
