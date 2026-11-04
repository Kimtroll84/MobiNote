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
 for(const id of ['A','B'])for(let i=1;i<=9;i++)assert.ok(fs.existsSync(path.join(ui,'assets/characters',id==='A'?'healer':'archer',String(i).padStart(2,'0')+'.png')));
});
test('voice selection preserves counters, outcomes, technical causes and rooster hits',()=>{
 for(const [,stage]of stages){
  const a=dialogue.copy(stage,'A'),b=dialogue.copy(stage,'B');
  assert.deepEqual(a.detail.match(/\d+/g),b.detail.match(/\d+/g));
 }
 assert.match(dialogue.copy({type:'stopping',text:'게임 창을 확인해 주세요. 중단 버튼을 다시 눌러 주세요.'},'B').message,/게임 창/);
 assert.equal(dialogue.copy({type:'stopped'},'B').image,'happy');
 assert.equal(dialogue.copy({type:'error'},'B').image,'crying');
 assert.match(dialogue.portrait('B','asking'),/04.png$/);
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
