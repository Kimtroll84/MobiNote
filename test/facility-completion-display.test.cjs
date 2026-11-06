const {test}=require('node:test'),assert=require('node:assert/strict'),M=require('../lib/model.cjs'),W=require('../ui/work-time.js');
test('facility state is not completed by a truthy string flag or elapsed countdown',()=>{
 for(const work of [{IsCompleted:'false',RemainingSeconds:120},{State:'InProgress',IsCompleted:true,RemainingSeconds:120},{State:'NotStarted',IsCompleted:true,RemainingSeconds:120},{State:'InProgress',IsCompleted:false,RemainingSeconds:0}]){assert.equal(W.isCompleted(work),false);assert.equal(M.done(work),false);}
 assert.equal(W.remainingAt({State:'InProgress',IsCompleted:'false',RemainingSeconds:120},1000,2000),119);
 assert.equal(W.progress({DisplayName:'A',State:'InProgress',IsCompleted:true,RemainingSeconds:120},[{name:'A',durationSeconds:240}]),50);
 assert.equal(W.isCompleted({State:'Completed',IsCompleted:true}),true);assert.equal(W.isCompleted({IsCompleted:true}),true);
});
test('final registration marks only the job complete, while game facility stays processing',async()=>{
 const {Engine}=require('../lib/engine.cjs'),{FakeCli,fixtureDb}=require('./fake-cli.cjs'),db=fixtureDb(),cli=new FakeCli({db,stock:{천:100,광석:100},autoComplete:false}),e=new Engine(cli,{}, {db,delay:async()=>{await Promise.resolve();}});await e.connect();await e.runImmediate({kind:'cycle',planMode:true,facility:'시설',pattern:['A','A'],repeatCount:1});
 assert.equal(e.terminal.type,'done');assert.equal(e.terminal.completed,1);assert.equal(e.snapshot().works.length,2);for(const work of e.snapshot().works){assert.equal(M.done(work),false);assert.equal(work.State,'InProgress');assert.ok(W.remainingAt(work,e.snapshot().worksReceivedAt)>0);}
});
