'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs'),{decode,errorMessage}=require('../lib/transport.cjs');
const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
function fixture(){
  const db=fixtureDb(),cli=new FakeCli({db,stock:{천:100,광석:100},autoComplete:true}),waits=[];
  const engine=new Engine(cli,{}, {db,delay:async ms=>{waits.push(ms);await Promise.resolve();}});
  return {e:engine,cli,waits};
}
function failure(code,status='rejected',extra={}){
  try{decode(JSON.stringify({status,body:{error:code,...extra}}));}catch(error){return error;}
  throw new Error('Expected CLI error');
}
for(const status of ['expired','disabled','invalid_body'])test(`${status} is never interpreted as success, even with an empty body`,()=>{
  assert.throws(()=>decode(JSON.stringify({status,body:{}})),e=>e.code===status&&e.responseStatus===status);
});
test('JSON-encoded body errors retain structured recovery metadata',()=>{
  assert.throws(()=>decode(JSON.stringify({status:'rejected',body:JSON.stringify({error:'rate_limited',retryAfterSeconds:2.5})})),e=>e.code==='rate_limited'&&e.body.retryAfterSeconds===2.5);
});
test('capabilities is fetched once per CLI path per engine session',async()=>{
  const {e,cli}=fixture();await e.connect();await e.connect();
  assert.equal(cli.calls.filter(c=>c.command==='capabilities').length,1);
  cli.file='different-cli';await e.connect();assert.equal(cli.calls.filter(c=>c.command==='capabilities').length,2);
});
test('missing supported commands prevent production before fetching item catalogs',async()=>{
  const {e,cli}=fixture(),read=cli.read.bind(cli);
  cli.read=async(cmd,...args)=>cmd==='capabilities'?{commands:[{Command:'get_items'}]}:read(cmd,...args);
  await assert.rejects(e.connect(),/execute_crafting/);assert.equal(e.connected,false);
  assert.equal(cli.calls.some(c=>c.command==='get_craftable_items'),false);
});
test('incomplete capabilities during loading is not cached',async()=>{
  const {e,cli}=fixture(),read=cli.read.bind(cli);let attempts=0;
  cli.read=async(cmd,...args)=>cmd==='capabilities'&&attempts++===0?{loading:true,commands:[]}:read(cmd,...args);
  await assert.rejects(e.connect(),e=>e.code==='loading');await e.connect();assert.equal(e.connected,true);
});
for(const code of ['command_in_progress','rate_limited','connection_lost'])test(`explicit pre-start ${code} rejection retries without crediting failed production`,async()=>{
  const {e,cli,waits}=fixture();await e.connect();const action=cli.action.bind(cli);let sent=0;
  cli.action=async(cmd,body)=>{if(cmd==='execute_crafting'&&++sent===1)throw failure(code,'rejected',{retryAfterSeconds:2.5});return action(cmd,body);};
  const job=e.add({kind:'craft',name:'키트',count:2});await e.run();
  assert.equal(e.terminal.type,'done');assert.equal(job.completed,2);assert.equal(sent,2);
  assert.equal(cli.calls.filter(c=>c.command==='execute_crafting').length,1);
  if(code==='rate_limited')assert.ok(waits.reduce((a,b)=>a+b,0)>=2500);
});
for(const status of ['accepted',undefined])test(`uncertain ${status||'transport'} rate limit failure never resubmits production`,async()=>{
  const {e,cli}=fixture();await e.connect();let sent=0;
  cli.action=async cmd=>{if(cmd==='execute_crafting'){sent++;const error=failure('rate_limited',status||'accepted');error.responseStatus=status;throw error;}return {};};
  const job=e.add({kind:'craft',name:'키트',count:2});await e.run();
  assert.equal(sent,1);assert.equal(job.completed,0);assert.equal(job.uncertain,true);
});
test('rate-limited reads honor server delay; idle connection loss retries remain bounded',async()=>{
  const {e,cli,waits}=fixture(),read=cli.read.bind(cli);let attempts=0;
  cli.read=async(cmd,...args)=>{if(cmd==='status'&&attempts++===0)throw failure('rate_limited','rejected',{retryAfterSeconds:2.5});return read(cmd,...args);};
  await e.connect();assert.equal(waits.reduce((a,b)=>a+b,0),2500);
  attempts=0;cli.read=async()=>{attempts++;throw failure('connection_lost');};
  await assert.rejects(e.read('get_items'),e=>e.code==='connection_lost');assert.equal(attempts,4);
});
test('long server retry delays remain stoppable before production is resubmitted',async()=>{
  const {e,cli}=fixture();await e.connect();let sent=0,waits=0;
  e.delay=async()=>{if(++waits===2)e.cancelReason='user';};
  cli.action=async cmd=>{if(cmd==='execute_crafting'){sent++;throw failure('rate_limited','rejected',{retryAfterSeconds:60});}return {};};
  e.add({kind:'craft',name:'키트',count:1});await e.run();assert.equal(sent,1);assert.equal(e.terminal.type,'stopped');
});
test('unavailable gathering tools skip the gather job without spending wings or blocking a craft',async()=>{
  const {e,cli}=fixture();await e.connect();const read=cli.read.bind(cli);
  cli.read=async(cmd,...args)=>cmd==='get_gatherable_items'?{items:[{DisplayName:'광석',ToolOk:false}]}:read(cmd,...args);
  const gather=e.add({kind:'gather',name:'광석',count:1}),craft=e.add({kind:'craft',name:'키트',count:1});await e.run();
  assert.equal(gather.status,'skipped');assert.match(gather.message,/도구/);assert.equal(craft.status,'done');
  assert.equal(cli.calls.some(c=>c.command==='execute_gathering'),false);
});
test('tool preflight refreshes instead of using stale connection-time tool state',async()=>{
  const {e,cli}=fixture(),read=cli.read.bind(cli);let broken=true;
  cli.read=async(cmd,...args)=>cmd==='get_gatherable_items'?{items:[{DisplayName:'광석',ToolOk:!broken}]}:read(cmd,...args);
  await e.connect();assert.equal(e.db.gather[0].toolOk,false);broken=false;
  const job=e.add({kind:'gather',name:'광석',count:1});await e.run();assert.equal(job.status,'done');
});
test('action expiry is a known non-execution, not an uncertain completed production',async()=>{
  const {e,cli}=fixture();await e.connect();cli.action=async()=>{throw failure('expired','expired');};
  const job=e.add({kind:'craft',name:'키트',count:1});await e.run();assert.equal(job.completed,0);assert.equal(job.uncertain,false);
});
test('material, tool and transfer errors have actionable Korean explanations',()=>{
  for(const code of ['ingredient_locked','tool_missing','tool_broken','required_consumable_missing','insufficient_transfer_cost'])assert.doesNotMatch(errorMessage(code),/게임 요청을 처리하지 못/);
});
