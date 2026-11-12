'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Engine}=require('../lib/engine.cjs');const {FakeCli}=require('./fake-cli.cjs');
const ui=path.join(__dirname,'../ui'),context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ui,'agent-personality.js'),'utf8'),context);
const dialogue=context.AgentDialogue;
const gallery=fs.readFileSync(path.join(ui,'agent-review.js'),'utf8');
const stages=vm.runInContext(gallery.slice(gallery.indexOf('const scenarios='),gallery.indexOf('for(const [label,stage]'))+';scenarios;',context);
test('every reviewed stage has both voices and an existing portrait',()=>{
 assert.ok(stages.length>=30);
 for(const [,stage]of stages)for(const id of ['A','B']){
  const text=dialogue.copy(stage,id);assert.ok(text.message);assert.ok(fs.existsSync(path.join(ui,dialogue.portrait(id,text.image))));
  if(id==='B')assert.doesNotMatch(text.message,/요[.!?]|주세요/);
 }
 for(const id of ['A','B'])for(let i=1;i<=13;i++)assert.ok(fs.existsSync(path.join(ui,'assets/characters',id==='A'?'healer':'archer',String(i).padStart(2,'0')+'.png')));
});
test('voice selection preserves counters, outcomes, technical causes and rooster hits',()=>{
 for(const [,stage]of stages){
  const a=dialogue.copy(stage,'A'),b=dialogue.copy(stage,'B');
  assert.deepEqual(a.detail.match(/\d+/g),b.detail.match(/\d+/g));
 }
 assert.match(dialogue.copy({type:'stopping',text:'게임 창을 확인해 주세요. 중단 버튼을 다시 눌러 주세요.'},'B').message,/게임 창/);
 assert.equal(dialogue.copy({type:'stopped'},'B').image,'happy');
 assert.equal(dialogue.copy({type:'error'},'B').image,'crying');
 assert.match(dialogue.portrait('B','asking'),/10.png$/);
});
test('default agent is A and selected B survives settings persistence',()=>{
 const a=new Engine(new FakeCli());assert.equal(a.snapshot().preferences.agentCharacter,'A');
 a.preferences.agentCharacter='B';const b=new Engine(new FakeCli(),a.persistent());assert.equal(b.snapshot().preferences.agentCharacter,'B');
});
test('completion retains skipped count alongside only confirmed production results',()=>{
 const stage={type:'done',completed:1,skipped:1,text:'대기줄의 작업을 모두 마쳤어요.',results:[{name:'못',kind:'제작',count:2}]};
 for(const id of ['A','B']){
  const text=dialogue.copy(stage,id);assert.match(text.detail,/완료 1개 작업 · 건너뜀 1개/);assert.match(text.detail,/못 · 제작 2회/);assert.match(text.message,/건너/);
 }
});

test('goal stop retries preserve the achieved quantity speech and portrait',()=>{
 for(const voice of ['A','B']){
  const stage={type:'stop-wait',stopReason:'quantity',item:'농어',gathered:3,gatherTarget:3,fishing:true,fish:true};
  const initial=dialogue.copy(stage,voice),retry=dialogue.copy({...stage,stopRetry:true,text:'중단을 요청했어요.'},voice);
  assert.equal(retry.message,initial.message);assert.equal(retry.image,'happy');assert.match(retry.detail,/3 \/ 3마리/);
 }
 assert.equal(dialogue.copy({type:'stop-wait',stopReason:'quantity',item:'농어',fishing:true},'B').message,'농어를 다 잡았어!');
});
test('fishing travel and actual fishing differ and fishing loot keeps item units',()=>{
 const stage={type:'shortage',item:'농어',source:'농어 매운탕',fishing:true,fish:true,gathered:0,gatherTarget:1};
 assert.match(dialogue.copy(stage).message,/낚으러/);
 assert.equal(dialogue.copy({...stage,fishingStarted:true}).message,'농어를 낚고 있어요.');
 assert.equal(dialogue.copy({...stage,fishingStarted:true}).image,'bored');
 assert.match(dialogue.copy({...stage,item:'메아리 고둥',fish:false}).detail,/1개/);
});
test('loading and observation retry keep counters and portraits, connection loss explains recovery',()=>{
 const stage={type:'shortage',item:'달걀',source:'마요네즈',gathered:4,gatherTarget:9};
 for(const voice of ['A','B'])for(const type of ['loading','retry-read']){
  const before=dialogue.copy(stage,voice),after=dialogue.copy({...stage,type,resumeType:'shortage'},voice);
  for(const key of ['message','image','detail'])assert.equal(after[key],before[key]);
 }
 assert.match(dialogue.copy({...stage,type:'retry-read',resumeType:'shortage',retryCode:'connection_lost'}).message,/연결/);
});
test('confirmation prompt describes confirmation and stop waits never promise resuming work',()=>{
 for(const voice of ['A','B']){
  const stage={type:'ui-blocked',blockerKind:'continuous_run_limit'};
  const waiting=dialogue.copy(stage,voice);assert.match(waiting.message,/이용 확인/);assert.doesNotMatch(waiting.detail,/창을 닫/);
  const stopping=dialogue.copy({...stage,type:'stopping'},voice);assert.match(stopping.message,/중단을 마무리/);assert.doesNotMatch(stopping.message,/작업을 이어/);
 }
});
test('all skipped, partially successful, registration complete and held results have distinct presentation',()=>{
 for(const voice of ['A','B']){
  assert.equal(dialogue.copy({type:'done',completed:0,skipped:1},voice).image,'asking');
  assert.equal(dialogue.copy({type:'done',completed:1,skipped:1},voice).image,'happy');
  assert.equal(dialogue.copy({type:'done',completed:1,held:1},voice).image,'asking');
  const registered=dialogue.copy({type:'done',completed:1,processingContinues:true,results:[{name:'목재',kind:'가공 등록',count:2}]},voice);
  assert.match(registered.message,/가공 등록/);assert.match(registered.detail,/계속 진행/);
 }
});
test('terminal report keeps fish amounts, skip reasons and registration/collection counts',()=>{
 const stage={type:'done',completed:1,skipped:1,results:[{name:'농어',kind:'채집',count:2,unit:'마리'}],notices:[{name:'마요네즈',status:'skipped',reason:'식용유가 부족해요.'}]};
 for(const voice of ['A','B']){const copy=dialogue.copy(stage,voice);assert.match(copy.detail,/농어 · 채집 2마리/);assert.match(copy.detail,/마요네즈 · 건너뜀 · 식용유/);}
 const waiting=dialogue.copy({type:'waiting',details:[{name:'목재',registered:7,target:14,completed:3}]});
 assert.match(waiting.detail,/등록 7 \/ 14회 · 수령 3회/);assert.doesNotMatch(waiting.detail,/3\/14회 완료/);
});
test('new portrait or a different work item clears short speech history',()=>{
 const {AgentSpeechHistory}=require('../ui/agent-flow.js');const flow=new AgentSpeechHistory();
 flow.update({type:'craft',item:'못'},{message:'못 제작',image:'working'},'A',0);
 assert.equal(flow.update({type:'register',item:'목재'},{message:'목재 등록',image:'working'},'A',100).previous,'');
 assert.equal(flow.update({type:'loading',item:'목재'},{message:'연결 확인',image:'thoughtful'},'A',200).previous,'');
});

 test('new portraits separate gathering, fishing, user prompts and actionable failures',()=>{
 for(const id of ['A','B']){
  assert.match(dialogue.portrait(id,'confident'),id==='A'?/10.png$/:/08.png$/);
  assert.match(dialogue.portrait(id,'asking'),id==='A'?/08.png$/:/10.png$/);
  assert.equal(dialogue.copy({type:'shortage',item:'달걀'},id).image,'confident');
  assert.equal(dialogue.copy({type:'shortage',fishing:true,fishingStarted:true,item:'농어'},id).image,'bored');
  assert.equal(dialogue.copy({type:'error',errorCode:'tool_missing'},id).image,'embarrassed');
  assert.equal(dialogue.copy({type:'error',errorCode:'timeout'},id).image,'thoughtful');
  assert.equal(dialogue.copy({type:'error',errorCode:'option_off'},id).image,'asking');
  assert.match(dialogue.portrait(id,'thoughtful'),/13.png$/);
  assert.equal(dialogue.copy({type:'waiting'},id).image,'waiting');
  assert.equal(dialogue.copy({type:'gather',retrying:true,item:'달걀'},id).image,'annoyed');
 }
});
