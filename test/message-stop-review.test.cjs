'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Engine}=require('../lib/engine.cjs'),{FakeCli,fixtureDb}=require('./fake-cli.cjs');require('../ui/agent-personality.js');
const D=globalThis.AgentDialogue;
async function fixture(){const db=fixtureDb(),cli=new FakeCli({db,stock:{천:100,광석:100},autoComplete:true}),e=new Engine(cli,{}, {db,delay:async()=>{await Promise.resolve();}});await e.connect();return {e,cli};}
for(const voice of ['A','B'])test(`single gather keeps the same item/quantity preparation sentence (${voice})`,async()=>{
 const {e,cli}=await fixture(),messages=[];e.on('change',s=>{if(s.stage.type==='checking')messages.push(D.copy(s.stage,voice).message);});
 await e.runImmediate({kind:'gather',name:'광석',count:100});assert.equal(new Set(messages).size,1);assert.match(messages[0],/광석 100개 채집/);
 assert.equal(cli.calls.filter(c=>c.command==='execute_gathering').length,1);
});
test('fully supplied production does not emit an unnecessary material preparation sentence',async()=>{
 const {e}=await fixture(),stages=[];e.on('change',s=>stages.push(s.stage.type));e.add({kind:'craft',name:'키트',count:1});await e.run();
 assert.equal(stages.includes('preparing'),false);assert.equal(stages.includes('shortage'),false);assert.equal(e.terminal.type,'done');
});
test('gathering completion shows final quantity without returning to collecting speech',async()=>{
 const {e}=await fixture(),stages=[];e.on('change',s=>stages.push({...s.stage}));await e.runImmediate({kind:'gather',name:'광석',count:100});
 const finish=stages.findIndex(s=>s.type==='stop-wait');assert.ok(finish>=0);assert.equal(stages[finish].gathered,100);
 assert.equal(stages.slice(finish+1).some(s=>['gather','shortage'].includes(s.type)),false);
 assert.match(D.copy(stages[finish]).message,/마무리/);assert.match(D.copy(stages[finish]).detail,/100 \/ 100/);
});
for(const voice of ['A','B'])test(`transient observation retry changes footer while keeping ongoing speech (${voice})`,()=>{
 const original={type:'gather',item:'달걀',gathered:2,gatherTarget:10},waiting={...original,type:'retry-read',resumeType:'gather'};
 assert.equal(D.copy(waiting,voice).message,D.copy(original,voice).message);assert.equal(D.copy(waiting,voice).detail,D.copy(original,voice).detail);assert.equal(D.copy(waiting,voice).phase,'정보 확인 중');
});
test('B stop and partial completion never concatenate repeated stock phrases',()=>{
 const stopping=D.copy({type:'stopping',text:'중단을 요청했어요. 멈췄는지 확인하고 있어요.'},'B');assert.doesNotMatch(stopping.message,/알았어|다시 눌러/);assert.equal(stopping.message,'작업을 멈추고 있어.');
 const skipped=D.copy({type:'done',skipped:1,completed:1,text:'대기줄의 작업을 모두 마쳤어요.'},'B');assert.doesNotMatch(skipped.message,/모두/);assert.match(skipped.detail,/건너뜀 1개/);
 const held=D.copy({type:'done',held:2,text:'확인이 필요한 시설 2개 작업을 보류하고 나머지 작업을 마쳤어요.'},'B');assert.match(held.message,/확인이 필요한 가공 시설/);assert.match(held.detail,/보류 2개/);
});
test('simultaneous stop clicks share a single in-flight stop request',async()=>{
 const {e,cli}=await fixture();let resolve,requests=0;e.running=true;e.activeCommand='execute_crafting';
 cli.action=async()=>{requests++;return new Promise(r=>resolve=r);};const a=e.stop(),b=e.stop();assert.equal(requests,1);resolve({});await Promise.all([a,b]);assert.equal(requests,1);
});
test('gather stop retries temporary rejection until the original action settles',async()=>{
 const {e,cli}=await fixture();let attempts=0,ticks=0,settled=false;e.running=true;e.activeCommand='execute_gathering';e.cancelReason='user';
 cli.read=async()=>({Mode:{MainButtonState:settled?'Compass':'Stop'}});cli.action=async()=>{if(++attempts<3)throw Object.assign(new Error('blocked'),{code:'blocked'});settled=true;return {};};
 e.delay=async()=>{assert.ok(++ticks<20);};await e.stopGathering(()=>settled);assert.equal(attempts,3);assert.doesNotMatch(e.stage.text||'',/다시 눌러/);
});
