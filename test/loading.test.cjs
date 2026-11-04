'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs');
const {decode}=require('../lib/transport.cjs');
const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
const loading=()=>Object.assign(new Error('게임을 불러오는 중이에요.'),{code:'loading'});
async function setup(){const db=fixtureDb(),cli=new FakeCli({db,stock:{천:10,광석:10},autoComplete:true});let clock=0;const waits=[];
  const e=new Engine(cli,{}, {db,now:()=>clock,delay:async ms=>{waits.push(ms);clock+=ms;await Promise.resolve();}});await e.connect();waits.length=0;return {e,cli,waits};}
test('plain-text and JSON loading responses keep a machine-readable loading code',()=>{
  for(const text of ['This command is only available while in-game. Game is currently loading. Please wait until loading finishes.',JSON.stringify({status:'rejected',body:{error:'invalid_state',message:'Game is currently loading.'}})])assert.throws(()=>decode(text),e=>e.code==='loading');
});
test('loading inventory reads wait then restore the stage and check activity without repeating production',async()=>{
  const {e,cli,waits}=await setup(),read=cli.read.bind(cli);let failures=3,checks=0;const stages=[];e.on('change',s=>stages.push(s.stage.type));
  cli.read=async(command,...args)=>{if(command==='get_items'&&failures-->0)throw loading();if(command==='get_activity')checks++;return read(command,...args);};
  e.add({kind:'craft',name:'키트',count:1});await e.run();
  assert.equal(e.terminal.type,'done');assert.equal(waits.filter(n=>n===1000).length,3);assert.ok(stages.includes('loading'));assert.ok(checks>0);
  assert.equal(cli.calls.filter(c=>c.command==='execute_crafting').length,1);
});
test('loading during a pending gathering read preserves the original command and finite stop',async()=>{
  const {e,cli}=await setup(),read=cli.read.bind(cli),action=cli.action.bind(cli);let pending,running=false,failures=2,starts=0,gained=false;const stages=[];
  e.on('change',s=>stages.push(s.stage.type));
  cli.read=async(command,...args)=>{
    if(command==='get_activity')return {Mode:{MainButtonState:running?'Stop':'Compass'}};
    if(command==='get_items'&&running){if(failures-->0)throw loading();if(!gained){gained=true;cli.stock.광석++;}}
    return read(command,...args);
  };
  cli.action=async(command,body)=>{
    if(command==='execute_gathering'){starts++;running=true;return new Promise(resolve=>{pending=resolve;});}
    if(command==='stop_action'){running=false;pending({result:'stopped',gained:1});return {};}
    return action(command,body);
  };
  await e.runImmediate({kind:'gather',name:'광석',count:1});assert.equal(e.terminal.type,'done');assert.equal(starts,1);assert.equal(running,false);assert.ok(stages.includes('loading'));
});
test('a gathering command ended by loading resumes only the uncollected amount after idle confirmation',async()=>{
  const {e,cli}=await setup(),action=cli.action.bind(cli),read=cli.read.bind(cli);let starts=0,loadingReads=2;
  cli.action=async(command,body)=>{if(command==='execute_gathering'){starts++;if(starts===1){cli.stock.광석++;throw loading();}}return action(command,body);};
  cli.read=async(command,...args)=>{if(command==='get_activity'&&starts===1&&loadingReads-->0)throw loading();return read(command,...args);};
  const task=e.add({kind:'gather',name:'광석',count:2});await e.run();assert.equal(e.terminal.type,'done');assert.equal(task.completed,2);assert.equal(starts,2);
});
test('loading that already fulfilled a finite gathering target never sends another paid command',async()=>{
  const {e,cli}=await setup();let starts=0;const action=cli.action.bind(cli);
  cli.action=async(command,body)=>{if(command==='execute_gathering'){starts++;cli.stock.광석++;throw loading();}return action(command,body);};
  await e.runImmediate({kind:'gather',name:'광석',count:1});assert.equal(e.terminal.type,'done');assert.equal(starts,1);
});
test('user stop remains responsive while loading and loading outside a run is not retried',async()=>{
  const {e,cli}=await setup(),read=cli.read.bind(cli);cli.read=async(command,...args)=>{if(command==='get_items')throw loading();return read(command,...args);};
  await assert.rejects(e.inventory(),err=>err.code==='loading');let waits=0;e.delay=async()=>{if(++waits===2)e.stop();await Promise.resolve();};
  e.add({kind:'craft',name:'키트',count:1});await e.run();assert.equal(e.terminal.type,'stopped');assert.equal(waits,2);assert.equal(cli.calls.some(c=>c.command==='execute_crafting'),false);
});
