'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../lib/model.cjs');
const {Engine}=require('../lib/engine.cjs');
const {decode}=require('../lib/transport.cjs');
const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
async function setup(stock={}){
  const db=fixtureDb(),cli=new FakeCli({db,stock,autoComplete:true});let now=0;const events=[];
  const e=new Engine(cli,{}, {db,now:()=>now,delay:async ms=>{now+=ms;await Promise.resolve();}});await e.connect();
  e.gather=async(name,amount)=>{events.push(['gather',name,amount]);cli.stock[name]=(cli.stock[name]||0)+amount;};
  cli.onAction=(command,body)=>events.push([command,body.displayName]);return {e,cli,db,events};
}
test('whole queue coalesces ordinary and SET materials before any production',async()=>{
  const {e,events}=await setup({천:2});e.add({kind:'cycle',facility:'시설',pattern:['A'],repeatCount:10});e.add({kind:'craft',name:'키트',count:1});
  await e.run();assert.deepEqual(events[0],['gather','광석',23]);assert.equal(events.filter(x=>x[0]==='gather').length,1);
  assert.equal(e.queue[0].completed,10);assert.equal(e.queue[1].completed,1);assert.equal(e.terminal.type,'done');
});
test('common manual ingredients are reserved for SET production first',async()=>{
  const {e,events}=await setup({천:2,광석:3});const set=e.add({kind:'cycle',facility:'시설',pattern:['B'],repeatCount:1});const craft=e.add({kind:'craft',name:'키트',count:1});
  await e.run();assert.equal(craft.status,'skipped');assert.equal(craft.completed,0);assert.equal(set.status,'done');
  assert.equal(events.some(x=>x[0]==='execute_altering'),true);assert.equal(events.some(x=>x[0]==='gather'),false);
});
test('two ordinary jobs sharing direct ingredients prepare only for their combined affordable quantity',async()=>{
  const {e,events}=await setup({천:4});e.add({kind:'craft',name:'키트',count:2});e.add({kind:'craft',name:'키트',count:2});await e.run();
  assert.deepEqual(events[0],['gather','광석',6]);assert.equal(e.queue[0].completed,2);assert.equal(e.queue[1].status,'skipped');assert.equal(events.filter(x=>x[0]==='gather').length,1);
});
test('preparation on resume excludes already registered works and already completed quantities',async()=>{
  const {e,cli,events}=await setup();const job=e.add({kind:'materials',name:'A',count:3});job.status='stopped';job.registered=2;job.completed=1;job.facility='시설';
  cli.works=[{DisplayName:'A',FacilityName:'시설',State:'Completed',IsCompleted:true,RemainingSeconds:0}];e.ledger.시설=[{name:'A',recipeId:'A',owner:job.id}];
  await e.prepareQueue();await e.run();assert.deepEqual(events[0],['gather','광석',2]);assert.equal(job.completed,3);assert.equal(events.filter(x=>x[0]==='execute_altering').length,1);
});
test('user stop during preparation leaves production unstarted and resumes with current inventory',async()=>{
  const {e,cli,events}=await setup({천:2});const job=e.add({kind:'craft',name:'키트',count:1});let interrupt=true;
  e.gather=async(name,amount)=>{cli.stock[name]=(cli.stock[name]||0)+1;events.push(['gather',name,amount]);if(interrupt){const err=new Error('사용자가 작업을 중단했어요.');err.manual=true;throw err;}cli.stock[name]+=amount-1;};
  await e.run();assert.equal(job.status,'stopped');assert.equal(e.terminal.type,'stopped');assert.equal(events.some(x=>x[0]==='execute_crafting'),false);
  interrupt=false;await e.prepareQueue();await e.run();assert.deepEqual(events.filter(x=>x[0]==='gather'),[['gather','광석',3],['gather','광석',2]]);assert.equal(job.completed,1);
});
test('production never begins if bag space check fails while preparing',async()=>{
  const {e,cli}=await setup({천:2});e.add({kind:'craft',name:'키트',count:1});e.gather=Engine.prototype.gather.bind(e);cli.weight=95;await e.run();
  assert.equal(e.terminal.type,'error');assert.equal(cli.calls.some(c=>/^execute_/.test(c.command)),false);assert.equal(e.queue[0].status,'stopped');
});
for(const locked of [false,true])test(`one-item gathering retries transient invalid_state and accepts requested cancellation (locked=${locked})`,async()=>{
  const db=fixtureDb();db.gather=[{id:'egg',name:'달걀',kind:'gather',path:['일상 채집']}];const cli=new FakeCli({db});let clock=0,pending,running=false,gained=0,stops=0;
  const read=cli.read.bind(cli),action=cli.action.bind(cli);
  cli.read=async(command,...args)=>{
    if(command==='get_activity')return {Mode:{MainButtonState:running?'Stop':'Compass'}};
    if(command==='get_items')return [{DisplayName:'달걀',Count:10+gained,Location:'inventory',IsLocked:locked}];
    return read(command,...args);
  };
  cli.action=async(command,body)=>{
    if(command==='execute_gathering'){running=true;return new Promise((resolve,reject)=>{pending={resolve,reject};});}
    if(command==='stop_action'){
      stops++;if(stops===1){const err=new Error('not stoppable yet');err.code='invalid_state';throw err;}
      running=false;let error;try{decode(JSON.stringify({status:'accepted',body:{error:'canceled',gained,target:100,message:'Canceled'}}));}catch(e){error=e;}pending.reject(error);return {message:'stopped'};
    }
    return action(command,body);
  };
  const e=new Engine(cli,{}, {db,now:()=>clock,delay:async ms=>{clock+=ms;if(running&&ms===1000)gained++;await Promise.resolve();}});await e.connect();
  await e.runImmediate({kind:'gather',name:'달걀',count:1});
  assert.equal(running,false);assert.equal(stops,2);assert.equal(gained,1);assert.equal(e.terminal.type,'done');assert.equal(e.terminal.completed,1);
});
test('observation counts locked stacks but production stock still excludes them',()=>{
  const items=[{DisplayName:'달걀',Count:5,IsLocked:true},{DisplayName:'달걀',Count:2,IsLocked:false}];assert.equal(M.observedStocks(items).달걀,7);assert.equal(M.stocks(items).달걀,2);
});
test('real blocked failures remain errors instead of being mistaken for requested cancellation',async()=>{
  const db=fixtureDb(),cli=new FakeCli({db});const original=cli.action.bind(cli);
  cli.action=async(command,body)=>{if(command==='execute_gathering'){const error=new Error('게임 확인 창을 처리해 주세요.');error.code='blocked';throw error;}return original(command,body);};
  const e=new Engine(cli,{}, {db,delay:async()=>{await Promise.resolve();}});await e.connect();await e.runImmediate({kind:'gather',name:'광석',count:1});
  assert.equal(e.terminal.type,'error');assert.equal(e.terminal.errorCode,'blocked');
});

for(const status of ['accepted'])test(`blocked diagnostics preserve kind, original message and response status (${status})`,async()=>{
  const db=fixtureDb(),cli=new FakeCli({db}),action=cli.action.bind(cli);
  cli.action=async(command,body)=>{
    if(command==='execute_gathering'){
      try{return decode(JSON.stringify({status,body:{error:'blocked',kind:'test_window',message:'Synthetic blocking window message.'}}));}
      catch(error){error.command=command;throw error;}
    }
    return action(command,body);
  };
  const e=new Engine(cli,{}, {db,delay:async()=>{await Promise.resolve();}});await e.connect();let finished;e.on('finished',result=>{finished=result;});
  await e.runImmediate({kind:'gather',name:'광석',count:1});
  assert.equal(finished.type,'error');assert.equal(finished.errorCode,'blocked');assert.equal(finished.errorCommand,'execute_gathering');
  assert.equal(finished.errorKind,'test_window');assert.equal(finished.errorOriginalMessage,'Synthetic blocking window message.');assert.equal(finished.errorResponseStatus,status);
  assert.equal(finished.text,'게임 화면의 확인 창을 처리해 주세요.');
});
test('a lookup error during initial preparation leaves an entirely unstarted queue resumable',async()=>{
  const {e,cli}=await setup({천:2});const job=e.add({kind:'craft',name:'키트',count:1}),read=cli.read.bind(cli);
  cli.read=async(command,...args)=>{if(command==='get_craftable_items'){const error=new Error('조회 실패');error.code='cli_error';throw error;}return read(command,...args);};
  await e.run();assert.equal(job.status,'stopped');assert.equal(job.completed,0);assert.equal(e.queueMode(),'resume');assert.equal(e.terminal.type,'error');
  assert.equal(cli.calls.some(c=>/^execute_/.test(c.command)),false);cli.read=read;await e.prepareQueue();await e.run();assert.equal(job.status,'done');
});
