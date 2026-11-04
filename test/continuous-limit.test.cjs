'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs');const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
for(const stop of [false,true])test(`continuous limit preserves partial gathering and allows user stop=${stop}`,async()=>{
 const db=fixtureDb(),cli=new FakeCli({db,stock:{광석:0},autoComplete:true});let attempts=0,closed=false,waits=0;const stages=[];
 const action=cli.action.bind(cli),read=cli.read.bind(cli);
 cli.action=async(command,body)=>{if(command==='execute_gathering'&&++attempts===1){cli.stock.광석=2;throw Object.assign(new Error('confirm'),{code:'blocked',responseStatus:'accepted',body:{kind:'continuous_run_limit',gained:2}});}return action(command,body);};
 cli.read=async(command,...args)=>{if(command==='get_activity'&&attempts===1&&!closed)throw Object.assign(new Error('confirm'),{code:'blocked',body:{kind:'continuous_run_limit'}});return read(command,...args);};
 const e=new Engine(cli,{}, {db,delay:async()=>{if(++waits===3){if(stop)await e.stop();else closed=true;}await Promise.resolve();}});await e.connect();e.on('change',s=>stages.push(s.stage));
 const job=e.add({kind:'gather',name:'광석',count:3});await e.run();
 assert.ok(stages.some(s=>s.type==='ui-blocked'&&s.blockerKind==='continuous_run_limit'));
 assert.equal(e.terminal.type,stop?'stopped':'done');assert.equal(attempts,stop?1:2);if(!stop)assert.equal(job.completed,3);
});
