'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs');const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
test('running craft refreshes facility display without collecting unrelated work or changing stage',async()=>{
 const db=fixtureDb(),cli=new FakeCli({db}),e=new Engine(cli,{}, {db});await e.connect();
 e.running=true;e.activeCommand='execute_crafting';e.stage={type:'craft',item:'키트'};
 cli.works=[{DisplayName:'A',FacilityName:'시설',IsCompleted:true,RemainingSeconds:0}];
 await e.poll();assert.equal(e.works[0].IsCompleted,true);assert.equal(e.stage.type,'craft');
 assert.equal(cli.calls.some(c=>c.command==='complete_altering_work'),false);
 cli.read=async()=>{throw Object.assign(new Error('loading'),{code:'loading'});};
 await e.poll();assert.equal(e.connected,true);assert.equal(e.stage.type,'craft');
});
test('terminal results contain only crafts confirmed in this execution',async()=>{
 const db=fixtureDb(),cli=new FakeCli({db,stock:{천:100,광석:100}}),e=new Engine(cli,{}, {db,delay:async()=>{await Promise.resolve();}});
 await e.connect();const job=e.add({kind:'craft',name:'키트',count:5});job.completed=2;
 await e.run();assert.deepEqual(e.terminal.results,[{name:'키트',kind:'제작',count:3}]);
});
