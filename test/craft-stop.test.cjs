'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs');const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
test('failed stop keeps English game response in diagnostics and only Korean in agent text',async()=>{
 const db=fixtureDb(),cli=new FakeCli({db}),e=new Engine(cli,{}, {db}),original='A blocking UI is covering the screen.';let diagnostic;
 e.running=true;e.activeCommand='execute_crafting';e.on('diagnostic',d=>diagnostic=d);
 cli.action=async()=>{throw Object.assign(new Error(original),{code:'blocked',body:{error:'blocked',message:original}});};
 await e.stop();assert.doesNotMatch(e.stage.text,/[A-Za-z]/);assert.match(e.stage.text,/중단/);assert.equal(diagnostic.response.message,original);
});
test('stop sends immediately even when craft activity looks idle, retries automatically, and waits before any next job',async()=>{
 const db=fixtureDb(),cli=new FakeCli({db,stock:{천:100,광석:100}}),read=cli.read.bind(cli),action=cli.action.bind(cli);
 let finish,stops=0,started=false,ticks=0;
 cli.read=async(command,name)=>command==='get_activity'?{Mode:{MainButtonState:'Compass'}}:read(command,name);
 cli.action=async(command,body)=>{
  if(command==='execute_crafting'){started=true;return new Promise(resolve=>{finish=resolve;});}
  if(command==='stop_action'){
   stops++;if(stops===1)throw Object.assign(new Error('중단 거부'),{code:'blocked',body:{message:'게임 창을 확인해 주세요.'}});
   return {};
  }
  return action(command,body);
 };
 const e=new Engine(cli,{}, {db,delay:async()=>{
  if(started){ticks++;
   if(ticks===1){await e.stop();assert.equal(e.stage.type,'stopping');assert.match(e.stage.text,/열린 창/);assert.equal(e.running,true);}
   if(ticks===2){assert.equal(stops,2);assert.equal(e.running,true);}
   if(ticks===4)finish({result:'stopped_by_user'});
   assert.ok(ticks<10);
  }await Promise.resolve();
 }});
 await e.connect();const first=e.add({kind:'craft',name:'키트',count:5}),next=e.add({kind:'craft',name:'키트',count:1});
 await e.run();assert.equal(e.terminal.type,'stopped');assert.equal(first.completed,0);assert.equal(next.status,'waiting');assert.ok(stops>=2);
});
