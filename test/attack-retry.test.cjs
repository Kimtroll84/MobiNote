'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs');
const {decode}=require('../lib/transport.cjs');
const {FakeCli,fixtureDb}=require('./fake-cli.cjs');
async function setup(step,onDelay){
  const db=fixtureDb();db.gather=[{id:'egg',name:'달걀',kind:'gather',path:['일상 채집']}];
  const cli=new FakeCli({db});let attempts=0,clock=0,e;const action=cli.action.bind(cli),states=[];
  cli.action=async(command,body)=>{
    if(command!=='execute_gathering')return action(command,body);
    attempts++;const outcome=step(attempts);cli.stock.달걀=(cli.stock.달걀||0)+(outcome.gained||0);
    if(outcome.error)return decode(JSON.stringify({status:'accepted',body:{error:outcome.error,gained:outcome.gained||0,target:100,message:'interrupted'}}));
    return {result:outcome.result||'completed',gained:outcome.gained||0};
  };
  e=new Engine(cli,{}, {db,now:()=>clock,delay:async ms=>{clock+=ms;if(onDelay)onDelay(e,attempts,ms);await Promise.resolve();}});await e.connect();
  e.on('change',s=>{if(['gather','shortage','stop-wait'].includes(s.stage.type)&&s.stage.gathered!=null)states.push({...s.stage});});
  return {e,cli,states,attempts:()=>attempts};
}
test('chicken attacks retry beyond any small retry limit until target is reached',async()=>{
  const {e,attempts}=await setup(n=>n<=70?{error:'interrupted_by_attack'}:{gained:1});const job=e.add({kind:'gather',name:'달걀',count:1});await e.run();
  assert.equal(attempts(),71);assert.equal(job.completed,1);assert.equal(job.status,'done');assert.equal(e.terminal.type,'done');assert.equal(job.roosterHits,70);
});
test('partial gains from attacks accumulate exactly once and gather counters remain monotonic',async()=>{
  const {e,states,attempts}=await setup(n=>n<3?{error:'interrupted_by_attack',gained:1}:{gained:1});const job=e.add({kind:'gather',name:'달걀',count:3});await e.run();
  assert.equal(attempts(),3);assert.equal(job.completed,3);assert.equal(e.terminal.type,'done');
  const counters=states.filter(s=>s.gathered!=null);assert.equal(counters[0].gathered,0);assert.equal(counters.at(-1).gathered,3);
  assert.ok(counters.every((s,i)=>s.gatherTarget===3&&(i===0||s.gathered>=counters[i-1].gathered)));
});
test('an attack after obtaining the final item completes without another paid gathering call',async()=>{
  const {e,attempts}=await setup(()=>({error:'interrupted_by_attack',gained:1}));await e.runImmediate({kind:'gather',name:'달걀',count:1});
  assert.equal(attempts(),1);assert.equal(e.terminal.type,'done');assert.equal(e.terminal.completed,1);
});
test('the app stop button takes precedence over an attack retry',async()=>{
  const {e,attempts}=await setup(()=>({error:'interrupted_by_attack'}),(engine,count)=>{if(count>=2)engine.cancelReason='user';});
  const job=e.add({kind:'gather',name:'달걀',count:1});await e.run();assert.equal(attempts(),2);assert.equal(job.status,'stopped');assert.equal(e.terminal.type,'stopped');
});
for(const outcome of [{result:'stopped'},{error:'canceled'},{error:'blocked'},{error:'tool_broken'}])test(`non-attack interruption ${outcome.error||outcome.result} is never auto-retried`,async()=>{
  const {e,attempts}=await setup(()=>outcome);await e.runImmediate({kind:'gather',name:'달걀',count:1});assert.equal(attempts(),1);assert.equal(e.terminal.type,'error');
});
test('infinite gathering reports collected counts and remains stoppable during repeated attacks',async()=>{
  const {e,states,attempts}=await setup(()=>({error:'interrupted_by_attack',gained:1}),(engine,count)=>{if(count>=4)engine.cancelReason='user';});
  const job=e.add({kind:'gather',name:'달걀',count:0});await e.run();assert.equal(attempts(),4);assert.equal(job.completed,4);assert.equal(e.terminal.type,'stopped');
  assert.ok(states.some(s=>s.gathered>=3&&s.gatherTarget===null));
});
test('resumed collection counter uses completed/goal rather than resetting to zero',async()=>{
  const {e,states}=await setup(()=>({gained:3}));const job=e.add({kind:'gather',name:'달걀',count:5});job.completed=2;job.status='stopped';await e.prepareQueue();await e.run();
  assert.equal(states[0].gathered,2);assert.equal(states[0].gatherTarget,5);assert.equal(states.at(-1).gathered,5);assert.equal(job.completed,5);
});
test('production-material counters count gathered resources rather than completed production jobs',async()=>{
  const {e,states}=await setup(()=>({gained:3}));const job={kind:'craft',completed:99};await e.gather('달걀',3,job,'생산 재료');
  assert.equal(states[0].gathered,0);assert.equal(states.at(-1).gathered,3);assert.equal(states.at(-1).gatherTarget,3);assert.equal(job.completed,99);
});

test('rooster hit counter counts only attack responses and survives a resumed egg task',async()=>{
  const {e,states}=await setup(n=>n===1?{error:'interrupted_by_attack'}:{gained:1});const job=e.add({kind:'gather',name:'달걀',count:2});job.completed=1;job.roosterHits=4;job.status='stopped';
  await e.prepareQueue();await e.run();assert.equal(job.roosterHits,5);assert.equal(states[0].roosterHits,4);assert.equal(states.at(-1).roosterHits,5);e.resetQueue();assert.equal(e.queue[0].roosterHits,undefined);
});
